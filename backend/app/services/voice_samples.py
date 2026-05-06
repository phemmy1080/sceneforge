"""
Voice sample generator — Edge TTS (free) + ElevenLabs (paid).
Samples cached in Redis as base64 MP3s for 30 days.
Warm runs only once — protected by a Redis flag.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")

EDGE_TTS_VOICES: dict[str, str] = {
    # Free tier (6)
    "Marcus":   "en-US-GuyNeural",
    "Sophie":   "en-US-JennyNeural",
    "Alex":     "en-US-ChristopherNeural",
    "Jordan":   "en-GB-RyanNeural",
    "Luna":     "en-US-AriaNeural",
    "Kai":      "en-AU-WilliamNeural",
    # Paid tier (18)
    "Andrew":   "en-US-AndrewNeural",
    "Brian":    "en-US-BrianNeural",
    "Emma":     "en-US-EmmaNeural",
    "Ava":      "en-US-AvaNeural",
    "Steffan":  "en-US-SteffanNeural",
    "Michelle": "en-US-MichelleNeural",
    "Libby":    "en-GB-LibbyNeural",
    "Maisie":   "en-GB-MaisieNeural",
    "Sonia":    "en-GB-SoniaNeural",
    "Natasha":  "en-AU-NatashaNeural",
    "Clara":    "en-CA-ClaraNeural",
    "Liam":     "en-CA-LiamNeural",
    "Connor":   "en-IE-ConnorNeural",
    "Emily":    "en-IE-EmilyNeural",
    "Neerja":   "en-IN-NeerjaNeural",
    "Prabhat":  "en-IN-PrabhatNeural",
    "Mitchell": "en-NZ-MitchellNeural",
    "Leah":     "en-ZA-LeahNeural",
}

ELEVENLABS_VOICE_IDS: dict[str, str] = {
    "Marcus":  "TxGEqnHWrfWFTfGW9XjX",
    "Sophie":  "EXAVITQu4vr4xnSDxMaL",
    "Alex":    "ErXwobaYiN019PkySvjV",
    "Jordan":  "VR6AewLTigWG4xSOukaG",
    "Luna":    "pNInz6obpgDQGcFmaJgB",
    "Kai":     "yoZ06aMxZJJ28mfd3POQ",
}

FREE_VOICES  = {"Marcus", "Sophie", "Alex", "Jordan", "Luna", "Kai"}
PREMIUM_PLANS = {"starter", "pro", "studio"}

SAMPLE_TEXT      = "Hi! This is how your video will sound with this voice."
REDIS_KEY_PREFIX = "voice_sample:"
REDIS_TTL        = 60 * 60 * 24 * 30   # 30 days
WARM_FLAG_KEY    = "voice_samples:warmed"
WARM_FLAG_TTL    = 60 * 60 * 24 * 25   # 25 days


# ── Generators ────────────────────────────────────────────────────────────────

async def _edge_tts_sample(voice_name: str) -> Optional[bytes]:
    try:
        import edge_tts
        voice_id = EDGE_TTS_VOICES.get(voice_name, "en-US-GuyNeural")
        chunks: list[bytes] = []
        async for chunk in edge_tts.Communicate(text=SAMPLE_TEXT, voice=voice_id).stream():
            if chunk["type"] == "audio":
                chunks.append(chunk["data"])
        if not chunks:
            return None
        audio = b"".join(chunks)
        logger.info("Edge TTS sample: %s (%d bytes)", voice_name, len(audio))
        return audio
    except Exception as e:
        logger.error("Edge TTS sample failed for %s: %s", voice_name, e)
        return None


async def _elevenlabs_sample(voice_name: str) -> Optional[bytes]:
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
                headers={"xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json"},
                json={"text": SAMPLE_TEXT, "model_id": "eleven_turbo_v2",
                      "voice_settings": {"stability": 0.5, "similarity_boost": 0.75}},
            )
            if resp.status_code == 200:
                logger.info("ElevenLabs sample: %s (%d bytes)", voice_name, len(resp.content))
                return resp.content
            logger.warning("ElevenLabs HTTP %d for %s", resp.status_code, voice_name)
    except Exception as e:
        logger.error("ElevenLabs sample error for %s: %s", voice_name, e)
    return None


# ── Redis cache ───────────────────────────────────────────────────────────────

def _key(voice_name: str, provider: str) -> str:
    return f"{REDIS_KEY_PREFIX}{provider}:{voice_name}"


async def _get(redis, voice_name: str, provider: str) -> Optional[bytes]:
    try:
        raw = await redis.get(_key(voice_name, provider))
        return base64.b64decode(raw) if raw else None
    except Exception:
        return None


async def _set(redis, voice_name: str, provider: str, audio: bytes) -> None:
    try:
        await redis.set(_key(voice_name, provider),
                        base64.b64encode(audio).decode(), ex=REDIS_TTL)
    except Exception as e:
        logger.warning("Cache write failed for %s/%s: %s", provider, voice_name, e)


# ── Public API ────────────────────────────────────────────────────────────────

async def get_voice_sample(redis, voice_name: str, user_plan: str = "free") -> Optional[bytes]:
    """Return MP3 bytes. ElevenLabs for pro/studio, Edge TTS otherwise. Redis-cached."""
    use_el    = (user_plan.lower() in PREMIUM_PLANS
                 and bool(ELEVENLABS_API_KEY)
                 and voice_name in ELEVENLABS_VOICE_IDS)
    provider  = "elevenlabs" if use_el else "edge_tts"

    # 1 Redis read
    cached = await _get(redis, voice_name, provider)
    if cached:
        return cached

    # Generate
    if use_el:
        audio = await _elevenlabs_sample(voice_name)
        if not audio:
            # Fallback to Edge TTS
            provider = "edge_tts"
            cached   = await _get(redis, voice_name, "edge_tts")
            if cached:
                return cached
            audio = await _edge_tts_sample(voice_name)
    else:
        audio = await _edge_tts_sample(voice_name)

    if audio:
        await _set(redis, voice_name, provider, audio)
    return audio


async def warm_sample_cache(redis) -> None:
    """
    Pre-generate free tier Edge TTS samples.
    Guarded by a Redis flag — only runs once every 25 days.
    Saves ~12 Redis write calls on every Railway restart.
    """
    try:
        already = await redis.get(WARM_FLAG_KEY)
        if already:
            logger.info("Voice cache already warm — skipping")
            return
    except Exception:
        pass

    logger.info("Warming voice sample cache...")
    tasks = [
        _warm_one(redis, name)
        for name in FREE_VOICES
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    warmed  = sum(1 for r in results if not isinstance(r, Exception))
    logger.info("Voice cache warmed — %d/%d samples generated", warmed, len(tasks))

    # Set flag — next restart skips entirely (1 Redis read instead of 6+ writes)
    try:
        await redis.set(WARM_FLAG_KEY, "1", ex=WARM_FLAG_TTL)
    except Exception as e:
        logger.warning("Could not set warm flag: %s", e)


async def _warm_one(redis, voice_name: str) -> None:
    cached = await _get(redis, voice_name, "edge_tts")
    if cached:
        logger.debug("Sample already cached: %s", voice_name)
        return
    audio = await _edge_tts_sample(voice_name)
    if audio:
        await _set(redis, voice_name, "edge_tts", audio)
