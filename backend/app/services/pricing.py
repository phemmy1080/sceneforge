from __future__ import annotations

"""
Pricing service — geo-aware pricing with live exchange rates.
- Nigerian users see NGN prices (base currency)
- All other users see USD at live exchange rate
- Exchange rate cached in Redis for 1 hour to avoid API hammering
- Falls back to hardcoded rate if API unavailable
"""
import json
import logging
from typing import Optional

import httpx
import redis.asyncio as aioredis

from app.config import get_settings

settings = get_settings()
logger   = logging.getLogger(__name__)

PRICING_KEY      = "sceneforge:pricing:plans"
EXCHANGE_KEY     = "sceneforge:exchange:usd_ngn"
EXCHANGE_TTL     = 3600       # cache rate for 1 hour
FALLBACK_RATE    = 1600.0     # NGN per 1 USD — update if stale
GEO_CACHE_PREFIX = "sceneforge:geo:"
GEO_TTL          = 86400      # cache IP geolocation for 24 hours

DEFAULT_PLANS = {
    "starter": {"amount": 1000, "currency": "NGN", "tokens": 500,  "label": "Starter", "videos": 5},
    "pro":     {"amount": 2000, "currency": "NGN", "tokens": 1200, "label": "Pro",     "videos": 12},
    "studio":  {"amount": 5000, "currency": "NGN", "tokens": 3500, "label": "Studio",  "videos": 35},
}


# ── Exchange rate ──────────────────────────────────────────────────────────────

async def get_usd_to_ngn_rate(redis: aioredis.Redis) -> float:
    """
    Get live USD→NGN rate. Cached in Redis for 1 hour.
    Uses exchangerate-api.com free tier (1500 req/month free).
    Falls back to hardcoded rate if API fails.
    """
    # Check cache first
    cached = await redis.get(EXCHANGE_KEY)
    if cached:
        try:
            return float(cached)
        except ValueError:
            pass

    # Fetch live rate
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            # Free API — no key required for USD base
            resp = await client.get(
                "https://open.er-api.com/v6/latest/USD",
                headers={"Accept": "application/json"},
            )
            if resp.status_code == 200:
                data = resp.json()
                rate = float(data["rates"]["NGN"])
                # Cache for 1 hour
                await redis.set(EXCHANGE_KEY, str(rate), ex=EXCHANGE_TTL)
                logger.info("Exchange rate updated: 1 USD = %.2f NGN", rate)
                return rate
    except Exception as e:
        logger.warning("Exchange rate fetch failed: %s — using fallback %.2f", e, FALLBACK_RATE)

    return FALLBACK_RATE


async def ngn_to_usd(amount_ngn: float, redis: aioredis.Redis) -> float:
    """Convert NGN amount to USD, rounded to 2 decimal places."""
    rate = await get_usd_to_ngn_rate(redis)
    return round(amount_ngn / rate, 2)


# ── Geo detection ─────────────────────────────────────────────────────────────

async def get_country_from_ip(ip: str, redis: aioredis.Redis) -> str:
    """
    Detect country code from IP address.
    Returns 2-letter country code (e.g. 'NG', 'US').
    Cached per IP for 24 hours.
    """
    if not ip or ip in ("127.0.0.1", "::1", "localhost"):
        return "NG"  # default to Nigeria for local dev

    cache_key = f"{GEO_CACHE_PREFIX}{ip}"
    cached = await redis.get(cache_key)
    if cached:
        return cached

    try:
        async with httpx.AsyncClient(timeout=5) as client:
            # Free — no API key needed, 45 req/min
            resp = await client.get(
                f"http://ip-api.com/json/{ip}?fields=countryCode",
                headers={"Accept": "application/json"},
            )
            if resp.status_code == 200:
                country = resp.json().get("countryCode", "US")
                await redis.set(cache_key, country, ex=GEO_TTL)
                logger.debug("Geo: %s → %s", ip, country)
                return country
    except Exception as e:
        logger.warning("Geo lookup failed for %s: %s", ip, e)

    return "US"


def is_nigeria(country_code: str) -> bool:
    return country_code.upper() == "NG"


# ── Plans ──────────────────────────────────────────────────────────────────────

async def get_plans(redis: aioredis.Redis) -> dict:
    """Return base plans (always in NGN) from Redis."""
    raw = await redis.get(PRICING_KEY)
    if raw:
        return json.loads(raw)
    plans = dict(settings.token_plans) if settings.token_plans else DEFAULT_PLANS
    for key, plan in plans.items():
        if "videos" not in plan:
            plan["videos"] = plan["tokens"] // 100
    await redis.set(PRICING_KEY, json.dumps(plans))
    return plans


async def get_plans_for_user(
    redis: aioredis.Redis,
    country_code: str = "NG",
) -> dict:
    """
    Return plans with pricing in the user's local currency.
    Nigerian users → NGN
    Everyone else  → USD (converted at live rate)
    """
    base_plans = await get_plans(redis)

    if is_nigeria(country_code):
        # Return NGN prices as-is
        return {
            k: {**v, "currency": "NGN", "currency_symbol": "₦"}
            for k, v in base_plans.items()
        }

    # Convert to USD
    rate = await get_usd_to_ngn_rate(redis)
    usd_plans = {}
    for key, plan in base_plans.items():
        amount_ngn = plan["amount"]
        amount_usd = round(amount_ngn / rate, 2)
        # Round to clean price: $0.99, $1.99, $4.99 etc
        amount_usd = _clean_usd_price(amount_usd)
        usd_plans[key] = {
            **plan,
            "amount":          int(amount_usd * 100),  # cents for Flutterwave
            "amount_display":  amount_usd,             # for display
            "currency":        "USD",
            "currency_symbol": "$",
            "amount_ngn":      amount_ngn,             # original NGN price
            "exchange_rate":   rate,
        }
    return usd_plans


def _clean_usd_price(price: float) -> float:
    """Round to nearest psychological price point."""
    if price < 1:
        return round(price, 2)
    elif price < 5:
        # Round to nearest .99
        return round(price - 0.01, 0) + 0.99
    elif price < 20:
        return round(price, 0) - 0.01
    else:
        return round(price, 0)


async def get_plan(redis: aioredis.Redis, plan_key: str) -> Optional[dict]:
    plans = await get_plans(redis)
    return plans.get(plan_key)


async def update_plan_pricing(
    redis: aioredis.Redis,
    plan_key: str,
    amount: int,
    tokens: int,
    label: str,
    currency: str = "NGN",
) -> dict:
    plans = await get_plans(redis)
    if plan_key not in plans:
        raise ValueError(f"Unknown plan key: {plan_key}")
    plans[plan_key].update({
        "amount":   amount,
        "tokens":   tokens,
        "label":    label,
        "currency": currency,
        "videos":   tokens // 100,
    })
    await redis.set(PRICING_KEY, json.dumps(plans))
    logger.info("Pricing updated | plan=%s | amount=%d | tokens=%d", plan_key, amount, tokens)
    return plans


async def add_plan(
    redis: aioredis.Redis,
    plan_key: str,
    amount: int,
    tokens: int,
    label: str,
    currency: str = "NGN",
) -> dict:
    plans = await get_plans(redis)
    plans[plan_key] = {
        "amount":   amount,
        "tokens":   tokens,
        "label":    label,
        "currency": currency,
        "videos":   tokens // 100,
    }
    await redis.set(PRICING_KEY, json.dumps(plans))
    logger.info("Plan added | key=%s | amount=%d | tokens=%d", plan_key, amount, tokens)
    return plans


async def delete_plan(redis: aioredis.Redis, plan_key: str) -> dict:
    plans = await get_plans(redis)
    if plan_key not in plans:
        raise ValueError(f"Plan not found: {plan_key}")
    del plans[plan_key]
    await redis.set(PRICING_KEY, json.dumps(plans))
    logger.info("Plan deleted | key=%s", plan_key)
    return plans
