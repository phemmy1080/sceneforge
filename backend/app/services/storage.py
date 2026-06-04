"""
backend/app/services/storage.py
Cloudflare R2 via S3-compatible API.
Env vars read lazily (inside functions) so they're always current.
"""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


def _cfg():
    """Read R2 config fresh each time — never stale from module load."""
    return {
        "account_id": os.environ.get("R2_ACCOUNT_ID", ""),
        "access_key":  os.environ.get("R2_ACCESS_KEY", ""),
        "secret_key":  os.environ.get("R2_SECRET_KEY", ""),
        "bucket":      os.environ.get("R2_BUCKET", "sceneforge-renders"),
        "public_url":  os.environ.get("R2_PUBLIC_URL", "").rstrip("/"),
    }


def r2_enabled() -> bool:
    c = _cfg()
    enabled = bool(c["account_id"] and c["access_key"] and c["secret_key"] and c["bucket"])
    if not enabled:
        missing = [k for k, v in {
            "R2_ACCOUNT_ID": c["account_id"],
            "R2_ACCESS_KEY":  c["access_key"],
            "R2_SECRET_KEY":  c["secret_key"],
            "R2_BUCKET":      c["bucket"],
        }.items() if not v]
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

    c = _cfg()
    endpoint = f"https://{c['account_id']}.r2.cloudflarestorage.com"
    logger.info("R2 client → endpoint: %s  bucket: %s", endpoint, c["bucket"])

    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=c["access_key"],
        aws_secret_access_key=c["secret_key"],
        region_name="auto",
    )


def _public_url(key: str) -> str:
    c = _cfg()
    if c["public_url"]:
        return f"{c['public_url']}/{key}"
    return f"https://{c['account_id']}.r2.cloudflarestorage.com/{c['bucket']}/{key}"


async def delete_job_files(job_id: str) -> int:
    """Delete all R2 objects for a job (renders/{job_id}/*). Returns count deleted."""
    if not r2_enabled():
        return 0
    c = _cfg()
    bucket = c["bucket"]
    prefix = f"renders/{job_id}/"

    def _do():
        client = _client()
        # List all objects with prefix
        paginator = client.get_paginator("list_objects_v2")
        keys = []
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                keys.append({"Key": obj["Key"]})
        if not keys:
            return 0
        # Delete in batches of 1000
        deleted = 0
        for i in range(0, len(keys), 1000):
            resp = client.delete_objects(
                Bucket=bucket,
                Delete={"Objects": keys[i:i+1000], "Quiet": True}
            )
            deleted += len(keys[i:i+1000]) - len(resp.get("Errors", []))
        return deleted

    loop = asyncio.get_event_loop()
    count = await loop.run_in_executor(None, _do)
    logger.info("R2 cleanup — job %s: deleted %d objects", job_id, count)
    return count


async def upload_file(local_path: str, key: str) -> str:
    """Upload one file to R2. Returns public URL. Raises on failure."""
    c = _cfg()

    def _do():
        client = _client()
        logger.info("R2 uploading %s → %s/%s", Path(local_path).name, c["bucket"], key)
        client.upload_file(
            local_path,
            c["bucket"],
            key,
            ExtraArgs={"ContentType": _content_type(local_path)},
        )
        url = _public_url(key)
        logger.info("R2 ✓  %s → %s", Path(local_path).name, url)
        return url

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _do)


async def upload_job_files(job_id: str, output_dir: str) -> dict[str, str]:
    """Upload all render outputs for a job to R2."""
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

    # Metadata
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
            logger.error("R2 upload FAILED — %s: %s (%s)",
                         Path(local).name, e, type(e).__name__)

    await asyncio.gather(*[_upload_one(lp, k) for lp, k in targets])

    if urls:
        logger.info("R2 upload complete — %d/%d files for job %s",
                    len(urls), len(targets), job_id)
    else:
        logger.error("R2 ALL uploads FAILED for job %s — check R2 credentials", job_id)

    return urls


async def get_r2_url(redis, job_id: str, filename: str) -> Optional[str]:
    """Look up a file's R2 URL from Redis job result."""
    try:
        import json
        raw = await redis.get(f"job:{job_id}:progress")
        if raw:
            data = json.loads(raw)
            return data.get("r2_urls", {}).get(filename)
    except Exception:
        pass
    return None
