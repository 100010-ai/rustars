"""
Shared helpers for RuStars pentest suite.

Provides:
- HTTP client with browser-like headers
- Supabase REST client (anon + service key)
- HMAC initData generator
- Colored terminal output
- Assertion helpers
"""

import asyncio
import hashlib
import hmac
import json
import sys
import time
from typing import Any, Optional
from urllib.parse import urlencode

import aiohttp

from config import (
    BASE_URL, BROWSER_UA, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY,
    SUPABASE_URL, TELEGRAM_BOT_TOKEN, TEST_INIT_DATA,
)


# ═══════════════════════════════════════════════════════════
# TERMINAL OUTPUT
# ═══════════════════════════════════════════════════════════

class Colors:
    GREEN = "\033[92m"
    RED = "\033[91m"
    YELLOW = "\033[93m"
    CYAN = "\033[96m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RESET = "\033[0m"


def header(text: str):
    print(f"\n{Colors.BOLD}{Colors.CYAN}{'═' * 70}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}  {text}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}{'═' * 70}{Colors.RESET}")


def subheader(text: str):
    print(f"\n{Colors.BOLD}{Colors.YELLOW}  ▸ {text}{Colors.RESET}")


def ok(text: str):
    print(f"  {Colors.GREEN}✓ PASS{Colors.RESET}  {text}")


def fail(text: str):
    print(f"  {Colors.RED}✗ FAIL{Colors.RESET}  {text}")


def info(text: str):
    print(f"  {Colors.DIM}ℹ {text}{Colors.RESET}")


def warn(text: str):
    print(f"  {Colors.YELLOW}⚠ WARN{Colors.RESET}  {text}")


def summary(passed: int, failed: int, total: int):
    print(f"\n{Colors.BOLD}{'─' * 70}{Colors.RESET}")
    color = Colors.GREEN if failed == 0 else Colors.RED
    print(f"  {color}{Colors.BOLD}Results: {passed}/{total} passed, {failed} failed{Colors.RESET}")
    print(f"{Colors.BOLD}{'─' * 70}{Colors.RESET}\n")


# ═══════════════════════════════════════════════════════════
# HTTP CLIENT
# ═══════════════════════════════════════════════════════════

def get_browser_headers() -> dict:
    """Headers that look like a real browser (bypasses middleware UA check)."""
    return {
        "User-Agent": BROWSER_UA,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Connection": "keep-alive",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
    }


async def api_get(
    session: aiohttp.ClientSession,
    url: str,
    headers: Optional[dict] = None,
    params: Optional[dict] = None,
) -> tuple[int, dict | str]:
    """GET request, returns (status, body)."""
    h = {**get_browser_headers(), **(headers or {})}
    async with session.get(url, headers=h, params=params, timeout=aiohttp.ClientTimeout(total=15)) as resp:
        try:
            body = await resp.json()
        except Exception:
            body = await resp.text()
        return resp.status, body


async def api_post(
    session: aiohttp.ClientSession,
    url: str,
    data: Optional[dict] = None,
    headers: Optional[dict] = None,
) -> tuple[int, dict | str]:
    """POST request with JSON body, returns (status, body)."""
    h = {**get_browser_headers(), "Content-Type": "application/json", **(headers or {})}
    async with session.post(url, json=data, headers=h, timeout=aiohttp.ClientTimeout(total=15)) as resp:
        try:
            body = await resp.json()
        except Exception:
            body = await resp.text()
        return resp.status, body


async def raw_post(
    session: aiohttp.ClientSession,
    url: str,
    data: Any,
    headers: Optional[dict] = None,
) -> tuple[int, dict | str, dict]:
    """Raw POST — no browser headers injected. Returns (status, body, response_headers)."""
    h = headers or {}
    async with session.post(url, data=data, headers=h, timeout=aiohttp.ClientTimeout(total=15)) as resp:
        try:
            body = await resp.json()
        except Exception:
            body = await resp.text()
        resp_headers = dict(resp.headers)
        return resp.status, body, resp_headers


# ═══════════════════════════════════════════════════════════
# SUPABASE REST CLIENT
# ═══════════════════════════════════════════════════════════

class SupabaseClient:
    """Minimal Supabase REST client for testing."""

    def __init__(self, use_service_key: bool = False):
        self.url = SUPABASE_URL
        self.key = SUPABASE_SERVICE_KEY if use_service_key else SUPABASE_ANON_KEY
        self.rest_url = f"{SUPABASE_URL}/rest/v1"

    @property
    def headers(self) -> dict:
        return {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

    async def select(
        self,
        session: aiohttp.ClientSession,
        table: str,
        columns: str = "*",
        filters: Optional[dict] = None,
        limit: int = 100,
    ) -> tuple[int, list]:
        """SELECT query via REST API."""
        url = f"{self.rest_url}/{table}?select={columns}"
        if filters:
            for k, v in filters.items():
                url += f"&{k}=eq.{v}"
        url += f"&limit={limit}"

        async with session.get(url, headers=self.headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            try:
                data = await resp.json()
            except Exception:
                data = []
            return resp.status, data

    async def insert(
        self,
        session: aiohttp.ClientSession,
        table: str,
        row: dict,
    ) -> tuple[int, Any]:
        """INSERT via REST API."""
        url = f"{self.rest_url}/{table}"
        async with session.post(url, json=row, headers=self.headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            try:
                data = await resp.json()
            except Exception:
                data = await resp.text()
            return resp.status, data

    async def update(
        self,
        session: aiohttp.ClientSession,
        table: str,
        data: dict,
        filters: dict,
    ) -> tuple[int, Any]:
        """UPDATE via REST API."""
        url = f"{self.rest_url}/{table}"
        for k, v in filters.items():
            url += f"&{k}=eq.{v}" if "?" in url else f"?{k}=eq.{v}"
        async with session.patch(url, json=data, headers=self.headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            try:
                result = await resp.json()
            except Exception:
                result = await resp.text()
            return resp.status, result

    async def rpc(
        self,
        session: aiohttp.ClientSession,
        function_name: str,
        params: dict,
    ) -> tuple[int, Any]:
        """Call a PostgRPC function."""
        url = f"{self.rest_url}/rpc/{function_name}"
        async with session.post(url, json=params, headers=self.headers, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            try:
                data = await resp.json()
            except Exception:
                data = await resp.text()
            return resp.status, data


# ═══════════════════════════════════════════════════════════
# HMAC INITDATA GENERATOR
# ═══════════════════════════════════════════════════════════

def generate_init_data(
    user_id: int,
    username: str = "",
    bot_token: str = "",
) -> str:
    """
    Generate a valid Telegram initData string with HMAC signature.

    This creates a real initData that passes HMAC verification
    when the bot token matches the one configured on the server.
    """
    token = bot_token or TELEGRAM_BOT_TOKEN
    if not token:
        # Return invalid initData for testing rejection
        user_data = json.dumps({"id": user_id, "first_name": "Test", "username": username})
        return f"user={user_data}&hash=invalid_no_token"

    user_data = json.dumps({"id": user_id, "first_name": "Test", "username": username})
    params = {"user": user_data, "auth_date": str(int(time.time()))}

    # Sort params alphabetically
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(params.items()))

    # Compute HMAC
    secret_key = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    hash_val = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    params["hash"] = hash_val
    return urlencode(params)


# ═══════════════════════════════════════════════════════════
# TIMING HELPERS
# ═══════════════════════════════════════════════════════════

def ms_now() -> int:
    return int(time.time() * 1000)


async def delay(seconds: float):
    await asyncio.sleep(seconds)
