"""
backend/app/services/storage.py
Cloudflare R2 via S3-compatible API.
"""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

R2_ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID", "")
R2_ACCESS_KEY  = os.environ.get("R2_ACCESS_KEY", "")
R2_SECRET_KEY  = os.environ.get("R2_SECRET_KEY", "")
R2_BUCKET      = os.environ.get("R2_BUCKET", "sceneforge-renders")
R2_PUBLIC_URL  = os.environ.get("R2_PUBLIC_URL", "").rstrip("/")


def r2_enabled() -> bool:
    enabled = bool(R2_ACCOUNT_ID and R2_ACCESS_KEY and R2_SECRET_KEY and R2_BUCKET)
    if not enabled:
        missing = [k for k, v in {
            "R2_ACCOUNT_ID": R2_ACCOUNT_ID,
            "R2_ACCESS_KEY":  R2_ACCESS_KEY,
            "R2_SECRET_KEY":  R2_SECRET_KEY,
            "R2_BUCKET":      R2_BUCKET,
        }.items() if not v]
        if missing:
            logger.warning("R2 disabled — missing env vars: %s", missing)
    return enabled


def _content_type(path: str) -> str:
    return {
        ".mp4":  "video/mp4",
        ".mp3":  "audio/mpeg",
        ".wav":  "audio/wav",
        ".zip":  "application/zip",
        ".json": "application/json",
        ".png":  "image/png",
        ".jpg":  "image/jpeg",
    }.get(Path(path).suffix.lower(), "application/octet-stream")


def _client():
    try:
        import boto3
    except ImportError:
        raise RuntimeError("boto3 not installed — run: pip install boto3>=1.34.0")

    endpoint = f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
    logger.debug("R2 endpoint: %s bucket: %s", endpoint, R2_BUCKET)

    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=R2_ACCESS_KEY,
        aws_secret_access_key=R2_SECRET_KEY,
        region_name="auto",
    )


def _public_url(key: str) -> str:
    if R2_PUBLIC_URL:
        return f"{R2_PUBLIC_URL}/{key}"
    return f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com/{R2_BUCKET}/{key}"


async def upload_file(local_path: str, key: str) -> str:
    """Upload one file to R2. Returns public URL. Raises on failure."""
    def _do():
        client = _client()
        logger.info("R2 uploading %s → %s/%s", Path(local_path).name, R2_BUCKET, key)
        client.upload_file(
            local_path,
            R2_BUCKET,
            key,
            ExtraArgs={"ContentType": _content_type(local_path)},
        )
        url = _public_url(key)
        logger.info("R2 ✓  %s → %s", Path(local_path).name, url)
        return url

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _do)


async def upload_job_files(job_id: str, output_dir: str) -> dict[str, str]:
    """
    Upload all render outputs for a job to R2.
    Returns {filename: public_url}. Logs each failure individually.
    """
    if not r2_enabled():
        return {}

    output_path = Path(output_dir)
    targets: list[tuple[str, str]] = []

    # Final video (music version takes priority)
    for name in ("final_video_music.mp4", "final_video.mp4"):
        p = output_path / name
        if p.exists():
            targets.append((str(p), f"renders/{job_id}/{name}"))
            break

    # Per-scene clips
    for sf in sorted(output_path.glob("scene_*.mp4")):
        targets.append((str(sf), f"renders/{job_id}/{sf.name}"))

    # Metadata files
    for name in ("manifest.json", "draft_content.json"):
        p = output_path / name
        if p.exists():
            targets.append((str(p), f"renders/{job_id}/{name}"))

    if not targets:
        logger.warning("R2: no files found to upload for job %s in %s", job_id, output_dir)
        return {}

    logger.info("R2: uploading %d files for job %s", len(targets), job_id)
    urls: dict[str, str] = {}

    async def _upload_one(local: str, key: str):
        try:
            url = await upload_file(local, key)
            urls[Path(local).name] = url
        except Exception as e:
            # Log full error so we can see exactly what went wrong
            logger.error("R2 upload FAILED for %s: %s — type: %s",
                         Path(local).name, e, type(e).__name__)

    await asyncio.gather(*[_upload_one(lp, k) for lp, k in targets])

    if urls:
        logger.info("R2 upload complete — %d/%d files uploaded for job %s",
                    len(urls), len(targets), job_id)
    else:
        logger.error("R2 upload FAILED for ALL files in job %s — check credentials", job_id)

    return urls


async def get_r2_url(redis, job_id: str, filename: str) -> Optional[str]:
    """Look up a file's R2 URL from the Redis job result."""
    try:
        import json
        raw = await redis.get(f"job:{job_id}:progress")
        if raw:
            data = json.loads(raw)
            return data.get("r2_urls", {}).get(filename)
    except Exception:
        pass
    return None
