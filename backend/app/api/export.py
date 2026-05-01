from __future__ import annotations

import io
import json
import re
import zipfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse

from app.config import get_settings
from app.dependencies import get_redis
from fastapi import Depends
import os

settings = get_settings()
router = APIRouter()

# Worker base URL — set this env var to your worker's Railway domain
WORKER_BASE_URL = os.environ.get("WORKER_BASE_URL", "")


def _job_dir(job_id: str) -> Path:
    p = Path(settings.renders_dir) / job_id
    if not p.exists():
        raise HTTPException(status_code=404, detail="Render job not found")
    return p


def _worker_redirect(job_id: str, path: str):
    """If WORKER_BASE_URL is set, redirect file downloads to the worker service."""
    if WORKER_BASE_URL:
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url=f"{WORKER_BASE_URL}/renders/{job_id}/{path}")
    return None


def _safe_filename(title: str, suffix: str) -> str:
    """Turn a project title into a safe filename."""
    # Keep alphanumeric, spaces, hyphens — remove everything else
    clean = re.sub(r"[^\w\s\-]", "", title).strip()
    # Replace spaces with underscores, collapse multiples
    clean = re.sub(r"\s+", "_", clean)
    # Truncate to 60 chars so filenames stay manageable
    clean = clean[:60].strip("_")
    return f"{clean}{suffix}" if clean else f"sceneforge{suffix}"


@router.get("/full/{job_id}")
async def export_full_video(
    job_id: str,
    title: str = Query(default="", description="Project title for the filename"),
):
    """Download the final stitched MP4 with a meaningful filename."""
    # Try redirect to worker first if configured
    for name in ("final_video_music.mp4", "final_video.mp4"):
        redirect = _worker_redirect(job_id, name)
        if redirect:
            return redirect

    job_dir = _job_dir(job_id)
    filename = _safe_filename(title, ".mp4") if title else "sceneforge_video.mp4"

    for name in ("final_video_music.mp4", "final_video.mp4"):
        path = job_dir / name
        if path.exists():
            return FileResponse(
                str(path),
                media_type="video/mp4",
                filename=filename,
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"'
                },
            )

    raise HTTPException(status_code=404, detail="Video not rendered yet")


@router.get("/scenes/{job_id}")
async def export_scene_bundle(
    job_id: str,
    title: str = Query(default="", description="Project title for the filename"),
):
    """Download ZIP of all per-scene MP4s."""
    job_dir = _job_dir(job_id)
    scene_files = sorted(job_dir.glob("scene_*.mp4"))
    manifest = job_dir / "manifest.json"

    if not scene_files:
        raise HTTPException(status_code=404, detail="No scenes found")

    filename = _safe_filename(title, "_scenes.zip") if title else "scene_bundle.zip"

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for sf in scene_files:
            zf.write(sf, sf.name)
        if manifest.exists():
            zf.write(manifest, "manifest.json")

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/capcut/{job_id}")
async def export_capcut_package(
    job_id: str,
    title: str = Query(default="", description="Project title for the filename"),
):
    """Download CapCut-ready ZIP with draft_content.json."""
    job_dir = _job_dir(job_id)
    scene_files = sorted(job_dir.glob("scene_*.mp4"))
    draft_file = job_dir / "draft_content.json"

    if not scene_files:
        raise HTTPException(status_code=404, detail="No scenes found")
    if not draft_file.exists():
        raise HTTPException(status_code=404, detail="CapCut draft not generated")

    filename = _safe_filename(title, "_capcut.zip") if title else "capcut_package.zip"

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for sf in scene_files:
            zf.write(sf, sf.name)
        zf.write(draft_file, "draft_content.json")
        zf.writestr("README.txt", "Import this folder into CapCut: File > Import Project")

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )



@router.get("/voice/{job_id}")
async def export_voice(
    job_id: str,
    title: str = Query(default="", description="Project title for the filename"),
    format: str = Query(default="mp3", description="Audio format: mp3 or wav"),
):
    """
    Extract and download the voiceover audio track from the final rendered video.
    Uses FFmpeg to strip the audio — no re-encoding quality loss for MP3.
    """
    import subprocess, tempfile, os

    job_dir = _job_dir(job_id)

    # Find the final video
    video_path = None
    for name in ("final_video_music.mp4", "final_video.mp4"):
        p = job_dir / name
        if p.exists():
            video_path = str(p)
            break

    if not video_path:
        raise HTTPException(status_code=404, detail="Video not rendered yet")

    fmt = "wav" if format == "wav" else "mp3"
    suffix = f"_voiceover.{fmt}"
    filename = _safe_filename(title, suffix) if title else f"voiceover.{fmt}"

    # Check if we already extracted it (cache)
    cached = job_dir / f"voiceover.{fmt}"
    if not cached.exists():
        # Extract audio with FFmpeg
        if fmt == "mp3":
            cmd = [
                "ffmpeg", "-y",
                "-i", video_path,
                "-vn",                    # no video
                "-acodec", "libmp3lame",
                "-q:a", "2",              # high quality VBR
                "-ar", "44100",
                "-ac", "2",
                str(cached),
            ]
        else:
            cmd = [
                "ffmpeg", "-y",
                "-i", video_path,
                "-vn",
                "-acodec", "pcm_s16le",   # uncompressed WAV
                "-ar", "44100",
                "-ac", "2",
                str(cached),
            ]

        result = subprocess.run(cmd, capture_output=True)
        if result.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=f"Audio extraction failed: {result.stderr.decode()[:200]}"
            )

    media_type = "audio/wav" if fmt == "wav" else "audio/mpeg"
    return FileResponse(
        str(cached),
        media_type=media_type,
        filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

@router.get("/manifest/{job_id}")
async def get_manifest(job_id: str):
    """Return the scene manifest JSON directly."""
    job_dir = _job_dir(job_id)
    manifest = job_dir / "manifest.json"
    if not manifest.exists():
        raise HTTPException(status_code=404, detail="Manifest not found")
    with open(manifest) as f:
        return json.load(f)
