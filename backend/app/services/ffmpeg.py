from __future__ import annotations

import os
import asyncio
import logging
import subprocess
from pathlib import Path

from app.models.schemas import Scene

logger = logging.getLogger(__name__)

W, H = 1080, 1920
FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"


def _ffmpeg_has_filter(name: str) -> bool:
    try:
        r = subprocess.run(["ffmpeg", "-filters"], capture_output=True, text=True)
        return name in r.stdout
    except Exception:
        return False


_HAS_DRAWTEXT = _ffmpeg_has_filter("drawtext")
logger.info("FFmpeg drawtext available: %s", _HAS_DRAWTEXT)


def _run(cmd: list[str]) -> None:
    logger.info("Running FFmpeg: %s", " ".join(cmd))

    result = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=180  # ⏱️ prevent infinite hang
    )

    if result.returncode != 0:
        raise RuntimeError(
            f"FFmpeg failed:\n{result.stderr.decode(errors='replace')}"
        )


async def run_ffmpeg(cmd: list[str]) -> None:
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _run, cmd)


# ---------------------------
# FILTER COMPLEX
# ---------------------------
def _build_filter_complex(subtitle_text: str | None, subtitle_style: str) -> str:
    scale_f = (
        f"scale="
        f"w='if(gt(iw/ih,{W}/{H}),trunc({H}*iw/ih/2)*2,{W})':"
        f"h='if(gt(iw/ih,{W}/{H}),{H},trunc({W}*ih/iw/2)*2)',"
        f"crop={W}:{H},"
        f"setsar=1,"
        f"fps=30"
    )

    audio_f = "aresample=44100:async=1,aformat=sample_fmts=fltp:channel_layouts=stereo"

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

        draw_f = (
            f"drawtext=fontfile={FONT_PATH}:"
            f"text='{safe}':{style}"
        )

        return f"[0:v]{scale_f},{draw_f}[vout];[1:a]{audio_f}[aout]"

    return f"[0:v]{scale_f}[vout];[1:a]{audio_f}[aout]"


# ---------------------------
# RENDER SCENE
# ---------------------------
async def render_scene(
    scene: Scene,
    visual_path: str,
    audio_path: str,
    output_path: str,
    subtitle_style: str = "viral",
    is_image: bool = False,
) -> str:

    # Validate inputs early
    if not Path(visual_path).exists():
        raise FileNotFoundError(f"Missing visual: {visual_path}")

    if not Path(audio_path).exists():
        raise FileNotFoundError(f"Missing audio: {audio_path}")

    # Build subtitle text
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

    fc = _build_filter_complex(subtitle_text, subtitle_style)

    cmd = [
        "ffmpeg", "-y",

        # 🖼️ Handle image input properly
        *(["-loop", "1"] if is_image else []),

        "-i", visual_path,
        "-i", audio_path,

        "-filter_complex", fc,

        "-map", "[vout]",
        "-map", "[aout]",

        "-r", "30",

        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",

        "-c:a", "aac",
        "-b:a", "128k",
        "-ar", "44100",
        "-ac", "2",

        "-shortest",

        "-avoid_negative_ts", "make_zero",
        "-movflags", "+faststart",

        output_path,
    ]

    await run_ffmpeg(cmd)

    logger.info("Rendered scene %s → %s", scene.id, Path(output_path).name)
    return output_path


# ---------------------------
# CONCAT
# ---------------------------
async def concat_scenes(scene_files: list[str], output_path: str) -> str:
    concat_list = str(Path(output_path).parent / "concat_list.txt")

    with open(concat_list, "w") as f:
        for sf in scene_files:
            f.write(f"file '{os.path.abspath(sf)}'\n")

    await run_ffmpeg([
        "ffmpeg", "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", concat_list,
        "-c:v", "libx264",   # 🔥 safer than copy
        "-c:a", "aac",
        "-movflags", "+faststart",
        output_path,
    ])

    return output_path


# ---------------------------
# BACKGROUND MUSIC
# ---------------------------
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
            f"[1:a]volume={music_volume},aloop=loop=1000:size=44100[music];"
            "[0:a][music]amix=inputs=2:duration=first[a]"
        ),
        "-map", "0:v",
        "-map", "[a]",
        "-c:v", "copy",
        "-c:a", "aac",
        "-shortest",
        output_path,
    ])

    return output_path
