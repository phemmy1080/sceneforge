from __future__ import annotations

"""
Geo/currency detection service.
Detects user country from IP and returns appropriate currency.
Uses ip-api.com (free, no key needed, 45 req/min).
"""

import logging
import asyncio
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# Plans with both NGN and USD pricing
# USD prices are set at roughly market-equivalent rates
PLAN_PRICING = {
    "starter": {
        "tokens": 500, "videos": 5, "label": "Starter",
        "NGN": {"amount": 1000,  "symbol": "₦"},
        "USD": {"amount": 2,     "symbol": "$"},
    },
    "pro": {
        "tokens": 1200, "videos": 12, "label": "Pro",
        "NGN": {"amount": 2000,  "symbol": "₦"},
        "USD": {"amount": 4,     "symbol": "$"},
    },
    "studio": {
        "tokens": 3500, "videos": 35, "label": "Studio",
        "NGN": {"amount": 5000,  "symbol": "₦"},
        "USD": {"amount": 10,    "symbol": "$"},
    },
}

SUPPORTED_CURRENCIES = {"NGN", "USD"}
DEFAULT_CURRENCY = "USD"
NIGERIA_CURRENCY = "NGN"


async def detect_currency(client_ip: Optional[str]) -> str:
    """
    Detect currency from IP address.
    Nigerian IPs → NGN, everything else → USD.
    Falls back to USD on any error.
    """
    if not client_ip or client_ip in ("127.0.0.1", "::1", "testclient"):
        # Local dev — default to NGN so you can test locally
        return NIGERIA_CURRENCY

    # Strip port if present (e.g. "1.2.3.4:5678" → "1.2.3.4")
    ip = client_ip.split(",")[0].strip().split(":")[0]

    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(f"http://ip-api.com/json/{ip}?fields=countryCode")
            if resp.status_code == 200:
                data = resp.json()
                country = data.get("countryCode", "")
                currency = NIGERIA_CURRENCY if country == "NG" else DEFAULT_CURRENCY
                logger.info("Geo detected: IP=%s country=%s currency=%s", ip, country, currency)
                return currency
    except Exception as e:
        logger.warning("Geo detection failed for IP %s: %s — defaulting to USD", ip, e)

    return DEFAULT_CURRENCY


def build_plans_response(plans_from_redis: dict, currency: str) -> list[dict]:
    """
    Build the plans list with the correct currency pricing.
    Merges Redis-stored pricing with localized currency data.
    """
    if currency not in SUPPORTED_CURRENCIES:
        currency = DEFAULT_CURRENCY

    result = []
    for key, redis_plan in plans_from_redis.items():
        # Get localized pricing from PLAN_PRICING if available, else use Redis data
        local = PLAN_PRICING.get(key, {})
        curr_data = local.get(currency, {})

        if curr_data:
            amount = curr_data["amount"]
            symbol = curr_data["symbol"]
        else:
            # Custom plan added via admin — use Redis amount and infer currency
            if currency == "NGN":
                amount = redis_plan.get("amount", 0)
                symbol = "₦"
            else:
                # Convert NGN → USD at ~1600 rate, rounded nicely
                ngn = redis_plan.get("amount", 0)
                amount = max(1, round(ngn / 1600, 0))
                symbol = "$"

        tokens = redis_plan.get("tokens", local.get("tokens", 0))
        videos = redis_plan.get("videos", tokens // 100)

        result.append({
            "key":             key,
            "label":           redis_plan.get("label", local.get("label", key)),
            "amount":          amount,
            "currency":        currency,
            "symbol":          symbol,
            "tokens":          tokens,
            "videos":          videos,
            "per_token_rate":  round(amount / tokens, 4) if tokens else 0,
        })

    return result
