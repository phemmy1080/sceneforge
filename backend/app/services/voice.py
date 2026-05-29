from __future__ import annotations

import asyncio
import logging
import subprocess
import tempfile
import os
from pathlib import Path
from typing import Optional

from app.config import get_settings
from app.models.schemas import Scene

settings = get_settings()
logger = logging.getLogger(__name__)

# Maps SceneForge voice names → Edge TTS neural voice IDs
VOICE_MAP: dict[str, str] = {
    "Marcus": "en-US-GuyNeural",           # Deep, authoritative
    "Sophie": "en-US-JennyNeural",         # Warm, friendly
    "Alex":   "en-US-ChristopherNeural",   # Energetic
    "Jordan": "en-GB-RyanNeural",          # Professional, British
    "Luna":   "en-US-AriaNeural",          # Calm, storytelling
    "Kai":    "en-AU-WilliamNeural",       # Casual, Australian
}


def _rate_string(speed: float) -> str:
    pct = round((speed - 1.0) * 100)
    if pct == 0:
        return "+0%"
    return f"+{pct}%" if pct > 0 else f"{pct}%"


# ── Word timing type ──────────────────────────────────────────────────────────
# List of {"word": str, "start": float, "end": float} in seconds
WordTimings = list[dict]


async def _synthesize_edge_with_timing(
    text: str,
    voice_id: str,
    rate: str,
    out_path: str,
) -> WordTimings:
    """
    Synthesise via Edge TTS using stream() to capture both audio and
    word boundary events. Returns word timings list.

    Edge TTS offset/duration units: 100-nanosecond ticks.
    Divide by 10_000_000 to get seconds.
    """
    import edge_tts

    audio_chunks: list[bytes] = []
    timings: WordTimings = []

    communicate = edge_tts.Communicate(text=text, voice=voice_id, rate=rate)
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio_chunks.append(chunk["data"])
        elif chunk["type"] == "WordBoundary":
            start_s = chunk["offset"] / 10_000_000
            dur_s   = chunk["duration"] / 10_000_000
            timings.append({
                "word":  chunk["text"],
                "start": round(start_s, 4),
                "end":   round(start_s + dur_s, 4),
            })

    # Write the raw MP3 audio chunks
    with open(out_path, "wb") as f:
        f.write(b"".join(audio_chunks))

    return timings


async def synthesize_scene(
    scene: Scene,
    voice_name: str,
    output_dir: str,
    speed: float = 1.0,
    stability: str = "medium",  # kept for API compatibility
) -> str:
    """Synthesise TTS for a single scene. Returns audio path."""
    path, _ = await _synthesize_scene_with_timing(scene, voice_name, output_dir, speed)
    return path


async def _synthesize_scene_with_timing(
    scene: Scene,
    voice_name: str,
    output_dir: str,
    speed: float = 1.0,
) -> tuple[str, WordTimings]:
    """
    Synthesise TTS and capture per-word timing from Edge TTS.
    Falls back to save() (no timing) if stream() fails.
    Returns (audio_path, word_timings).
    """
    import edge_tts

    voice_id = VOICE_MAP.get(voice_name, VOICE_MAP["Marcus"])
    rate     = _rate_string(speed)
    out_path = str(Path(output_dir) / f"scene_{scene.id:02d}_audio.mp3")

    # Primary: stream() captures audio + word boundaries simultaneously
    try:
        timings = await asyncio.wait_for(
            _synthesize_edge_with_timing(scene.text, voice_id, rate, out_path),
            timeout=30.0,
        )
        size = Path(out_path).stat().st_size
        logger.info(
            "Edge TTS ✓ scene %s | %s | %d words timed | %d bytes",
            scene.id, voice_id, len(timings), size,
        )
        return out_path, timings

    except asyncio.TimeoutError:
        logger.warning("Edge TTS stream timed out (scene %s) — trying save()", scene.id)
    except Exception as e:
        logger.warning("Edge TTS stream failed (scene %s): %s — trying save()", scene.id, e)

    # Fallback: save() without timing data
    try:
        communicate = edge_tts.Communicate(text=scene.text, voice=voice_id, rate=rate)
        await asyncio.wait_for(communicate.save(out_path), timeout=25.0)
        logger.info("Edge TTS save() fallback ✓ scene %s (no word timing)", scene.id)
        return out_path, []
    except Exception as e2:
        raise RuntimeError(f"Scene {scene.id}: Edge TTS failed entirely — {e2}") from e2


async def synthesize_all_scenes(
    scenes: list[Scene],
    voice_name: str,
    output_dir: str,
    speed: float = 1.0,
    stability: str = "medium",
    on_progress=None,
) -> list[str]:
    """Synthesise all scenes. Returns audio paths only (backward compatible)."""
    paths, _ = await synthesize_all_scenes_with_timing(
        scenes, voice_name, output_dir, speed, stability, on_progress
    )
    return paths


async def synthesize_all_scenes_with_timing(
    scenes: list[Scene],
    voice_name: str,
    output_dir: str,
    speed: float = 1.0,
    stability: str = "medium",
    on_progress=None,
) -> tuple[list[str], list[WordTimings]]:
    """
    Synthesise all scenes concurrently (max 3 at a time).
    Returns (audio_paths, word_timings_per_scene).
    """
    total     = len(scenes)
    completed = 0
    paths:   list[Optional[str]]       = [None] * total
    timings: list[Optional[WordTimings]] = [None] * total
    semaphore = asyncio.Semaphore(3)

    async def _synth(i: int, scene: Scene) -> None:
        nonlocal completed
        async with semaphore:
            p, t = await _synthesize_scene_with_timing(
                scene, voice_name, output_dir, speed
            )
            paths[i]   = p
            timings[i] = t
            completed += 1
            if on_progress:
                await on_progress(completed, total)

    await asyncio.gather(*[_synth(i, s) for i, s in enumerate(scenes)])
    return paths, [t or [] for t in timings]  # type: ignore[return-value]


async def get_available_voices() -> list[dict]:
    return [
        {"id": vid, "name": name, "category": "free"}
        for name, vid in VOICE_MAP.items()
    ]


async def split_audio_by_scenes(
    audio_path: str,
    scenes: list[Scene],
    output_dir: str,
) -> list[str]:
    """Split a single uploaded voiceover into per-scene clips by duration."""
    output_files = []
    cursor = 0.0
    for scene in scenes:
        out_path = str(Path(output_dir) / f"scene_{scene.id:02d}_audio.mp3")
        result = subprocess.run([
            "ffmpeg", "-y", "-i", audio_path,
            "-ss", str(cursor), "-t", str(float(scene.duration)),
            "-ar", "44100", "-ac", "2", "-q:a", "4",
            out_path,
        ], capture_output=True)
        if result.returncode != 0:
            subprocess.run([
                "ffmpeg", "-y", "-i", audio_path,
                "-ss", str(cursor),
                "-ar", "44100", "-ac", "2", "-q:a", "4",
                out_path,
            ], capture_output=True)
        output_files.append(out_path)
        logger.info("Split scene %s: %.1f–%.1fs", scene.id, cursor, cursor + scene.duration)
        cursor += float(scene.duration)
    return output_files
