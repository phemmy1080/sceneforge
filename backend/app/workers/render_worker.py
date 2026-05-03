from __future__ import annotations

"""
ARQ background worker.
Run with:  python -m arq app.workers.render_worker.WorkerSettings
"""
import json
import os
import logging
from pathlib import Path

import arq
import arq.connections
import redis.asyncio as aioredis

from app.config import get_settings
from app.models.schemas import RenderRequest
from app.services.voice import synthesize_all_scenes, split_audio_by_scenes
from app.services.visuals import get_visuals_for_all_scenes
from app.services.ffmpeg import render_full_pipeline
from app.services.storage import upload_to_s3
from app.services.capcut import build_capcut_draft, write_manifest
from app.services import auth as auth_service

settings = get_settings()
logger = logging.getLogger(__name__)


async def _set_progress(redis, job_id: str, stage: str, pct: int):
    await redis.set(
        f"job:{job_id}:progress",
        json.dumps({"stage": stage, "pct": pct, "status": "processing"}),
        ex=3600,
    )


async def render_video(ctx: dict, job_id: str, request_data: dict):
    redis: aioredis.Redis = ctx["redis"]
    req = RenderRequest(**request_data)

    output_dir = Path(settings.renders_dir) / job_id
    output_dir.mkdir(parents=True, exist_ok=True)

    # Retrieve user_id stored by the API at queue time
    # Decode from bytes — ARQ's redis ctx does not use decode_responses=True
    _raw_user_id = await redis.get(f"job:{job_id}:user_id")
    _raw_prev_job = await redis.get(f"job:{job_id}:prev_job_id")
    user_id = _raw_user_id.decode() if isinstance(_raw_user_id, bytes) else _raw_user_id
    prev_job_id = _raw_prev_job.decode() if isinstance(_raw_prev_job, bytes) else _raw_prev_job

    # Is this a re-render of an already-charged job?
    is_re_render = False
    if user_id and prev_job_id:
        is_re_render = bool(await redis.sismember(
            f"user:{user_id}:charged_jobs", prev_job_id
        ))

    try:
        # ── Stage 1: Voice ────────────────────────────────────────────────
        await _set_progress(redis, job_id, "Synthesising voice...", 5)

        async def voice_progress(done, total):
            pct = 5 + int((done / total) * 30)
            await _set_progress(redis, job_id, f"Voice: scene {done}/{total}", pct)

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
                on_progress=voice_progress,
            )

        # ── Stage 2: Visuals ──────────────────────────────────────────────
        await _set_progress(redis, job_id, "Fetching visuals...", 35)

        async def visual_progress(done, total):
            pct = 35 + int((done / total) * 20)
            await _set_progress(redis, job_id, f"Visuals: scene {done}/{total}", pct)

        visual_files = await get_visuals_for_all_scenes(
            scenes=req.scenes,
            output_dir=str(output_dir),
            source=req.visual_source,
            on_progress=visual_progress,
        )

        # ── Stage 3: FFmpeg ───────────────────────────────────────────────
        await _set_progress(redis, job_id, "Rendering scenes...", 55)

        async def ffmpeg_progress(stage_msg, pct):
            await _set_progress(redis, job_id, stage_msg, pct)

        result = await render_full_pipeline(
            scenes=req.scenes,
            audio_files=audio_files,
            visual_files=visual_files,
            output_dir=str(output_dir),
            subtitle_style=req.subtitle_style,
            on_progress=ffmpeg_progress,
            platform=req.platform,
        )

        # ── Stage 4: Manifests ────────────────────────────────────────────
        await _set_progress(redis, job_id, "Writing export files...", 92)

        write_manifest(
            scenes=req.scenes,
            scene_files=result["scene_paths"],
            final_path=result["final_path"],
            project_title=req.project_title,
            output_path=str(output_dir / "manifest.json"),
        )

        capcut_draft = build_capcut_draft(
            scenes=req.scenes,
            scene_files=result["scene_paths"],
            project_title=req.project_title,
        )
        with open(output_dir / "draft_content.json", "w") as f:
            json.dump(capcut_draft, f, indent=2)

        # ── Stage 5: S3 (optional) ────────────────────────────────────────
        video_url = None
        if settings.s3_bucket:
            await _set_progress(redis, job_id, "Uploading to storage...", 95)
            video_url = await upload_to_s3(
                result["final_path"],
                f"renders/{job_id}/final_video.mp4",
            )

        # ── Stage 6: Deduct tokens + update scene stats ───────────────────
        tokens_remaining = None
        scene_count = len(req.scenes)
        if user_id and not is_re_render:
            try:
                # Create a fresh Redis connection with decode_responses=True for auth ops
                import redis.asyncio as aioredis
                auth_redis = await aioredis.from_url(
                    settings.redis_url, decode_responses=True
                )
                updated_user = await auth_service.deduct_tokens(auth_redis, user_id, job_id)
                tokens_remaining = updated_user.tokens_remaining
                # Track scene count for analytics
                await auth_service.update_scene_stats(auth_redis, user_id, scene_count)
                await auth_redis.aclose()
                logger.info(
                    "Tokens deducted — user %s | job %s | remaining: %s",
                    user_id, job_id, tokens_remaining,
                )
            except Exception as e:
                # Don't fail the render just because token deduction failed
                logger.error("Token deduction failed for user %s: %s", user_id, e)
        elif user_id and is_re_render:
            import redis.asyncio as aioredis
            auth_redis = await aioredis.from_url(
                settings.redis_url, decode_responses=True
            )
            bal = await auth_service.get_token_balance(auth_redis, user_id)
            tokens_remaining = bal["tokens_remaining"]
            # Still track scene stats even for re-renders
            await auth_service.update_scene_stats(auth_redis, user_id, scene_count)
            await auth_redis.aclose()
            tokens_remaining = bal["tokens_remaining"]
            logger.info("Re-render — user %s | no tokens deducted", user_id)

        # ── Done ──────────────────────────────────────────────────────────
        final_result = {
            "status": "complete",
            "stage": "Done",
            "pct": 100,
            "job_id": job_id,
            "video_url": video_url or f"{os.environ.get('WORKER_BASE_URL', '')}/renders/{job_id}/final_video.mp4",
            "scene_count": len(req.scenes),
            "total_duration": sum(s.duration for s in req.scenes),
            "tokens_remaining": tokens_remaining,
            "is_re_render": is_re_render,
        }

        await redis.set(
            f"job:{job_id}:progress",
            json.dumps(final_result),
            ex=86400,
        )

        return final_result

    except Exception as exc:
        await redis.set(
            f"job:{job_id}:progress",
            json.dumps({"status": "failed", "stage": "Error", "pct": 0, "error": str(exc)}),
            ex=3600,
        )
        raise


class WorkerSettings:
    functions = [render_video]
    redis_settings = arq.connections.RedisSettings.from_dsn(settings.redis_url)
    max_jobs = 2
    job_timeout = 900
    keep_result = 86400
