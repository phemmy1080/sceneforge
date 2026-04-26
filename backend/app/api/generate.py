import json
import logging
import shutil
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Header, Request, UploadFile
from fastapi.responses import StreamingResponse

from app.config import get_settings
from app.models.schemas import (
    GenerateIdeasRequest, GenerateIdeasResponse,
    GenerateScriptRequest, GenerateScriptResponse,
    GenerateScenesRequest, GenerateScenesResponse,
    SearchVisualsRequest, SearchVisualsResponse,
    UploadScriptResponse,
)
from app.services import ai, visuals
from app.services import auth as auth_service
from app.services.plans import get_limits, check_scene_limit
from app.dependencies import get_redis
from app.middleware.rate_limit import limiter

router = APIRouter()
logger = logging.getLogger(__name__)


async def _check_tokens(authorization: Optional[str]) -> None:
    """Raise 402 if user has no tokens. No-op if user not logged in (guest mode)."""
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not token:
        return  # guest — no gate
    try:
        import redis.asyncio as aioredis
        from app.config import get_settings as _gs
        from app.services import auth as _auth
        _settings = _gs()
        r = await aioredis.from_url(_settings.redis_url, decode_responses=True)
        user_id = _auth.verify_token(token)
        if user_id:
            bal = await _auth.get_token_balance(r, user_id)
            await r.aclose()
            if bal["tokens_remaining"] <= 0:
                raise HTTPException(
                    status_code=402,
                    detail={
                        "error": "tokens_exhausted",
                        "message": "Your token balance is exhausted. Please top up to continue.",
                        "tokens_remaining": 0,
                    }
                )
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("Token check failed (non-blocking): %s", e)
settings = get_settings()


@router.post("/ideas", response_model=GenerateIdeasResponse)
@limiter.limit("10/minute")
async def generate_ideas(
    request: Request,
    req: GenerateIdeasRequest,
    authorization: Optional[str] = Header(None),
):
    """Generate content ideas and track niche usage for analytics."""
    await _check_tokens(authorization)
    try:
        ideas = await ai.generate_ideas(req)

        # Track niche usage — fire and forget, never blocks response
        if req.niche and authorization:
            token = (authorization or "").removeprefix("Bearer ").strip()
            if token:
                try:
                    import redis.asyncio as aioredis, json as _json
                    from app.services import auth as _auth
                    _r = await aioredis.from_url(settings.redis_url, decode_responses=True)
                    uid = _auth.verify_token(token)
                    if uid:
                        raw = await _r.get(f"user:{uid}")
                        if raw:
                            data = _json.loads(raw)
                            usage = data.get("niche_usage") or {}
                            usage[req.niche] = usage.get(req.niche, 0) + 1
                            data["niche_usage"] = usage
                            await _r.set(f"user:{uid}", _json.dumps(data))
                            logger.info("Niche tracked: %s for user %s", req.niche, uid)
                    await _r.aclose()
                except Exception as track_err:
                    logger.warning("Niche tracking failed (non-blocking): %s", track_err)

        return GenerateIdeasResponse(ideas=ideas)
    except Exception as e:
        logger.exception("generate_ideas failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/script", response_model=GenerateScriptResponse)
async def generate_script(req: GenerateScriptRequest):
    try:
        script = await ai.generate_script(req)
        word_count = len(script.split())
        estimated_duration = int(word_count / 150 * 60)
        return GenerateScriptResponse(
            script=script,
            word_count=word_count,
            estimated_duration_seconds=estimated_duration,
        )
    except Exception as e:
        logger.exception("generate_script failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/script/stream")
@limiter.limit("5/minute")
async def stream_script(request: Request, req: GenerateScriptRequest):
    async def event_generator():
        try:
            async for chunk in ai.stream_script(req):
                yield f"data: {json.dumps({'chunk': chunk})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            logger.exception("stream_script failed")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/scenes", response_model=GenerateScenesResponse)
@limiter.limit("10/minute")
async def generate_scenes(
    request: Request,
    req: GenerateScenesRequest,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    try:
        # Get user plan for scene limit
        user_plan = "free"
        token = (authorization or "").removeprefix("Bearer ").strip()
        if token:
            user_id = auth_service.verify_token(token)
            if user_id:
                import json as _json
                raw = await redis.get(f"user:{user_id}")
                if raw:
                    user_plan = _json.loads(raw).get("plan", "free")

        scenes = await ai.generate_scenes(req)

        # Enforce scene limit — truncate to max for free users
        limits = get_limits(user_plan)
        max_scenes = limits["max_scenes"]
        was_truncated = False
        if max_scenes != -1 and len(scenes) > max_scenes:
            scenes = scenes[:max_scenes]
            was_truncated = True

        total_duration = sum(s.duration for s in scenes)
        resp = GenerateScenesResponse(scenes=scenes, total_duration=total_duration)
        if was_truncated:
            # Attach metadata so frontend can show upgrade prompt
            resp.__dict__["truncated"] = True
            resp.__dict__["max_scenes"] = max_scenes
        return resp
    except Exception as e:
        logger.exception("generate_scenes failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/visuals/search", response_model=SearchVisualsResponse)
async def search_visuals(req: SearchVisualsRequest):
    try:
        results = await visuals.search_pexels_videos(req.keyword, per_page=6)
        return SearchVisualsResponse(results=results)
    except Exception as e:
        logger.exception("search_visuals failed")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/upload-script", response_model=UploadScriptResponse)
async def upload_script(
    script_file: UploadFile = File(None),
    script_text: str = Form(None),
    voiceover_file: UploadFile = File(None),
    platform: str = Form("TikTok (9:16, 60s)"),
):
    """
    Accept a user-uploaded script (text file or raw text) and optional voiceover MP3/WAV.
    Returns the script text and a job_dir where the voiceover was saved.
    """
    # ── Get script text ────────────────────────────────────────────────────────
    if script_file and script_file.filename:
        raw = await script_file.read()
        try:
            script_text = raw.decode("utf-8")
        except UnicodeDecodeError:
            script_text = raw.decode("latin-1")
    elif not script_text:
        raise HTTPException(status_code=400, detail="Provide either script_file or script_text")

    script_text = script_text.strip()
    if len(script_text) < 20:
        raise HTTPException(status_code=400, detail="Script is too short (minimum 20 characters)")

    word_count = len(script_text.split())
    estimated_duration = int(word_count / 150 * 60)

    # ── Save voiceover if provided ─────────────────────────────────────────────
    upload_dir = None
    voiceover_path = None

    if voiceover_file and voiceover_file.filename:
        suffix = Path(voiceover_file.filename).suffix.lower()
        if suffix not in {".mp3", ".wav", ".m4a", ".aac", ".ogg"}:
            raise HTTPException(
                status_code=400,
                detail="Voiceover must be an audio file (.mp3, .wav, .m4a, .aac, .ogg)"
            )

        upload_id = str(uuid.uuid4())
        upload_dir = Path(settings.renders_dir) / upload_id
        upload_dir.mkdir(parents=True, exist_ok=True)

        # Save as uploaded_voice.mp3 (or original extension)
        voiceover_path = str(upload_dir / f"uploaded_voice{suffix}")
        content = await voiceover_file.read()
        with open(voiceover_path, "wb") as f:
            f.write(content)

        logger.info(
            "Voiceover uploaded: %s (%d bytes) → %s",
            voiceover_file.filename, len(content), voiceover_path
        )

    return UploadScriptResponse(
        script=script_text,
        word_count=word_count,
        estimated_duration_seconds=estimated_duration,
        voiceover_path=voiceover_path,
        upload_id=str(upload_dir.name) if upload_dir else None,
    )