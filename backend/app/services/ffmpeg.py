from __future__ import annotations

import os
import asyncio
import logging
import subprocess
from pathlib import Path

from app.models.schemas import Scene

logger = logging.getLogger(__name__)

W, H = 1080, 1920
SCALE_VF = (
    f"scale=w={W}:h={H}:force_original_aspect_ratio=increase,"
    f"crop={W}:{H}"
)


def _ffmpeg_has_filter(name: str) -> bool:
    try:
        r = subprocess.run(["ffmpeg", "-filters"], capture_output=True, text=True)
        return name in r.stdout
    except Exception:
        return False


_HAS_DRAWTEXT = _ffmpeg_has_filter("drawtext")
logger.info("FFmpeg drawtext available: %s", _HAS_DRAWTEXT)


def _run(cmd: list[str]) -> None:
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg failed:\n{result.stderr.decode()}")


async def run_ffmpeg(cmd: list[str]) -> None:
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _run, cmd)


async def normalize_scene(input_path: str, output_path: str) -> str:
    """
    Re-encode a scene MP4 to ensure clean, consistent audio/video streams.
    Fixes broken AAC from stock Pexels clips and timestamp issues.
    Forces: stereo, 44100 Hz, clean AAC, consistent video timebase.
    """
    await run_ffmpeg([
        "ffmpeg", "-y",
        "-i", input_path,
        # Force clean audio decode + re-encode
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        # Force clean stereo AAC at standard sample rate
        "-c:a", "aac",
        "-ar", "44100",
        "-ac", "2",
        "-b:a", "128k",
        # Fix timestamps
        "-avoid_negative_ts", "make_zero",
        "-fflags", "+genpts",
        output_path,
    ])
    return output_path


async def render_scene(
    scene: Scene,
    visual_path: str,
    audio_path: str,
    output_path: str,
    subtitle_style: str = "viral",
    is_image: bool = False,
) -> str:
    """Render one scene: scale visual, overlay TTS audio, optional subtitle."""

    if subtitle_style != "none" and _HAS_DRAWTEXT:
        # Use first 2 lines of text for subtitle — enough for readability without truncation
        words = scene.text.replace("\n", " ").split()
        # Build subtitle lines of ~8 words each, show first 2 lines
        lines, current = [], []
        for word in words:
            current.append(word)
            if len(current) >= 8:
                lines.append(" ".join(current))
                current = []
        if current:
            lines.append(" ".join(current))
        subtitle_display = "\n".join(lines[:2])  # show first 2 lines on screen
        safe = (
            subtitle_display
            .replace("'",  "\u2019")
            .replace(":",  "\\:")
            .replace("%",  "\\%")
        )
        style_map = {
            "viral":   "fontsize=52:fontcolor=white:borderw=4:bordercolor=black:x=(w-text_w)/2:y=h*0.80",
            "minimal": "fontsize=40:fontcolor=white:borderw=1:bordercolor=black@0.4:x=(w-text_w)/2:y=h*0.85",
            "karaoke": "fontsize=48:fontcolor=yellow:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h*0.82",
        }
        style = style_map.get(subtitle_style, style_map["viral"])
        vf = f"{SCALE_VF},drawtext=text='{safe}':{style}"
    else:
        vf = SCALE_VF

    # Render with our clean TTS audio — ignore any audio in the visual file
    cmd = [
        "ffmpeg", "-y",
        *(["-loop", "1"] if is_image else []),
        "-i", visual_path,
        "-i", audio_path,
        # Map video from visual, audio from TTS only
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-vf", vf,
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-ar", "44100",   # standard sample rate
        "-ac", "2",       # stereo
        "-b:a", "128k",
        "-t", str(scene.duration),
        "-pix_fmt", "yuv420p",
        "-avoid_negative_ts", "make_zero",
        output_path,
    ]

    await run_ffmpeg(cmd)
    logger.info("Rendered scene %s → %s", scene.id, Path(output_path).name)
    return output_path


async def concat_scenes(scene_files: list[str], output_path: str) -> str:
    """
    Concatenate scene MP4s.
    Normalises each scene first to guarantee consistent stream parameters,
    then uses the concat demuxer with stream copy (fast, no re-encode).
    """
    output_dir = Path(output_path).parent
    normalized: list[str] = []

    for i, sf in enumerate(scene_files):
        norm_path = str(output_dir / f"norm_{i+1:02d}.mp4")
        logger.info("Normalising scene %d/%d…", i + 1, len(scene_files))
        await normalize_scene(sf, norm_path)
        normalized.append(norm_path)

    concat_list = str(output_dir / "concat_list.txt")
    with open(concat_list, "w") as f:
        for nf in normalized:
            f.write(f"file '{os.path.abspath(nf)}'\n")

    # Stream-copy concat — fast because all streams are already consistent
    await run_ffmpeg([
        "ffmpeg", "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", concat_list,
        "-c", "copy",          # stream copy — no re-encode needed after normalize
        "-movflags", "+faststart",
        output_path,
    ])

    # Clean up normalised temp files
    for nf in normalized:
        try:
            Path(nf).unlink()
        except Exception:
            pass
    try:
        Path(concat_list).unlink()
    except Exception:
        pass

    logger.info("Concatenated %d scenes → %s", len(scene_files), Path(output_path).name)
    return output_path


async def add_background_music(
    video_path: str,
    music_path: str,
    output_path: str,
    music_volume: float = 0.15,
) -> str:
    await run_ffmpeg([
        "ffmpeg", "-y",
        "-i", video_path,
        "-i", music_path,
        "-filter_complex",
        (
            f"[1:a]volume={music_volume},aloop=loop=-1:size=2e+09[music];"
            "[0:a][music]amix=inputs=2:duration=first[a]"
        ),
        "-map", "0:v",
        "-map", "[a]",
        "-c:v", "copy",
        "-c:a", "aac",
        "-ar", "44100",
        "-ac", "2",
        "-shortest",
        output_path,
    ])
    return output_path


async def render_full_pipeline(
    scenes: list[Scene],
    audio_files: list[str],
    visual_files,
    output_dir: str,
    subtitle_style: str = "viral",
    music_path: str = None,
    on_progress=None,
) -> dict:
    scene_outputs = []

    for i, (scene, audio, visual) in enumerate(zip(scenes, audio_files, visual_files)):
        scene_out = str(Path(output_dir) / f"scene_{i+1:02d}.mp4")
        is_image = getattr(visual, "media_type", "video") == "image"

        await render_scene(
            scene=scene,
            visual_path=visual.path,
            audio_path=audio,
            output_path=scene_out,
            subtitle_style=subtitle_style,
            is_image=is_image,
        )
        scene_outputs.append(scene_out)

        if on_progress:
            pct = int(55 + (i / len(scenes)) * 25)
            await on_progress(f"Rendered scene {i+1}/{len(scenes)}", pct)

    if on_progress:
        await on_progress("Normalising and concatenating scenes...", 82)

    final_path = str(Path(output_dir) / "final_video.mp4")
    await concat_scenes(scene_outputs, final_path)

    if music_path and music_path != "none":
        if on_progress:
            await on_progress("Mixing background music...", 95)
        mixed_path = str(Path(output_dir) / "final_video_music.mp4")
        await add_background_music(final_path, music_path, mixed_path)
        final_path = mixed_path

    return {
        "final_path": final_path,
        "scene_paths": scene_outputs,
    }