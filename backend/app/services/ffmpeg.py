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
    "facebook":          (1920, 1080),
    "twitter":           (1920, 1080),
    "twitter_x":         (1920, 1080),
    "snapchat":          (1080, 1920),
    "pinterest":         (1000, 1500),
}

def _dims(platform: str | None) -> tuple[int, int]:
    if not platform:
        return (1080, 1920)
    key = (
        (platform or "")
        .lower()
        .replace(" ", "_")
        .replace("-", "_")
        .replace("/", "_")   # handles "Twitter/X" → "twitter_x"
    )
    # 1. Exact match first
    if key in PLATFORM_DIMS:
        return PLATFORM_DIMS[key]
    # 2. Key starts with a known platform (e.g. "youtube_shorts" starts with "youtube")
    #    — use longest matching key to avoid "youtube" matching "youtube_shorts"
    matches = [(k, d) for k, d in PLATFORM_DIMS.items() if key.startswith(k) or k.startswith(key)]
    if matches:
        # Pick the longest key match (most specific)
        return max(matches, key=lambda x: len(x[0]))[1]
    # 3. Substring fallback
    for k, d in PLATFORM_DIMS.items():
        if k in key:
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


_FONT_PATH = _find_font()
_HAS_DRAWTEXT = _FONT_PATH is not None  # Enabled when a font is available
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
async def normalize_scene(
    input_path: str,
    output_path: str,
    platform: str | None = None,
) -> str:
    """Re-encode a clip to a consistent spec for concatenation.
    Forces exact target resolution with scale+crop so all clips match.
    """
    w, h = _dims(platform)
    # scale-to-fill: scale so the SMALLER dimension matches target, then crop centre
    vf = (
        f"scale=w={w}:h={h}:force_original_aspect_ratio=increase,"
        f"crop={w}:{h},"
        f"setsar=1"
    )
    await run_ffmpeg([
        "ffmpeg", "-y",
        "-i", input_path,
        "-vf", vf,
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "26", "-threads", "2",
        "-r", "30",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "128k",
        "-avoid_negative_ts", "make_zero",
        "-fflags", "+genpts",
        "-async", "1",
        "-vsync", "cfr",
        output_path,
    ])
    return output_path


# ── Scene renderer ────────────────────────────────────────────────────────────
# ── Cinematic motion presets ──────────────────────────────────────────────────
# Each preset returns a zoompan filter string for the given width/height/duration
# used to add Ken Burns, pan, or zoom-out effects to images and video clips.

def _motion_filter(motion: str, w: int, h: int, duration: float) -> str:
    """Return a zoompan vf string for the requested motion effect."""
    fps    = 30
    frames = int(duration * fps)
    # Scale preserving aspect ratio then crop to exact target — no stretching
    # We scale to 2x target size while preserving AR, then zoompan crops to exact output
    safe_scale = (
        f"scale=w={w*2}:h={h*2}:force_original_aspect_ratio=increase,"
        f"crop={w*2}:{h*2}"
    )

    if motion == "kenburns_in":
        return (
            f"{safe_scale},"
            f"zoompan=z='min(zoom+0.0006,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
            f":d={frames}:s={w}x{h}:fps={fps}"
        )
    elif motion == "kenburns_out":
        return (
            f"{safe_scale},"
            f"zoompan=z='if(eq(on,1),1.12,max(zoom-0.0006,1.0))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
            f":d={frames}:s={w}x{h}:fps={fps}"
        )
    elif motion == "pan_left":
        # Scale wider to allow horizontal pan without hitting edges
        pan_scale = (
            f"scale=w={int(w*1.4)}:h={h*2}:force_original_aspect_ratio=increase,"
            f"crop={int(w*1.4)}:{h}"
        )
        return (
            f"{pan_scale},"
            f"zoompan=z='1.0':x='if(eq(on,1),iw*0.15,x-iw*0.15/{frames})'"
            f":y='(ih-{h})/2':d={frames}:s={w}x{h}:fps={fps}"
        )
    elif motion == "pan_right":
        pan_scale = (
            f"scale=w={int(w*1.4)}:h={h*2}:force_original_aspect_ratio=increase,"
            f"crop={int(w*1.4)}:{h}"
        )
        return (
            f"{pan_scale},"
            f"zoompan=z='1.0':x='if(eq(on,1),0,x+iw*0.15/{frames})'"
            f":y='(ih-{h})/2':d={frames}:s={w}x{h}:fps={fps}"
        )
    else:
        # none — scale preserving AR then crop to exact size
        return (
            f"scale=w={w}:h={h}:force_original_aspect_ratio=increase,"
            f"crop={w}:{h}"
        )


# Rotate through motion effects per scene index for variety
_MOTION_CYCLE = ["kenburns_in", "pan_left", "kenburns_out", "pan_right"]


async def render_scene(
    scene: Scene,
    visual_path: str,
    audio_path: str,
    output_path: str,
    subtitle_style: str = "viral",
    is_image: bool = False,
    platform: str | None = None,
    motion: str = "auto",   # "auto" | "kenburns_in" | "kenburns_out" | "pan_left" | "pan_right" | "none"
    scene_index: int = 0,
    is_custom_image: bool = False,  # True = letterbox (preserve proportions), False = scale-fill+crop
) -> str:
    w, h   = _dims(platform)
    duration = max(float(scene.duration or 10), 3.0)

    # Resolve motion effect
    if motion == "auto":
        motion = _MOTION_CYCLE[scene_index % len(_MOTION_CYCLE)]

    # Custom uploaded images: letterbox (scale-to-fit + black padding) to preserve proportions
    # Stock footage/AI images: scale-to-fill + crop for a cinematic look
    if is_custom_image and is_image:
        # Scale to fit within frame, pad with black to exact dimensions
        letterbox_vf = (
            f"scale=w={w}:h={h}:force_original_aspect_ratio=decrease,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1"
        )
        motion_vf = letterbox_vf
    elif motion != "none":
        motion_vf = _motion_filter(motion, w, h, duration)
    else:
        motion_vf = f"scale=w={w}:h={h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1"

    # Add subtitles on top of motion filter
    if subtitle_style != "none" and _HAS_DRAWTEXT:
        # ── Font size: scale by WIDTH not height — prevents overflow on portrait ──
        # Use ~4.5% of frame width, capped so text fits comfortably
        # Portrait 1080px wide → max ~42px; landscape 1920px wide → max ~48px
        _font_size_viral   = max(24, min(48, int(w * 0.045)))
        _font_size_minimal = max(20, min(38, int(w * 0.035)))
        _font_size_karaoke = max(22, min(44, int(w * 0.040)))

        # ── Word wrap: target ~40 chars per line, max 2 lines ────────────────
        # Estimate chars per line based on font size and frame width
        # Average char width ≈ font_size * 0.55
        _chars_per_line = max(20, int(w * 0.85 / (_font_size_viral * 0.55)))
        words = scene.text.replace("\n", " ").split()
        lines, current, line_len = [], [], 0
        for word in words:
            wlen = len(word) + 1
            if line_len + wlen > _chars_per_line and current:
                lines.append(" ".join(current))
                current, line_len = [], 0
                if len(lines) >= 2:   # max 2 lines shown at once
                    break
            current.append(word)
            line_len += wlen
        if current and len(lines) < 2:
            lines.append(" ".join(current))

        # ── Sanitise text for drawtext ────────────────────────────────────────
        def _sanitise(t: str) -> str:
            return (
                t
                .replace("'",  "\u2019")
                .replace("\"", "\u201C")
                .replace(":",   "\\:")
                .replace("%",   "\\%")
                .replace("[",   "\\[")
                .replace("]",   "\\]")
                .replace("{",   "")
                .replace("}",   "")
                .replace("\n", " ")
            )

        # Use newline character between lines (works on most ffmpeg builds)
        if len(lines) == 2:
            safe = _sanitise(lines[0]) + "\n" + _sanitise(lines[1])
        else:
            safe = _sanitise(lines[0] if lines else "")

        # Hard cap — safety net
        if len(safe) > 120:
            safe = safe[:117] + "..."

        # ── Styles ────────────────────────────────────────────────────────────
        # x clamp: keep text inside frame with 20px margin on each side
        _x = f"max(20, (w-text_w)/2)"
        style_map = {
            "viral":   f"fontsize={_font_size_viral}:fontcolor=white:borderw=3:bordercolor=black:shadowx=2:shadowy=2:shadowcolor=black@0.6:x={_x}:y=h*0.80:line_spacing=4",
            "minimal": f"fontsize={_font_size_minimal}:fontcolor=white:borderw=1:bordercolor=black@0.4:x={_x}:y=h*0.85:line_spacing=4",
            "karaoke": f"fontsize={_font_size_karaoke}:fontcolor=yellow:borderw=2:bordercolor=black:shadowx=2:shadowy=2:shadowcolor=black@0.8:x={_x}:y=h*0.82:line_spacing=4",
            "none":    None,
        }
        sub_style = style_map.get(subtitle_style, style_map["viral"])
        if _FONT_PATH and sub_style:
            vf = f"{motion_vf},drawtext=fontfile='{_FONT_PATH}':text='{safe}':{sub_style}"
        else:
            vf = motion_vf
    else:
        vf = motion_vf

    cmd = [
        "ffmpeg", "-y",
        *(["-loop", "1", "-t", str(duration)] if is_image else []),
        "-i", visual_path,
        "-t", str(duration),
        "-i", audio_path,
        "-map", "0:v:0",
        "-map", "1:a:0",
        "-vf", vf,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "26",
        "-threads", "2",
        "-r", "30",
        "-c:a", "aac",
        "-ar", "44100",
        "-ac", "2",
        "-b:a", "128k",
        "-pix_fmt", "yuv420p",
        "-avoid_negative_ts", "make_zero",
        "-async", "1",
        "-vsync", "cfr",
        "-shortest",
        output_path,
    ]

    logger.info("Scene %s | motion=%s | platform=%s | %dx%d | %.1fs",
                scene.id, motion, platform, w, h, duration)
    await run_ffmpeg(cmd)
    logger.info("Rendered scene %s → %s", scene.id, Path(output_path).name)
    return output_path


# ── Concatenation ─────────────────────────────────────────────────────────────
async def concat_scenes(
    scene_files: list[str],
    output_path: str,
    transition: str = "fade",   # "fade" | "blur" | "none"
    transition_duration: float = 0.4,
    platform: str | None = None,
) -> str:
    """
    Concatenate scene files with optional xfade transitions between them.
    transition="fade"  → smooth crossfade (cinematic)
    transition="blur"  → blur + fade (modern)
    transition="none"  → plain cut (fastest)
    """
    output_dir = Path(output_path).parent
    normalized: list[str] = []

    # Step 1: normalize all scenes to identical codec/resolution/fps
    for i, sf in enumerate(scene_files):
        norm_path = str(output_dir / f"norm_{i+1:02d}.mp4")
        logger.info("Normalising scene %d/%d…", i + 1, len(scene_files))
        await normalize_scene(sf, norm_path, platform=platform)
        normalized.append(norm_path)

    n = len(normalized)

    # Step 2: plain cut if only 1 scene or transitions disabled
    if n == 1 or transition == "none":
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
        try: Path(concat_list).unlink()
        except: pass
        for nf in normalized:
            try: Path(nf).unlink()
            except: pass
        logger.info("Concatenated %d scenes (no transitions) → %s", n, Path(output_path).name)
        return output_path

    # Step 3: build xfade filter graph
    # We need to know each scene duration to compute xfade offsets
    import json as _json

    async def _get_duration(path: str) -> float:
        """Probe duration of a video file using ffprobe."""
        loop = asyncio.get_event_loop()
        def _probe():
            import subprocess
            r = subprocess.run(
                ["ffprobe", "-v", "quiet", "-print_format", "json",
                 "-show_streams", path],
                capture_output=True, text=True
            )
            data = _json.loads(r.stdout)
            for s in data.get("streams", []):
                if s.get("codec_type") == "video":
                    return float(s.get("duration", 5.0))
            return 5.0
        return await loop.run_in_executor(None, _probe)

    durations = []
    for nf in normalized:
        d = await _get_duration(nf)
        durations.append(d)

    td = transition_duration

    # Map transition name to xfade filter name
    xfade_map = {
        "fade":  "fade",
        "blur":  "fadeblur",   # gaussian blur fade (xfade built-in)
    }
    xfade_name = xfade_map.get(transition, "fade")

    # Build complex filter:
    # [0][1] xfade at offset=(d0-td), [prev][2] xfade at offset=(d0+d1-2*td), etc.
    inputs = []
    for nf in normalized:
        inputs += ["-i", nf]

    filter_parts = []
    # label streams: [0:v],[0:a],[1:v],[1:a],...
    offset = 0.0
    prev_v = "[0:v]"
    prev_a = "[0:a]"

    for i in range(1, n):
        offset += durations[i-1] - td
        offset = max(offset, 0.01)
        out_v = f"[v{i}]" if i < n-1 else "[vout]"
        out_a = f"[a{i}]" if i < n-1 else "[aout]"
        filter_parts.append(
            f"{prev_v}[{i}:v]xfade=transition={xfade_name}:duration={td}:offset={offset:.3f}{out_v}"
        )
        filter_parts.append(
            f"{prev_a}[{i}:a]acrossfade=d={td}{out_a}"
        )
        prev_v = out_v
        prev_a = out_a

    filter_str = ";".join(filter_parts)

    cmd = (
        ["ffmpeg", "-y"]
        + inputs
        + [
            "-filter_complex", filter_str,
            "-map", "[vout]",
            "-map", "[aout]",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "26",
            "-r", "30", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "128k",
            "-movflags", "+faststart",
            output_path,
        ]
    )

    try:
        await run_ffmpeg(cmd)
        logger.info("Concatenated %d scenes with '%s' transitions → %s",
                    n, transition, Path(output_path).name)
    except Exception as e:
        # Fallback to plain cut if xfade fails
        logger.warning("xfade failed (%s) — falling back to plain cut", e)
        concat_list = str(output_dir / "concat_list_fb.txt")
        with open(concat_list, "w") as f:
            for nf in normalized:
                f.write(f"file '{os.path.abspath(nf)}'\n")
        await run_ffmpeg([
            "ffmpeg", "-y", "-f", "concat", "-safe", "0",
            "-i", concat_list, "-c", "copy", "-movflags", "+faststart", output_path,
        ])
        try: Path(concat_list).unlink()
        except: pass

    for nf in normalized:
        try: Path(nf).unlink()
        except: pass

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
    motion: str = "auto",
    transition: str = "fade",
    transition_duration: float = 0.4,
    max_resolution: str | None = None,   # e.g. "720p" for free plan
) -> dict:
    # Resolve music track name → local file path
    resolved_music = await _resolve_music(music_path, output_dir)

    # Apply plan resolution cap — downscale platform dims if needed
    if max_resolution and max_resolution != "1080p":
        from app.services.plans import resolution_to_dims as _res_to_dims
        cap = _res_to_dims(max_resolution)
        if cap and platform:
            w, h = get_platform_dims(platform)
            cap_w, cap_h = cap
            # Scale down proportionally if either dimension exceeds cap
            if w > cap_w or h > cap_h:
                ratio = min(cap_w / w, cap_h / h)
                w = int(w * ratio)
                h = int(h * ratio)
                # Make even numbers (required by H.264)
                w = w - (w % 2)
                h = h - (h % 2)
                # Override platform dims for this render
                _original_get_dims = get_platform_dims
                _capped_dims = (w, h)
                import functools
                _orig_fn = get_platform_dims
                def get_platform_dims(p):  # noqa: F811
                    return _capped_dims
                logger.info("Resolution capped to %dx%d for plan=%s", w, h, max_resolution)

    scene_outputs = []

    for i, (scene, audio, visual) in enumerate(zip(scenes, audio_files, visual_files)):
        scene_out = str(Path(output_dir) / f"scene_{i+1:02d}.mp4")
        is_image = getattr(visual, "media_type", "video") == "image"

        _is_custom = bool(getattr(scene, "custom_image_url", None))
        await render_scene(
            scene=scene,
            visual_path=visual.path,
            audio_path=audio,
            output_path=scene_out,
            subtitle_style=subtitle_style,
            is_image=is_image,
            platform=platform,
            motion=motion,
            scene_index=i,
            is_custom_image=_is_custom,
        )
        scene_outputs.append(scene_out)

        if on_progress:
            pct = int(55 + (i / len(scenes)) * 25)
            await on_progress(f"Rendered scene {i+1}/{len(scenes)}", pct)

    if on_progress:
        await on_progress("Normalising and concatenating scenes...", 82)

    final_path = str(Path(output_dir) / "final_video.mp4")
    await concat_scenes(
            scene_outputs, final_path,
            transition=transition,
            transition_duration=transition_duration,
            platform=platform,
        )

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

# ── Brand kit — intro / outro / logo watermark ────────────────────────────────

async def download_clip(url: str, dest: str) -> bool:
    """Download a video/image from URL to dest. Returns True on success."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url, follow_redirects=True)
            resp.raise_for_status()
        with open(dest, "wb") as f:
            f.write(resp.content)
        return True
    except Exception as e:
        logger.warning("Brand kit clip download failed (%s): %s", url, e)
        return False


async def _probe_video(path: str) -> dict:
    """Return dict with width, height, codec for a video file using ffprobe."""
    import asyncio as _asyncio, json as _json
    try:
        proc = await _asyncio.create_subprocess_exec(
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_streams", path,
            stdout=_asyncio.subprocess.PIPE, stderr=_asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        data = _json.loads(stdout)
        for s in data.get("streams", []):
            if s.get("codec_type") == "video":
                return {"width": s.get("width", 0), "height": s.get("height", 0), "codec": s.get("codec_name", "")}
    except Exception:
        pass
    return {"width": 0, "height": 0, "codec": ""}


async def _normalise_clip_to_match(clip_path: str, ref_path: str, output_path: str) -> str:
    """Normalise clip to match ref video dimensions and codec. Returns output_path or clip_path on fail."""
    ref_info  = await _probe_video(ref_path)
    clip_info = await _probe_video(clip_path)
    w, h = ref_info["width"], ref_info["height"]
    if w == 0 or h == 0:
        return clip_path   # can't probe ref — skip normalisation
    try:
        await run_ffmpeg([
            "ffmpeg", "-y", "-i", clip_path,
            "-vf", f"scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black",
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", "-ar", "44100", "-ac", "2",
            "-movflags", "+faststart",
            output_path,
        ])
        logger.info("Clip normalised %dx%d → %dx%d", clip_info["width"], clip_info["height"], w, h)
        return output_path
    except Exception as e:
        logger.warning("Clip normalisation failed: %s", e)
        return clip_path


async def prepend_intro(main_video: str, intro_url: str, output_path: str) -> str:
    """Prepend brand intro clip to main video. Returns output_path on success, main_video on fail."""
    intro_path = output_path.replace(".mp4", "_intro_src.mp4")
    if not await download_clip(intro_url, intro_path):
        logger.warning("Intro clip download failed — skipping intro: %s", intro_url)
        return main_video
    concat_list = output_path.replace(".mp4", "_intro_list.txt")
    intro_norm  = output_path.replace(".mp4", "_intro_norm.mp4")
    try:
        # Normalise intro to match main video dimensions
        normed = await _normalise_clip_to_match(intro_path, main_video, intro_norm)
        with open(concat_list, "w") as f:
            f.write(f"file '{os.path.abspath(normed)}'\n")
            f.write(f"file '{os.path.abspath(main_video)}'\n")
        await run_ffmpeg([
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0", "-i", concat_list,
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", "-ar", "44100", "-ac", "2",
            "-movflags", "+faststart",
            output_path,
        ])
        logger.info("Brand intro prepended → %s", Path(output_path).name)
        return output_path
    except Exception as e:
        logger.warning("Intro prepend failed: %s", e)
        return main_video
    finally:
        for p in [intro_path, concat_list, intro_norm]:
            try: Path(p).unlink(missing_ok=True)
            except: pass


async def append_outro(main_video: str, outro_url: str, output_path: str) -> str:
    """Append brand outro clip to main video. Returns output_path on success, main_video on fail."""
    outro_path = output_path.replace(".mp4", "_outro_src.mp4")
    if not await download_clip(outro_url, outro_path):
        logger.warning("Outro clip download failed — skipping outro: %s", outro_url)
        return main_video
    concat_list = output_path.replace(".mp4", "_outro_list.txt")
    outro_norm  = output_path.replace(".mp4", "_outro_norm.mp4")
    try:
        # Normalise outro to match main video dimensions
        normed = await _normalise_clip_to_match(outro_path, main_video, outro_norm)
        with open(concat_list, "w") as f:
            f.write(f"file '{os.path.abspath(main_video)}'\n")
            f.write(f"file '{os.path.abspath(normed)}'\n")
        await run_ffmpeg([
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0", "-i", concat_list,
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", "-ar", "44100", "-ac", "2",
            "-movflags", "+faststart",
            output_path,
        ])
        logger.info("Brand outro appended → %s", Path(output_path).name)
        return output_path
    except Exception as e:
        logger.warning("Outro append failed: %s", e)
        return main_video
    finally:
        for p in [outro_path, concat_list, outro_norm]:
            try: Path(p).unlink(missing_ok=True)
            except: pass


async def overlay_logo_watermark(
    main_video: str,
    logo_url: str,
    position: str,   # "top-left"|"top-right"|"bottom-left"|"bottom-right"|"center"
    output_path: str,
    opacity: float = 0.25,
    scale: float = 0.12,       # logo width as fraction of video width
) -> str:
    """Overlay brand logo as watermark. Returns output_path on success, main_video on fail."""
    import mimetypes
    ext = Path(logo_url).suffix or ".png"
    logo_path = output_path.replace(".mp4", f"_logo{ext}")
    if not await download_clip(logo_url, logo_path):
        return main_video

    # Position map — pad=20px from edges
    POS = {
        "top-left":     "x=20:y=20",
        "top-right":    "x=W-w-20:y=20",
        "bottom-left":  "x=20:y=H-h-20",
        "bottom-right": "x=W-w-20:y=H-h-20",
        "center":       "x=(W-w)/2:y=(H-h)/2",
    }
    pos_expr = POS.get(position, POS["top-right"])
    scale_filter = f"scale=iw*{scale}:-1"
    overlay_filter = (
        f"[1:v]format=rgba,{scale_filter},colorchannelmixer=aa={opacity}[logo];"
        f"[0:v][logo]overlay={pos_expr}"
    )

    try:
        await run_ffmpeg([
            "ffmpeg", "-y",
            "-i", main_video,
            "-i", logo_path,
            "-filter_complex", overlay_filter,
            "-c:a", "copy",
            "-movflags", "+faststart",
            output_path,
        ])
        logger.info("Brand watermark applied (%s, %.0f%% opacity) → %s",
                    position, opacity * 100, Path(output_path).name)
        return output_path
    except Exception as e:
        logger.warning("Logo watermark failed (non-fatal): %s", e)
        return main_video
    finally:
        try: Path(logo_path).unlink(missing_ok=True)
        except: pass
