"""
Voice processing service — handles user-uploaded and recorded voice clips.

Pipeline (all via ffmpeg):
  1. Convert to WAV 44100Hz stereo
  2. Silence trimming   — remove leading/trailing silence
  3. Noise reduction    — afftdn filter
  4. EQ balancing       — highpass + presence boost
  5. Compression        — acompressor to even out dynamics
  6. Loudness norm      — loudnorm to -14 LUFS (YouTube/TikTok standard)
  7. Fade in/out        — 50ms fade in, 80ms fade out
  8. Encode to AAC MP3  — final output ready for render

Returns: { path, duration_seconds, r2_url }
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import json
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


async def _run(cmd: list[str]) -> tuple[int, str]:
    """Run a subprocess asynchronously, return (returncode, stderr)."""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    return proc.returncode, stderr.decode(errors="replace")


async def probe_duration(path: str) -> float:
    """Return audio duration in seconds using ffprobe."""
    rc, out = await _run([
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_streams", path,
    ])
    # ffprobe writes to stdout — re-run capturing stdout
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_streams", path,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    stdout, _ = await proc.communicate()
    try:
        data = json.loads(stdout)
        for s in data.get("streams", []):
            dur = float(s.get("duration", 0) or 0)
            if dur > 0:
                return dur
    except Exception:
        pass
    return 0.0


async def process_voice_clip(
    input_path: str,
    output_dir: str,
    scene_id: int = 0,
) -> dict:
    """
    Run the full audio processing pipeline on a voice clip.

    Returns dict with:
        path            — processed file path (MP3)
        duration        — duration in seconds after processing
        error           — error message if failed (None on success)
    """
    work_dir = Path(output_dir)
    work_dir.mkdir(parents=True, exist_ok=True)

    wav_path        = str(work_dir / f"voice_{scene_id}_raw.wav")
    trimmed_path    = str(work_dir / f"voice_{scene_id}_trimmed.wav")
    processed_path  = str(work_dir / f"voice_{scene_id}_processed.wav")
    final_path      = str(work_dir / f"voice_{scene_id}_final.mp3")

    try:
        # ── Step 1: Convert to WAV 44100Hz stereo ────────────────────────────
        rc, err = await _run([
            "ffmpeg", "-y", "-i", input_path,
            "-ar", "44100", "-ac", "2", "-sample_fmt", "s16",
            wav_path,
        ])
        if rc != 0:
            return {"path": None, "duration": 0.0, "error": f"Conversion failed: {err[:200]}"}

        # ── Step 2: Silence trimming ─────────────────────────────────────────
        # silenceremove: trim silence from start (start_periods=1) and end (stop_periods=1)
        # threshold -50dB, min silence duration 0.3s
        rc, err = await _run([
            "ffmpeg", "-y", "-i", wav_path,
            "-af", (
                "silenceremove=start_periods=1:start_duration=0.1:start_threshold=-50dB"
                ":stop_periods=-1:stop_duration=0.3:stop_threshold=-50dB"
            ),
            trimmed_path,
        ])
        if rc != 0:
            # If silence trimming fails (very short clip), use original
            logger.warning("Silence trim failed — using original: %s", err[:100])
            import shutil; shutil.copy2(wav_path, trimmed_path)

        # ── Steps 3–7: Noise reduction + EQ + compression + loudnorm + fade ──
        # All in a single ffmpeg pass for efficiency
        duration_raw = await probe_duration(trimmed_path)
        fade_out_start = max(0.0, duration_raw - 0.08)

        af_chain = ",".join([
            # Noise reduction — afftdn (adaptive noise filter)
            "afftdn=nf=-25",
            # EQ — highpass at 80Hz (remove rumble), gentle presence boost 2–5kHz
            "highpass=f=80",
            "equalizer=f=2500:t=h:width=2000:g=2",
            # Compression — even out dynamics
            "acompressor=threshold=0.089:ratio=4:attack=5:release=50:makeup=2",
            # Loudness normalisation to -14 LUFS (YouTube/TikTok standard)
            # Two-pass loudnorm is ideal but single-pass is fine for voice
            "loudnorm=I=-14:TP=-1.5:LRA=7",
            # Fade in 50ms, fade out 80ms
            f"afade=t=in:st=0:d=0.05",
            f"afade=t=out:st={fade_out_start:.3f}:d=0.08",
        ])

        rc, err = await _run([
            "ffmpeg", "-y", "-i", trimmed_path,
            "-af", af_chain,
            processed_path,
        ])
        if rc != 0:
            # Fallback — skip fancy processing, just loudnorm + fade
            logger.warning("Full chain failed — fallback to loudnorm only: %s", err[:100])
            rc, err = await _run([
                "ffmpeg", "-y", "-i", trimmed_path,
                "-af", f"loudnorm=I=-14:TP=-1.5:LRA=7,afade=t=in:st=0:d=0.05,afade=t=out:st={fade_out_start:.3f}:d=0.08",
                processed_path,
            ])
            if rc != 0:
                import shutil; shutil.copy2(trimmed_path, processed_path)

        # ── Step 8: Encode to MP3 ─────────────────────────────────────────────
        rc, err = await _run([
            "ffmpeg", "-y", "-i", processed_path,
            "-codec:a", "libmp3lame", "-qscale:a", "2",
            "-ar", "44100", "-ac", "2",
            final_path,
        ])
        if rc != 0:
            return {"path": None, "duration": 0.0, "error": f"Encoding failed: {err[:200]}"}

        duration = await probe_duration(final_path)
        logger.info("Voice processing complete — scene %s | %.1fs | %s",
                    scene_id, duration, Path(final_path).name)

        return {"path": final_path, "duration": round(duration, 2), "error": None}

    except Exception as e:
        logger.exception("Voice processing failed: %s", e)
        return {"path": None, "duration": 0.0, "error": str(e)}
    finally:
        # Clean up intermediates
        for p in [wav_path, trimmed_path, processed_path]:
            try: Path(p).unlink(missing_ok=True)
            except: pass


async def process_and_upload(
    input_path: str,
    scene_id: int,
    output_dir: str,
    r2_prefix: str = "voice-clips",
) -> dict:
    """
    Process voice clip and upload to R2.
    Returns { r2_url, duration, error }.
    """
    result = await process_voice_clip(input_path, output_dir, scene_id)
    if result["error"] or not result["path"]:
        return {"r2_url": None, "duration": 0.0, "error": result["error"]}

    # Upload to R2
    try:
        from app.services.storage import upload_file, r2_enabled, _public_url
        if r2_enabled():
            import uuid as _uuid
            key = f"{r2_prefix}/{_uuid.uuid4().hex[:12]}_scene{scene_id}.mp3"
            r2_url = await upload_file(result["path"], key)
            logger.info("Voice uploaded to R2: %s", r2_url)
        else:
            # Dev fallback — serve from local path
            r2_url = f"/tmp/{Path(result['path']).name}"
            import shutil
            shutil.copy2(result["path"], r2_url)
    except Exception as e:
        logger.warning("R2 upload failed: %s", e)
        r2_url = None

    try: Path(result["path"]).unlink(missing_ok=True)
    except: pass

    return {"r2_url": r2_url, "duration": result["duration"], "error": None}
