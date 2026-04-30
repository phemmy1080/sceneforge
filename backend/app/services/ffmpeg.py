from __future__ import annotations

import os
import asyncio
import logging
import subprocess
from pathlib import Path

from app.models.schemas import Scene

logger = logging.getLogger(__name__)

W, H = 1080, 1920


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
    Forces: stereo, 44100 Hz, clean AAC, consistent video timebase.
    """
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


def _build_filter_complex(subtitle_text: str | None, subtitle_style: str) -> str:
    """
    Build the filter_complex string that handles BOTH video scaling and
    audio resampling in a single unified filtergraph.

    WHY filter_complex for everything:
    FFmpeg 7.x deadlocks when -vf and -af are used simultaneously with
    -map and -stream_loop. The encoders wait on each other for PTS sync
    that never arrives, writing frame=0 before timing out.
    Putting all filters in one filter_complex forces a single init path
    that resolves correctly.
    """
    # Video: scale to fill 1080x1920, crop center, normalize SAR and fps
    # trunc(X/2)*2 ensures even pixel dimensions — libx264 hard requirement
    scale_f = (
        f"scale="
        f"w='if(gt(iw/ih,{W}/{H}),trunc({H}*iw/ih/2)*2,{W})':"
        f"h='if(gt(iw/ih,{W}/{H}),{H},trunc({W}*ih/iw/2)*2)',"
        f"crop={W}:{H},"
        f"setsar=1,"
        f"fps=30"
    )

    # Audio: resample ElevenLabs 24000 Hz mono → 44100 Hz stereo
    audio_f = "aresample=44100,aformat=channel_layouts=stereo"

    if subtitle_text and _HAS_DRAWTEXT:
        # Escape characters that break FFmpeg drawtext parsing
        safe = (
            subtitle_text
            .replace("\\", "\\\\")
            .replace("'",  "\u2019")   # right single quote — visually identical, safe
            .replace(":",  "\\:")
            .replace("%",  "\\%")
            .replace("[",  "\\[")
            .replace("]",  "\\]")
        )
        style_map = {
            "viral":   f"fontsize=52:fontcolor=white:borderw=4:bordercolor=black:x=(w-text_w)/2:y=h*0.80",
            "minimal": f"fontsize=40:fontcolor=white:borderw=1:bordercolor=black@0.4:x=(w-text_w)/2:y=h*0.85",
            "karaoke": f"fontsize=48:fontcolor=yellow:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h*0.82",
        }
        style = style_map.get(subtitle_style, style_map["viral"])
        draw_f = f"drawtext=text='{safe}':{style}"
        return f"[0:v]{scale_f},{draw_f}[vout];[1:a]{audio_f}[aout]"
    else:
        return f"[0:v]{scale_f}[vout];[1:a]{audio_f}[aout]"


async def render_scene(
    scene: Scene,
    visual_path: str,
    audio_path: str,
    output_path: str,
    subtitle_style: str = "viral",
    is_image: bool = False,
) -> str:
    """
    Render one scene: scale visual to 1080x1920, mix in TTS audio,
    optional subtitle overlay.

    Root cause of the frame=0 crash (fixed here):
    -----------------------------------------------
    FFmpeg 7.x deadlocks when -vf and -af are both specified alongside
    -map and -stream_loop. The muxer initialises correctly (stream mapping
    shows in the log, output stream shows 44100 Hz AAC) but the encoder
    loop never starts — it waits for PTS synchronisation between the two
    separate filtergraphs that never resolves.

    Fix: merge ALL filters (video scale + audio resample + optional drawtext)
    into a single -filter_complex. Remove -vf and -af entirely. Map the
    named outputs [vout] and [aout] from the filter_complex.
    """
    # Build subtitle text from first 2 lines of scene text
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

    *(["-loop", "1"] if is_image else []),  #

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

    "-movflags", "+faststart",

    output_path,
]


    await run_ffmpeg(cmd)
    logger.info("Rendered scene %s → %s", scene.id, Path(output_path).name)
    return output_path


async def concat_scenes(scene_files: list[str], output_path: str) -> str:
    """
    Normalise each scene then concat with stream copy.
    Normalisation guarantees consistent codec params so stream copy works.
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
        "-f", "concat", "-safe", "0",
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
        "-c:a", "aac", "-ar", "44100", "-ac", "2",
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
