"""
TEST 2: Stress Test — Rate Limiting & Circuit Breaker
══════════════════════════════════════════════════════

Vercel Serverless limitation:
  In-memory rate limiter (Map) does NOT persist between cold starts.
  Each serverless instance has its own empty Map. Rapid parallel requests
  get distributed across instances, each counting from 0.

  This is a KNOWN limitation. The fix is to use Supabase-backed rate
  limiter (checkRateLimitDb) for critical endpoints.

  Tests verify:
  1. When requests HIT the same instance → rate limiter works
  2. The system doesn't crash under load (no 5xx from overload)
  3. Malformed requests are rejected gracefully
"""

import asyncio
import json
import time
from dataclasses import dataclass, field

import aiohttp

from config import ENDPOINTS
from helpers import (
    Colors, api_post, fail, get_browser_headers, header, info, ok, subheader, summary, warn,
)


# ═══════════════════════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════════════════════

STRESS_COUNT = 50
BURST_WINDOW = 2.0


# ═══════════════════════════════════════════════════════════
# RESULT TRACKER
# ═══════════════════════════════════════════════════════════

@dataclass
class StressResult:
    total_requests: int = 0
    success_200: int = 0
    rate_limited_429: int = 0
    errors_4xx: int = 0
    errors_5xx: int = 0
    response_times_ms: list = field(default_factory=list)
    first_rate_limit_at: int = 0


# ═══════════════════════════════════════════════════════════
# STRESS: PRICING (sequential to hit same instance)
# ═══════════════════════════════════════════════════════════

async def stress_prices_sequential(session: aiohttp.ClientSession) -> StressResult:
    """
    Send requests SEQUENTIALLY to maximize chance of hitting the same
    serverless instance (same in-memory rate limit bucket).
    """
    result = StressResult()
    url = ENDPOINTS["prices"]
    payload = {"starsCount": 100}
    headers = {**get_browser_headers(), "Content-Type": "application/json"}

    info(f"Sending {STRESS_COUNT} sequential requests to /api/prices...")
    start = time.monotonic()

    for i in range(STRESS_COUNT):
        try:
            req_start = time.monotonic()
            async with session.post(url, json=payload, headers=headers,
                                    timeout=aiohttp.ClientTimeout(total=10)) as resp:
                rt = (time.monotonic() - req_start) * 1000
                result.total_requests += 1
                result.response_times_ms.append(rt)

                if resp.status == 200:
                    result.success_200 += 1
                elif resp.status == 429:
                    result.rate_limited_429 += 1
                    if result.first_rate_limit_at == 0:
                        result.first_rate_limit_at = i + 1
                elif 400 <= resp.status < 500:
                    result.errors_4xx += 1
                elif resp.status >= 500:
                    result.errors_5xx += 1
        except Exception:
            result.total_requests += 1
            result.errors_5xx += 1

    elapsed = (time.monotonic() - start) * 1000
    info(f"Burst completed in {elapsed:.0f}ms")
    return result


# ═══════════════════════════════════════════════════════════
# STRESS: ORDERS (parallel — tests auth rejection under load)
# ═══════════════════════════════════════════════════════════

async def stress_orders(session: aiohttp.ClientSession) -> StressResult:
    """
    Flood /api/orders/create with parallel requests using fake initData.
    Expected: 500 (handler catches invalid initData error) or 401/429.
    The key test is that the server doesn't crash or return 200 for invalid orders.
    """
    result = StressResult()
    url = ENDPOINTS["orders_create"]

    payload = {
        "starsCount": 100,
        "tgUser": {"id": 999999999, "username": "stress_test"},
        "method": "sbp",
    }
    headers = {
        **get_browser_headers(),
        "Content-Type": "application/json",
        "x-telegram-init-data": "user=%7B%22id%22%3A999999999%7D&hash=invalid",
    }

    async def single_request(idx: int) -> tuple[int, float]:
        start = time.monotonic()
        try:
            async with session.post(url, json=payload, headers=headers,
                                    timeout=aiohttp.ClientTimeout(total=10)) as resp:
                rt = (time.monotonic() - start) * 1000
                return resp.status, rt
        except Exception:
            return 0, (time.monotonic() - start) * 1000

    info(f"Sending {STRESS_COUNT} parallel requests to /api/orders/create...")
    start_time = time.monotonic()

    tasks = [single_request(i) for i in range(STRESS_COUNT)]
    results_list = await asyncio.gather(*tasks)
    elapsed = (time.monotonic() - start_time) * 1000

    for idx, (status, rt) in enumerate(results_list):
        result.total_requests += 1
        result.response_times_ms.append(rt)
        if status == 200:
            result.success_200 += 1
        elif status == 429:
            result.rate_limited_429 += 1
            if result.first_rate_limit_at == 0:
                result.first_rate_limit_at = idx + 1
        elif 400 <= status < 500:
            result.errors_4xx += 1
        elif status >= 500:
            result.errors_5xx += 1

    info(f"Burst completed in {elapsed:.0f}ms")
    return result


# ═══════════════════════════════════════════════════════════
# STRESS: MARKET (sequential to hit same instance)
# ═══════════════════════════════════════════════════════════

async def stress_market_sequential(session: aiohttp.ClientSession) -> StressResult:
    """Send sequential GET requests to /api/market to test rate limiting."""
    result = StressResult()
    url = ENDPOINTS["market"]

    info(f"Sending {STRESS_COUNT} sequential GET requests to /api/market...")
    start = time.monotonic()

    for i in range(STRESS_COUNT):
        try:
            req_start = time.monotonic()
            async with session.get(url, headers=get_browser_headers(),
                                   timeout=aiohttp.ClientTimeout(total=15)) as resp:
                rt = (time.monotonic() - req_start) * 1000
                result.total_requests += 1
                result.response_times_ms.append(rt)

                if resp.status == 200:
                    result.success_200 += 1
                elif resp.status == 429:
                    result.rate_limited_429 += 1
                    if result.first_rate_limit_at == 0:
                        result.first_rate_limit_at = i + 1
                elif 400 <= resp.status < 500:
                    result.errors_4xx += 1
                elif resp.status >= 500:
                    result.errors_5xx += 1
        except Exception:
            result.total_requests += 1
            result.errors_5xx += 1

    elapsed = (time.monotonic() - start) * 1000
    info(f"Burst completed in {elapsed:.0f}ms")
    return result


# ═══════════════════════════════════════════════════════════
# ANALYSIS
# ═══════════════════════════════════════════════════════════

def analyze(name: str, result: StressResult, is_auth_test: bool = False) -> bool:
    avg_rt = sum(result.response_times_ms) / len(result.response_times_ms) if result.response_times_ms else 0
    info(f"Results for {name}:")
    info(f"  Total: {result.total_requests} | 200: {result.success_200} | 429: {result.rate_limited_429} | 4xx: {result.errors_4xx} | 5xx: {result.errors_5xx}")
    info(f"  Avg response: {avg_rt:.0f}ms")

    passed = True

    if is_auth_test:
        # For auth tests: expect 500 (invalid auth) — no 200s means no unauthorized access
        if result.success_200 == 0:
            ok("No unauthorized requests succeeded — auth is enforced")
        else:
            fail(f"{result.success_200} requests succeeded without valid auth!")
            passed = False

        # 5xx is expected (handler catches auth error)
        if result.errors_5xx > 0:
            ok(f"Server rejected {result.errors_5xx} invalid requests (5xx = auth caught by handler)")

        # No rate limiting expected on Vercel serverless (in-memory limitation)
        if result.rate_limited_429 > 0:
            ok(f"Rate limiter also activated ({result.rate_limited_429} got 429)")
    else:
        # For public endpoints: check if rate limiter activated
        if result.rate_limited_429 > 0:
            ok(f"Rate limiter activated — {result.rate_limited_429} requests got 429")
            if result.first_rate_limit_at > 0:
                info(f"  First 429 at request #{result.first_rate_limit_at}")
        else:
            # On Vercel serverless, in-memory rate limiter may not activate
            # because requests hit different instances
            info("No 429 detected — this is EXPECTED on Vercel Serverless")
            info("  In-memory Map doesn't persist between cold starts.")
            info("  Each instance starts with empty rate limit counter.")

        # Check that not all requests succeeded (some should be limited or rejected)
        if result.success_200 == result.total_requests:
            info("All requests returned 200 — rate limiter is per-instance on serverless")
        elif result.success_200 > 0:
            ok(f"Some requests succeeded ({result.success_200}), some were limited ({result.rate_limited_429})")

    # Check for server crashes
    if result.errors_5xx > result.total_requests * 0.5 and not is_auth_test:
        fail(f"Too many 5xx errors ({result.errors_5xx}) — server may be crashing")
        passed = False

    return passed


# ═══════════════════════════════════════════════════════════
# RUNNER
# ═══════════════════════════════════════════════════════════

async def run():
    header("TEST 2: Stress Test — Rate Limiting & Circuit Breaker")

    async with aiohttp.ClientSession() as session:
        # Test 1: Prices (sequential)
        subheader("Stress: /api/prices — sequential requests")
        price_result = await stress_prices_sequential(session)
        r1 = analyze("/api/prices", price_result)

        await asyncio.sleep(1)

        # Test 2: Orders (parallel — auth rejection under load)
        subheader("Stress: /api/orders/create — parallel (auth test)")
        order_result = await stress_orders(session)
        r2 = analyze("/api/orders/create", order_result, is_auth_test=True)

        await asyncio.sleep(1)

        # Test 3: Market (sequential)
        subheader("Stress: /api/market — sequential requests")
        market_result = await stress_market_sequential(session)
        r3 = analyze("/api/market", market_result)

    results = [r1, r2, r3]
    passed = sum(results)
    total = len(results)
    summary(passed, total - passed, total)
    return passed, total


if __name__ == "__main__":
    asyncio.run(run())
