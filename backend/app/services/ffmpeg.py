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
    Build a single unified filter_complex for video + audio.

    All filters must be in one filter_complex — separate -vf and -af deadlock
    in FFmpeg 7.x when combined with -stream_loop and -map.
    """
    scale_f = (
        f"scale="
        f"w='if(gt(iw/ih,{W}/{H}),trunc({H}*iw/ih/2)*2,{W})':"
        f"h='if(gt(iw/ih,{W}/{H}),{H},trunc({W}*ih/iw/2)*2)',"
        f"crop={W}:{H},setsar=1,fps=30"
    )
    audio_f = "aresample=44100,aformat=channel_layouts=stereo"

    if subtitle_text and _HAS_DRAWTEXT:
        safe = (
            subtitle_text
            .replace("\\", "\\\\")
            .replace("'",  "\u2019")
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
        return f"[0:v]{scale_f},drawtext=text='{safe}':{style}[vout];[1:a]{audio_f}[aout]"
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
    Render one scene to MP4.

    THE ROOT CAUSE OF frame=0 (solved here)
    =========================================
    In FFmpeg 7.x, when -stream_loop is active and -filter_complex is used,
    the filtergraph never receives an EOF signal from the looped stream.
    Without EOF, the filtergraph never flushes its buffer.
    Without a flush, the encoders never start writing frames.
    Result: frame=0, time=N/A, non-zero exit.

    The output-side -t flag does NOT fix this — it tells the MUXER to stop
    after N seconds, but the muxer only runs after the encoders produce frames,
    which never happens if the filtergraph never flushes.

    THE FIX: Place -t BEFORE each -i as an INPUT option.
    Input-side -t tells the DEMUXER to stop reading after N seconds.
    The demuxer sends EOF to the filtergraph after N seconds.
    The filtergraph flushes, the encoders start, frames are written.
    -shortest is added as a safety net to stop at whichever stream ends first.
    """
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
    duration = scene.duration

    cmd = [
        "ffmpeg", "-y",

        # ── Input 0: visual ───────────────────────────────────────────────
        # -t BEFORE -i = INPUT option = demuxer stops sending frames after
        # `duration` seconds, which sends EOF into the filtergraph.
        # This is what allows filter_complex to flush and encode to start.
        # Without this, -stream_loop -1 never terminates → frame=0.
        "-t", str(duration),
        *(["-loop", "1"] if is_image else ["-stream_loop", "-1"]),
        "-i", visual_path,

        # ── Input 1: TTS audio ────────────────────────────────────────────
        # -t here too so audio demuxer also has a hard stop
        "-t", str(duration),
        "-i", audio_path,

        # ── Filters: everything in one graph ─────────────────────────────
        "-filter_complex", fc,
        "-map", "[vout]",
        "-map", "[aout]",

        # ── Video encode ──────────────────────────────────────────────────
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",

        # ── Audio encode ──────────────────────────────────────────────────
        "-c:a", "aac",
        "-b:a", "128k",
        "-ar", "44100",
        "-ac", "2",

        # ── Output control ────────────────────────────────────────────────
        # -shortest: stop encoding when the shorter stream ends
        # (belt-and-suspenders alongside the input -t flags)
        "-shortest",
        "-avoid_negative_ts", "make_zero",
        "-movflags", "+faststart",
        output_path,
    ]

    await run_ffmpeg(cmd)
    logger.info("Rendered scene %s → %s", scene.id, Path(output_path).name)
    return output_path


async def concat_scenes(scene_files: list[str], output_path: str) -> str:
    """
    Normalise each scene then concat with stream copy.
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
