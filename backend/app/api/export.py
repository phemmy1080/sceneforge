from __future__ import annotations

import io
import json
import logging
import os
import re
import zipfile
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, Response, StreamingResponse

from app.config import get_settings

settings = get_settings()
router = APIRouter()
logger = logging.getLogger(__name__)

WORKER_BASE_URL = os.environ.get("WORKER_BASE_URL", "").rstrip("/")


def _job_dir(job_id: str) -> Path:
    p = Path(settings.renders_dir) / job_id
    if not p.exists():
        raise HTTPException(status_code=404, detail="Render job not found")
    return p


def _safe_filename(title: str, suffix: str) -> str:
    clean = re.sub(r"[^\w\s\-]", "", title).strip()
    clean = re.sub(r"\s+", "_", clean)[:60].strip("_")
    return f"{clean}{suffix}" if clean else f"sceneforge{suffix}"


async def _worker_get(client: httpx.AsyncClient, job_id: str, path: str) -> httpx.Response:
    return await client.get(f"{WORKER_BASE_URL}/renders/{job_id}/{path}")


@router.get("/full/{job_id}")
async def export_full_video(job_id: str, title: str = Query(default="")):
    filename = _safe_filename(title, ".mp4") if title else "sceneforge_video.mp4"
    if WORKER_BASE_URL:
        async with httpx.AsyncClient(timeout=120) as client:
            for name in ("final_video_music.mp4", "final_video.mp4"):
                try:
                    resp = await _worker_get(client, job_id, name)
                    if resp.status_code == 200:
                        return Response(content=resp.content, media_type="video/mp4",
                            headers={"Content-Disposition": f'attachment; filename="{filename}"'})
                except Exception as e:
                    logger.warning("Worker proxy failed for %s: %s", name, e)
        raise HTTPException(status_code=404, detail="Video not found on worker")
    job_dir = _job_dir(job_id)
    for name in ("final_video_music.mp4", "final_video.mp4"):
        path = job_dir / name
        if path.exists():
            return FileResponse(str(path), media_type="video/mp4", filename=filename,
                headers={"Content-Disposition": f'attachment; filename="{filename}"'})
    raise HTTPException(status_code=404, detail="Video not rendered yet")


@router.get("/scenes/{job_id}")
async def export_scene_bundle(job_id: str, title: str = Query(default="")):
    filename = _safe_filename(title, "_scenes.zip") if title else "scene_bundle.zip"
    if WORKER_BASE_URL:
        buf = io.BytesIO()
        async with httpx.AsyncClient(timeout=120) as client:
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
                for i in range(1, 25):
                    name = f"scene_{i:02d}.mp4"
                    resp = await _worker_get(client, job_id, name)
                    if resp.status_code == 200:
                        zf.writestr(name, resp.content)
                    else:
                        break
                resp = await _worker_get(client, job_id, "manifest.json")
                if resp.status_code == 200:
                    zf.writestr("manifest.json", resp.content)
                if not zf.namelist():
                    raise HTTPException(status_code=404, detail="No scenes found on worker")
        buf.seek(0)
        return StreamingResponse(buf, media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'})
    job_dir = _job_dir(job_id)
    scene_files = sorted(job_dir.glob("scene_*.mp4"))
    if not scene_files:
        raise HTTPException(status_code=404, detail="No scenes found")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for sf in scene_files:
            zf.write(sf, sf.name)
        manifest = job_dir / "manifest.json"
        if manifest.exists():
            zf.write(manifest, "manifest.json")
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/capcut/{job_id}")
async def export_capcut_package(job_id: str, title: str = Query(default="")):
    filename = _safe_filename(title, "_capcut.zip") if title else "capcut_package.zip"
    if WORKER_BASE_URL:
        buf = io.BytesIO()
        async with httpx.AsyncClient(timeout=120) as client:
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
                for i in range(1, 25):
                    name = f"scene_{i:02d}.mp4"
                    resp = await _worker_get(client, job_id, name)
                    if resp.status_code == 200:
                        zf.writestr(name, resp.content)
                    else:
                        break
                resp = await _worker_get(client, job_id, "draft_content.json")
                if resp.status_code == 200:
                    zf.writestr("draft_content.json", resp.content)
                zf.writestr("README.txt", "Import into CapCut: File > Import Project")
                if not any(n.endswith(".mp4") for n in zf.namelist()):
                    raise HTTPException(status_code=404, detail="No scenes found on worker")
        buf.seek(0)
        return StreamingResponse(buf, media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'})
    job_dir = _job_dir(job_id)
    scene_files = sorted(job_dir.glob("scene_*.mp4"))
    draft_file = job_dir / "draft_content.json"
    if not scene_files:
        raise HTTPException(status_code=404, detail="No scenes found")
    if not draft_file.exists():
        raise HTTPException(status_code=404, detail="CapCut draft not generated")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for sf in scene_files:
            zf.write(sf, sf.name)
        zf.write(draft_file, "draft_content.json")
        zf.writestr("README.txt", "Import into CapCut: File > Import Project")
    buf.seek(0)
    return StreamingResponse(buf, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/voice/{job_id}")
async def export_voice(job_id: str, title: str = Query(default=""), format: str = Query(default="mp3")):
    import subprocess
    fmt = "wav" if format == "wav" else "mp3"
    filename = _safe_filename(title, f"_voiceover.{fmt}") if title else f"voiceover.{fmt}"
    tmp_dir = Path(settings.renders_dir) / job_id
    tmp_dir.mkdir(parents=True, exist_ok=True)
    video_path = None
    for name in ("final_video_music.mp4", "final_video.mp4"):
        local = tmp_dir / name
        if local.exists():
            video_path = str(local)
            break
        if WORKER_BASE_URL:
            try:
                async with httpx.AsyncClient(timeout=120) as client:
                    resp = await _worker_get(client, job_id, name)
                    if resp.status_code == 200:
                        local.write_bytes(resp.content)
                        video_path = str(local)
                        break
            except Exception as e:
                logger.warning("Worker download failed for %s: %s", name, e)
    if not video_path:
        raise HTTPException(status_code=404, detail="Video not rendered yet")
    cached = tmp_dir / f"voiceover.{fmt}"
    if not cached.exists():
        cmd = (["ffmpeg", "-y", "-i", video_path, "-vn", "-acodec", "libmp3lame",
                "-q:a", "2", "-ar", "44100", "-ac", "2", str(cached)] if fmt == "mp3" else
               ["ffmpeg", "-y", "-i", video_path, "-vn", "-acodec", "pcm_s16le",
                "-ar", "44100", "-ac", "2", str(cached)])
        result = subprocess.run(cmd, capture_output=True)
        if result.returncode != 0:
            raise HTTPException(status_code=500,
                detail=f"Audio extraction failed: {result.stderr.decode()[:200]}")
    media_type = "audio/wav" if fmt == "wav" else "audio/mpeg"
    return FileResponse(str(cached), media_type=media_type, filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.get("/manifest/{job_id}")
async def get_manifest(job_id: str):
    if WORKER_BASE_URL:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await _worker_get(client, job_id, "manifest.json")
            if resp.status_code == 200:
                return resp.json()
    job_dir = _job_dir(job_id)
    manifest = job_dir / "manifest.json"
    if not manifest.exists():
        raise HTTPException(status_code=404, detail="Manifest not found")
    with open(manifest) as f:
        return json.load(f)
