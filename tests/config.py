"""
Configuration for RuStars Pentest Suite.

All secrets and URLs are read from environment variables.
NEVER hardcode credentials in test files.

Usage:
    export RUSTARS_BASE_URL="https://rustars.vercel.app"
    export SUPABASE_URL="https://xxx.supabase.co"
    export SUPABASE_ANON_KEY="eyJ..."
    export SUPABASE_SERVICE_KEY="eyJ..."
    export TEST_TELEGRAM_BOT_TOKEN="123:ABC"
    export YOOKASSA_SHOP_ID="123456"
    export YOOKASSA_SECRET_KEY="test_..."
"""

import os


# ═══════════════════════════════════════════════════════════
# BASE URL
# ═══════════════════════════════════════════════════════════

BASE_URL = os.getenv("RUSTARS_BASE_URL", "https://rustars.vercel.app")

# ═══════════════════════════════════════════════════════════
# SUPABASE
# ═══════════════════════════════════════════════════════════

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

# ═══════════════════════════════════════════════════════════
# TELEGRAM
# ═══════════════════════════════════════════════════════════

TELEGRAM_BOT_TOKEN = os.getenv("TEST_TELEGRAM_BOT_TOKEN", "")

# ═══════════════════════════════════════════════════════════
# YOOKASSA
# ═══════════════════════════════════════════════════════════

YOOKASSA_SHOP_ID = os.getenv("YOOKASSA_SHOP_ID", "")
YOOKASSA_SECRET_KEY = os.getenv("YOOKASSA_SECRET_KEY", "")

# ═══════════════════════════════════════════════════════════
# API ENDPOINTS
# ═══════════════════════════════════════════════════════════

ENDPOINTS = {
    "webhook_payment": f"{BASE_URL}/api/webhooks/payment",
    "prices": f"{BASE_URL}/api/prices",
    "orders_create": f"{BASE_URL}/api/orders/create",
    "stock_check": f"{BASE_URL}/api/stock/check",
    "referrals_register": f"{BASE_URL}/api/referrals/register",
    "referrals_stats": f"{BASE_URL}/api/referrals/stats",
    "market": f"{BASE_URL}/api/market",
    "honeypot": f"{BASE_URL}/api/honeypot",
}

# ═══════════════════════════════════════════════════════════
# TEST USER (fake —用于 testing only)
# ═══════════════════════════════════════════════════════════

# Fake initData for testing (will fail HMAC but tests the flow)
TEST_INIT_DATA = "user=%7B%22id%22%3A999999999%2C%22first_name%22%3A%22Test%22%7D&hash=invalid_hash_for_testing"

# ═══════════════════════════════════════════════════════════
# BROWSER-LIKE USER AGENT (bypasses middleware scraper block)
# ═══════════════════════════════════════════════════════════

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

# ═══════════════════════════════════════════════════════════
# SUPABASE TABLES
# ═══════════════════════════════════════════════════════════

TABLES = {
    "orders": "tma_stars_orders",
    "balances": "tma_balances",
    "wallet_txns": "tma_wallet_txns",
    "referrals": "tma_referrals",
    "delivery_queue": "tma_delivery_queue",
    "audit_log": "tma_audit_log",
    "rate_limits": "tma_rate_limits",
    "pending_approvals": "tma_pending_approvals",
}
