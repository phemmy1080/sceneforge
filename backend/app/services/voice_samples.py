"""
Voice sample generator — Edge TTS (free) + ElevenLabs (paid).
Samples cached in Redis as base64 MP3s for 30 days. No R2 needed.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")

# All Edge TTS voices — must match voice_config.ts VOICES list
EDGE_TTS_VOICES: dict[str, str] = {
    # Free tier
    "Marcus":   "en-US-GuyNeural",
    "Sophie":   "en-US-JennyNeural",
    "Alex":     "en-US-ChristopherNeural",
    "Jordan":   "en-GB-RyanNeural",
    "Luna":     "en-US-AriaNeural",
    "Kai":      "en-AU-WilliamNeural",
    # Paid tier
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

# ElevenLabs voice IDs for pro/studio users
ELEVENLABS_VOICE_IDS: dict[str, str] = {
    "Marcus":  "TxGEqnHWrfWFTfGW9XjX",
    "Sophie":  "EXAVITQu4vr4xnSDxMaL",
    "Alex":    "ErXwobaYiN019PkySvjV",
    "Jordan":  "VR6AewLTigWG4xSOukaG",
    "Luna":    "pNInz6obpgDQGcFmaJgB",
    "Kai":     "yoZ06aMxZJJ28mfd3POQ",
}

SAMPLE_TEXT = "Hi there! This is a preview of how your video will sound with this voice."
REDIS_KEY_PREFIX = "voice_sample:"
REDIS_TTL = 60 * 60 * 24 * 30  # 30 days
PREMIUM_PLANS = {"starter", "pro", "studio"}

# Free plan voice names
FREE_VOICES = {"Marcus", "Sophie", "Alex", "Jordan", "Luna", "Kai"}


async def _generate_edge_tts_sample(voice_name: str) -> Optional[bytes]:
    try:
        import edge_tts
        voice_id = EDGE_TTS_VOICES.get(voice_name, "en-US-GuyNeural")
        chunks: list[bytes] = []
        communicate = edge_tts.Communicate(text=SAMPLE_TEXT, voice=voice_id)
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                chunks.append(chunk["data"])
        if not chunks:
            return None
        audio = b"".join(chunks)
        logger.info("Generated Edge TTS sample for %s (%d bytes)", voice_name, len(audio))
        return audio
    except Exception as e:
        logger.error("Edge TTS sample failed for %s: %s", voice_name, e)
        return None


async def _generate_elevenlabs_sample(voice_name: str) -> Optional[bytes]:
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
                return resp.content
            logger.warning("ElevenLabs sample HTTP %d for %s", resp.status_code, voice_name)
    except Exception as e:
        logger.error("ElevenLabs sample error for %s: %s", voice_name, e)
    return None


def _cache_key(voice_name: str, provider: str) -> str:
    return f"{REDIS_KEY_PREFIX}{provider}:{voice_name}"


async def _get_cached(redis, voice_name: str, provider: str) -> Optional[bytes]:
    try:
        raw = await redis.get(_cache_key(voice_name, provider))
        if raw:
            return base64.b64decode(raw)
    except Exception: pass
    return None


async def _set_cached(redis, voice_name: str, provider: str, audio: bytes) -> None:
    try:
        await redis.set(_cache_key(voice_name, provider),
                        base64.b64encode(audio).decode(), ex=REDIS_TTL)
    except Exception: pass


async def get_voice_sample(redis, voice_name: str, user_plan: str = "free") -> Optional[bytes]:
    """Return MP3 bytes for a voice preview. Cached in Redis 30 days."""
    use_elevenlabs = (user_plan.lower() in PREMIUM_PLANS and bool(ELEVENLABS_API_KEY)
                      and voice_name in ELEVENLABS_VOICE_IDS)
    provider = "elevenlabs" if use_elevenlabs else "edge_tts"

    cached = await _get_cached(redis, voice_name, provider)
    if cached:
        return cached

    if use_elevenlabs:
        audio = await _generate_elevenlabs_sample(voice_name)
        if not audio:
            provider = "edge_tts"
            cached = await _get_cached(redis, voice_name, "edge_tts")
            if cached:
                return cached
            audio = await _generate_edge_tts_sample(voice_name)
    else:
        audio = await _generate_edge_tts_sample(voice_name)

    if audio:
        await _set_cached(redis, voice_name, provider, audio)
    return audio


async def warm_sample_cache(redis) -> None:
    """Pre-generate free tier voice samples at startup."""
    logger.info("Warming voice sample cache...")
    tasks = []
    for name in FREE_VOICES:
        if not await _get_cached(redis, name, "edge_tts"):
            tasks.append(_warm_one(redis, name))
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
        logger.info("Warmed %d voice samples", len(tasks))
    else:
        logger.info("Voice cache already warm")


async def _warm_one(redis, voice_name: str) -> None:
    audio = await _generate_edge_tts_sample(voice_name)
    if audio:
        await _set_cached(redis, voice_name, "edge_tts", audio)
