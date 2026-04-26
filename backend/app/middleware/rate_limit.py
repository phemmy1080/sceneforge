from __future__ import annotations
"""
Rate limiting middleware using slowapi.
Limits are per user ID (authenticated) or IP (anonymous).
"""
from fastapi import Request

def _get_limit_key(request: Request) -> str:
    """Use user ID for authenticated requests, IP for anonymous."""
    try:
        from app.services.auth import verify_token
        auth = request.headers.get("Authorization", "")
        token = auth.removeprefix("Bearer ").strip()
        if token:
            user_id = verify_token(token)
            if user_id:
                return f"user:{user_id}"
    except Exception:
        pass
    # Fall back to IP
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


try:
    from slowapi import Limiter
    limiter = Limiter(key_func=_get_limit_key, default_limits=[])
    RATE_LIMITING_ENABLED = True
except ImportError:
    # slowapi not installed — create a no-op limiter
    RATE_LIMITING_ENABLED = False

    class _NoOpLimiter:
        def limit(self, *args, **kwargs):
            def decorator(func):
                return func
            return decorator

    limiter = _NoOpLimiter()
