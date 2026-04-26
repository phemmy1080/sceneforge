import os
import asyncio
from pathlib import Path

import boto3
from botocore.exceptions import ClientError

from app.config import get_settings

settings = get_settings()


def _get_s3_client():
    return boto3.client(
        "s3",
        region_name=settings.s3_region,
        aws_access_key_id=settings.aws_access_key_id or None,
        aws_secret_access_key=settings.aws_secret_access_key or None,
    )


async def upload_to_s3(local_path: str, s3_key: str) -> str:
    """Upload a file to S3 and return the public URL."""
    def _upload():
        s3 = _get_s3_client()
        s3.upload_file(
            local_path,
            settings.s3_bucket,
            s3_key,
            ExtraArgs={"ContentType": _content_type(local_path)},
        )
        return f"https://{settings.s3_bucket}.s3.{settings.s3_region}.amazonaws.com/{s3_key}"

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _upload)


async def generate_presigned_url(s3_key: str, expires: int = 3600) -> str:
    """Generate a presigned download URL for a private S3 object."""
    def _presign():
        s3 = _get_s3_client()
        return s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.s3_bucket, "Key": s3_key},
            ExpiresIn=expires,
        )

    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _presign)


def _content_type(path: str) -> str:
    ext = Path(path).suffix.lower()
    return {
        ".mp4": "video/mp4",
        ".mp3": "audio/mpeg",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".zip": "application/zip",
        ".json": "application/json",
    }.get(ext, "application/octet-stream")
