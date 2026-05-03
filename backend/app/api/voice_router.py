"""
backend/app/api/voice_router.py

Voice sample preview endpoint.
Add to main.py:
    from app.api.voice_router import router as voice_sample_router
    app.include_router(voice_sample_router, prefix="/api/voice", tags=["voice"])
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from app.dependencies import get_redis, get_current_user
from app.services.voice_samples import get_voice_sample, EDGE_TTS_VOICES

router = APIRouter()


@router.get("/sample/{voice_name}")
async def voice_sample(
    voice_name: str,
    redis=Depends(get_redis),
    user=Depends(get_current_user),
):
    """
    Stream a voice preview MP3.
    Edge TTS for free/starter, ElevenLabs for pro/studio (when key set).
    Cached in Redis — first call generates, subsequent calls instant.
    """
    if voice_name not in EDGE_TTS_VOICES:
        raise HTTPException(status_code=404, detail=f"Voice '{voice_name}' not found")

    user_plan = getattr(user, "plan", "free") or "free"

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
            "Cache-Control": "public, max-age=86400",  # browser caches 24h
            "Content-Disposition": f'inline; filename="{voice_name}.mp3"',
        },
    )
