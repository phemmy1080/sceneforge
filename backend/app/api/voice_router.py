"""
backend/app/api/voice_router.py
"""
from __future__ import annotations

import logging
from fastapi import APIRouter, Depends, HTTPException, Header
from fastapi.responses import Response
from typing import Optional

from app.dependencies import get_redis
from app.services import auth as auth_service
from app.services.voice_samples import get_voice_sample, EDGE_TTS_VOICES

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/sample/{voice_name}")
async def voice_sample(
    voice_name: str,
    redis=Depends(get_redis),
    authorization: Optional[str] = Header(default=None),
):
    """Stream a voice preview MP3 — Edge TTS for free, ElevenLabs for pro/studio."""
    if voice_name not in EDGE_TTS_VOICES:
        raise HTTPException(status_code=404, detail=f"Voice '{voice_name}' not found")

    # Resolve user plan from JWT (graceful — defaults to free if token missing/invalid)
    user_plan = "free"
    if authorization:
        token = authorization.removeprefix("Bearer ").strip()
        user_id = auth_service.verify_token(token)
        if user_id:
            try:
                import json
                raw = await redis.get(f"user:{user_id}")
                if raw:
                    user_data = json.loads(raw)
                    user_plan = user_data.get("plan", "free")
            except Exception as e:
                logger.warning("Could not resolve user plan for sample: %s", e)

    audio = await get_voice_sample(
        redis=redis,
        voice_name=voice_name,
        user_plan=user_plan,
    )

    if not audio:
        raise HTTPException(status_code=503,
                            detail="Sample generation failed. Try again shortly.")

    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={
            "Cache-Control": "public, max-age=86400",
            "Content-Disposition": f'inline; filename="{voice_name}.mp3"',
        },
    )
