"""
backend/app/services/geo.py
Geo-aware currency detection with live USD/NGN exchange rate.
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

FALLBACK_RATE    = 1600.0   # NGN per USD — updated May 2026
EXCHANGE_CACHE_KEY = "sceneforge:exchange:usd_ngn"
EXCHANGE_TTL     = 3600     # 1 hour
GEO_CACHE_PREFIX = "sceneforge:geo:"
GEO_TTL          = 86400    # 24 hours per IP

_redis_instance  = None     # module-level Redis for exchange rate


async def _get_redis():
    """Get a Redis connection for caching."""
    global _redis_instance
    if _redis_instance is None:
        try:
            import redis.asyncio as aioredis
            from app.config import get_settings
            _redis_instance = await aioredis.from_url(
                get_settings().redis_url, decode_responses=True
            )
        except Exception:
            pass
    return _redis_instance


async def get_usd_to_ngn_rate(redis=None) -> float:
    """
    Fetch live USD→NGN exchange rate.
    Cached in Redis for 1 hour. Falls back to hardcoded rate.
    Uses open.er-api.com — free, no API key required.
    """
    r = redis or await _get_redis()

    # Check cache
    if r:
        try:
            cached = await r.get(EXCHANGE_CACHE_KEY)
            if cached:
                return float(cached)
        except Exception:
            pass

    # Fetch live rate
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                "https://open.er-api.com/v6/latest/USD",
                headers={"Accept": "application/json"},
            )
            if resp.status_code == 200:
                data = resp.json()
                rate = float(data["rates"]["NGN"])
                if r:
                    try:
                        await r.set(EXCHANGE_CACHE_KEY, str(rate), ex=EXCHANGE_TTL)
                    except Exception:
                        pass
                logger.info("Exchange rate updated: 1 USD = %.2f NGN", rate)
                return rate
    except Exception as e:
        logger.warning("Exchange rate fetch failed: %s — using fallback %.2f", e, FALLBACK_RATE)

    return FALLBACK_RATE


async def get_country_from_ip(ip: str, redis=None) -> str:
    """
    Detect country code from IP address using ip-api.com (free, no key).
    Returns 2-letter ISO country code e.g. 'NG', 'US', 'GB'.
    Cached per IP for 24 hours.
    """
    if not ip or ip in ("127.0.0.1", "::1", "testclient"):
        return "NG"  # local dev defaults to Nigeria

    r = redis or await _get_redis()
    cache_key = f"{GEO_CACHE_PREFIX}{ip}"

    # Check cache
    if r:
        try:
            cached = await r.get(cache_key)
            if cached:
                return cached
        except Exception:
            pass

    # Fetch from API
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                f"http://ip-api.com/json/{ip}?fields=countryCode",
                headers={"Accept": "application/json"},
            )
            if resp.status_code == 200:
                country = resp.json().get("countryCode", "US")
                if r:
                    try:
                        await r.set(cache_key, country, ex=GEO_TTL)
                    except Exception:
                        pass
                logger.debug("Geo lookup: %s → %s", ip, country)
                return country
    except Exception as e:
        logger.warning("Geo lookup failed for %s: %s", ip, e)

    return "US"


async def detect_currency(ip: Optional[str], redis=None) -> str:
    """Return 'NGN' for Nigerian IPs, 'USD' for everyone else."""
    country = await get_country_from_ip(ip or "", redis)
    return "NGN" if country.upper() == "NG" else "USD"


def build_plans_response(plans_raw: dict, currency: str) -> list[dict]:
    """
    Convert raw NGN plans to user-facing plans in their local currency.
    For USD: converts NGN amount using live rate (pulled separately).
    Returns a list so frontend can iterate directly.

    NOTE: For USD conversion use build_plans_response_async instead.
    This sync version uses the fallback rate — fine for non-critical display.
    """
    result = []
    for key, plan in plans_raw.items():
        amount_ngn = plan.get("amount", 0)
        tokens     = plan.get("tokens", 0)

        if currency == "NGN":
            amount        = amount_ngn
            symbol        = "₦"
            per_token     = round(amount_ngn / tokens, 2) if tokens else 0
        else:
            rate          = FALLBACK_RATE
            amount_usd    = round(amount_ngn / rate, 2)
            amount        = amount_usd
            symbol        = "$"
            per_token     = round(amount_usd / tokens, 4) if tokens else 0

        result.append({
            "key":           key,
            "label":         plan.get("label", key.title()),
            "amount":        amount,
            "currency":      currency,
            "symbol":        symbol,
            "tokens":        tokens,
            "videos":        plan.get("videos", tokens // 100),
            "per_token_rate": per_token,
        })

    return result


async def build_plans_response_async(
    plans_raw: dict, currency: str, redis=None
) -> list[dict]:
    """
    Same as build_plans_response but fetches live exchange rate.
    Use this in the /plans endpoint for accurate USD prices.
    """
    result = []
    rate = FALLBACK_RATE

    if currency == "USD":
        rate = await get_usd_to_ngn_rate(redis)

    for key, plan in plans_raw.items():
        amount_ngn = plan.get("amount", 0)
        tokens     = plan.get("tokens", 0)

        if currency == "NGN":
            amount    = amount_ngn
            symbol    = "₦"
            per_token = round(amount_ngn / tokens, 2) if tokens else 0
        else:
            amount_usd = round(amount_ngn / rate, 2)
            # Round to clean price points
            amount    = _clean_usd_price(amount_usd)
            symbol    = "$"
            per_token = round(amount / tokens, 4) if tokens else 0

        result.append({
            "key":            key,
            "label":          plan.get("label", key.title()),
            "amount":         amount,
            "currency":       currency,
            "symbol":         symbol,
            "tokens":         tokens,
            "videos":         plan.get("videos", tokens // 100),
            "per_token_rate": per_token,
            "exchange_rate":  rate if currency == "USD" else None,
            "amount_ngn":     amount_ngn if currency == "USD" else None,
        })

    return result


def _clean_usd_price(price: float) -> float:
    """Round to psychological price points: $0.99, $1.99, $4.99..."""
    if price < 1:
        return round(price, 2)
    elif price < 5:
        return float(int(price)) + 0.99
    elif price < 20:
        return round(price, 0) - 0.01
    else:
        return round(price, 0)
