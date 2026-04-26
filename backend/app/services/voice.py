from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import edge_tts

from app.config import get_settings
from app.models.schemas import Scene

settings = get_settings()
logger = logging.getLogger(__name__)

# Maps SceneForge voice names → Edge TTS voice IDs
# All free — no API key, no account required
VOICE_MAP: dict[str, str] = {
    "Marcus": "en-US-GuyNeural",          # Deep, authoritative
    "Sophie": "en-US-JennyNeural",        # Warm, friendly
    "Alex":   "en-US-ChristopherNeural",  # Energetic
    "Jordan": "en-GB-RyanNeural",         # Professional, British
    "Luna":   "en-US-AriaNeural",         # Calm, storytelling
    "Kai":    "en-AU-WilliamNeural",      # Casual, Australian
}

# Speed is expressed as a rate string e.g. "+10%" or "-5%"
def _rate_string(speed: float) -> str:
    pct = round((speed - 1.0) * 100)
    if pct == 0:
        return "+0%"
    return f"+{pct}%" if pct > 0 else f"{pct}%"


async def synthesize_scene(
    scene: Scene,
    voice_name: str,
    output_dir: str,
    speed: float = 1.0,
    stability: str = "medium",   # kept for API compatibility, not used by Edge TTS
) -> str:
    """
    Generate TTS audio for a single scene using Microsoft Edge TTS.
    Returns the path to the saved MP3 file.
    Free — no API key required.
    """
    voice_id = VOICE_MAP.get(voice_name, VOICE_MAP["Marcus"])
    rate = _rate_string(speed)
    out_path = str(Path(output_dir) / f"scene_{scene.id:02d}_audio.mp3")

    communicate = edge_tts.Communicate(
        text=scene.text,
        voice=voice_id,
        rate=rate,
    )
    await communicate.save(out_path)

    size = Path(out_path).stat().st_size
    logger.info(
        "Synthesised scene %s with %s → %s (%d bytes)",
        scene.id, voice_id, Path(out_path).name, size,
    )
    return out_path


async def synthesize_all_scenes(
    scenes: list[Scene],
    voice_name: str,
    output_dir: str,
    speed: float = 1.0,
    stability: str = "medium",
    on_progress=None,
) -> list[str]:
    """Synthesise all scenes concurrently (max 3 at a time)."""
    total = len(scenes)
    completed = 0
    results: list[str | None] = [None] * total
    semaphore = asyncio.Semaphore(3)

    async def _synth(i: int, scene: Scene):
        nonlocal completed
        async with semaphore:
            path = await synthesize_scene(
                scene, voice_name, output_dir, speed, stability
            )
            results[i] = path
            completed += 1
            if on_progress:
                await on_progress(completed, total)

    await asyncio.gather(*[_synth(i, s) for i, s in enumerate(scenes)])
    return results  # type: ignore[return-value]


async def get_available_voices() -> list[dict]:
    """Return the list of available voices."""
    return [
        {"id": vid, "name": name, "category": "free"}
        for name, vid in VOICE_MAP.items()
    ]


async def split_audio_by_scenes(
    audio_path: str,
    scenes: list[Scene],
    output_dir: str,
) -> list[str]:
    """
    Split a single uploaded voiceover file into per-scene audio clips
    based on cumulative scene durations. Uses FFmpeg for accurate splitting.
    """
    import subprocess
    from pathlib import Path

    output_files = []
    cursor = 0.0

    for i, scene in enumerate(scenes):
        out_path = str(Path(output_dir) / f"scene_{scene.id:02d}_audio.mp3")
        duration = float(scene.duration)

        cmd = [
            "ffmpeg", "-y",
            "-i", audio_path,
            "-ss", str(cursor),
            "-t", str(duration),
            "-c:a", "libmp3lame",
            "-q:a", "4",
            out_path,
        ]

        result = subprocess.run(cmd, capture_output=True)
        if result.returncode != 0:
            logger.warning(
                "Could not split scene %s audio at %.1fs — using full audio: %s",
                scene.id, cursor, result.stderr.decode()[:100]
            )
            # Fallback: copy the whole file for this scene
            cmd_fallback = [
                "ffmpeg", "-y",
                "-i", audio_path,
                "-ss", str(cursor),
                "-c:a", "libmp3lame",
                "-q:a", "4",
                out_path,
            ]
            subprocess.run(cmd_fallback, capture_output=True)

        output_files.append(out_path)
        logger.info(
            "Split scene %s: %.1fs → %.1fs → %s",
            scene.id, cursor, cursor + duration, Path(out_path).name,
        )
        cursor += duration

    return output_files