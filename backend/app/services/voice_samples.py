"""
Voice sample generator and cache service.

Generates short preview clips for each voice and caches them in Redis.
- Free/Starter plans: Edge TTS (Microsoft Neural — free, high quality)
- Pro/Studio plans:   ElevenLabs (when ELEVENLABS_API_KEY is set)

Samples are cached in Redis as base64 MP3s for 30 days.
No R2 or external storage needed.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")

# ── Voice definitions ─────────────────────────────────────────────────────────

# Must match VOICE_MAP in voice.py exactly
EDGE_TTS_VOICES: dict[str, str] = {
    "Marcus": "en-US-GuyNeural",
    "Sophie": "en-US-JennyNeural",
    "Alex":   "en-US-ChristopherNeural",
    "Jordan": "en-GB-RyanNeural",
    "Luna":   "en-US-AriaNeural",
    "Kai":    "en-AU-WilliamNeural",
}

# ElevenLabs voice IDs for Pro/Studio users
ELEVENLABS_VOICE_IDS: dict[str, str] = {
    "Marcus": "TxGEqnHWrfWFTfGW9XjX",  # Josh — deep authoritative
    "Sophie": "EXAVITQu4vr4xnSDxMaL",  # Bella — warm friendly
    "Alex":   "ErXwobaYiN019PkySvjV",   # Antoni — energetic young
    "Jordan": "VR6AewLTigWG4xSOukaG",   # Arnold — professional clear
    "Luna":   "pNInz6obpgDQGcFmaJgB",   # Adam — calm storytelling
    "Kai":    "yoZ06aMxZJJ28mfd3POQ",   # Sam — casual conversational
}

SAMPLE_TEXT = "Hi there! This is a preview of how your video will sound with this voice."

REDIS_KEY_PREFIX = "voice_sample:"
REDIS_TTL = 60 * 60 * 24 * 30  # 30 days

# Plans that get ElevenLabs voices
PREMIUM_PLANS = {"pro", "studio"}


# ── Generators ────────────────────────────────────────────────────────────────

async def _generate_edge_tts_sample(voice_name: str) -> Optional[bytes]:
    """Generate a sample using Edge TTS. Returns MP3 bytes."""
    try:
        import edge_tts
        import io

        voice_id = EDGE_TTS_VOICES.get(voice_name, "en-US-GuyNeural")
        audio_chunks: list[bytes] = []

        communicate = edge_tts.Communicate(text=SAMPLE_TEXT, voice=voice_id)
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_chunks.append(chunk["data"])

        if not audio_chunks:
            logger.warning("Edge TTS returned no audio for %s", voice_name)
            return None

        audio_bytes = b"".join(audio_chunks)
        logger.info("Generated Edge TTS sample for %s (%d bytes)", voice_name, len(audio_bytes))
        return audio_bytes

    except Exception as e:
        logger.error("Edge TTS sample generation failed for %s: %s", voice_name, e)
        return None


async def _generate_elevenlabs_sample(voice_name: str) -> Optional[bytes]:
    """Fetch a sample from ElevenLabs API. Returns MP3 bytes."""
    if not ELEVENLABS_API_KEY:
        return None
    voice_id = ELEVENLABS_VOICE_IDS.get(voice_name)
    if not voice_id:
        return None
    try:
        import httpx
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
                headers={
                    "xi-api-key": ELEVENLABS_API_KEY,
                    "Content-Type": "application/json",
                },
                json={
                    "text": SAMPLE_TEXT,
                    "model_id": "eleven_turbo_v2",
                    "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
                },
            )
            if resp.status_code == 200:
                logger.info("Fetched ElevenLabs sample for %s (%d bytes)",
                            voice_name, len(resp.content))
                return resp.content
            logger.warning("ElevenLabs sample fetch failed for %s: HTTP %d",
                           voice_name, resp.status_code)
    except Exception as e:
        logger.error("ElevenLabs sample fetch error for %s: %s", voice_name, e)
    return None


# ── Redis cache ───────────────────────────────────────────────────────────────

def _cache_key(voice_name: str, provider: str) -> str:
    return f"{REDIS_KEY_PREFIX}{provider}:{voice_name}"


async def _get_cached(redis, voice_name: str, provider: str) -> Optional[bytes]:
    try:
        raw = await redis.get(_cache_key(voice_name, provider))
        if raw:
            return base64.b64decode(raw)
    except Exception as e:
        logger.warning("Cache read failed for %s/%s: %s", provider, voice_name, e)
    return None


async def _set_cached(redis, voice_name: str, provider: str, audio: bytes) -> None:
    try:
        encoded = base64.b64encode(audio).decode()
        await redis.set(_cache_key(voice_name, provider), encoded, ex=REDIS_TTL)
        logger.info("Cached %s/%s sample (%d bytes)", provider, voice_name, len(audio))
    except Exception as e:
        logger.warning("Cache write failed for %s/%s: %s", provider, voice_name, e)


# ── Main entry point ──────────────────────────────────────────────────────────

async def get_voice_sample(
    redis,
    voice_name: str,
    user_plan: str = "free",
) -> Optional[bytes]:
    """
    Return MP3 bytes for a voice preview sample.
    - Pro/Studio + ElevenLabs key → ElevenLabs quality
    - Everyone else               → Edge TTS (still sounds great, free)
    Redis-cached for 30 days.
    """
    use_elevenlabs = (
        user_plan.lower() in PREMIUM_PLANS
        and bool(ELEVENLABS_API_KEY)
    )
    provider = "elevenlabs" if use_elevenlabs else "edge_tts"

    # Cache hit
    cached = await _get_cached(redis, voice_name, provider)
    if cached:
        return cached

    # Generate
    if use_elevenlabs:
        audio = await _generate_elevenlabs_sample(voice_name)
        if not audio:
            logger.warning("ElevenLabs failed, falling back to Edge TTS for %s", voice_name)
            provider = "edge_tts"
            # Check Edge TTS cache before regenerating
            cached_fallback = await _get_cached(redis, voice_name, "edge_tts")
            if cached_fallback:
                return cached_fallback
            audio = await _generate_edge_tts_sample(voice_name)
    else:
        audio = await _generate_edge_tts_sample(voice_name)

    if audio:
        await _set_cached(redis, voice_name, provider, audio)

    return audio


async def warm_sample_cache(redis) -> None:
    """
    Pre-generate all Edge TTS samples at startup and cache them.
    Skips voices already cached. Fast on subsequent startups.
    """
    logger.info("Warming voice sample cache (Edge TTS)...")
    tasks = []
    for voice_name in EDGE_TTS_VOICES:
        existing = await _get_cached(redis, voice_name, "edge_tts")
        if not existing:
            tasks.append(_warm_one(redis, voice_name))
        else:
            logger.debug("Sample already cached: edge_tts/%s", voice_name)

    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
        logger.info("Voice sample cache warm complete — %d generated", len(tasks))
    else:
        logger.info("Voice sample cache already warm — nothing to generate")


async def _warm_one(redis, voice_name: str) -> None:
    audio = await _generate_edge_tts_sample(voice_name)
    if audio:
        await _set_cached(redis, voice_name, "edge_tts", audio)
