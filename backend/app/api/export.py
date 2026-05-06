"""
backend/app/api/export.py
Downloads serve from R2 (permanent) → worker proxy → local fallback.
"""
from __future__ import annotations

import io
import json
import logging
import os
import re
import zipfile
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, RedirectResponse, Response, StreamingResponse

from app.config import get_settings
from app.dependencies import get_redis
from app.services.storage import get_r2_url, r2_enabled

settings  = get_settings()
router    = APIRouter()
logger    = logging.getLogger(__name__)

WORKER_BASE_URL = os.environ.get("WORKER_BASE_URL", "").rstrip("/")


# ── Helpers ───────────────────────────────────────────────────────────────────

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


async def _resolve_video_url(redis, job_id: str) -> str | None:
    """
    Find the final video URL — check R2 first, then worker URL.
    Returns the URL string or None.
    """
    # Check R2 URLs stored in Redis job result
    for name in ("final_video_music.mp4", "final_video.mp4"):
        url = await get_r2_url(redis, job_id, name)
        if url:
            return url
    # Fall back to worker URL
    if WORKER_BASE_URL:
        return f"{WORKER_BASE_URL}/renders/{job_id}/final_video.mp4"
    return None


# ── Full video ────────────────────────────────────────────────────────────────

@router.get("/full/{job_id}")
async def export_full_video(
    job_id: str,
    title: str = Query(default=""),
    redis=Depends(get_redis),
):
    filename = _safe_filename(title, ".mp4") if title else "sceneforge_video.mp4"

    # 1. Check R2 — redirect directly (fastest, permanent)
    for name in ("final_video_music.mp4", "final_video.mp4"):
        r2_url = await get_r2_url(redis, job_id, name)
        if r2_url:
            logger.info("Serving %s from R2: %s", job_id, r2_url)
            return RedirectResponse(url=r2_url)

    # 2. Proxy from worker
    if WORKER_BASE_URL:
        async with httpx.AsyncClient(timeout=120) as client:
            for name in ("final_video_music.mp4", "final_video.mp4"):
                try:
                    resp = await _worker_get(client, job_id, name)
                    if resp.status_code == 200:
                        return Response(
                            content=resp.content,
                            media_type="video/mp4",
                            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
                        )
                except Exception as e:
                    logger.warning("Worker proxy failed for %s: %s", name, e)

    # 3. Local fallback
    job_dir = _job_dir(job_id)
    for name in ("final_video_music.mp4", "final_video.mp4"):
        p = job_dir / name
        if p.exists():
            return FileResponse(str(p), media_type="video/mp4", filename=filename,
                headers={"Content-Disposition": f'attachment; filename="{filename}"'})

    raise HTTPException(status_code=404, detail="Video not rendered yet")


# ── Scene bundle ──────────────────────────────────────────────────────────────

@router.get("/scenes/{job_id}")
async def export_scene_bundle(
    job_id: str,
    title: str = Query(default=""),
    redis=Depends(get_redis),
):
    filename = _safe_filename(title, "_scenes.zip") if title else "scene_bundle.zip"

    async def _build_zip_from_source(client: httpx.AsyncClient, use_r2: bool) -> io.BytesIO | None:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for i in range(1, 25):
                name = f"scene_{i:02d}.mp4"
                if use_r2:
                    url = await get_r2_url(redis, job_id, name)
                    if not url:
                        break
                    resp = await client.get(url)
                else:
                    resp = await _worker_get(client, job_id, name)
                if resp.status_code == 200:
                    zf.writestr(name, resp.content)
                else:
                    break
            # Add manifest
            manifest_url = (await get_r2_url(redis, job_id, "manifest.json")
                           if use_r2 else None)
            if manifest_url:
                resp = await client.get(manifest_url)
                if resp.status_code == 200:
                    zf.writestr("manifest.json", resp.content)
            elif not use_r2 and WORKER_BASE_URL:
                resp = await _worker_get(client, job_id, "manifest.json")
                if resp.status_code == 200:
                    zf.writestr("manifest.json", resp.content)
            if not zf.namelist():
                return None
        buf.seek(0)
        return buf

    if r2_enabled() or WORKER_BASE_URL:
        async with httpx.AsyncClient(timeout=120) as client:
            use_r2 = r2_enabled() and bool(await get_r2_url(redis, job_id, "scene_01.mp4"))
            buf = await _build_zip_from_source(client, use_r2)
            if buf:
                return StreamingResponse(buf, media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})

    # Local fallback
    job_dir    = _job_dir(job_id)
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


# ── CapCut package ────────────────────────────────────────────────────────────

@router.get("/capcut/{job_id}")
async def export_capcut_package(
    job_id: str,
    title: str = Query(default=""),
    redis=Depends(get_redis),
):
    filename = _safe_filename(title, "_capcut.zip") if title else "capcut_package.zip"

    if r2_enabled() or WORKER_BASE_URL:
        async with httpx.AsyncClient(timeout=120) as client:
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
                for i in range(1, 25):
                    name = f"scene_{i:02d}.mp4"
                    url  = await get_r2_url(redis, job_id, name)
                    resp = await client.get(url) if url else await _worker_get(client, job_id, name)
                    if resp.status_code == 200:
                        zf.writestr(name, resp.content)
                    else:
                        break
                # draft_content.json
                url  = await get_r2_url(redis, job_id, "draft_content.json")
                resp = await client.get(url) if url else await _worker_get(client, job_id, "draft_content.json")
                if resp.status_code == 200:
                    zf.writestr("draft_content.json", resp.content)
                zf.writestr("README.txt", "Import into CapCut: File > Import Project")
                if not any(n.endswith(".mp4") for n in zf.namelist()):
                    raise HTTPException(status_code=404, detail="No scenes found")
            buf.seek(0)
            return StreamingResponse(buf, media_type="application/zip",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'})

    # Local fallback
    job_dir    = _job_dir(job_id)
    scene_files = sorted(job_dir.glob("scene_*.mp4"))
    draft_file  = job_dir / "draft_content.json"
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


# ── Voice extraction ──────────────────────────────────────────────────────────

@router.get("/voice/{job_id}")
async def export_voice(
    job_id: str,
    title: str = Query(default=""),
    format: str = Query(default="mp3"),
    redis=Depends(get_redis),
):
    import subprocess
    fmt      = "wav" if format == "wav" else "mp3"
    filename = _safe_filename(title, f"_voiceover.{fmt}") if title else f"voiceover.{fmt}"

    # Get video — from R2, worker, or local
    tmp_dir = Path(settings.renders_dir) / job_id
    tmp_dir.mkdir(parents=True, exist_ok=True)
    video_path: str | None = None

    for name in ("final_video_music.mp4", "final_video.mp4"):
        local = tmp_dir / name
        if local.exists():
            video_path = str(local)
            break
        # Try R2
        r2_url = await get_r2_url(redis, job_id, name)
        if r2_url:
            try:
                async with httpx.AsyncClient(timeout=120) as client:
                    resp = await client.get(r2_url)
                    if resp.status_code == 200:
                        local.write_bytes(resp.content)
                        video_path = str(local)
                        break
            except Exception as e:
                logger.warning("R2 video download failed: %s", e)
        # Try worker
        if WORKER_BASE_URL:
            try:
                async with httpx.AsyncClient(timeout=120) as client:
                    resp = await _worker_get(client, job_id, name)
                    if resp.status_code == 200:
                        local.write_bytes(resp.content)
                        video_path = str(local)
                        break
            except Exception as e:
                logger.warning("Worker download failed: %s", e)

    if not video_path:
        raise HTTPException(status_code=404, detail="Video not rendered yet")

    cached = tmp_dir / f"voiceover.{fmt}"
    if not cached.exists():
        cmd = (["ffmpeg", "-y", "-i", video_path, "-vn",
                "-acodec", "libmp3lame", "-q:a", "2", "-ar", "44100", "-ac", "2", str(cached)]
               if fmt == "mp3" else
               ["ffmpeg", "-y", "-i", video_path, "-vn",
                "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2", str(cached)])
        result = subprocess.run(cmd, capture_output=True)
        if result.returncode != 0:
            raise HTTPException(status_code=500,
                detail=f"Audio extraction failed: {result.stderr.decode()[:200]}")

    media_type = "audio/wav" if fmt == "wav" else "audio/mpeg"
    return FileResponse(str(cached), media_type=media_type, filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'})


# ── Manifest ──────────────────────────────────────────────────────────────────

@router.get("/manifest/{job_id}")
async def get_manifest(job_id: str, redis=Depends(get_redis)):
    url = await get_r2_url(redis, job_id, "manifest.json")
    if url:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                return resp.json()
    if WORKER_BASE_URL:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await _worker_get(client, job_id, "manifest.json")
            if resp.status_code == 200:
                return resp.json()
    job_dir  = _job_dir(job_id)
    manifest = job_dir / "manifest.json"
    if not manifest.exists():
        raise HTTPException(status_code=404, detail="Manifest not found")
    with open(manifest) as f:
        return json.load(f)
