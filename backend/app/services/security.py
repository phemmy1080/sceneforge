"""
security.py — SceneForge platform security layer.

Covers:
  1. File upload validation  — type, size, magic bytes
  2. Signed download URLs    — time-limited, user-bound tokens
  3. Queue isolation         — per-user job limits, queue depth cap
  4. Worker protection       — overload, spam, recursive job detection
  5. API abuse protection    — IP monitoring, suspicious usage, token abuse
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import mimetypes
import re
import secrets
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, UploadFile

logger = logging.getLogger(__name__)

# ─── Constants ────────────────────────────────────────────────────────────────

# File upload
MAX_UPLOAD_BYTES        = 100 * 1024 * 1024   # 100 MB
MAX_UPLOAD_BYTES_FREE   =  25 * 1024 * 1024   # 25 MB for free plan
ALLOWED_AUDIO_TYPES     = {"audio/mpeg", "audio/mp4", "audio/wav", "audio/ogg",
                            "audio/x-m4a", "audio/webm"}
ALLOWED_IMAGE_TYPES     = {"image/jpeg", "image/png", "image/webp", "image/gif"}
ALLOWED_VIDEO_TYPES     = {"video/mp4", "video/quicktime", "video/webm"}
ALLOWED_UPLOAD_TYPES    = ALLOWED_AUDIO_TYPES | ALLOWED_IMAGE_TYPES | ALLOWED_VIDEO_TYPES

# Magic bytes (file signatures) — prevents MIME type spoofing
MAGIC_SIGNATURES: dict[bytes, str] = {
    b"\xff\xfb": "audio/mpeg",   b"\xff\xf3": "audio/mpeg",
    b"\xff\xf2": "audio/mpeg",   b"\x49\x44\x33": "audio/mpeg",   # ID3 MP3
    b"\x52\x49\x46\x46": "audio/wav",    # RIFF WAV
    b"\x00\x00\x00\x20\x66\x74\x79\x70": "video/mp4",             # MP4 ftyp
    b"\x00\x00\x00\x18\x66\x74\x79\x70": "video/mp4",
    b"\x66\x74\x79\x70\x6D\x70\x34\x32": "video/mp4",
    b"\x1a\x45\xdf\xa3": "video/webm",
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89\x50\x4e\x47": "image/png",
    b"RIFF": "audio/wav",
}

# Signed URLs
SIGNED_URL_TTL          = 3600         # 1 hour
SIGNED_URL_KEY_PREFIX   = "dl:sig:"

# Queue limits
MAX_QUEUE_DEPTH         = 50           # total jobs across all users
MAX_JOBS_PER_USER       = 2            # concurrent jobs per user
MAX_JOBS_PER_USER_FREE  = 1            # free plan: only 1 at a time
QUEUE_KEY               = "render:queue:active"
USER_JOBS_PREFIX        = "render:user:active:"

# Abuse detection
ABUSE_KEY_PREFIX        = "abuse:"
ABUSE_WINDOW_SECS       = 3600         # 1 hour rolling window
ABUSE_RENDER_THRESHOLD  = 20           # >20 renders/hour = suspicious
ABUSE_FAIL_THRESHOLD    = 10           # >10 failed renders/hour = suspicious
ABUSE_TOKEN_BURN_RATE   = 500          # burning >500 tokens/hour = suspicious
BLOCKED_IP_KEY          = "security:blocked_ips"
SUSPICIOUS_KEY_PREFIX   = "security:suspicious:"
IP_RATE_KEY_PREFIX      = "security:ip:"


# ─── 1. File upload validation ───────────────────────────────────────────────

def _detect_magic_type(header: bytes) -> Optional[str]:
    """Detect file type from first 16 bytes."""
    for sig, mime in MAGIC_SIGNATURES.items():
        if header[:len(sig)] == sig:
            return mime
    return None


async def validate_upload(
    file: UploadFile,
    allowed_types: set[str] | None = None,
    max_bytes: int = MAX_UPLOAD_BYTES,
    plan: str = "free",
) -> bytes:
    """
    Validate uploaded file. Returns file bytes.
    Raises HTTPException 400/413 on violation.
    """
    if allowed_types is None:
        allowed_types = ALLOWED_UPLOAD_TYPES

    # Plan-based size limit
    effective_max = MAX_UPLOAD_BYTES_FREE if plan == "free" else max_bytes

    # 1. Filename sanity check
    fname = file.filename or ""
    if ".." in fname or "/" in fname or "\\" in fname:
        raise HTTPException(status_code=400, detail="Invalid filename")

    ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
    dangerous_exts = {"exe", "sh", "bat", "cmd", "php", "py", "js", "html", "svg"}
    if ext in dangerous_exts:
        raise HTTPException(status_code=400, detail=f"File type .{ext} not allowed")

    # 2. Read file (with size limit)
    content = b""
    chunk_size = 1024 * 64   # 64 KB chunks
    while True:
        chunk = await file.read(chunk_size)
        if not chunk:
            break
        content += chunk
        if len(content) > effective_max:
            mb = effective_max // (1024 * 1024)
            raise HTTPException(
                status_code=413,
                detail=f"File too large. Maximum size is {mb} MB"
                       + (" for free plan — upgrade for larger uploads" if plan == "free" else "")
            )

    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    # 3. Magic byte detection (prevents MIME spoofing)
    detected = _detect_magic_type(content[:16])

    # 4. Declared MIME type
    declared = file.content_type or mimetypes.guess_type(fname)[0] or ""
    declared = declared.split(";")[0].strip().lower()

    # Use detected type if available, fall back to declared
    effective_type = detected or declared

    if effective_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"File type not supported. Allowed: {', '.join(sorted(allowed_types))}"
        )

    # 5. Magic vs declared mismatch — potential spoofing
    if detected and declared and detected != declared:
        logger.warning(
            "File type mismatch: declared=%s detected=%s filename=%s",
            declared, detected, fname
        )
        # Use detected (more trustworthy) — already validated above

    logger.info("Upload validated: %s (%s, %d bytes)", fname, effective_type, len(content))
    return content


def sanitize_filename(filename: str, max_length: int = 100) -> str:
    """Return a safe filename — strip path components and special chars."""
    name = re.sub(r"[^\w\s\-\.]", "", filename.replace("/", "_").replace("\\", "_"))
    name = re.sub(r"\s+", "_", name).strip("._")
    return name[:max_length] or "upload"


# ─── 2. Signed download URLs ─────────────────────────────────────────────────

def _sign(job_id: str, user_id: str, expires: int, secret: str) -> str:
    """HMAC-SHA256 signature for download token."""
    payload = f"{job_id}:{user_id}:{expires}"
    return hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


async def create_signed_url(
    redis,
    job_id: str,
    user_id: str,
    secret: str,
    ttl: int = SIGNED_URL_TTL,
) -> str:
    """
    Create a time-limited signed token for downloading a render.
    Returns the token (to be appended as ?token=xxx).
    """
    expires = int(time.time()) + ttl
    token   = secrets.token_urlsafe(16)
    sig     = _sign(job_id, user_id, expires, secret)

    record = json.dumps({
        "job_id":  job_id,
        "user_id": user_id,
        "expires": expires,
        "sig":     sig,
    })
    await redis.set(f"{SIGNED_URL_KEY_PREFIX}{token}", record, ex=ttl + 60)
    logger.debug("Signed URL created: job=%s user=%s expires=%d", job_id, user_id, expires)
    return token


async def verify_signed_url(
    redis,
    token: str,
    job_id: str,
    secret: str,
    consume: bool = False,
) -> str:
    """
    Verify a signed download token. Returns user_id.
    Raises 403/410 on invalid/expired token.
    Set consume=True to invalidate token after use (single-use links).
    """
    raw = await redis.get(f"{SIGNED_URL_KEY_PREFIX}{token}")
    if not raw:
        raise HTTPException(status_code=410, detail="Download link expired or invalid")

    try:
        data = json.loads(raw)
    except Exception:
        raise HTTPException(status_code=403, detail="Malformed download token")

    # Check expiry
    if int(time.time()) > data.get("expires", 0):
        await redis.delete(f"{SIGNED_URL_KEY_PREFIX}{token}")
        raise HTTPException(status_code=410, detail="Download link has expired")

    # Check job_id matches
    if data.get("job_id") != job_id:
        logger.warning("Signed URL job_id mismatch: expected=%s got=%s", job_id, data.get("job_id"))
        raise HTTPException(status_code=403, detail="Invalid download token")

    # Verify HMAC signature
    expected_sig = _sign(data["job_id"], data["user_id"], data["expires"], secret)
    if not hmac.compare_digest(expected_sig, data.get("sig", "")):
        logger.warning("Signed URL signature mismatch for job=%s", job_id)
        raise HTTPException(status_code=403, detail="Invalid download token signature")

    if consume:
        await redis.delete(f"{SIGNED_URL_KEY_PREFIX}{token}")

    return data["user_id"]


# ─── 3. Queue isolation ───────────────────────────────────────────────────────

async def check_queue_capacity(redis) -> None:
    """Raise 503 if global queue is full."""
    depth = await redis.llen(QUEUE_KEY)
    if depth >= MAX_QUEUE_DEPTH:
        raise HTTPException(
            status_code=503,
            detail=f"Render queue is at capacity ({MAX_QUEUE_DEPTH} jobs). "
                   "Please try again in a few minutes."
        )


async def check_user_concurrency(
    redis,
    user_id: str,
    plan: str = "free",
) -> None:
    """Raise 429 if user already has too many active jobs."""
    limit = MAX_JOBS_PER_USER_FREE if plan == "free" else MAX_JOBS_PER_USER
    key   = f"{USER_JOBS_PREFIX}{user_id}"
    count = await redis.scard(key)
    if count >= limit:
        raise HTTPException(
            status_code=429,
            detail=f"You already have {count} render(s) in progress. "
                   f"Please wait for them to complete before starting a new one."
                   + (" Upgrade your plan for more concurrent renders." if plan == "free" else "")
        )


async def register_active_job(redis, user_id: str, job_id: str) -> None:
    """Mark a job as active for this user."""
    key = f"{USER_JOBS_PREFIX}{user_id}"
    await redis.sadd(key, job_id)
    await redis.expire(key, 3600)   # auto-expire after 1 hour safety net
    await redis.lpush(QUEUE_KEY, job_id)
    await redis.expire(QUEUE_KEY, 7200)


async def unregister_active_job(redis, user_id: str, job_id: str) -> None:
    """Mark a job as complete — free up the user's concurrency slot."""
    key = f"{USER_JOBS_PREFIX}{user_id}"
    await redis.srem(key, job_id)
    await redis.lrem(QUEUE_KEY, 0, job_id)


# ─── 4. Recursive / spam job detection ───────────────────────────────────────

async def check_recursive_job(redis, user_id: str, job_id: str, prev_job_id: Optional[str]) -> None:
    """
    Prevent recursive renders: if this job_id or prev_job_id is currently
    registered as active for this user, block it.
    """
    key    = f"{USER_JOBS_PREFIX}{user_id}"
    active = await redis.smembers(key)
    if isinstance(next(iter(active), b""), bytes):
        active = {m.decode() for m in active}

    if prev_job_id and prev_job_id in active:
        logger.warning("Recursive render detected: user=%s prev_job=%s", user_id, prev_job_id)
        raise HTTPException(
            status_code=409,
            detail="A re-render of this job is already in progress."
        )

    # Spam detection: too many renders in a short window
    spam_key = f"render:spam:{user_id}"
    count    = await redis.incr(spam_key)
    if count == 1:
        await redis.expire(spam_key, 300)   # 5-minute window
    if count > 10:
        logger.warning("Render spam detected: user=%s count=%d in 5 min", user_id, count)
        raise HTTPException(
            status_code=429,
            detail="Too many render requests. Please wait a few minutes before trying again."
        )


# ─── 5. API abuse / IP monitoring ────────────────────────────────────────────

async def check_ip_blocked(redis, ip: str) -> None:
    """Raise 403 if IP is in the blocked list."""
    blocked = await redis.sismember(BLOCKED_IP_KEY, ip)
    if blocked:
        raise HTTPException(status_code=403, detail="Access denied")


async def track_ip_request(redis, ip: str, endpoint: str) -> None:
    """Track IP request rate. Auto-block after threshold."""
    if not ip or ip in ("unknown", "127.0.0.1", "::1"):
        return

    key = f"{IP_RATE_KEY_PREFIX}{ip}:{endpoint}"
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, 60)   # 1-minute window

    # Hard block: >120 requests/minute to any single endpoint
    if count > 120:
        await redis.sadd(BLOCKED_IP_KEY, ip)
        await redis.expire(BLOCKED_IP_KEY, 86400)   # block for 24 hours
        logger.warning("IP auto-blocked for flood: ip=%s endpoint=%s count=%d", ip, endpoint, count)
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Try again later.")


async def track_render_abuse(
    redis,
    user_id: str,
    tokens_used: int = 100,
    failed: bool = False,
) -> None:
    """
    Track render activity for abuse detection.
    Flags accounts burning tokens unusually fast or failing suspiciously often.
    """
    now = int(time.time())
    window_key = f"{ABUSE_KEY_PREFIX}{user_id}:{now // ABUSE_WINDOW_SECS}"

    pipe = redis.pipeline()
    pipe.hincrby(window_key, "renders", 1)
    pipe.hincrby(window_key, "tokens", tokens_used)
    if failed:
        pipe.hincrby(window_key, "failures", 1)
    pipe.expire(window_key, ABUSE_WINDOW_SECS * 2)
    results = await pipe.execute()

    renders  = results[0]
    tokens   = results[1]
    failures = results[3] if failed else await redis.hget(window_key, "failures") or 0
    failures = int(failures)

    suspicious = False
    reasons    = []

    if renders > ABUSE_RENDER_THRESHOLD:
        reasons.append(f"{renders} renders in 1 hour")
        suspicious = True
    if tokens > ABUSE_TOKEN_BURN_RATE:
        reasons.append(f"{tokens} tokens burned in 1 hour")
        suspicious = True
    if failures > ABUSE_FAIL_THRESHOLD:
        reasons.append(f"{failures} failed renders in 1 hour")
        suspicious = True

    if suspicious:
        sus_key = f"{SUSPICIOUS_KEY_PREFIX}{user_id}"
        await redis.set(sus_key, json.dumps({
            "user_id":  user_id,
            "reasons":  reasons,
            "renders":  renders,
            "tokens":   tokens,
            "failures": failures,
            "ts":       datetime.now(timezone.utc).isoformat(),
        }), ex=86400)
        logger.warning("Suspicious usage: user=%s reasons=%s", user_id, reasons)


async def get_suspicious_users(redis, limit: int = 50) -> list[dict]:
    """Return list of flagged users for admin review."""
    suspicious = []
    cursor = 0
    while True:
        cursor, keys = await redis.scan(cursor, match=f"{SUSPICIOUS_KEY_PREFIX}*", count=100)
        for key in keys:
            raw = await redis.get(key)
            if raw:
                try:
                    suspicious.append(json.loads(raw))
                except Exception:
                    pass
        if cursor == 0:
            break
    suspicious.sort(key=lambda x: x.get("renders", 0), reverse=True)
    return suspicious[:limit]


async def get_blocked_ips(redis) -> list[str]:
    """Return list of blocked IPs."""
    ips = await redis.smembers(BLOCKED_IP_KEY)
    return [ip.decode() if isinstance(ip, bytes) else ip for ip in ips]


async def unblock_ip(redis, ip: str) -> None:
    await redis.srem(BLOCKED_IP_KEY, ip)


# ─── Schema hardening helpers ─────────────────────────────────────────────────

def validate_job_id(job_id: str) -> str:
    """Validate job_id is a safe UUID — prevent path traversal."""
    # UUID format: 8-4-4-4-12 hex chars
    pattern = r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    if not re.match(pattern, job_id.lower()):
        raise HTTPException(status_code=400, detail="Invalid job ID format")
    return job_id.lower()


def validate_scene_text(text: str, max_length: int = 1000) -> str:
    """Validate scene text — cap length, strip control chars."""
    if not text or not text.strip():
        raise HTTPException(status_code=400, detail="Scene text cannot be empty")
    # Strip control characters (keep newlines)
    text = re.sub(r'[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]', '', text)
    if len(text) > max_length:
        raise HTTPException(
            status_code=400,
            detail=f"Scene text too long (max {max_length} chars, got {len(text)})"
        )
    return text.strip()
