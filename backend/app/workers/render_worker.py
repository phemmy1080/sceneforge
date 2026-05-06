from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path

import redis.asyncio as aioredis

from app.config import get_settings
from app.models.schemas import RenderRequest
from app.services.ffmpeg import render_full_pipeline
from app.services.voice import synthesize_all_scenes, split_audio_by_scenes
from app.services.visuals import get_visual_for_scene
from app.services.storage import upload_job_files, r2_enabled
from app.services.capcut import build_capcut_draft, write_manifest

settings = get_settings()
logger   = logging.getLogger(__name__)

WORKER_BASE_URL = os.environ.get("WORKER_BASE_URL", "").rstrip("/")

# Log R2 config on startup so we can see what the worker sees
def _log_r2_status():
    account = os.environ.get("R2_ACCOUNT_ID", "")
    access  = os.environ.get("R2_ACCESS_KEY", "")
    secret  = os.environ.get("R2_SECRET_KEY", "")
    bucket  = os.environ.get("R2_BUCKET", "")
    pub_url = os.environ.get("R2_PUBLIC_URL", "")
    logger.info("R2 STATUS — account_id=%s access_key=%s secret_key=%s bucket=%s pub_url=%s",
        account[:8] + "..." if account else "MISSING",
        access[:8]  + "..." if access  else "MISSING",
        secret[:8]  + "..." if secret  else "MISSING",
        bucket      or "MISSING",
        pub_url     or "MISSING",
    )

_log_r2_status()


async def _set_progress(redis, job_id: str, stage: str, pct: int, extra: dict | None = None):
    data = {"status": "processing", "stage": stage, "pct": pct, "job_id": job_id}
    if extra:
        data.update(extra)
    await redis.set(f"job:{job_id}:progress", json.dumps(data), ex=3600)


async def render_video(ctx, job_id: str, payload: dict):
    redis      = ctx["redis"]
    req        = RenderRequest(**payload)
    output_dir = Path(settings.renders_dir) / job_id

    # user_id and prev_job_id are stored in Redis by render.py (not in payload)
    user_id    = await redis.get(f"job:{job_id}:user_id")
    prev_job_stored = await redis.get(f"job:{job_id}:prev_job_id")
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        # ── Stage 1: Voice synthesis ──────────────────────────────────────────
        await _set_progress(redis, job_id, "Synthesising voice...", 5)

        async def voice_progress(done, total):
            pct = 5 + int((done / total) * 35)
            await _set_progress(redis, job_id, f"Voice {done}/{total}...", pct)

        if req.uploaded_voice_path:
            await _set_progress(redis, job_id, "Splitting uploaded voice...", 8)
            audio_files = await split_audio_by_scenes(
                audio_path=req.uploaded_voice_path,
                scenes=req.scenes,
                output_dir=str(output_dir),
            )
        else:
            audio_files = await synthesize_all_scenes(
                scenes=req.scenes,
                voice_name=req.voice_name,
                output_dir=str(output_dir),
                speed=req.voice_speed,
                stability=req.voice_stability if hasattr(req, "voice_stability") else "medium",
                on_progress=voice_progress,
            )

        # ── Stage 2: Fetch visuals ────────────────────────────────────────────
        await _set_progress(redis, job_id, "Fetching visuals...", 42)
        visual_files = []
        for i, scene in enumerate(req.scenes):
            try:
                visual = await get_visual_for_scene(
                    scene=scene,
                    output_dir=str(output_dir),
                    source=req.visual_source,
                )
                visual_files.append(visual)
                pct = 42 + int(((i + 1) / len(req.scenes)) * 12)
                await _set_progress(redis, job_id, f"Visuals {i+1}/{len(req.scenes)}...", pct)
            except Exception as e:
                logger.error("Visual fetch failed for scene %s: %s", scene.id, e)
                raise

        # ── Stage 3: FFmpeg render ────────────────────────────────────────────
        await _set_progress(redis, job_id, "Rendering video...", 55)

        async def ffmpeg_progress(stage: str, pct: int):
            await _set_progress(redis, job_id, stage, pct)

        result = await render_full_pipeline(
            scenes=req.scenes,
            audio_files=audio_files,
            visual_files=visual_files,
            output_dir=str(output_dir),
            subtitle_style=req.subtitle_style,
            music_path=req.music if req.music != "none" else None,
            on_progress=ffmpeg_progress,
            platform=req.platform,
        )

        # ── Stage 4: CapCut draft ─────────────────────────────────────────────
        await _set_progress(redis, job_id, "Generating CapCut package...", 88)
        try:
            capcut_draft = build_capcut_draft(
                scenes=req.scenes,
                scene_files=result["scene_paths"],
                project_title=getattr(req, "project_title", None) or "SceneForge Export",
            )
            draft_path = str(output_dir / "draft_content.json")
            with open(draft_path, "w") as f:
                json.dump(capcut_draft, f, indent=2)
            write_manifest(
                scenes=req.scenes,
                scene_files=result["scene_paths"],
                final_path=result["final_path"],
                project_title=getattr(req, "project_title", None) or "SceneForge Export",
                output_path=str(output_dir / "manifest.json"),
            )
        except Exception as e:
            logger.warning("CapCut draft generation failed (non-fatal): %s", e)

        # ── Stage 5: Upload to R2 ─────────────────────────────────────────────
        r2_urls:   dict[str, str] = {}
        video_url: str | None     = None

        if r2_enabled():
            await _set_progress(redis, job_id, "Uploading to cloud storage...", 92)
            try:
                r2_urls = await upload_job_files(job_id, str(output_dir))
                for name in ("final_video_music.mp4", "final_video.mp4"):
                    if name in r2_urls:
                        video_url = r2_urls[name]
                        break
                logger.info("R2 upload complete — job %s video_url: %s", job_id, video_url)
            except Exception as e:
                logger.error("R2 upload failed for job %s: %s", job_id, e)

        if not video_url:
            video_url = f"{WORKER_BASE_URL}/renders/{job_id}/final_video.mp4"

        # ── Stage 6: Token deduction ──────────────────────────────────────────
        tokens_remaining = 0
        is_re_render     = bool(prev_job_stored or payload.get("prev_job_id"))

        if user_id and not is_re_render:
            try:
                raw_user = await redis.get(f"user:{user_id}")
                if raw_user:
                    user_data = json.loads(raw_user)
                    cost      = getattr(settings, "cost_per_video", 100)
                    new_bal   = max(0, user_data.get("tokens_remaining", 0) - cost)
                    user_data["tokens_remaining"] = new_bal
                    user_data["videos_created"]   = user_data.get("videos_created", 0) + 1
                    await redis.set(f"user:{user_id}", json.dumps(user_data))
                    tokens_remaining = new_bal
                    logger.info("Tokens deducted — user=%s cost=%d remaining=%d",
                                user_id, cost, new_bal)
            except Exception as e:
                logger.error("Token deduction failed for user %s: %s", user_id, e)
        elif user_id and is_re_render:
            try:
                raw_user = await redis.get(f"user:{user_id}")
                if raw_user:
                    tokens_remaining = json.loads(raw_user).get("tokens_remaining", 0)
            except Exception:
                pass

        # ── Stage 7: Render complete email ────────────────────────────────────
        if user_id:
            try:
                raw_user = await redis.get(f"user:{user_id}")
                if raw_user:
                    user_data = json.loads(raw_user)
                    from app.services.email import send_render_complete
                    await send_render_complete(
                        to_email=user_data.get("email", ""),
                        full_name=user_data.get("full_name", "Creator"),
                        project_title=getattr(req, "project_title", None) or "Your video",
                        scene_count=len(req.scenes),
                        duration=int(sum(s.duration for s in req.scenes)),
                        video_url=video_url,
                        tokens_remaining=tokens_remaining,
                    )
                    logger.info("Render complete email sent → %s", user_data.get("email"))
            except Exception as e:
                logger.error("Render complete email failed: %s", e)

        # ── Done ──────────────────────────────────────────────────────────────
        final_result = {
            "status":           "complete",
            "stage":            "Done",
            "pct":              100,
            "job_id":           job_id,
            "video_url":        video_url,
            "r2_urls":          r2_urls,
            "scene_count":      len(req.scenes),
            "total_duration":   sum(s.duration for s in req.scenes),
            "tokens_remaining": tokens_remaining,
            "is_re_render":     is_re_render,
        }
        await redis.set(f"job:{job_id}:progress", json.dumps(final_result), ex=86400)
        logger.info("Render complete — job %s | %s", job_id, video_url)
        return final_result

    except Exception as e:
        logger.exception("Render failed — job %s: %s", job_id, e)
        await redis.set(f"job:{job_id}:progress", json.dumps({
            "status": "failed", "stage": "Failed",
            "pct": 0, "job_id": job_id, "error": str(e),
        }), ex=3600)
        raise


from arq.connections import RedisSettings
from urllib.parse import urlparse as _urlparse

def _make_redis_settings(url: str) -> RedisSettings:
    p = _urlparse(url)
    return RedisSettings(
        host=p.hostname or "localhost",
        port=p.port or 6379,
        password=p.password or None,
        database=int((p.path or "/0").lstrip("/") or 0),
        ssl=p.scheme in ("rediss",),
    )

async def startup(ctx):
    """Called by ARQ when worker starts — perfect place for diagnostics."""
    import os
    account = os.environ.get("R2_ACCOUNT_ID", "")
    access  = os.environ.get("R2_ACCESS_KEY", "")
    secret  = os.environ.get("R2_SECRET_KEY", "")
    bucket  = os.environ.get("R2_BUCKET", "")
    pub_url = os.environ.get("R2_PUBLIC_URL", "")
    logger.info(
        "=== WORKER STARTUP === R2: account=%s access=%s secret=%s bucket=%s url=%s",
        account[:8] + "..." if account else "MISSING",
        access[:8]  + "..." if access  else "MISSING",
        secret[:8]  + "..." if secret  else "MISSING",
        bucket      or "MISSING",
        pub_url     or "MISSING",
    )
    logger.info("=== WORKER STARTUP === redis_url=%s",
        settings.redis_url[:30] + "..." if settings.redis_url else "MISSING")


class WorkerSettings:
    functions      = [render_video]
    on_startup     = startup
    redis_settings = _make_redis_settings(settings.redis_url)
    max_jobs       = 2
    job_timeout    = 600
