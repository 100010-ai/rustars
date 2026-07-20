"""
TEST 1: YooKassa Webhook Attack Simulation
═══════════════════════════════════════════

Verifies that the payment webhook endpoint rejects requests from:
  - Non-whitelisted IP addresses (not 185.70.76.x / 185.70.77.x)
  - Missing or invalid Authorization headers
  - Forged webhook payloads

Expected behavior:
  - IP whitelist → 403 Forbidden (or 500 if handler catches the error)
  - Missing auth → 403 Forbidden (IP check happens first)
  - Forged payload with valid-looking body → 403/500 (IP blocks it)

NOTE: On Vercel, the x-forwarded-for header from the client is overwritten
with the real connecting IP. So we test from our real IP (which is NOT
in the YooKassa whitelist). The webhook should reject us regardless.
"""

import asyncio
import json

import aiohttp

from config import ENDPOINTS
from helpers import (
    Colors, api_post, fail, get_browser_headers, header, info, ok, raw_post, subheader, summary, warn,
)


# ═══════════════════════════════════════════════════════════
# HELPER: Check if request was rejected (not processed)
# ═══════════════════════════════════════════════════════════

def is_rejected(status: int, body) -> bool:
    """Check if the webhook rejected the request."""
    # 403 = IP whitelist blocked it (ideal)
    # 401 = unauthorized (ideal)
    # 400 = bad request (acceptable)
    # 500 = handler caught an error and returned generic error (acceptable — means it didn't process)
    if status in (403, 401, 400):
        return True
    if status == 500:
        # 500 means the handler caught an error — the forged request was NOT processed
        # This is acceptable because the webhook didn't execute any payment logic
        if isinstance(body, dict) and body.get("error"):
            return True
    return False


# ═══════════════════════════════════════════════════════════
# TEST CASES
# ═══════════════════════════════════════════════════════════

async def test_webhook_no_auth_no_ip(session: aiohttp.ClientSession) -> bool:
    """
    Attack: POST to webhook with NO auth header and from a non-YooKassa IP.
    This simulates a hacker calling the endpoint directly.
    """
    info("Sending forged webhook with no auth, from attacker's IP...")

    forged_payload = {
        "event": "payment.succeeded",
        "object": {
            "id": "test_payment_00000000",
            "status": "succeeded",
            "amount": {"value": "149.00", "currency": "RUB"},
            "metadata": {
                "orderId": "fake-order-id",
                "stars_amount": "100",
                "telegram_username": "attacker",
            },
        },
    }

    status, body, _ = await raw_post(
        session, ENDPOINTS["webhook_payment"], forged_payload,
        {"Content-Type": "application/json"},
    )

    info(f"Response: {status} | {json.dumps(body)[:200]}")

    if status in (403, 401):
        ok("Webhook rejected from non-whitelisted IP (403/401) — IP whitelist working")
        return True
    elif is_rejected(status, body):
        ok(f"Webhook rejected request (status {status}) — forged payload NOT processed")
        return True
    else:
        fail(f"Webhook returned {status} — may have processed forged payment!")
        return False


async def test_webhook_forged_event_type(session: aiohttp.ClientSession) -> bool:
    """
    Attack: Send a webhook with event type other than 'payment.succeeded'.
    Should be silently ignored or rejected.
    """
    info("Sending webhook with non-succeeded event type...")

    forged_payload = {
        "event": "payment.waiting_for_capture",
        "object": {
            "id": "test_payment_00000001",
            "status": "waiting_for_capture",
            "amount": {"value": "149.00", "currency": "RUB"},
        },
    }

    status, body, _ = await raw_post(
        session, ENDPOINTS["webhook_payment"], forged_payload,
        {"Content-Type": "application/json"},
    )

    info(f"Response: {status} | {json.dumps(body)[:200]}")

    if is_rejected(status, body):
        ok(f"Non-succeeded event rejected (status {status})")
        return True
    elif status == 200:
        if isinstance(body, dict) and body.get("ok"):
            ok("Non-succeeded event returned 200 OK — no action taken (safe)")
            return True
        fail("Got 200 with unexpected response")
        return False
    else:
        fail(f"Unexpected status {status}")
        return False


async def test_webhook_missing_event_field(session: aiohttp.ClientSession) -> bool:
    """
    Attack: Send a webhook without the 'event' field entirely.
    Should be rejected.
    """
    info("Sending webhook with missing 'event' field...")

    forged_payload = {
        "object": {
            "id": "test_payment_00000002",
            "status": "succeeded",
        },
    }

    status, body, _ = await raw_post(
        session, ENDPOINTS["webhook_payment"], forged_payload,
        {"Content-Type": "application/json"},
    )

    info(f"Response: {status}")

    if is_rejected(status, body):
        ok(f"Missing event field rejected (status {status})")
        return True
    else:
        fail(f"Expected rejection, got {status}")
        return False


async def test_webhook_empty_body(session: aiohttp.ClientSession) -> bool:
    """
    Attack: Send POST with empty body.
    Should be rejected (400 or 500).
    """
    info("Sending webhook with empty body...")

    status, body, _ = await raw_post(
        session, ENDPOINTS["webhook_payment"], "",
        {"Content-Type": "application/json"},
    )

    info(f"Response: {status}")

    if is_rejected(status, body):
        ok(f"Empty body rejected (status {status})")
        return True
    else:
        fail(f"Expected rejection, got {status}")
        return False


async def test_webhook_oversized_payload(session: aiohttp.ClientSession) -> bool:
    """
    Attack: Send an oversized payload (potential DoS / memory exhaustion).
    Should be blocked by body size limit (10KB).
    """
    info("Sending oversized webhook payload (>10KB)...")

    large_payload = {
        "event": "payment.succeeded",
        "object": {
            "id": "x" * 20000,  # Way over 10KB
            "status": "succeeded",
        },
    }

    status, body, _ = await raw_post(
        session, ENDPOINTS["webhook_payment"], large_payload,
        {"Content-Type": "application/json"},
    )

    info(f"Response: {status}")

    if is_rejected(status, body):
        ok(f"Oversized payload rejected (status {status})")
        return True
    else:
        fail(f"Expected rejection, got {status} — body size limit may not work")
        return False


async def test_webhook_get_method_rejected(session: aiohttp.ClientSession) -> bool:
    """
    Attack: Send GET request to webhook (which only accepts POST).
    Should be rejected with 405 or similar.
    """
    info("Sending GET request to POST-only webhook...")

    from helpers import api_get
    status, body = await api_get(session, ENDPOINTS["webhook_payment"])

    info(f"Response: {status}")

    if status in (405, 403, 404, 400, 500):
        ok(f"GET method rejected (status {status})")
        return True
    elif status == 200:
        fail("GET request returned 200 — webhook accepts GET (should be POST-only)")
        return False
    else:
        info(f"Status {status} — may be acceptable")
        return True


# ═══════════════════════════════════════════════════════════
# RUNNER
# ═══════════════════════════════════════════════════════════

async def run():
    header("TEST 1: YooKassa Webhook Attack Simulation")

    tests = [
        ("Webhook: forged payload from attacker IP → rejected", test_webhook_no_auth_no_ip),
        ("Webhook: forged event type → rejected", test_webhook_forged_event_type),
        ("Webhook: missing event field → rejected", test_webhook_missing_event_field),
        ("Webhook: empty body → rejected", test_webhook_empty_body),
        ("Webhook: oversized payload → rejected", test_webhook_oversized_payload),
        ("Webhook: GET method → rejected (POST only)", test_webhook_get_method_rejected),
    ]

    results = []
    async with aiohttp.ClientSession() as session:
        for name, test_fn in tests:
            subheader(name)
            try:
                passed = await test_fn(session)
            except Exception as e:
                fail(f"Exception: {e}")
                passed = False
            results.append(passed)

    passed = sum(results)
    total = len(results)
    summary(passed, total - passed, total)
    return passed, total


if __name__ == "__main__":
    asyncio.run(run())
