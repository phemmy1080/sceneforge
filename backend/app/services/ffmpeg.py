from __future__ import annotations

import os
import asyncio
import logging
import subprocess
from pathlib import Path

from app.models.schemas import Scene

logger = logging.getLogger(__name__)

# ── Platform-aware dimensions ─────────────────────────────────────────────────
PLATFORM_DIMS: dict[str, tuple[int, int]] = {
    "tiktok":            (1080, 1920),
    "youtube_shorts":    (1080, 1920),
    "instagram_reels":   (1080, 1920),
    "reels":             (1080, 1920),
    "shorts":            (1080, 1920),
    "youtube":           (1920, 1080),
    "youtube_landscape": (1920, 1080),
    "linkedin":          (1080, 1080),
    "facebook":          (1080, 1080),
}

def _dims(platform: str | None) -> tuple[int, int]:
    if not platform:
        return (1080, 1920)
    key = (platform or "").lower().replace(" ", "_").replace("-", "_")
    for k, d in PLATFORM_DIMS.items():
        if k in key or key in k:
            return d
    return (1080, 1920)

# Default dimensions (overridden per-render via platform param)
W, H = 1080, 1920
SCALE_VF = (
    f"scale=w={W}:h={H}:force_original_aspect_ratio=increase,"
    f"crop={W}:{H}"
)


# ── FFmpeg capability checks ──────────────────────────────────────────────────
def _ffmpeg_has_filter(name: str) -> bool:
    try:
        r = subprocess.run(["ffmpeg", "-filters"], capture_output=True, text=True)
        return name in r.stdout
    except Exception:
        return False


def _find_font() -> str | None:
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
        "/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            logger.info("Using font: %s", path)
            return path
    logger.warning("No font found — drawtext will be disabled")
    return None


_HAS_DRAWTEXT = _ffmpeg_has_filter("drawtext")
_FONT_PATH = _find_font()
_HAS_DRAWTEXT = False  # Disabled to reduce memory usage on Railway free tier
logger.info("FFmpeg drawtext available: %s (font: %s)", _HAS_DRAWTEXT, _FONT_PATH)


# ── Runner ────────────────────────────────────────────────────────────────────
def _run(cmd: list[str]) -> None:
    logger.info("FFmpeg CMD: %s", " ".join(cmd))
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stderr = result.stderr.decode(errors="replace")
    if result.returncode != 0:
        logger.error("FFmpeg FAILED (code %d):\nCMD: %s\nSTDERR: %s",
                     result.returncode, " ".join(cmd), stderr[-3000:])
        raise RuntimeError(f"FFmpeg failed (code {result.returncode}):\n{stderr[-2000:]}")


async def run_ffmpeg(cmd: list[str]) -> None:
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _run, cmd)


# ── Normalize ─────────────────────────────────────────────────────────────────
async def normalize_scene(input_path: str, output_path: str) -> str:
    await run_ffmpeg([
        "ffmpeg", "-y",
        "-i", input_path,
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-threads", "2",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "128k",
        "-avoid_negative_ts", "make_zero",
        "-fflags", "+genpts",
        "-async", "1",    # resample audio to fix drift
        "-vsync", "cfr",  # constant frame rate
        output_path,
    ])
    return output_path


# ── Scene renderer ────────────────────────────────────────────────────────────
async def render_scene(
    scene: Scene,
    visual_path: str,
    audio_path: str,
    output_path: str,
    subtitle_style: str = "viral",
    is_image: bool = False,
    platform: str | None = None,
) -> str:
    # Resolve dimensions for this platform
    w, h = _dims(platform)
    scale_vf = (
        f"scale=w={w}:h={h}:force_original_aspect_ratio=increase,"
        f"crop={w}:{h}"
    )

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
        safe = (
            "\n".join(lines[:2])
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
        vf = f"{scale_vf},drawtext=fontfile='{_FONT_PATH}':text='{safe}':{style}"
    else:
        vf = scale_vf

    cmd = [
        "ffmpeg", "-y",
        *(["-loop", "1"] if is_image else []),
        "-i", visual_path,
        "-i", audio_path,
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-vf", vf,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "28",
        "-threads", "2",
        "-c:a", "aac",
        "-ar", "44100",
        "-ac", "2",
        "-b:a", "96k",
        "-t", str(max(float(scene.duration or 10), 3.0)),
        "-pix_fmt", "yuv420p",
        "-avoid_negative_ts", "make_zero",
        output_path,
    ]

    logger.info("Scene %s | platform=%s | dims=%dx%d | duration=%s",
                scene.id, platform, w, h, scene.duration)
    await run_ffmpeg(cmd)
    logger.info("Rendered scene %s → %s", scene.id, Path(output_path).name)
    return output_path


# ── Concatenation ─────────────────────────────────────────────────────────────
async def concat_scenes(scene_files: list[str], output_path: str) -> str:
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
        try: Path(nf).unlink()
        except: pass
    try: Path(concat_list).unlink()
    except: pass

    logger.info("Concatenated %d scenes → %s", len(scene_files), Path(output_path).name)
    return output_path


# ── Background music ──────────────────────────────────────────────────────────
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
        f"[1:a]volume={music_volume},aloop=loop=-1:size=2e+09[music];"
        "[0:a][music]amix=inputs=2:duration=first[a]",
        "-map", "0:v",
        "-map", "[a]",
        "-c:v", "copy",
        "-c:a", "aac", "-ar", "44100", "-ac", "2",
        "-shortest",
        output_path,
    ])
    return output_path




# ── Music track resolver ───────────────────────────────────────────────────────



# Music track FFmpeg filter configs — generated programmatically, no downloads needed
_MUSIC_FILTERS: dict[str, str] = {
    "upbeat":    "sine=frequency=440:beep_factor=4,volume=0.3",
    "cinematic": "aevalsrc=sin(2*PI*220*t)*exp(-t/8)+sin(2*PI*330*t)*exp(-t/6):s=44100,volume=0.25",
    "lofi":      "sine=frequency=220:beep_factor=2,volume=0.2",
    "corporate": "sine=frequency=330:beep_factor=3,volume=0.25",
    "energetic": "sine=frequency=528:beep_factor=6,volume=0.3",
    "inspiring": "aevalsrc=sin(2*PI*264*t)+sin(2*PI*396*t)*0.5:s=44100,volume=0.2",
}

# Music directory — bundle MP3s here in the repo at backend/music/
_MUSIC_DIR = Path(__file__).parent.parent.parent / "music"


async def _resolve_music(music_path: str, output_dir: str):
    """
    Resolve a music track name to a local file.
    Priority: 1) bundled file in backend/music/  2) ffmpeg-generated tone
    Returns None if music should be skipped.
    """
    if not music_path or music_path == "none":
        return None

    # Already a valid file path
    if os.path.exists(music_path):
        return music_path

    track_name = music_path.lower().strip()

    # 1. Check bundled music directory (backend/music/<name>.mp3)
    bundled = _MUSIC_DIR / f"{track_name}.mp3"
    if bundled.exists():
        logger.info("Using bundled music track: %s", track_name)
        return str(bundled)

    # 2. Generate a simple ambient tone using FFmpeg (no download needed)
    local_path = str(Path(output_dir) / f"music_{track_name}.mp3")
    if os.path.exists(local_path):
        return local_path

    logger.info("Generating ambient music track for: %s", track_name)
    try:
        # Generate 3 minutes of ambient sine tones that loop well
        freqs = {
            "upbeat":    [440, 550, 660],
            "cinematic": [220, 277, 330],
            "lofi":      [196, 246, 293],
            "corporate": [330, 415, 494],
            "energetic": [528, 660, 792],
            "inspiring": [264, 330, 396],
        }.get(track_name, [330, 440, 550])

        # Build a rich but subtle ambient sound from layered sines
        expr = "+".join(
            f"sin(2*PI*{f}*t)*{0.15 / len(freqs)}" for f in freqs
        )
        filter_str = f"aevalsrc='{expr}':s=44100:c=stereo,volume=0.4"

        loop = asyncio.get_event_loop()
        def _gen():
            import subprocess
            result = subprocess.run([
                "ffmpeg", "-y",
                "-f", "lavfi", "-i", filter_str,
                "-t", "180",  # 3 minutes
                "-c:a", "mp3", "-b:a", "128k",
                local_path,
            ], capture_output=True)
            return result.returncode
        rc = await loop.run_in_executor(None, _gen)
        if rc == 0:
            logger.info("Generated music track: %s", local_path)
            return local_path
        else:
            logger.warning("FFmpeg music generation failed — skipping music")
            return None
    except Exception as e:
        logger.warning("Music generation failed: %s — skipping", e)
        return None

# ── Full pipeline ─────────────────────────────────────────────────────────────
async def render_full_pipeline(
    scenes: list[Scene],
    audio_files: list[str],
    visual_files,
    output_dir: str,
    subtitle_style: str = "viral",
    music_path: str = None,
    on_progress=None,
    platform: str | None = None,
) -> dict:
    # Resolve music track name → local file path
    resolved_music = await _resolve_music(music_path, output_dir)

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
            platform=platform,
        )
        scene_outputs.append(scene_out)

        if on_progress:
            pct = int(55 + (i / len(scenes)) * 25)
            await on_progress(f"Rendered scene {i+1}/{len(scenes)}", pct)

    if on_progress:
        await on_progress("Normalising and concatenating scenes...", 82)

    final_path = str(Path(output_dir) / "final_video.mp4")
    await concat_scenes(scene_outputs, final_path)

    if resolved_music:
        if on_progress:
            await on_progress("Mixing background music...", 95)
        mixed_path = str(Path(output_dir) / "final_video_music.mp4")
        await add_background_music(final_path, resolved_music, mixed_path)
        final_path = mixed_path

    return {
        "final_path": final_path,
        "scene_paths": scene_outputs,
    }
