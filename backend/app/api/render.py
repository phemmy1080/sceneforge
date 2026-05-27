import uuid
import json
import logging
from typing import Optional
from pydantic import BaseModel

from fastapi import APIRouter, HTTPException, Header, Request, UploadFile, File, Form

from app.config import get_settings
from app.models.schemas import RenderRequest, RenderJobResponse, JobStatusResponse
from app.services import auth as auth_service
from app.middleware.rate_limit import limiter
from app.services.plans import get_limits, check_scene_limit
from app.services.security import (
    check_queue_capacity, check_user_concurrency, check_recursive_job,
    register_active_job, track_render_abuse, track_ip_request,
    check_ip_blocked, validate_job_id,
)
from app.services.agency_service import get_workspace_id_for_user

settings = get_settings()
router = APIRouter()
logger = logging.getLogger(__name__)


async def _get_redis():
    try:
        import redis.asyncio as aioredis
        return await aioredis.from_url(settings.redis_url, decode_responses=True)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Redis unavailable: {e}")


def _extract_user_id(authorization: Optional[str]) -> Optional[str]:
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not token:
        return None
    return auth_service.verify_token(token)


@router.post("/start", response_model=RenderJobResponse)
@limiter.limit("5/minute")
async def start_render(
    request: Request,
    req: RenderRequest,
    authorization: Optional[str] = Header(None),
):
    """
    Enqueue a render job.
    Checks token balance first — deduction happens after successful render.
    Re-renders of the same job_id are always free.
    """
    try:
        import arq
        import arq.connections
    except ImportError:
        raise HTTPException(status_code=503, detail="arq not installed")

    redis = await _get_redis()
    user_id = _extract_user_id(authorization)

    # ── Security checks ───────────────────────────────────────────────────────
    from fastapi import Request as _Req
    client_ip = (
        request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or (request.client.host if request.client else "unknown")
    )
    await check_ip_blocked(redis, client_ip)
    await track_ip_request(redis, client_ip, "render_start")
    await check_queue_capacity(redis)

    # ── Token check ──────────────────────────────────────────────────────────
    # Generate a new job_id — each render start gets a fresh one
    job_id = str(uuid.uuid4())

    # If the request carries a previous job_id (re-render), check if already charged
    prev_job_id = getattr(req, "prev_job_id", None)

    if user_id:
        check_id = prev_job_id or job_id
        check = await auth_service.check_can_render(redis, user_id, check_id)

        if not check["can_render"]:
            await redis.aclose()
            raise HTTPException(
                status_code=402,
                detail={
                    "error": "insufficient_tokens",
                    "message": check["reason"],
                    "tokens_remaining": check["tokens_remaining"],
                    "cost_per_video": 100,
                }
            )

        # ── Plan feature limits ───────────────────────────────────────────────
        import json as _json
        raw_user = await redis.get(f"user:{user_id}")
        user_plan = "free"
        if raw_user:
            user_plan = _json.loads(raw_user).get("plan", "free")

        # Agency workspace members inherit workspace plan for all limits
        # so editors on free personal plans get agency-tier render limits
        try:
            from app.services.agency_service import get_workspace_id_for_user
            _ws_id_for_plan = await get_workspace_id_for_user(redis, user_id)
            if _ws_id_for_plan:
                _ws_raw = await redis.get(f"workspace:{_ws_id_for_plan}")
                if _ws_raw:
                    _ws_plan = _json.loads(_ws_raw).get("plan", user_plan)
                    _RANK = {"free": 0, "pro": 1, "studio": 2, "agency": 3}
                    if _RANK.get(_ws_plan, 0) > _RANK.get(user_plan, 0):
                        user_plan = _ws_plan
        except Exception:
            pass

        limits = get_limits(user_plan)

        # Scene count limit (skip for re-renders)
        # ── Queue isolation: concurrency + spam ────────────────────────────
        await check_user_concurrency(redis, user_id, user_plan)
        await check_recursive_job(redis, user_id, job_id, getattr(req, "prev_job_id", None))

        if not prev_job_id:
            scene_count = len(req.scenes)
            allowed, max_scenes = check_scene_limit(user_plan, scene_count)
            if not allowed:
                await redis.aclose()
                raise HTTPException(
                    status_code=403,
                    detail={
                        "error": "scene_limit_exceeded",
                        "message": f"Free plan is limited to {max_scenes} scenes. You have {scene_count}. Upgrade to create longer videos.",
                        "max_scenes": max_scenes,
                        "upgrade_required": True,
                    }
                )

            # Daily render limit
            max_daily = limits["max_renders_per_day"]
            if max_daily != -1:
                import datetime
                today = datetime.date.today().isoformat()
                daily_key = f"renders:daily:{user_id}:{today}"
                daily_count = await redis.get(daily_key)
                daily_count = int(daily_count) if daily_count else 0

                if daily_count >= max_daily:
                    await redis.aclose()
                    raise HTTPException(
                        status_code=403,
                        detail={
                            "error": "daily_limit_exceeded",
                            "message": f"{limits['label']} plan allows {max_daily} renders per day. You've used all {max_daily} today. Try again tomorrow.",
                            "daily_limit": max_daily,
                            "used_today": daily_count,
                            "upgrade_required": True,
                        }
                    )

                # Increment daily counter (expires after 25 hours for safety)
                await redis.incr(daily_key)
                await redis.expire(daily_key, 90000)

        logger.info(
            "Render %s | user %s | re_render=%s | tokens=%s",
            job_id, user_id, check.get("is_re_render"), check["tokens_remaining"],
        )

    # ── Queue job ────────────────────────────────────────────────────────────
    await redis.set(
        f"job:{job_id}:progress",
        json.dumps({"status": "queued", "stage": "Queued", "pct": 0}),
        ex=3600,
    )

    # Store user_id alongside the job so the worker can deduct after success
    if user_id:
        await redis.set(f"job:{job_id}:user_id", user_id, ex=86400)
        # Store workspace_id so worker can deduct from shared pool
        try:
            ws_id = await get_workspace_id_for_user(redis, user_id)
            if ws_id:
                # Block suspended members from rendering
                suspended = await redis.get(f"workspace:suspended:{ws_id}:{user_id}")
                if suspended:
                    raise HTTPException(
                        status_code=403,
                        detail="Your workspace access has been suspended. Contact the workspace owner."
                    )
                await redis.set(f"job:{job_id}:ws_id", ws_id, ex=86400)
        except HTTPException:
            raise
        except Exception:
            pass
    if prev_job_id:
        await redis.set(f"job:{job_id}:prev_job_id", prev_job_id, ex=86400)
    # Store niche for analytics
    niche = getattr(req, "niche", None) or ""
    if niche:
        await redis.set(f"job:{job_id}:niche", niche, ex=86400)

    pool = await arq.create_pool(
        arq.connections.RedisSettings.from_dsn(settings.redis_url)
    )
    # Store agency_proj_id so worker can load brand kit
    agency_proj_id = getattr(req, "agency_project_id", None)
    if agency_proj_id:
        await redis.set(f"job:{job_id}:agency_proj_id", agency_proj_id, ex=86400 * 7)
        await redis.set(f"job:{job_id}:created_by", user_id, ex=86400 * 7)

    # Store scenes so the SceneEditor can reload them if the session is lost
    await redis.set(
        f"job:{job_id}:scenes",
        json.dumps([s.model_dump() for s in req.scenes]),
        ex=86400 * 7  # 7 days — editors may come back days later
    )
    await pool.enqueue_job("render_video", job_id, req.model_dump(), _job_id=job_id)
    await pool.close()
    await redis.aclose()

    logger.info("Render job queued: %s", job_id)
    return RenderJobResponse(job_id=job_id, status="queued")




class RenderSceneRequest(BaseModel):
    scene: Optional[dict] = None          # updated scene fields
    visual_source: Optional[str] = None
    custom_image_url: Optional[str] = None
    voice_name: Optional[str] = None
    voice_speed: Optional[float] = None
    subtitle_style: Optional[str] = None
    platform: Optional[str] = None
    motion: Optional[str] = None


@router.post("/scenes/{job_id}/{scene_index}")
async def rerender_scene(
    job_id: str,
    scene_index: int,
    req: RenderSceneRequest,
    authorization: Optional[str] = Header(None),
):
    """
    Re-render a single scene and splice it back into the existing video.
    Much faster than a full re-render — only processes one scene.
    Returns { video_url, scene_url, job_id }.
    """
    import tempfile, os, shutil, uuid as _uuid, httpx, asyncio as _asyncio
    from pathlib import Path as _Path
    from app.services.ffmpeg import render_scene, normalize_scene, run_ffmpeg
    from app.services.visuals import get_visual_for_scene, VisualSource
    from app.services.voice import synthesize_scene as _synthesize_scene
    from app.services.storage import upload_file, r2_enabled, _public_url
    from app.models.schemas import Scene, VisualSource as VS

    redis = await _get_redis()
    try:
        token  = (authorization or "").removeprefix("Bearer ").strip()
        user_id = auth_service.verify_token(token) if token else None

        # Load existing scene URLs
        raw_urls = await redis.get(f"job:{job_id}:scene_urls")
        if not raw_urls:
            raise HTTPException(404, "Scene URLs not found — run a full render first")
        scene_urls: list[str] = json.loads(raw_urls)

        if scene_index < 0 or scene_index >= len(scene_urls):
            raise HTTPException(400, f"Scene index {scene_index} out of range (0-{len(scene_urls)-1})")

        # Load original scenes from Redis
        raw_scenes = await redis.get(f"job:{job_id}:scenes")
        if not raw_scenes:
            raise HTTPException(404, "Original scenes not found")
        all_scenes = json.loads(raw_scenes)

        # Merge updated scene data from request
        scene_data = all_scenes[scene_index]
        if req.scene:
            scene_data.update(req.scene)
        scene = Scene(**scene_data)

        work_dir = _Path(tempfile.mkdtemp(prefix=f"scene_patch_{job_id}_"))
        try:
            # ── Step 1: Get visual ──────────────────────────────────────────
            visual_file = await get_visual_for_scene(
                scene, str(work_dir),
                source=VS(req.visual_source or "pexels_video"),
                custom_image_url=req.custom_image_url,
            )
            is_img = visual_file.media_type == "image"

            # ── Step 2: Synthesise voice ────────────────────────────────────
            audio_path = await _synthesize_scene(
                scene=scene,
                voice_name=req.voice_name or "alloy",
                output_dir=str(work_dir),
                speed=req.voice_speed or 1.0,
            )

            # ── Step 3: Render the single scene ────────────────────────────
            scene_out = str(work_dir / f"scene_{scene_index:02d}_new.mp4")
            is_custom = bool(getattr(scene, "custom_image_url", None) or req.custom_image_url)
            await render_scene(
                scene=scene,
                visual_path=visual_file.path,
                audio_path=audio_path,
                output_path=scene_out,
                subtitle_style=req.subtitle_style or "viral",
                is_image=is_img,
                platform=req.platform or "TikTok",
                motion=req.motion or "auto",
                scene_index=scene_index,
                is_custom_image=is_custom,
            )

            # ── Step 4: Upload new scene clip to R2 ────────────────────────
            new_scene_url = scene_urls[scene_index]  # default to old
            if r2_enabled():
                key = f"renders/{job_id}/scene_{scene_index:02d}_patched.mp4"
                new_scene_url = await upload_file(scene_out, key)

            # ── Step 5: Download all scenes and splice ─────────────────────
            updated_urls = scene_urls.copy()
            updated_urls[scene_index] = new_scene_url

            # Download each scene clip
            clips: list[str] = []
            async with httpx.AsyncClient(timeout=60) as client:
                for i, url in enumerate(updated_urls):
                    clip_path = str(work_dir / f"clip_{i:02d}.mp4")
                    if i == scene_index:
                        # Use the freshly rendered clip
                        shutil.copy(scene_out, clip_path)
                    else:
                        resp = await client.get(url)
                        resp.raise_for_status()
                        with open(clip_path, "wb") as cf:
                            cf.write(resp.content)
                    clips.append(clip_path)

            # Normalise all clips to same specs
            norm_clips: list[str] = []
            for i, clip in enumerate(clips):
                norm = str(work_dir / f"norm_{i:02d}.mp4")
                await normalize_scene(clip, norm, platform=req.platform)
                norm_clips.append(norm)

            # Concat list
            concat_list = str(work_dir / "concat.txt")
            with open(concat_list, "w") as f:
                for nc in norm_clips:
                    f.write(f"file '{os.path.abspath(nc)}'\n")

            final_out = str(work_dir / "final_patched.mp4")
            await run_ffmpeg([
                "ffmpeg", "-y",
                "-f", "concat", "-safe", "0", "-i", concat_list,
                "-c", "copy", "-movflags", "+faststart",
                final_out,
            ])

            # ── Step 6: Upload patched video ───────────────────────────────
            video_url = ""
            if r2_enabled():
                vid_key = f"renders/{job_id}/final_video_patched.mp4"
                video_url = await upload_file(final_out, vid_key)
            else:
                # Fallback: serve directly from worker
                video_url = f"{os.environ.get('WORKER_BASE_URL','')}/renders/{job_id}/final_video_patched.mp4"

            # Update stored scene URLs and scenes in Redis
            updated_scenes = all_scenes.copy()
            updated_scenes[scene_index] = scene_data
            await redis.set(f"job:{job_id}:scene_urls", json.dumps(updated_urls), ex=86400 * 7)
            await redis.set(f"job:{job_id}:scenes",     json.dumps(updated_scenes), ex=86400 * 7)

            # Write the patched video URL back into the job progress key
            # so the review endpoint always serves the latest full video
            try:
                raw_progress = await redis.get(f"job:{job_id}:progress")
                if raw_progress:
                    import json as _jp
                    progress = _jp.loads(raw_progress)
                    progress["video_url"] = video_url
                    # Also update r2_urls so all lookup paths find it
                    if "r2_urls" not in progress:
                        progress["r2_urls"] = {}
                    progress["r2_urls"]["final_video_patched.mp4"] = video_url
                    await redis.set(f"job:{job_id}:progress", _jp.dumps(progress), ex=3600 * 24 * 7)
            except Exception as _e:
                logger.warning("Failed to update progress with patched url: %s", _e)

            logger.info("Partial re-render complete — job=%s scene=%d url=%s", job_id, scene_index, video_url)
            return {
                "video_url":  video_url,
                "scene_url":  new_scene_url,
                "job_id":     job_id,
                "scene_index": scene_index,
            }

        finally:
            shutil.rmtree(str(work_dir), ignore_errors=True)

    finally:
        await redis.aclose()




@router.post("/voice/process-upload")
async def process_voice_upload(
    request: Request,
    file: UploadFile = File(...),
    scene_id: int = Form(default=0),
    authorization: Optional[str] = Header(None),
):
    """
    Accept a voice upload or recording, run the full processing pipeline,
    upload to R2, and return the processed URL + detected duration.

    Processing steps applied automatically:
    - Silence trimming
    - Noise reduction (afftdn)
    - EQ balancing (highpass + presence boost)
    - Compression (acompressor)
    - Loudness normalisation (-14 LUFS)
    - Fade in/out (50ms / 80ms)
    """
    from app.services.voice_processing import process_and_upload

    redis = await _get_redis()
    user_id = _extract_user_id(authorization)

    # Validate file type
    content_type = file.content_type or ""
    allowed = {"audio/webm", "audio/ogg", "audio/wav", "audio/mpeg",
               "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/aac", "video/webm"}
    if content_type not in allowed and not content_type.startswith("audio/"):
        raise HTTPException(400, detail="Invalid file type. Must be an audio file.")

    # Limit file size — 50MB
    MAX_BYTES = 50 * 1024 * 1024
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(413, detail="File too large. Maximum 50MB.")

    # Save to temp file
    suffix = Path(file.filename or "voice.webm").suffix or ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name

    work_dir = tempfile.mkdtemp(prefix="voice_proc_")

    try:
        result = await process_and_upload(
            input_path=tmp_path,
            scene_id=scene_id,
            output_dir=work_dir,
        )
        if result["error"]:
            raise HTTPException(422, detail=f"Processing failed: {result['error']}")

        return {
            "voice_url":  result["r2_url"],
            "duration":   result["duration"],
            "scene_id":   scene_id,
            "processed":  True,
            "steps": [
                "silence_trimmed",
                "noise_reduced",
                "eq_balanced",
                "compressed",
                "loudness_normalised",
                "fade_applied",
            ],
        }
    finally:
        try: Path(tmp_path).unlink(missing_ok=True)
        except: pass
        try:
            import shutil as _sh
            _sh.rmtree(work_dir, ignore_errors=True)
        except: pass


@router.get("/job-creator/{job_id}")
async def get_job_creator(job_id: str):
    """Return the user_id of whoever submitted this render job."""
    redis = await _get_redis()
    try:
        raw = await redis.get(f"job:{job_id}:created_by")
        created_by = raw.decode() if isinstance(raw, bytes) else (raw or "")
        return {"job_id": job_id, "created_by": created_by}
    finally:
        await redis.aclose()


@router.put("/scenes/{job_id}")
async def save_job_scenes(
    job_id: str,
    body: dict,
    authorization: Optional[str] = Header(None),
):
    """Persist updated scene data back to Redis so partial re-renders use fresh data."""
    import json as _json
    redis = await _get_redis()
    try:
        token = (authorization or "").removeprefix("Bearer ").strip()
        user_id = auth_service.verify_token(token) if token else None
        if not user_id:
            raise HTTPException(status_code=401, detail="Unauthorized")

        scenes = body.get("scenes")
        if not scenes or not isinstance(scenes, list):
            raise HTTPException(status_code=400, detail="scenes array required")

        await redis.set(
            f"job:{job_id}:scenes",
            _json.dumps(scenes),
            ex=86400 * 7,
        )
        logger.info("Scenes saved | job=%s | count=%d | user=%s", job_id, len(scenes), user_id)
        return {"saved": True, "count": len(scenes)}
    finally:
        await redis.aclose()

@router.get("/scenes/{job_id}")
async def get_job_scenes(job_id: str):
    """Return the scenes and current clip URLs for a render job.
    scene_urls reflects any partial re-renders — always use these over
    the original r2_urls from the status endpoint.
    """
    redis = await _get_redis()
    try:
        raw = await redis.get(f"job:{job_id}:scenes")
        if not raw:
            raise HTTPException(404, "Scenes not found for this job")
        scenes = json.loads(raw)

        # Also return the current per-scene clip URLs (updated on partial re-renders)
        raw_urls = await redis.get(f"job:{job_id}:scene_urls")
        scene_urls: list[str] = json.loads(raw_urls) if raw_urls else []

        return {"scenes": scenes, "scene_urls": scene_urls}
    finally:
        await redis.aclose()


@router.get("/status/{job_id}", response_model=JobStatusResponse)
async def get_job_status(job_id: str):
    redis = await _get_redis()
    raw = await redis.get(f"job:{job_id}:progress")
    await redis.aclose()

    if raw is None:
        raise HTTPException(status_code=404, detail="Job not found")

    data = json.loads(raw)
    status = data.get("status", "processing")

    return JobStatusResponse(
        job_id=job_id,
        status=status,
        progress=data.get("pct", 0),
        stage=data.get("stage", ""),
        result=data if status == "complete" else None,
        error=data.get("error") if status == "failed" else None,
    )
