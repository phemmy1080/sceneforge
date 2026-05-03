"""
Voice sample generator and cache service.

Generates short TTS preview clips for each voice and caches them in Redis.
Called once at worker startup — subsequent requests serve from cache.

gTTS voices: generated via gTTS with different language/accent settings
ElevenLabs voices: fetched from ElevenLabs preview API when key is available
"""
from __future__ import annotations

import asyncio
import base64
import io
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")

# ── Voice definitions ─────────────────────────────────────────────────────────

# gTTS voice mapping: name → (lang, tld) 
# tld changes accent: com=US, co.uk=British, com.au=Australian, ca=Canadian
GTTS_VOICES: dict[str, dict] = {
    "Marcus":  {"lang": "en", "tld": "com",     "slow": False},  # US male-ish
    "Sophie":  {"lang": "en", "tld": "co.uk",   "slow": False},  # British female
    "Alex":    {"lang": "en", "tld": "com.au",  "slow": False},  # Australian
    "Jordan":  {"lang": "en", "tld": "ca",      "slow": False},  # Canadian
    "Luna":    {"lang": "en", "tld": "co.uk",   "slow": True},   # British slow
    "Kai":     {"lang": "en", "tld": "com",     "slow": False},  # US casual
}

# ElevenLabs voice IDs (map your voice names to ElevenLabs voice IDs)
ELEVENLABS_VOICE_IDS: dict[str, str] = {
    "Marcus":  "TxGEqnHWrfWFTfGW9XjX",  # Josh — deep authoritative
    "Sophie":  "EXAVITQu4vr4xnSDxMaL",  # Bella — warm friendly
    "Alex":    "ErXwobaYiN019PkySvjV",   # Antoni — energetic young
    "Jordan":  "VR6AewLTigWG4xSOukaG",   # Arnold — professional clear
    "Luna":    "pNInz6obpgDQGcFmaJgB",   # Adam — calm storytelling
    "Kai":     "yoZ06aMxZJJ28mfd3POQ",   # Sam — casual conversational
}

SAMPLE_TEXT = "Hi there! This is a preview of how your video will sound with this voice."

REDIS_KEY_PREFIX = "voice_sample:"
REDIS_TTL = 60 * 60 * 24 * 30  # 30 days


# ── Generator ─────────────────────────────────────────────────────────────────

async def _generate_gtts_sample(voice_name: str) -> Optional[bytes]:
    """Generate a gTTS audio sample, return raw MP3 bytes."""
    try:
        from gtts import gTTS
        config = GTTS_VOICES.get(voice_name, {"lang": "en", "tld": "com", "slow": False})
        
        def _synthesize():
            buf = io.BytesIO()
            tts = gTTS(text=SAMPLE_TEXT, lang=config["lang"],
                      tld=config["tld"], slow=config["slow"])
            tts.write_to_fp(buf)
            return buf.getvalue()
        
        loop = asyncio.get_event_loop()
        audio_bytes = await loop.run_in_executor(None, _synthesize)
        logger.info("Generated gTTS sample for %s (%d bytes)", voice_name, len(audio_bytes))
        return audio_bytes
    except Exception as e:
        logger.error("gTTS sample generation failed for %s: %s", voice_name, e)
        return None


async def _fetch_elevenlabs_sample(voice_name: str) -> Optional[bytes]:
    """Fetch ElevenLabs voice preview MP3."""
    if not ELEVENLABS_API_KEY:
        return None
    voice_id = ELEVENLABS_VOICE_IDS.get(voice_name)
    if not voice_id:
        return None
    try:
        import httpx
        async with httpx.AsyncClient(timeout=15) as client:
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
            else:
                logger.warning("ElevenLabs sample fetch failed for %s: %s",
                               voice_name, resp.status_code)
    except Exception as e:
        logger.error("ElevenLabs sample fetch error for %s: %s", voice_name, e)
    return None


# ── Cache layer ───────────────────────────────────────────────────────────────

def _redis_key(voice_name: str, provider: str) -> str:
    return f"{REDIS_KEY_PREFIX}{provider}:{voice_name}"


async def get_sample_from_cache(redis, voice_name: str, provider: str) -> Optional[bytes]:
    """Retrieve cached sample from Redis. Returns raw bytes or None."""
    try:
        raw = await redis.get(_redis_key(voice_name, provider))
        if raw:
            return base64.b64decode(raw)
    except Exception as e:
        logger.warning("Cache read failed for %s/%s: %s", provider, voice_name, e)
    return None


async def store_sample_in_cache(redis, voice_name: str, provider: str,
                                 audio_bytes: bytes) -> None:
    """Store sample in Redis as base64, TTL 30 days."""
    try:
        encoded = base64.b64encode(audio_bytes).decode()
        await redis.set(_redis_key(voice_name, provider), encoded, ex=REDIS_TTL)
        logger.info("Cached %s/%s sample (%d bytes)", provider, voice_name, len(audio_bytes))
    except Exception as e:
        logger.warning("Cache write failed for %s/%s: %s", provider, voice_name, e)


async def get_or_generate_sample(redis, voice_name: str,
                                  use_elevenlabs: bool = False) -> Optional[bytes]:
    """
    Main entry point. Returns MP3 bytes for the voice sample.
    Checks Redis cache first, generates if missing.
    """
    provider = "elevenlabs" if use_elevenlabs and ELEVENLABS_API_KEY else "gtts"

    # Check cache
    cached = await get_sample_from_cache(redis, voice_name, provider)
    if cached:
        logger.debug("Cache hit for %s/%s", provider, voice_name)
        return cached

    # Generate
    logger.info("Generating %s sample for %s...", provider, voice_name)
    if provider == "elevenlabs":
        audio_bytes = await _fetch_elevenlabs_sample(voice_name)
        # Fallback to gTTS if ElevenLabs fails
        if not audio_bytes:
            logger.warning("ElevenLabs failed, falling back to gTTS for %s", voice_name)
            audio_bytes = await _generate_gtts_sample(voice_name)
            provider = "gtts"
    else:
        audio_bytes = await _generate_gtts_sample(voice_name)

    if audio_bytes:
        await store_sample_in_cache(redis, voice_name, provider, audio_bytes)

    return audio_bytes


async def warm_cache(redis) -> None:
    """
    Pre-generate all gTTS samples at startup.
    Call this from main.py lifespan so samples are ready before first request.
    """
    logger.info("Warming voice sample cache...")
    for voice_name in GTTS_VOICES:
        existing = await get_sample_from_cache(redis, voice_name, "gtts")
        if not existing:
            audio = await _generate_gtts_sample(voice_name)
            if audio:
                await store_sample_in_cache(redis, voice_name, "gtts", audio)
    logger.info("Voice sample cache warm complete")
