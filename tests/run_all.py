"""
RuStars Pentest Suite — Master Runner
══════════════════════════════════════

Executes all 5 test scenarios and produces a final report.

Usage:
    # Run all tests
    python tests/run_all.py

    # Run specific test
    python tests/run_all.py --test 1
    python tests/run_all.py --test 2

    # Set target URL
    RUSTARS_BASE_URL=https://rustars.vercel.app python tests/run_all.py

    # With Supabase (for RLS tests)
    SUPABASE_URL=https://xxx.supabase.co SUPABASE_ANON_KEY=eyJ... SUPABASE_SERVICE_KEY=eyJ... python tests/run_all.py

Environment Variables:
    RUSTARS_BASE_URL      — Target URL (default: https://rustars.vercel.app)
    SUPABASE_URL          — Supabase project URL
    SUPABASE_ANON_KEY     — Supabase anon/public key
    SUPABASE_SERVICE_KEY  — Supabase service_role key
    TEST_TELEGRAM_BOT_TOKEN — Bot token for HMAC testing
"""

import argparse
import asyncio
import sys
import time

from helpers import Colors, header, summary


# ═══════════════════════════════════════════════════════════
# IMPORTS (lazy to allow --help without deps)
# ═══════════════════════════════════════════════════════════

def load_test(num: int):
    if num == 1:
        from test_01_webhook_attack import run
        return run, "YooKassa Webhook Attack Simulation"
    elif num == 2:
        from test_02_stress_rate_limit import run
        return run, "Stress Test — Rate Limiting & Circuit Breaker"
    elif num == 3:
        from test_03_referral_abuse import run
        return run, "Referral System Abuse Prevention"
    elif num == 4:
        from test_04_rls_isolation import run
        return run, "RLS Isolation Verification"
    elif num == 5:
        from test_05_dynamic_pricing import run
        return run, "Dynamic Pricing Freeze Verification"
    else:
        raise ValueError(f"Unknown test number: {num}")


# ═══════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════

async def main(test_num: int = 0):
    from config import BASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY

    print(f"\n{Colors.BOLD}{'═' * 70}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}  RuStars Pentest Suite — Automated Security & Load Testing{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}  Target: {BASE_URL}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}  Supabase: {'✓ Configured' if SUPABASE_URL else '✗ Not configured (RLS tests limited)'}{Colors.RESET}")
    print(f"{Colors.BOLD}{Colors.CYAN}  Anon Key: {'✓ Present' if SUPABASE_ANON_KEY else '✗ Missing'}{Colors.RESET}")
    print(f"{Colors.BOLD}{'═' * 70}{Colors.RESET}")

    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        print(f"\n{Colors.YELLOW}  ⚠ WARNING: SUPABASE_URL and SUPABASE_ANON_KEY not set.{Colors.RESET}")
        print(f"  {Colors.YELLOW}  RLS tests (Test 4) will be limited. Set env vars for full coverage.{Colors.RESET}\n")

    start_time = time.monotonic()
    all_results = []

    if test_num > 0:
        # Run single test
        test_fn, test_name = load_test(test_num)
        print(f"\n{Colors.BOLD}Running Test {test_num}: {test_name}{Colors.RESET}")
        passed, total = await test_fn()
        all_results.append((test_num, test_name, passed, total))
    else:
        # Run all tests
        for num in range(1, 6):
            test_fn, test_name = load_test(num)
            try:
                passed, total = await test_fn()
                all_results.append((num, test_name, passed, total))
            except Exception as e:
                print(f"\n{Colors.RED}  ✗ Test {num} crashed: {e}{Colors.RESET}")
                all_results.append((num, test_name, 0, 1))

    elapsed = time.monotonic() - start_time

    # ═══ FINAL REPORT ═══
    print(f"\n{Colors.BOLD}{'═' * 70}{Colors.RESET}")
    print(f"{Colors.BOLD}  FINAL REPORT{Colors.RESET}")
    print(f"{Colors.BOLD}{'═' * 70}{Colors.RESET}")

    total_passed = 0
    total_all = 0

    for num, name, passed, total in all_results:
        color = Colors.GREEN if passed == total else Colors.RED
        status = "✓ PASS" if passed == total else "✗ FAIL"
        print(f"  {color}{status}{Colors.RESET}  Test {num}: {name} ({passed}/{total})")
        total_passed += passed
        total_all += total

    print(f"\n{Colors.BOLD}{'─' * 70}{Colors.RESET}")
    overall_color = Colors.GREEN if total_passed == total_all else Colors.RED
    print(f"  {overall_color}{Colors.BOLD}OVERALL: {total_passed}/{total_all} checks passed in {elapsed:.1f}s{Colors.RESET}")
    print(f"{Colors.BOLD}{'─' * 70}{Colors.RESET}\n")

    # Exit code
    sys.exit(0 if total_passed == total_all else 1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RuStars Pentest Suite")
    parser.add_argument("--test", "-t", type=int, default=0, help="Run specific test (1-5)")
    args = parser.parse_args()

    asyncio.run(main(args.test))
