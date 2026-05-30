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
from app.services.voice import synthesize_all_scenes_with_timing, split_audio_by_scenes
from app.services.visuals import get_visual_for_scene
from app.services.storage import upload_job_files, r2_enabled
from app.services.capcut import build_capcut_draft, write_manifest
from app.services.cost_tracker import build_cost_record, store_cost_record
from app.services.security import (
    register_active_job, unregister_active_job,
    track_render_abuse,
)
from app.services.agency_service import deduct_pool_tokens

settings = get_settings()
logger   = logging.getLogger(__name__)

WORKER_BASE_URL = os.environ.get("WORKER_BASE_URL", "").rstrip("/")



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
    _uid            = await redis.get(f"job:{job_id}:user_id")
    _prev           = await redis.get(f"job:{job_id}:prev_job_id")
    _ws             = await redis.get(f"job:{job_id}:ws_id")
    # decode bytes → str if Redis returns bytes instead of str
    user_id         = _uid.decode()  if isinstance(_uid,  bytes) else _uid
    prev_job_stored = _prev.decode() if isinstance(_prev, bytes) else _prev
    ws_id           = _ws.decode()   if isinstance(_ws,   bytes) else _ws
    output_dir.mkdir(parents=True, exist_ok=True)
    if user_id:
        await register_active_job(redis, user_id, job_id)
    logger.info("Job %s — user_id=%s prev_job=%s", job_id, user_id, prev_job_stored)

    try:
        # ── Stage 1: Voice synthesis ──────────────────────────────────────────
        await _set_progress(redis, job_id, "Synthesising voice...", 5)

        async def voice_progress(done, total):
            pct = 5 + int((done / total) * 35)
            await _set_progress(redis, job_id, f"Voice {done}/{total}...", pct)

        # Word timings from Edge TTS — list[list[dict]], one per scene
        # Used to sync subtitle cards to the actual spoken words
        scene_timings: list[list[dict]] = [[] for _ in req.scenes]

        # Check if any scene has a custom voice clip
        has_per_scene_voice = any(
            getattr(s, "custom_voice_url", None) for s in req.scenes
        )

        if req.uploaded_voice_path and not has_per_scene_voice:
            # Legacy: single uploaded voiceover for the whole video
            await _set_progress(redis, job_id, "Splitting uploaded voice...", 8)
            audio_files = await split_audio_by_scenes(
                audio_path=req.uploaded_voice_path,
                scenes=req.scenes,
                output_dir=str(output_dir),
            )
        elif has_per_scene_voice:
            # Per-scene custom voice clips — download each and use directly
            # Scenes without a custom clip get synthesised via TTS
            await _set_progress(redis, job_id, "Preparing voice clips...", 8)
            import httpx as _httpx
            audio_files = []
            scenes_needing_tts = []
            tts_indices = []

            for i, scene in enumerate(req.scenes):
                voice_url = getattr(scene, "custom_voice_url", None)
                if voice_url:
                    # Download the processed voice clip
                    clip_path = str(output_dir / f"scene_{i+1:02d}_custom_voice.mp3")
                    try:
                        async with _httpx.AsyncClient(timeout=30) as client:
                            resp = await client.get(voice_url, follow_redirects=True)
                            resp.raise_for_status()
                        with open(clip_path, "wb") as fh:
                            fh.write(resp.content)
                        # Use custom_voice_duration to update scene duration
                        custom_dur = getattr(scene, "custom_voice_duration", None)
                        if custom_dur and custom_dur > 0:
                            # Adjust scene duration to match voice clip (ceil to int, min 1)
                            import math
                            scene.__dict__["duration"] = max(1, math.ceil(custom_dur))
                        audio_files.append(clip_path)
                        logger.info("Custom voice ✓ scene %s → %.1fs", i+1, custom_dur or 0)
                    except Exception as e:
                        logger.warning("Custom voice download failed scene %s: %s — falling back to TTS", i+1, e)
                        audio_files.append(None)
                        scenes_needing_tts.append((i, scene))
                        tts_indices.append(i)
                else:
                    audio_files.append(None)
                    scenes_needing_tts.append((i, scene))
                    tts_indices.append(i)

            # Synthesise TTS for scenes without custom voice
            if scenes_needing_tts:
                tts_scenes = [s for _, s in scenes_needing_tts]
                tts_paths, tts_timings = await synthesize_all_scenes_with_timing(
                    scenes=tts_scenes,
                    voice_name=req.voice_name,
                    output_dir=str(output_dir),
                    speed=req.voice_speed,
                    stability=req.voice_stability if hasattr(req, "voice_stability") else "medium",
                    on_progress=voice_progress,
                )
                for idx, (i, _) in enumerate(scenes_needing_tts):
                    audio_files[i] = tts_paths[idx]
                    scene_timings[i] = tts_timings[idx]
        else:
            audio_files, scene_timings = await synthesize_all_scenes_with_timing(
                scenes=req.scenes,
                voice_name=req.voice_name,
                output_dir=str(output_dir),
                speed=req.voice_speed,
                stability=req.voice_stability if hasattr(req, "voice_stability") else "medium",
                on_progress=voice_progress,
            )

        # ── Stage 2: Fetch visuals ────────────────────────────────────────────
        await _set_progress(redis, job_id, "Fetching visuals...", 42)
        # Resolve user plan for feature gating (DALL-E = pro/studio only)
        _visual_user_plan = "free"
        if user_id:
            try:
                _raw = await redis.get(f"user:{user_id}")
                if _raw:
                    _visual_user_plan = json.loads(_raw).get("plan", "free")
            except Exception:
                pass

        visual_files = []
        for i, scene in enumerate(req.scenes):
            try:
                visual = await get_visual_for_scene(
                    scene=scene,
                    output_dir=str(output_dir),
                    source=("custom" if getattr(scene, "custom_image_url", None) else req.visual_source),
                    custom_image_url=getattr(scene, "custom_image_url", None),
                    user_plan=_visual_user_plan,
                )
                visual_files.append(visual)
                pct = 42 + int(((i + 1) / len(req.scenes)) * 12)
                await _set_progress(redis, job_id, f"Visuals {i+1}/{len(req.scenes)}...", pct)
            except Exception as e:
                logger.error("Visual fetch failed for scene %s: %s", scene.id, e)
                raise

        # ── Stage 3: FFmpeg render ────────────────────────────────────────────
        await _set_progress(redis, job_id, "Rendering video...", 55)
        _render_start = __import__('time').time()

        async def ffmpeg_progress(stage: str, pct: int):
            await _set_progress(redis, job_id, stage, pct)

        # Resolve user plan for resolution gating
        _render_user_plan = "free"
        if user_id:
            _raw_render_user = await redis.get(f"user:{user_id}")
            if _raw_render_user:
                _render_user_plan = json.loads(_raw_render_user).get("plan", "free")
            # Agency workspace members get workspace plan
            try:
                from app.services.agency_service import get_workspace_id_for_user as _gwid
                _ws_id_r = await _gwid(redis, user_id)
                if _ws_id_r:
                    _ws_raw_r = await redis.get(f"workspace:{_ws_id_r}")
                    if _ws_raw_r:
                        _ws_plan_r = json.loads(_ws_raw_r).get("plan", _render_user_plan)
                        _RANK = {"free": 0, "starter": 1, "pro": 2, "studio": 3, "agency": 4}
                        if _RANK.get(_ws_plan_r, 0) > _RANK.get(_render_user_plan, 0):
                            _render_user_plan = _ws_plan_r
            except Exception:
                pass
        from app.services.plans import get_resolution as _get_resolution
        _max_resolution = _get_resolution(_render_user_plan)

        result = await render_full_pipeline(
            scenes=req.scenes,
            audio_files=audio_files,
            visual_files=visual_files,
            output_dir=str(output_dir),
            subtitle_style=req.subtitle_style,
            music_path=req.music if req.music != "none" else None,
            on_progress=ffmpeg_progress,
            platform=req.platform,
            max_resolution=_max_resolution,
            scene_timings=scene_timings,
        )
        _render_seconds = __import__('time').time() - _render_start

        # ── Stage 3b: Watermark (free plan only) ────────────────────────────────
        await _set_progress(redis, job_id, "Finalising video...", 85)
        try:
            # Check user plan — watermark free users only
            user_plan = "free"
            if user_id:
                raw_user = await redis.get(f"user:{user_id}")
                if raw_user:
                    user_plan = json.loads(raw_user).get("plan", "free")

            if user_plan == "free":
                final_path = result.get("final_path") or result.get("output_path", "")
                if final_path and os.path.exists(final_path):
                    watermarked = final_path.replace(".mp4", "_wm.mp4")
                    wm_cmd = [
                        "ffmpeg", "-y", "-i", final_path,
                        "-vf",
                        "drawtext=text='Made with SceneForge':"
                        "fontcolor=white@0.45:"
                        "fontsize=22:"
                        "x=w-tw-18:"
                        "y=h-th-18:"
                        "shadowcolor=black@0.6:"
                        "shadowx=2:shadowy=2",
                        "-c:a", "copy",
                        "-preset", "fast",
                        watermarked,
                    ]
                    import subprocess
                    wm_result = subprocess.run(
                        wm_cmd, capture_output=True, timeout=120
                    )
                    if wm_result.returncode == 0 and os.path.exists(watermarked):
                        # Replace final video with watermarked version
                        os.replace(watermarked, final_path)
                        logger.info("Watermark applied — job %s (plan=%s)", job_id, user_plan)
                    else:
                        logger.warning("Watermark failed (non-fatal): %s",
                                       wm_result.stderr.decode()[:200])
        except Exception as e:
            logger.warning("Watermark step failed (non-fatal): %s", e)

        # ── Stage 3c: Brand kit — intro, outro, logo watermark ─────────────────
        await _set_progress(redis, job_id, "Applying brand kit...", 87)
        try:
            # Load brand kit via agency project
            brand_kit = None
            agency_proj_id = await redis.get(f"job:{job_id}:agency_proj_id")
            if agency_proj_id:
                agency_proj_id = agency_proj_id.decode() if isinstance(agency_proj_id, bytes) else agency_proj_id
                from app.services.agency_service import get_project, get_brand_kit
                agency_proj = await get_project(redis, agency_proj_id)
                if agency_proj and agency_proj.get("brand_kit_id"):
                    brand_kit = await get_brand_kit(redis, agency_proj["brand_kit_id"])

            if brand_kit:
                current_final = result.get("final_path") or result.get("output_path", "")
                out_dir = str(output_dir)

                # 1. Prepend intro clip
                intro_url = brand_kit.get("intro_url", "").strip()
                if intro_url and current_final and os.path.exists(current_final):
                    intro_out = str(Path(out_dir) / "final_with_intro.mp4")
                    current_final = await prepend_intro(current_final, intro_url, intro_out)

                # 2. Append outro clip
                outro_url = brand_kit.get("outro_url", "").strip()
                if outro_url and current_final and os.path.exists(current_final):
                    outro_out = str(Path(out_dir) / "final_with_outro.mp4")
                    current_final = await append_outro(current_final, outro_url, outro_out)

                # 3. Overlay logo watermark
                logo_url   = brand_kit.get("logo_url", "").strip()
                wm_pos     = brand_kit.get("watermark_position", "").strip()
                wm_opacity = float(brand_kit.get("watermark_opacity", 0.25) or 0.25)
                wm_scale   = float(brand_kit.get("watermark_scale",   0.12) or 0.12)
                if logo_url and wm_pos and current_final and os.path.exists(current_final):
                    wm_out = str(Path(out_dir) / "final_with_watermark.mp4")
                    current_final = await overlay_logo_watermark(
                        current_final, logo_url, wm_pos, wm_out,
                        opacity=wm_opacity, scale=wm_scale,
                    )

                # Track what was applied for logging + error surfacing
                applied = {
                    "intro":     bool(intro_url),
                    "outro":     bool(outro_url),
                    "watermark": bool(logo_url and wm_pos),
                }

                # Update result with brand-kitted final path
                if current_final != (result.get("final_path") or result.get("output_path", "")):
                    final_name = str(Path(out_dir) / "final_video.mp4")
                    if current_final != final_name:
                        import shutil
                        shutil.copy2(current_final, final_name)
                        current_final = final_name
                    result["final_path"] = current_final
                    logger.info("Brand kit applied — intro=%s outro=%s watermark=%s",
                                applied["intro"], applied["outro"], applied["watermark"])

                # Store brand kit application status on the job so UI can surface issues
                await redis.set(
                    f"job:{job_id}:brand_kit_applied",
                    json.dumps(applied),
                    ex=86400 * 7,
                )
        except Exception as e:
            logger.warning("Brand kit application failed (non-fatal): %s", e)
            # Store failure so UI can warn the owner
            try:
                await redis.set(
                    f"job:{job_id}:brand_kit_error",
                    str(e),
                    ex=86400 * 7,
                )
            except Exception:
                pass

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

        # ── Rename final video to project title ─────────────────────────────────
        _raw_title = getattr(req, "project_title", None) or payload.get("project_title", "") or "SceneForge Video"
        import re as _re
        # Slug: keep letters/numbers/spaces, replace spaces with underscores, max 60 chars
        _slug = _re.sub(r"[^\w\s-]", "", _raw_title).strip()
        _slug = _re.sub(r"[\s]+", "_", _slug)[:60] or "SceneForge_Video"
        _friendly_name = f"{_slug}.mp4"
        # Rename the final video file so R2 key and download filename match the project
        for _candidate in ("final_video_music.mp4", "final_video.mp4"):
            _src_path = output_dir / _candidate
            if _src_path.exists():
                _dst_path = output_dir / _friendly_name
                import shutil as _shutil
                _shutil.copy2(str(_src_path), str(_dst_path))
                logger.info("Renamed final video → %s", _friendly_name)
                break

        if r2_enabled():
            await _set_progress(redis, job_id, "Uploading to cloud storage...", 92)
            try:
                r2_urls = await upload_job_files(job_id, str(output_dir))
                # Prefer project-titled file, fall back to generic names
                for name in (_friendly_name, "final_video_music.mp4", "final_video.mp4"):
                    if name in r2_urls:
                        video_url = r2_urls[name]
                        break
                logger.info("R2 upload complete — job %s video_url: %s", job_id, video_url)
            except Exception as e:
                logger.error("R2 upload failed for job %s: %s", job_id, e)

        if not video_url:
            video_url = f"{WORKER_BASE_URL}/renders/{job_id}/final_video.mp4"

        # ── Stage 6: Token deduction ──────────────────────────────────────────
        tokens_remaining  = 0
        _tokens_deducted  = 0   # track actual deduction for refund on failure
        _deducted_from_ws = False
        is_re_render      = bool(prev_job_stored or payload.get("prev_job_id"))

        if user_id:
            try:
                from app.services.auth import deduct_tokens, get_token_balance
                if not is_re_render:
                    scene_count = len(req.scenes) if hasattr(req, 'scenes') else 0
                    _dalle_count = int(getattr(req, 'dalle_images', 0) or 0)
                    render_cost  = 100 + (_dalle_count * 200)  # 100 base + 200 per DALL-E image
                    proj_id    = payload.get("agency_project_id", "")
                    proj_title = payload.get("project_title", "")
                    if ws_id:
                        # Agency workspace — deduct from shared pool
                        try:
                            new_balance = await deduct_pool_tokens(
                                redis, ws_id, render_cost,
                                user_id=user_id, job_id=job_id,
                                scene_count=scene_count,
                                project_id=proj_id, project_title=proj_title,
                            )
                            tokens_remaining   = new_balance
                            _tokens_deducted   = render_cost
                            _deducted_from_ws  = True
                            logger.info("Pool tokens deducted ✓ — ws=%s remaining=%d",
                                        ws_id, tokens_remaining)
                        except ValueError:
                            # Pool exhausted — fall back to user tokens
                            logger.warning("Pool exhausted for ws=%s — falling back to user tokens", ws_id)
                            user_out = await deduct_tokens(
                                redis, user_id, job_id,
                                scene_count=scene_count, project_id=proj_id, project_title=proj_title,
                            )
                            tokens_remaining = user_out.tokens_remaining
                    else:
                        # Regular user — deduct from personal tokens
                        user_out = await deduct_tokens(
                            redis, user_id, job_id,
                            scene_count=scene_count, project_id=proj_id, project_title=proj_title,
                        )
                        tokens_remaining  = user_out.tokens_remaining
                        _tokens_deducted  = render_cost
                        _deducted_from_ws = False
                        logger.info("Tokens deducted ✓ — user=%s remaining=%d",
                                    user_id, tokens_remaining)
                else:
                    # Re-render — just read balance, don't deduct
                    if ws_id:
                        raw_pool = await redis.get(f"agency:tokens:{ws_id}")
                        tokens_remaining = int(raw_pool) if raw_pool else 0
                    else:
                        bal = await get_token_balance(redis, user_id)
                        tokens_remaining = bal["tokens_remaining"]
                    logger.info("Re-render — tokens not deducted, remaining=%d", tokens_remaining)
            except Exception as e:
                logger.error("Token deduction failed for user %s: %s", user_id, e, exc_info=True)
        else:
            logger.warning("No user_id — tokens not deducted for job %s", job_id)

        # ── Stage 7: Render complete email ────────────────────────────────────
        if user_id:
            try:
                raw_user = await redis.get(f"user:{user_id}")
                if raw_user:
                    user_data = json.loads(raw_user)
                    from app.services.email import send_render_complete
                    # Get project_id from payload for deep link
                    project_id = payload.get("project_id") or payload.get("project_title", "")
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
        # Store individual scene URLs for partial re-render
        scene_urls: list[str] = []
        for i in range(len(req.scenes)):
            padded = str(i + 1).zfill(2)
            key = f"scene_{padded}.mp4"
            if key in r2_urls:
                scene_urls.append(r2_urls[key])
        if scene_urls:
            await redis.set(
                f"job:{job_id}:scene_urls",
                json.dumps(scene_urls),
                ex=86400 * 7
            )

        # Store scenes for re-render restoration (7-day TTL)
        # This allows My Videos to restore scenes without the user
        # needing to go through the full workflow again.
        try:
            scenes_payload = [s.dict() if hasattr(s, 'dict') else vars(s) for s in req.scenes]
            await redis.set(
                f"render:scenes:{job_id}",
                json.dumps(scenes_payload),
                ex=86400 * 7
            )
        except Exception:
            pass

        final_result = {
            "status":           "complete",
            "stage":            "Done",
            "pct":              100,
            "job_id":           job_id,
            "video_url":        video_url,
            "r2_urls":          r2_urls,
            "scene_urls":       scene_urls,
            "scene_count":      len(req.scenes),
            "total_duration":   sum(s.duration for s in req.scenes),
            "tokens_remaining": tokens_remaining,
            "is_re_render":     is_re_render,
        }
        await redis.set(f"job:{job_id}:progress", json.dumps(final_result), ex=86400)
        if user_id:
            await unregister_active_job(redis, user_id, job_id)
            await track_render_abuse(redis, user_id, tokens_used=100, failed=False)
        logger.info("Render complete — job %s | %s", job_id, video_url)

        # ── Cost tracking ─────────────────────────────────────────────────────
        try:
            _user_plan = "free"
            _plan_price_ngn = 0.0
            _plan_tokens = 100        # tokens bundled in this plan purchase
            _exchange_rate = 1600.0
            if user_id:
                _raw_user = await redis.get(f"user:{user_id}")
                if _raw_user:
                    _ud = json.loads(_raw_user)
                    _user_plan = _ud.get("plan", "free")

            # Get plan price and token bundle size from Redis pricing
            try:
                from app.services.pricing import get_plans
                plans = await get_plans(redis)
                _plan_data = plans.get(_user_plan, {})
                _plan_price_ngn = float(_plan_data.get("amount", 0))
                _plan_tokens    = int(_plan_data.get("tokens", 100))
                # Get cached exchange rate
                _rate_raw = await redis.get("sceneforge:exchange:usd_ngn")
                if _rate_raw:
                    _exchange_rate = float(_rate_raw)
            except Exception:
                pass

            # Count total chars across all scenes for voice cost
            _total_chars = sum(len(s.text) for s in req.scenes)
            _dalle_images = len([v for v in visual_files if hasattr(v, 'source') and v.source == 'dalle'])

            # Voice provider — ElevenLabs only for studio plan when key is set
            _el_voices = {"Marcus", "Sophie", "Alex", "Jordan", "Luna", "Kai"}
            _voice_provider = (
                "elevenlabs"
                if settings.elevenlabs_api_key
                and _user_plan == "studio"
                and getattr(req, "voice_name", "") in _el_voices
                else "edge_tts"
            )

            # AI provider — Pro/Studio/Agency use OpenAI when key is set; others use Groq
            _PREMIUM_PLANS = {"pro", "studio", "agency"}
            _ai_provider = (
                "openai"
                if _user_plan in _PREMIUM_PLANS and getattr(settings, "openai_api_key", "")
                else "groq"
            )

            # Actual render wall-clock time
            _render_secs = float(result.get("render_seconds", 0) if isinstance(result, dict) else 0) or 30.0

            # Real AI token usage — stored by generate.py when scenes were generated
            _ai_in, _ai_out = 0, 0
            if user_id:
                try:
                    _tok_raw = await redis.get(f"user:{user_id}:pending_ai_tokens")
                    if _tok_raw:
                        _tok_data = json.loads(_tok_raw if isinstance(_tok_raw, str) else _tok_raw.decode())
                        _ai_in  = int(_tok_data.get("ai_input_tokens",  0))
                        _ai_out = int(_tok_data.get("ai_output_tokens", 0))
                        await redis.delete(f"user:{user_id}:pending_ai_tokens")
                except Exception:
                    pass
            if not _ai_in:  _ai_in  = 1200 if _ai_provider == "openai" else 800
            if not _ai_out: _ai_out = 600  if _ai_provider == "openai" else 400

            # Niche from Redis (stored by render.py at job creation, 86400s TTL)
            _niche = ""
            try:
                _n_raw = await redis.get(f"job:{job_id}:niche")
                _niche = (_n_raw.decode() if isinstance(_n_raw, bytes) else _n_raw) or ""
            except Exception:
                pass

            # Username / email for display in cost log
            _username, _user_email = "", ""
            if user_id:
                try:
                    _u_raw = await redis.get(f"user:{user_id}")
                    if _u_raw:
                        _ud2 = json.loads(_u_raw)
                        _username   = _ud2.get("full_name", "")
                        _user_email = _ud2.get("email", "")
                except Exception:
                    pass

            _cost_rec = build_cost_record(
                job_id=job_id,
                user_id=user_id or "",
                plan=_user_plan,
                scenes=len(req.scenes),
                visual_source=getattr(req, 'visual_source', 'pexels_video') or 'pexels_video',
                voice_provider=_voice_provider,
                total_chars=_total_chars,
                ai_provider=_ai_provider,
                ai_input_tokens=_ai_in,
                ai_output_tokens=_ai_out,
                render_seconds=_render_secs,
                dalle_images=_dalle_images,
                plan_price_ngn=_plan_price_ngn,
                plan_tokens=_plan_tokens,
                exchange_rate=_exchange_rate,
                niche=_niche,
                tokens_consumed=render_cost,  # 100 base + 200 per DALL-E image
                username=_username,
                user_email=_user_email,
            )
            await store_cost_record(redis, _cost_rec)
        except Exception as _cost_err:
            logger.warning("Cost tracking failed (non-fatal): %s", _cost_err)

        return final_result

    except Exception as e:
        logger.exception("Render failed — job %s: %s", job_id, e)
        await redis.set(f"job:{job_id}:progress", json.dumps({
            "status": "failed", "stage": "Failed",
            "pct": 0, "job_id": job_id, "error": str(e),
        }), ex=3600)

        # ── Token refund ──────────────────────────────────────────────────────
        # If tokens were deducted (Stage 6 ran) but the job ultimately failed,
        # refund the full amount so the user is never charged for a failed render.
        if user_id and _tokens_deducted > 0:
            try:
                if _deducted_from_ws and ws_id:
                    from app.services.agency_service import add_pool_tokens
                    new_bal = await add_pool_tokens(redis, ws_id, _tokens_deducted)
                    logger.info("Pool tokens refunded ✓ — ws=%s amount=%d new_balance=%d",
                                ws_id, _tokens_deducted, new_bal)
                else:
                    from app.services.auth_service import add_tokens as _add_tokens
                    await _add_tokens(redis, user_id, _tokens_deducted)
                    logger.info("Tokens refunded ✓ — user=%s amount=%d", user_id, _tokens_deducted)
                # Store refund record so admin panel can see it
                await redis.set(
                    f"job:{job_id}:refund",
                    json.dumps({"amount": _tokens_deducted, "reason": str(e)[:200]}),
                    ex=86400 * 30,
                )
            except Exception as _re:
                logger.error("Token refund FAILED for job %s user %s: %s", job_id, user_id, _re)

        # Always free the concurrency slot — even on failure
        if user_id:
            try:
                await unregister_active_job(redis, user_id, job_id)
                logger.info("Freed concurrency slot for user %s after failed job %s", user_id, job_id)
            except Exception as _ue:
                logger.warning("unregister_active_job failed: %s", _ue)
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
    """Called by ARQ when worker starts."""
    from app.services.storage import r2_enabled
    enabled = r2_enabled()
    logger.info("Worker started — R2 enabled: %s", enabled)
    if not enabled:
        import os
        missing = [k for k in ["R2_ACCOUNT_ID","R2_ACCESS_KEY","R2_SECRET_KEY","R2_BUCKET"]
                   if not os.environ.get(k)]
        logger.warning("R2 disabled — missing: %s", missing)


class WorkerSettings:
    functions      = [render_video]
    on_startup     = startup
    redis_settings = _make_redis_settings(settings.redis_url)
    max_jobs       = 2
    job_timeout    = 600
