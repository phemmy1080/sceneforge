from __future__ import annotations

import os
import asyncio
import logging
import subprocess
from pathlib import Path

from app.models.schemas import Scene

logger = logging.getLogger(__name__)

W, H = 1080, 1920


# -------------------------------------------------
# FFmpeg capability check
# -------------------------------------------------
def _ffmpeg_has_filter(name: str) -> bool:
    try:
        r = subprocess.run(["ffmpeg", "-filters"], capture_output=True, text=True)
        return name in r.stdout
    except Exception:
        return False


_HAS_DRAWTEXT = _ffmpeg_has_filter("drawtext")
logger.info("FFmpeg drawtext available: %s", _HAS_DRAWTEXT)


# -------------------------------------------------
# Runner
# -------------------------------------------------
def _run(cmd: list[str]) -> None:
    logger.debug("FFmpeg CMD: %s", " ".join(cmd))
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg failed:\n{result.stderr.decode(errors='replace')}")


async def run_ffmpeg(cmd: list[str]) -> None:
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _run, cmd)


# -------------------------------------------------
# Normalize scenes before concat
# -------------------------------------------------
async def normalize_scene(input_path: str, output_path: str) -> str:
    await run_ffmpeg([
        "ffmpeg", "-y",
        "-i", input_path,
        "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "128k",
        "-avoid_negative_ts", "make_zero",
        "-fflags", "+genpts",
        output_path,
    ])
    return output_path


# -------------------------------------------------
# Filter builder (tpad-based)
# -------------------------------------------------
def _build_filter_complex(
    subtitle_text: str | None,
    subtitle_style: str,
    duration: float,
) -> str:

    scale_chain = (
        f"scale="
        f"w='if(gt(iw/ih,{W}/{H}),trunc({H}*iw/ih/2)*2,{W})':"
        f"h='if(gt(iw/ih,{W}/{H}),{H},trunc({W}*ih/iw/2)*2)',"
        f"crop={W}:{H},"
        f"setsar=1,"
        f"fps=30,"
        # 🔥 tpad replaces ALL looping logic
        #f"tpad=stop_mode=clone:stop_duration=1000"

        f"tpad=stop_duration={duration}:stop_mode=clone"
        
    )

    audio_chain = "aresample=44100,aformat=channel_layouts=stereo"

    if subtitle_text and _HAS_DRAWTEXT:
        safe = (
            subtitle_text
            .replace("\\", "\\\\")
            .replace("'", "\u2019")
            .replace(":", "\\:")
            .replace("%", "\\%")
            .replace("[", "\\[")
            .replace("]", "\\]")
        )

        style_map = {
            "viral":   "fontsize=52:fontcolor=white:borderw=4:bordercolor=black:x=(w-text_w)/2:y=h*0.80",
            "minimal": "fontsize=40:fontcolor=white:borderw=1:bordercolor=black@0.4:x=(w-text_w)/2:y=h*0.85",
            "karaoke": "fontsize=48:fontcolor=yellow:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h*0.82",
        }

        style = style_map.get(subtitle_style, style_map["viral"])

        return (
            f"[0:v]{scale_chain},drawtext=text='{safe}':{style}[vout];"
            f"[1:a]{audio_chain}[aout]"
        )

    return f"[0:v]{scale_chain}[vout];[1:a]{audio_chain}[aout]"


# -------------------------------------------------
# Scene renderer
# -------------------------------------------------
async def render_scene(
    scene: Scene,
    visual_path: str,
    audio_path: str,
    output_path: str,
    subtitle_style: str = "viral",
    is_image: bool = False,
) -> str:

    # -----------------------------
    # Subtitle preparation
    # -----------------------------
    subtitle_text = None
    if subtitle_style != "none" and _HAS_DRAWTEXT and hasattr(scene, "text"):
        words = scene.text.replace("\n", " ").split()
        lines, current = [], []

        for word in words:
            current.append(word)
            if len(current) >= 8:
                lines.append(" ".join(current))
                current = []

        if current:
            lines.append(" ".join(current))

        subtitle_text = "\n".join(lines[:2])

    # -----------------------------
    # Safe subtitle text
    # -----------------------------
    safe = ""
    if subtitle_text:
        safe = (
            subtitle_text
            .replace("\\", "\\\\")
            .replace("'", "\u2019")
            .replace(":", "\\:")
            .replace("%", "\\%")
            .replace("[", "\\[")
            .replace("]", "\\]")
        )

    # -----------------------------
    # Subtitle style
    # -----------------------------
    style_map = {
        "viral":   "fontsize=52:fontcolor=white:borderw=4:bordercolor=black:x=(w-text_w)/2:y=h*0.80",
        "minimal": "fontsize=40:fontcolor=white:borderw=1:bordercolor=black@0.4:x=(w-text_w)/2:y=h*0.85",
        "karaoke": "fontsize=48:fontcolor=yellow:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h*0.82",
    }

    style = style_map.get(subtitle_style, style_map["viral"])

    # -----------------------------
    # Filter (NO TPAD!)
    # -----------------------------
    fc = (
        f"[0:v]scale="
        f"w='if(gt(iw/ih,{W}/{H}),trunc({H}*iw/ih/2)*2,{W})':"
        f"h='if(gt(iw/ih,{W}/{H}),{H},trunc({W}*ih/iw/2)*2)',"
        f"crop={W}:{H},setsar=1,fps=30"
    )

    if subtitle_text and _HAS_DRAWTEXT:
        fc += f",drawtext=text='{safe}':{style}"

    fc += "[vout];[1:a]aresample=44100,aformat=channel_layouts=stereo[aout]"

    # -----------------------------
    # Input strategy (KEY PART)
    # -----------------------------
    if is_image:
        video_flags = ["-loop", "1", "-i", visual_path]
    else:
        video_flags = ["-stream_loop", "-1", "-i", visual_path]

    # -----------------------------
    # FFmpeg command (CLEAN)
    # -----------------------------
    cmd = [
        "ffmpeg", "-y",
        *video_flags,
        "-i", audio_path,
        "-filter_complex", fc,
        "-map", "[vout]",
        "-map", "[aout]",
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "128k",
        "-ar", "44100",
        "-ac", "2",
        "-shortest",  # 🔥 CRITICAL
        "-movflags", "+faststart",
        output_path,
    ]

    await run_ffmpeg(cmd)
    logger.info("Rendered scene %s → %s", scene.id, Path(output_path).name)

    return output_path


# -------------------------------------------------
# Concatenation
# -------------------------------------------------
async def concat_scenes(scene_files: list[str], output_path: str) -> str:
    output_dir = Path(output_path).parent
    normalized = []

    for i, sf in enumerate(scene_files):
        norm_path = str(output_dir / f"norm_{i+1:02d}.mp4")
        await normalize_scene(sf, norm_path)
        normalized.append(norm_path)

    concat_list = str(output_dir / "concat_list.txt")

    with open(concat_list, "w") as f:
        for nf in normalized:
            f.write(f"file '{os.path.abspath(nf)}'\n")

    await run_ffmpeg([
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0",
        "-i", concat_list,
        "-c", "copy",
        "-movflags", "+faststart",
        output_path,
    ])

    return output_path


# -------------------------------------------------
# Background music
# -------------------------------------------------
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
        "-c:a", "aac", "-ar", "44100", "-ac", "2",
        "-shortest",
        output_path,
    ])

    return output_path


# -------------------------------------------------
# Full pipeline
# -------------------------------------------------
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

        is_image = str(getattr(visual, "media_type", "video")).lower() == "image"

        await render_scene(
            scene=scene,
            visual_path=visual.path,
            audio_path=audio,
            output_path=scene_out,
            subtitle_style=subtitle_style,
            is_image=is_image,
        )

        scene_outputs.append(scene_out)

    final_path = str(Path(output_dir) / "final_video.mp4")

    await concat_scenes(scene_outputs, final_path)

    if music_path and music_path != "none":
        mixed_path = str(Path(output_dir) / "final_video_music.mp4")
        await add_background_music(final_path, music_path, mixed_path)
        final_path = mixed_path

    return {
        "final_path": final_path,
        "scene_paths": scene_outputs,
    }
