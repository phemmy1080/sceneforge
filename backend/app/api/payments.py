from __future__ import annotations

import hashlib
import hmac
import json
import logging
import uuid
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Header, Request, Depends
from pydantic import BaseModel

from app.config import get_settings
from app.dependencies import get_redis
from app.services import auth as auth_service
from app.services.email import send_token_confirmation
from app.services import pricing as pricing_service
from app.services.geo import detect_currency, build_plans_response_async, get_country_from_ip

settings = get_settings()
router = APIRouter()
logger = logging.getLogger(__name__)

FLW_BASE = "https://api.flutterwave.com/v3"


# ─── Request / response models ────────────────────────────────────────────────

class InitiatePaymentRequest(BaseModel):
    plan_key: str   # "starter" | "pro" | "studio"


class InitiatePaymentResponse(BaseModel):
    payment_url: str
    tx_ref: str
    plan: dict


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _get_client_ip(request: Request) -> str:
    return (
        request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        or request.headers.get("x-real-ip", "")
        or (request.client.host if request.client else "")
    )

def _get_user_id(authorization: Optional[str]) -> Optional[str]:
    token = (authorization or "").removeprefix("Bearer ").strip()
    if not token:
        return None
    return auth_service.verify_token(token)


async def _verify_flw_transaction(tx_id: str) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{FLW_BASE}/transactions/{tx_id}/verify",
            headers={"Authorization": f"Bearer {settings.flutterwave_secret_key}"},
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/plans")
async def get_plans(
    request: Request,
    redis=Depends(get_redis),
):
    """Return plans with live geo-aware pricing — NGN for Nigeria, USD for everyone else."""
    client_ip  = _get_client_ip(request)
    country    = await get_country_from_ip(client_ip, redis)
    currency   = "NGN" if country == "NG" else "USD"
    plans_raw  = await pricing_service.get_plans(redis)
    plans_list = await build_plans_response_async(plans_raw, currency, redis)
    return {"plans": plans_list, "currency": currency, "country": country}


@router.post("/initiate", response_model=InitiatePaymentResponse)
async def initiate_payment(
    req: InitiatePaymentRequest,
    request: Request,
    authorization: Optional[str] = Header(None),
    redis=Depends(get_redis),
):
    user_id = _get_user_id(authorization)
    if not user_id:
        raise HTTPException(status_code=401, detail="Login required to make a payment")

    client_ip  = _get_client_ip(request)
    country    = await get_country_from_ip(client_ip, redis)
    currency   = "NGN" if country == "NG" else "USD"
    raw_plans  = await pricing_service.get_plans(redis)
    plans_list = await build_plans_response_async(raw_plans, currency, redis)
    plan = next((p for p in plans_list if p["key"] == req.plan_key), None)
    if not plan:
        raise HTTPException(status_code=400, detail=f"Unknown plan: {req.plan_key}")

    user = await auth_service.get_user_by_id(redis, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not settings.flutterwave_secret_key:
        raise HTTPException(
            status_code=503,
            detail="Payment not configured. Add FLUTTERWAVE_SECRET_KEY to .env"
        )

    tx_ref = f"sf_{user_id[:8]}_{uuid.uuid4().hex[:8]}"

    # Use display amount for USD (float), full amount for NGN (int)
    payment_amount = plan.get("amount_display", plan["amount"]) if currency == "USD" else plan["amount"]

    await redis.set(
        f"payment:pending:{tx_ref}",
        json.dumps({
            "user_id":    user_id,
            "plan_key":   req.plan_key,
            "tokens":     plan["tokens"],
            "amount":     payment_amount,
            "currency":   currency,
            "plan_label": plan["label"],
            "email":      user.email,
            "full_name":  user.full_name,
        }),
        ex=86400,
    )

    payload = {
        "tx_ref":       tx_ref,
        "amount":       str(payment_amount),
        "currency":     currency,
        "redirect_url": f"{settings.frontend_origin}/payment/callback",
        "meta": {
            "user_id":  user_id,
            "plan_key": req.plan_key,
            "tokens":   plan["tokens"],
        },
        "customer": {
            "email": user.email,
            "name":  user.full_name,
        },
        "customizations": {
            "title":       "SceneForge",
            "description": f"{plan['label']} — {plan['tokens']:,} tokens",
            "logo":        f"{settings.frontend_origin}/logo.png",
        },
        "payment_options": "card,banktransfer,ussd",
    }

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{FLW_BASE}/payments",
            json=payload,
            headers={"Authorization": f"Bearer {settings.flutterwave_secret_key}"},
            timeout=15,
        )
        if resp.status_code != 200:
            logger.error("Flutterwave payment init failed: %s", resp.text)
            raise HTTPException(status_code=502, detail="Payment gateway error")
        data = resp.json()

    payment_url = data.get("data", {}).get("link", "")
    if not payment_url:
        raise HTTPException(status_code=502, detail="No payment URL returned")

    logger.info("Payment initiated | user=%s | plan=%s | currency=%s | amount=%s | tx_ref=%s",
                user_id, req.plan_key, currency, payment_amount, tx_ref)
    return InitiatePaymentResponse(payment_url=payment_url, tx_ref=tx_ref, plan=plan)


@router.post("/webhook")
async def flutterwave_webhook(request: Request, redis=Depends(get_redis)):
    verif_hash = request.headers.get("verif-hash", "")
    if settings.flutterwave_secret_hash and verif_hash != settings.flutterwave_secret_hash:
        logger.warning("Webhook signature mismatch — rejected")
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    body = await request.json()
    logger.info("Flutterwave webhook received: %s", json.dumps(body)[:300])

    event = body.get("event", "")
    data  = body.get("data", {})

    if event != "charge.completed":
        return {"status": "ignored", "event": event}

    tx_status = data.get("status", "")
    tx_ref    = data.get("tx_ref", "")
    tx_id     = str(data.get("id", ""))
    amount    = data.get("amount", 0)
    currency  = data.get("currency", "")

    if tx_status != "successful":
        return {"status": "skipped", "reason": tx_status}

    already = await redis.get(f"payment:processed:{tx_id}")
    if already:
        return {"status": "duplicate"}

    raw = await redis.get(f"payment:pending:{tx_ref}")
    if not raw:
        meta      = data.get("meta", {})
        user_id   = meta.get("user_id")
        plan_key  = meta.get("plan_key")
        tokens    = int(meta.get("tokens", 0))
        plan_info = settings.token_plans.get(plan_key or "", {})
        plan_label = plan_info.get("label", plan_key or "Unknown")
        pending   = {}
    else:
        pending    = json.loads(raw if isinstance(raw, str) else raw.decode())
        user_id    = pending["user_id"]
        tokens     = pending["tokens"]
        plan_label = pending["plan_label"]

    if not user_id or not tokens:
        logger.error("Webhook: cannot find user or tokens for tx_ref=%s", tx_ref)
        return {"status": "error", "reason": "missing metadata"}

    try:
        verified = await _verify_flw_transaction(tx_id)
        if verified.get("data", {}).get("status") != "successful":
            return {"status": "verification_failed"}
    except Exception as e:
        logger.error("Webhook: FLW verification error: %s", e)

    import redis.asyncio as aioredis
    auth_redis = await aioredis.from_url(settings.redis_url, decode_responses=True)
    try:
        updated_user = await auth_service.add_tokens(
            auth_redis, user_id, tokens, plan=pending.get("plan_key", "")
        )
        logger.info("Tokens topped up | user=%s | +%d | balance=%d",
                    user_id, tokens, updated_user.tokens_remaining)

        # Auto-create agency workspace on first agency purchase
        if pending.get("plan_key") == "agency":
            try:
                from app.services.agency_service import (
                    get_workspace_id_for_user, create_workspace, add_pool_tokens
                )
                existing_ws = await get_workspace_id_for_user(auth_redis, user_id)
                if not existing_ws:
                    ws_name = f"{updated_user.full_name}'s Agency"
                    await create_workspace(auth_redis, user_id, ws_name, initial_tokens=tokens)
                    logger.info("Agency workspace auto-created | user=%s", user_id)
                else:
                    # Top up existing workspace pool with new tokens
                    await add_pool_tokens(auth_redis, existing_ws, tokens)
                    logger.info("Agency pool topped up | ws=%s | +%d", existing_ws, tokens)
            except Exception as ws_err:
                logger.error("Workspace auto-create failed (non-fatal): %s", ws_err)

        await redis.set(f"payment:processed:{tx_id}", "1", ex=60 * 60 * 24 * 90)
        await redis.delete(f"payment:pending:{tx_ref}")
        await send_token_confirmation(
            to_email=updated_user.email,
            full_name=updated_user.full_name,
            tokens_added=tokens,
            tokens_total=updated_user.tokens_remaining,
            amount=int(amount),
            currency=currency,
            plan_label=plan_label,
            transaction_id=tx_id,
        )
    finally:
        await auth_redis.aclose()

    return {"status": "success", "tokens_added": tokens}


@router.get("/callback")
async def payment_callback(
    status: str = "cancelled",
    tx_ref: str = "",
    transaction_id: str = "",
    redis=Depends(get_redis),
):
    if status != "successful" or not transaction_id:
        return {"status": "cancelled", "message": "Payment was cancelled or failed"}

    already = await redis.get(f"payment:processed:{transaction_id}")
    if already:
        return {"status": "success", "message": "Payment confirmed — tokens already credited"}

    try:
        verified = await _verify_flw_transaction(transaction_id)
        tx_data  = verified.get("data", {})
    except Exception as e:
        logger.error("Callback: FLW verification error: %s", e)
        return {"status": "error", "message": "Could not verify payment with Flutterwave"}

    if tx_data.get("status") != "successful":
        return {"status": "failed", "message": "Payment not confirmed by Flutterwave"}

    raw = await redis.get(f"payment:pending:{tx_ref}")
    if not raw:
        logger.error("Callback: no pending record for tx_ref=%s", tx_ref)
        return {"status": "error", "message": "Transaction record not found — contact support"}

    pending    = json.loads(raw if isinstance(raw, str) else raw.decode())
    user_id    = pending["user_id"]
    tokens     = pending["tokens"]
    plan_label = pending["plan_label"]
    amount     = int(tx_data.get("amount", pending["amount"]))
    currency   = tx_data.get("currency", pending["currency"])

    import redis.asyncio as aioredis
    auth_redis = await aioredis.from_url(settings.redis_url, decode_responses=True)
    try:
        updated_user = await auth_service.add_tokens(
            auth_redis, user_id, tokens, plan=pending.get("plan_key", "")
        )
        logger.info("Callback: tokens credited | user=%s | +%d | balance=%d",
                    user_id, tokens, updated_user.tokens_remaining)

        await redis.set(f"payment:processed:{transaction_id}", "1", ex=60 * 60 * 24 * 90)
        await redis.delete(f"payment:pending:{tx_ref}")
        await redis.set(
            f"payment:record:{transaction_id}",
            json.dumps({
                "transaction_id": transaction_id,
                "tx_ref":   tx_ref,
                "user_id":  user_id,
                "email":    updated_user.email,
                "plan":     plan_label,
                "tokens":   tokens,
                "amount":   amount,
                "currency": currency,
                "status":   "completed",
                "ts": __import__("datetime").datetime.now(
                    __import__("datetime").timezone.utc
                ).isoformat(),
            }),
            ex=60 * 60 * 24 * 90,
        )
        try:
            await send_token_confirmation(
                to_email=updated_user.email,
                full_name=updated_user.full_name,
                tokens_added=tokens,
                tokens_total=updated_user.tokens_remaining,
                amount=amount,
                currency=currency,
                plan_label=plan_label,
                transaction_id=transaction_id,
            )
        except Exception as email_err:
            logger.error("Callback: email failed: %s", email_err)
    finally:
        await auth_redis.aclose()

    return {
        "status":       "success",
        "message":      f"{tokens:,} tokens added to your account!",
        "tokens_added": tokens,
        "tokens_total": updated_user.tokens_remaining,
        "tx_ref":       tx_ref,
    }
