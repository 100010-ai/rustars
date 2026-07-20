"""
RuStars Admin Panel — Localhost Web Dashboard
═══════════════════════════════════════════════

FastAPI backend running on http://127.0.0.1:8000
Connects directly to Supabase (service role) and TON RPC.

Usage:
    cd admin
    pip install -r requirements.txt
    uvicorn main:app --host 127.0.0.1 --port 8000 --reload
"""

import os
import secrets
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request, Form, HTTPException, Depends
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from supabase import create_client, Client

# ═══════════════════════════════════════════════════════════
# ENV
# ═══════════════════════════════════════════════════════════

load_dotenv(Path(__file__).parent / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
ADMIN_PASSWORD = os.getenv("ADMIN_PANEL_PASSWORD", "rustars2024")
TONCENTER_API_KEY = os.getenv("TONCENTER_API_KEY", "")
TON_WALLET_ADDRESS = os.getenv("MY_WALLET_ADDRESS", "")

# ═══════════════════════════════════════════════════════════
# APP
# ═══════════════════════════════════════════════════════════

app = FastAPI(title="RuStars Admin", docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:8000", "http://localhost:8000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

templates = Jinja2Templates(directory=Path(__file__).parent / "templates")

# ═══════════════════════════════════════════════════════════
# SUPABASE CLIENT
# ═══════════════════════════════════════════════════════════

sb: Optional[Client] = None

def get_sb() -> Client:
    global sb
    if not sb:
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env")
        sb = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return sb

# ═══════════════════════════════════════════════════════════
# SESSION MANAGEMENT (simple token-based)
# ═══════════════════════════════════════════════════════════

sessions: dict[str, float] = {}  # token -> created_at
SESSION_TTL = 3600 * 8  # 8 hours

def create_session() -> str:
    token = secrets.token_urlsafe(32)
    sessions[token] = time.time()
    return token

def validate_session(token: Optional[str]) -> bool:
    if not token:
        return False
    created = sessions.get(token)
    if not created:
        return False
    if time.time() - created > SESSION_TTL:
        del sessions[token]
        return False
    return True

async def require_auth(request: Request):
    token = request.cookies.get("admin_token")
    if not validate_session(token):
        raise HTTPException(status_code=302, headers={"Location": "/login"})
    return token

# ═══════════════════════════════════════════════════════════
# TON WALLET BALANCE
# ═══════════════════════════════════════════════════════════

TON_PER_STAR = 0.0002

async def get_ton_balance() -> float:
    """Get TON wallet balance via TON Center API."""
    if not TON_WALLET_ADDRESS:
        return 0.0

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(
                f"https://toncenter.com/api/v2/getBalance",
                params={"address": TON_WALLET_ADDRESS},
                headers={"X-API-Key": TONCENTER_API_KEY} if TONCENTER_API_KEY else {},
            )
            if res.status_code == 200:
                data = res.json()
                balance_nano = int(data.get("result", {}).get("balance", 0))
                return balance_nano / 1e9
    except Exception:
        pass
    return 0.0


async def get_exchange_rates() -> dict:
    """Get TON/USD and USD/RUB rates."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            # TON/USD from CoinGecko
            cg = await client.get(
                "https://api.coingecko.com/api/v3/simple/price",
                params={"ids": "the-open-network", "vs_currencies": "usd"},
            )
            ton_usd = cg.json().get("the-open-network", {}).get("usd", 0)

            # USD/RUB
            fx = await client.get(
                "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json",
            )
            usd_rub = fx.json().get("usd", {}).get("rub", 0)

            return {"ton_usd": ton_usd, "usd_rub": usd_rub, "ton_rub": ton_usd * usd_rub}
    except Exception:
        return {"ton_usd": 0, "usd_rub": 0, "ton_rub": 0}


# ═══════════════════════════════════════════════════════════
# ROUTES — AUTH
# ═══════════════════════════════════════════════════════════

@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    return templates.TemplateResponse("login.html", {"request": request, "error": None})


@app.post("/login", response_class=HTMLResponse)
async def login_submit(request: Request, password: str = Form(...)):
    if password != ADMIN_PASSWORD:
        return templates.TemplateResponse("login.html", {"request": request, "error": "Неверный пароль"})
    
    token = create_session()
    response = RedirectResponse(url="/", status_code=302)
    response.set_cookie("admin_token", token, httponly=True, samesite="strict", max_age=SESSION_TTL)
    return response


@app.get("/logout")
async def logout(request: Request):
    token = request.cookies.get("admin_token")
    if token and token in sessions:
        del sessions[token]
    response = RedirectResponse(url="/login", status_code=302)
    response.delete_cookie("admin_token")
    return response


# ═══════════════════════════════════════════════════════════
# ROUTES — DASHBOARD
# ═══════════════════════════════════════════════════════════

@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request, tab: str = "orders"):
    token = request.cookies.get("admin_token")
    if not validate_session(token):
        return RedirectResponse(url="/login", status_code=302)
    return templates.TemplateResponse("index.html", {"request": request, "active_tab": tab})


# ═══════════════════════════════════════════════════════════
# API — ORDERS
# ═══════════════════════════════════════════════════════════

@app.get("/api/orders")
async def api_orders(request: Request, status: str = "all", limit: int = 100):
    token = request.cookies.get("admin_token")
    if not validate_session(token):
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    db = get_sb()
    query = db.table("tma_stars_orders").select("*").order("created_at", desc=True).limit(limit)
    if status != "all":
        query = query.eq("status", status)
    data = query.execute()
    return JSONResponse(data.data or [])


@app.post("/api/orders/{order_id}/push")
async def api_push_order(order_id: str, request: Request):
    """Force-push a pending_liquidity order to processing."""
    token = request.cookies.get("admin_token")
    if not validate_session(token):
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    db = get_sb()
    result = db.table("tma_stars_orders").update({
        "status": "processing_blockchain",
        "error_message": f"Admin push at {datetime.now(timezone.utc).isoformat()}",
    }).eq("id", order_id).in_("status", ["pending_liquidity", "failed", "error_fragment", "error_balance", "error_ton"]).execute()

    return JSONResponse({"ok": True, "updated": len(result.data or [])})


@app.post("/api/orders/{order_id}/force-success")
async def api_force_success(order_id: str, request: Request, tx_hash: str = Form(...)):
    """Force order to success status with manual BoC hash."""
    token = request.cookies.get("admin_token")
    if not validate_session(token):
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    db = get_sb()
    result = db.table("tma_stars_orders").update({
        "status": "completed",
        "tx_hash": tx_hash,
        "error_message": f"Admin force-success at {datetime.now(timezone.utc).isoformat()}",
    }).eq("id", order_id).execute()

    return JSONResponse({"ok": True, "updated": len(result.data or [])})


# ═══════════════════════════════════════════════════════════
# API — MONITORING
# ═══════════════════════════════════════════════════════════

@app.get("/api/wallet-balance")
async def api_wallet_balance(request: Request):
    token = request.cookies.get("admin_token")
    if not validate_session(token):
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    balance = await get_ton_balance()
    available_stars = int(balance / TON_PER_STAR)
    return JSONResponse({
        "balance_ton": round(balance, 4),
        "available_stars": available_stars,
        "low": balance < 50,
    })


@app.get("/api/system-status")
async def api_system_status(request: Request):
    token = request.cookies.get("admin_token")
    if not validate_session(token):
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    db = get_sb()
    # Check system status from a settings table or env
    # For now, return basic info
    return JSONResponse({
        "status": "active",
        "wallet": TON_Wallet_ADDRESS[:10] + "..." if TON_WALLET_ADDRESS else "not configured",
    })


@app.post("/api/emergency-stop")
async def api_emergency_stop(request: Request):
    """Set system_status to paused."""
    token = request.cookies.get("admin_token")
    if not validate_session(token):
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    db = get_sb()
    # Try to update a settings/config table
    try:
        db.table("tma_system_config").upsert({
            "key": "system_status",
            "value": "paused",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
    except Exception:
        # If table doesn't exist, try to create it or just log
        pass

    return JSONResponse({"ok": True, "status": "paused"})


@app.post("/api/emergency-resume")
async def api_emergency_resume(request: Request):
    """Set system_status to active."""
    token = request.cookies.get("admin_token")
    if not validate_session(token):
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    db = get_sb()
    try:
        db.table("tma_system_config").upsert({
            "key": "system_status",
            "value": "active",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
    except Exception:
        pass

    return JSONResponse({"ok": True, "status": "active"})


# ═══════════════════════════════════════════════════════════
# API — TASKS
# ═══════════════════════════════════════════════════════════

@app.get("/api/tasks")
async def api_tasks(request: Request):
    token = request.cookies.get("admin_token")
    if not validate_session(token):
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    db = get_sb()
    try:
        data = db.table("tma_tasks").select("*").order("created_at", desc=True).execute()
        return JSONResponse(data.data or [])
    except Exception:
        return JSONResponse([])


@app.post("/api/tasks")
async def api_create_task(
    request: Request,
    title: str = Form(...),
    reward_rub: int = Form(...),
    channel_url: str = Form(...),
    max_completions: int = Form(100),
):
    token = request.cookies.get("admin_token")
    if not validate_session(token):
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    db = get_sb()
    result = db.table("tma_tasks").insert({
        "title": title,
        "reward_rub": reward_rub,
        "channel_url": channel_url,
        "max_completions": max_completions,
        "completions": 0,
        "active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }).execute()

    return JSONResponse({"ok": True, "task": result.data[0] if result.data else None})


@app.delete("/api/tasks/{task_id}")
async def api_delete_task(task_id: str, request: Request):
    token = request.cookies.get("admin_token")
    if not validate_session(token):
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    db = get_sb()
    db.table("tma_tasks").delete().eq("id", task_id).execute()
    return JSONResponse({"ok": True})


# ═══════════════════════════════════════════════════════════
# API — USERS (referral abuse)
# ═══════════════════════════════════════════════════════════

@app.get("/api/users")
async def api_users(request: Request, search: str = ""):
    token = request.cookies.get("admin_token")
    if not validate_session(token):
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    db = get_sb()
    query = db.table("tma_balances").select("*, tma_referrals!inner(*)").order("balance_rub", desc=True).limit(100)
    if search:
        query = query.ilike("telegram_id", f"%{search}%")
    data = query.execute()
    return JSONResponse(data.data or [])


@app.post("/api/users/{tg_id}/reset-referral")
async def api_reset_referral(tg_id: str, request: Request):
    """Reset referral balance to 0."""
    token = request.cookies.get("admin_token")
    if not validate_session(token):
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    db = get_sb()
    db.table("tma_referrals").update({
        "total_earned_rub": 0,
    }).eq("referred_id", int(tg_id)).execute()

    return JSONResponse({"ok": True})


# ═══════════════════════════════════════════════════════════
# API — STATS
# ═══════════════════════════════════════════════════════════

@app.get("/api/stats")
async def api_stats(request: Request, from_date: str = "", to_date: str = ""):
    token = request.cookies.get("admin_token")
    if not validate_session(token):
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    db = get_sb()
    rates = await get_exchange_rates()
    balance = await get_ton_balance()
    ton_rub = rates.get("ton_rub", 0)

    # Determine date range
    now = datetime.now(timezone.utc)
    if from_date and to_date:
        range_start = f"{from_date}T00:00:00Z"
        range_end = f"{to_date}T23:59:59Z"
    else:
        # Default: today
        range_start = now.strftime("%Y-%m-%dT00:00:00Z")
        range_end = now.strftime("%Y-%m-%dT23:59:59Z")

    # Fetch all completed orders in range
    try:
        orders = db.table("tma_stars_orders").select("amount_rub, stars_count, created_at, status").eq("status", "completed").gte("created_at", range_start).lte("created_at", range_end).execute()
        order_list = orders.data or []
    except Exception:
        order_list = []

    # Aggregate by day
    daily_map: dict[str, dict] = {}
    for o in order_list:
        day = (o.get("created_at") or "")[:10]
        if not day:
            continue
        if day not in daily_map:
            daily_map[day] = {"date": day, "orders": 0, "revenue": 0, "stars": 0}
        daily_map[day]["orders"] += 1
        daily_map[day]["revenue"] += o.get("amount_rub", 0)
        daily_map[day]["stars"] += o.get("stars_count", 0)

    # Calculate financial metrics per day
    daily = []
    for day in sorted(daily_map.keys()):
        d = daily_map[day]
        ton_spent = d["stars"] * TON_PER_STAR
        cost_rub = ton_spent * ton_rub
        acquiring = d["revenue"] * 0.035
        profit = d["revenue"] - cost_rub - acquiring
        daily.append({
            "date": day,
            "orders": d["orders"],
            "revenue": round(d["revenue"], 2),
            "ton_spent": round(ton_spent, 4),
            "cost_rub": round(cost_rub, 2),
            "acquiring": round(acquiring, 2),
            "profit": round(profit, 2),
        })

    # Summary totals
    total_revenue = sum(d["revenue"] for d in daily)
    total_ton = sum(d["ton_spent"] for d in daily)
    total_cost = sum(d["cost_rub"] for d in daily)
    total_acquiring = sum(d["acquiring"] for d in daily)
    total_profit = total_revenue - total_cost - total_acquiring

    # All-time stats
    try:
        all_orders = db.table("tma_stars_orders").select("id, status").execute()
        all_data = all_orders.data or []
        total_all = len(all_data)
        total_completed = sum(1 for o in all_data if o.get("status") == "completed")
        total_pending = sum(1 for o in all_data if o.get("status") in ("pending", "paid", "processing_blockchain"))
        total_failed = sum(1 for o in all_data if o.get("status", "").startswith("error") or o.get("status") == "failed")
    except Exception:
        total_all = total_completed = total_pending = total_failed = 0

    return JSONResponse({
        "rates": rates,
        "wallet_balance_ton": round(balance, 4),
        "summary": {
            "revenue_rub": round(total_revenue, 2),
            "ton_spent": round(total_ton, 4),
            "cost_rub": round(total_cost, 2),
            "acquiring_fee": round(total_acquiring, 2),
            "gross_profit": round(total_profit, 2),
        },
        "daily": daily,
        "today": {
            "revenue_rub": round(total_revenue, 2),
            "stars_sold": sum(d["orders"] for d in daily),
            "ton_spent": round(total_ton, 4),
            "cost_rub": round(total_cost, 2),
            "acquiring_fee": round(total_acquiring, 2),
            "gross_profit": round(total_profit, 2),
        },
        "all_time": {
            "total_orders": total_all,
            "completed": total_completed,
            "pending": total_pending,
            "failed": total_failed,
        },
    })


# ═══════════════════════════════════════════════════════════
# RUN
# ═══════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    print("\n  RuStars Admin Panel")
    print("  http://127.0.0.1:8000")
    print("  Press Ctrl+C to stop\n")
    uvicorn.run(app, host="127.0.0.1", port=8000)
