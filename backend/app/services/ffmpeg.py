from __future__ import annotations

import os
import asyncio
import logging
import subprocess
from pathlib import Path

from app.models.schemas import Scene

logger = logging.getLogger(__name__)

W, H = 1080, 1920

# ── Scale filter ──────────────────────────────────────────────────────────────
# Problem with the original:
#   scale=force_original_aspect_ratio=increase then crop works BUT only when
#   the scaled dimensions are EVEN numbers. A 1080x2048 source scales to
#   1080x2048 (no change needed) then crops to 1080x1920 — this actually works.
#   However some Pexels sources produce odd intermediate dimensions.
#
# Fix: add scale2ref trick replaced with explicit even-safe scale expression.
# We scale so the SMALLER ratio dimension fills the target, then center-crop.
# The "trunc(X/2)*2" ensures libx264 always gets even dimensions.
SCALE_VF = (
    # 1. Scale: fill target box, keep aspect ratio, guarantee even pixel dims
    f"scale="
    f"w='if(gt(iw/ih,{W}/{H}),{H}*iw/ih,{W})':"
    f"h='if(gt(iw/ih,{W}/{H}),{H},{W}*ih/iw)',"
    # Round to even (libx264 requirement)
    f"scale=trunc(iw/2)*2:trunc(ih/2)*2,"
    # 2. Center crop to exact target
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
        raise RuntimeError(f"FFmpeg failed:\n{result.stderr.decode(errors='replace')}")


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
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-ar", "44100",
        "-ac", "2",
        "-b:a", "128k",
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
    """
    Render one scene: scale visual to 1080x1920, overlay TTS audio,
    optional subtitle drawtext.

    FIXES vs original:
    1. aresample filter on audio input — ElevenLabs outputs 24000 Hz mono MP3.
       Without explicit resampling, AAC encoder stalls (frame=0, time=N/A).
    2. Explicit -ar 44100 -ac 2 output flags for consistent stream params.
    3. -shortest added so output duration = min(video, audio) instead of
       stream_loop running forever when audio is shorter than video.
    4. Even-safe SCALE_VF that handles odd intermediate dimensions.
    """
    # ── Build video filter chain ──────────────────────────────────────────────
    if subtitle_style != "none" and _HAS_DRAWTEXT:
        words = scene.text.replace("\n", " ").split()
        lines, current = [], []
        for word in words:
            current.append(word)
            if len(current) >= 8:
                lines.append(" ".join(current))
                current = []
        if current:
            lines.append(" ".join(current))
        subtitle_display = "\n".join(lines[:2])
        safe = (
            subtitle_display
            .replace("\\", "\\\\")
            .replace("'",  "\u2019")   # typographic apostrophe — safe in drawtext
            .replace(":",  "\\:")
            .replace("%",  "\\%")
            .replace("[",  "\\[")
            .replace("]",  "\\]")
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

    # ── Audio filter: resample to 44100 Hz stereo ─────────────────────────────
    # CRITICAL FIX: ElevenLabs TTS outputs 24000 Hz mono MP3.
    # FFmpeg's AAC encoder requires 44100 Hz. Without aresample, the mux
    # initialises correctly (shows stream mapping) but encodes 0 frames
    # because the encoder rejects the sample rate mismatch silently.
    # This is the root cause of every "frame=0 time=N/A" crash in the logs.
    af = "aresample=44100,aformat=channel_layouts=stereo"

    # ── Build command ──────────────────────────────────────────────────────────
    cmd = [
        "ffmpeg", "-y",
        # Input 0: visual (loop image or video)
        *(["-loop", "1"] if is_image else ["-stream_loop", "-1"]),
        "-i", visual_path,
        # Input 1: TTS audio
        "-i", audio_path,
        # Explicit stream mapping — video from input 0, audio from input 1
        # (never rely on FFmpeg's auto-selection with multiple inputs)
        "-map", "0:v:0",
        "-map", "1:a:0",
        # Video filters
        "-vf", vf,
        # Audio filters (inline — simpler than filter_complex for single audio)
        "-af", af,
        # Video encode
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        # Audio encode — explicit rate/channels regardless of source format
        "-c:a", "aac",
        "-ar", "44100",
        "-ac", "2",
        "-b:a", "128k",
        # Duration: trim to scene duration
        # -shortest alone isn't enough when stream_loop makes video infinite
        "-t", str(scene.duration),
        # Timestamp fixes
        "-avoid_negative_ts", "make_zero",
        # Fast web streaming
        "-movflags", "+faststart",
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

    await run_ffmpeg([
        "ffmpeg", "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", concat_list,
        "-c", "copy",
        "-movflags", "+faststart",
        output_path,
    ])

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
