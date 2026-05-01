import asyncio
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Request

import logging
from app.dependencies import get_redis
from app.middleware.rate_limit import limiter
logger = logging.getLogger(__name__)
from app.models.auth_schemas import (
    SignupRequest, LoginRequest,
    TokenResponse, UserOut, UpdateProfileRequest, TokenBalanceResponse,
)
from app.services import auth as auth_service
from app.services import coupons as coupon_service

router = APIRouter()


class SignupWithCouponRequest(SignupRequest):
    coupon_code: Optional[str] = None


@router.post("/signup", response_model=TokenResponse)
async def signup(req: SignupWithCouponRequest, redis=Depends(get_redis)):
    try:
        user = await auth_service.create_user(redis, req)
        # Apply coupon if provided
        if req.coupon_code:
            try:
                coupon = await coupon_service.redeem_coupon(redis, req.coupon_code, user.id)
                user = await auth_service.add_tokens(redis, user.id, coupon["tokens"])
                logger.info("Coupon applied at signup | user=%s | code=%s | +%d tokens",
                            user.id, req.coupon_code, coupon["tokens"])
            except ValueError as ce:
                logger.warning("Invalid coupon at signup | code=%s | %s", req.coupon_code, ce)

        # Send verification OTP
        try:
            from app.services.email import send_verification_otp
            otp = auth_service.generate_otp()
            await auth_service.store_otp(redis, user.email, otp)
            asyncio.create_task(send_verification_otp(user.email, user.full_name, otp))
            logger.info("Verification OTP sent to %s", user.email)
        except Exception as email_err:
            logger.error("Failed to send verification OTP at signup: %s", email_err)

        token = auth_service.issue_token(user.id)
        return TokenResponse(access_token=token, user=user)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Signup failed: {e}")


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, redis=Depends(get_redis)):
    user = await auth_service.authenticate_user(redis, req.email, req.password)
    if not user:
        raise HTTPException(status_code=401, detail="Incorrect email or password.")
    if not user.email_verified:
        raise HTTPException(status_code=403, detail="Please verify your email before logging in. Check your inbox or request a new code.")
    token = auth_service.issue_token(user.id)
    return TokenResponse(access_token=token, user=user)


@router.get("/me", response_model=UserOut)
async def get_me(
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    user_id = auth_service.verify_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = await auth_service.get_user_by_id(redis, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.patch("/me", response_model=UserOut)
async def update_profile(
    req: UpdateProfileRequest,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    user_id = auth_service.verify_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = await auth_service.update_user(redis, user_id,
                                          full_name=req.full_name, email=req.email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.get("/tokens", response_model=TokenBalanceResponse)
async def get_tokens(
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    """Get the current user's token balance."""
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    user_id = auth_service.verify_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    bal = await auth_service.get_token_balance(redis, user_id)
    return TokenBalanceResponse(
        tokens_remaining=bal["tokens_remaining"],
        tokens_total=bal["tokens_total"],
        videos_created=bal["videos_created"],
        can_render=bal["tokens_remaining"] >= 100,
    )


@router.post("/validate-coupon")
async def validate_coupon(
    body: dict,
    redis=Depends(get_redis),
):
    """Check if a coupon code is valid before signup."""
    code = (body.get("code") or "").upper().strip()
    if not code:
        return {"valid": False, "tokens": 0, "message": "No code provided"}

    raw = await redis.get(f"coupon:{code}")
    if not raw:
        return {"valid": False, "tokens": 0, "message": "Invalid coupon code"}

    coupon = json.loads(raw)
    if not coupon.get("active"):
        return {"valid": False, "tokens": 0, "message": "This coupon has expired"}

    max_uses = coupon.get("max_uses", 0)
    uses = coupon.get("uses", 0)
    if max_uses > 0 and uses >= max_uses:
        return {"valid": False, "tokens": 0, "message": "This coupon has reached its usage limit"}

    tokens = coupon.get("tokens", 0)
    return {"valid": True, "tokens": tokens, "message": f"✓ {tokens:,} bonus tokens will be added to your account"}


@router.post("/verify-email")
async def verify_email(
    body: dict,
    redis=Depends(get_redis),
    authorization: Optional[str] = Header(None),
):
    """Verify email with OTP. Returns updated user on success."""
    otp = (body.get("otp") or "").strip()
    token = (authorization or "").removeprefix("Bearer ").strip()

    user_id = auth_service.verify_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    # Get user email
    raw = await redis.get(f"user:{user_id}")
    if not raw:
        raise HTTPException(status_code=404, detail="User not found")
    data = json.loads(raw)
    email = data.get("email", "")

    valid = await auth_service.verify_otp(redis, email, otp)
    if not valid:
        raise HTTPException(status_code=400, detail="Invalid or expired code. Please try again.")

    await auth_service.mark_email_verified(redis, user_id)
    data["email_verified"] = True
    return {"success": True, "email_verified": True}


@router.post("/resend-otp")
async def resend_otp(
    redis=Depends(get_redis),
    authorization: Optional[str] = Header(None),
):
    """Resend verification OTP. Rate limited to once per 60 seconds."""
    token = (authorization or "").removeprefix("Bearer ").strip()
    user_id = auth_service.verify_token(token)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token")

    raw = await redis.get(f"user:{user_id}")
    if not raw:
        raise HTTPException(status_code=404, detail="User not found")
    data = json.loads(raw)

    if data.get("email_verified"):
        return {"success": True, "message": "Email already verified"}

    email = data.get("email", "")
    full_name = data.get("full_name", "")

    can_send, wait_secs = await auth_service.can_resend_otp(redis, email)
    if not can_send:
        raise HTTPException(
            status_code=429,
            detail=f"Please wait {wait_secs} seconds before requesting a new code."
        )

    otp = auth_service.generate_otp()
    await auth_service.store_otp(redis, email, otp)

    from app.config import get_settings as _gs
    _settings = _gs()

    if _settings.smtp_user and _settings.smtp_password:
        from app.services.email import send_verification_otp
        import asyncio
        asyncio.create_task(send_verification_otp(email, full_name, otp))
        logger.info("OTP resent to %s", email)
    else:
        logger.warning("=" * 60)
        logger.warning("SMTP NOT CONFIGURED — OTP for %s: %s", email, otp)
        logger.warning("=" * 60)

    return {"success": True, "message": "Verification code sent"}


@router.post("/forgot-password")
@limiter.limit("3/minute")
async def forgot_password(
    request: Request,
    body: dict,
    redis=Depends(get_redis),
):
    """
    Send a password reset link to the user's email.
    Always returns 200 even if email not found (security best practice).
    """
    email = (body.get("email") or "").strip().lower()
    if not email:
        return {"success": True, "message": "If that email exists, a reset link has been sent."}

    # Check user exists
    uid = await redis.get(f"email_index:{email}")
    if not uid:
        # Don't reveal whether email exists
        return {"success": True, "message": "If that email exists, a reset link has been sent."}

    import json as _json
    raw = await redis.get(f"user:{uid}")
    if not raw:
        return {"success": True, "message": "If that email exists, a reset link has been sent."}

    user_data = _json.loads(raw)
    full_name = user_data.get("full_name", "there")

    # Generate reset token
    token = auth_service.generate_reset_token()
    await auth_service.store_reset_token(redis, email, token)

    # Build reset URL
    from app.config import get_settings as _gs
    _s = _gs()
    reset_url = f"{_s.frontend_origin}/reset-password?token={token}"

    # Send email (with console fallback)
    try:
        from app.services.email import send_password_reset
        import asyncio
        if _s.smtp_user and _s.smtp_password:
            asyncio.create_task(send_password_reset(email, full_name, reset_url))
            logger.info("Password reset email queued for %s", email)
        else:
            logger.warning("=" * 60)
            logger.warning("PASSWORD RESET LINK for %s:", email)
            logger.warning(reset_url)
            logger.warning("=" * 60)
    except Exception as e:
        logger.error("Failed to send reset email: %s", e)
        logger.warning("RESET URL for %s: %s", email, reset_url)

    return {"success": True, "message": "If that email exists, a reset link has been sent."}


@router.post("/reset-password")
async def reset_password_with_token(body: dict, redis=Depends(get_redis)):
    """Reset password using a valid token from the email link."""
    token = (body.get("token") or "").strip()
    new_password = (body.get("new_password") or "").strip()
    confirm_password = (body.get("confirm_password") or "").strip()

    if not token:
        raise HTTPException(status_code=400, detail="Reset token is required")
    if not new_password:
        raise HTTPException(status_code=400, detail="New password is required")
    if new_password != confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    # Consume token (single use)
    email = await auth_service.consume_reset_token(redis, token)
    if not email:
        raise HTTPException(status_code=400, detail="Reset link has expired or already been used. Please request a new one.")

    # Update password
    success = await auth_service.reset_password(redis, email, new_password)
    if not success:
        raise HTTPException(status_code=404, detail="Account not found")

    logger.info("Password successfully reset for %s", email)
    return {"success": True, "message": "Password updated. You can now log in."}


@router.get("/verify-reset-token")
async def verify_reset_token(token: str, redis=Depends(get_redis)):
    """Check if a reset token is still valid (used by frontend before showing the form)."""
    email = await auth_service.verify_reset_token(redis, token)
    if not email:
        raise HTTPException(status_code=400, detail="Reset link has expired or is invalid")
    return {"valid": True, "email": email}


@router.get("/plan-features")
async def get_plan_features(
    redis=Depends(get_redis),
    authorization: Optional[str] = Header(None),
):
    """Return the current user's plan limits — used by frontend to show/hide features."""
    from app.services.plans import get_limits, PLAN_LIMITS
    import json as _json

    token = (authorization or "").removeprefix("Bearer ").strip()
    user_plan = "free"

    if token:
        user_id = auth_service.verify_token(token)
        if user_id:
            raw = await redis.get(f"user:{user_id}")
            if raw:
                user_plan = _json.loads(raw).get("plan", "free")

    limits = get_limits(user_plan)
    return {
        "plan": user_plan,
        "limits": limits,
        "all_plans": PLAN_LIMITS,
    }
