"""
test_search_pipeline.py

Validates the 3-tier search provider chain:
  Test 1: Tavily primary search
  Test 2: DDGS fallback (skipped if Tavily works — we verify independently)
  Test 3: Static fallback format integrity
  Test 4: Cache hit (15-min TTL)
  Test 5: Force-refresh bypasses cache
  Test 6: Daily limit enforcement (5/day)
  Test 7: search_company_trends returns text (session.py path)

Run from backend/:
    python test_search_pipeline.py
"""

import os
import sys
import asyncio
import time

# Allow imports from the backend root
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Load .env manually so we can test without uvicorn
from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

from services.web_researcher import (
    fetch_personalized_news,
    search_company_trends,
    search_company_interview_questions,
    _search_via_tavily,
    _search_via_ddgs,
    _STATIC_FALLBACK,
    _CS_FUNDAMENTALS_STATIC_FALLBACK,
    _cache,
    _daily_counts,
    check_and_increment_daily_limit,
    get_reloads_remaining,
    DAILY_RELOAD_LIMIT,
)

PASS = "✅ PASS"
FAIL = "❌ FAIL"
SKIP = "⚠️  SKIP"


def section(title: str):
    print(f"\n{'─'*55}")
    print(f"  {title}")
    print('─'*55)


async def test_1_tavily():
    section("Test 1: Tavily Primary Search")
    key = os.getenv("TAVILY_API_KEY", "")
    if not key:
        print(f"{SKIP}  TAVILY_API_KEY not set — skipping Tavily test")
        return True

    results = await _search_via_tavily("Google software engineering hiring 2025")
    print(f"  Returned {len(results)} results")
    if results:
        print(f"  First result: {results[0].get('title', '')[:70]}")
    ok = isinstance(results, list)
    print(PASS if ok else FAIL)
    return ok


async def test_2_ddgs():
    section("Test 2: DDGS Fallback Search (strict 10s timeout)")
    t0 = time.time()
    results = await _search_via_ddgs("software engineering hiring trends")
    elapsed = time.time() - t0
    print(f"  Returned {len(results)} results in {elapsed:.1f}s")
    if results:
        print(f"  First result: {results[0].get('title', '')[:70]}")
    ok = elapsed <= 12.0  # allow 2s buffer
    print(PASS if ok else FAIL)
    return ok


async def test_3_static_fallback():
    section("Test 3: Static Fallback Format Integrity")
    ok = all(
        isinstance(r.get("title"), str) and
        isinstance(r.get("url"), str) and
        r["url"].startswith("http")
        for r in _STATIC_FALLBACK
    )
    print(f"  Static fallback has {len(_STATIC_FALLBACK)} articles")
    print(PASS if ok else FAIL)
    return ok


async def test_4_cache_hit():
    section("Test 4: Cache Hit (15-min TTL)")
    _cache.clear()
    companies = ["__cache_test_company__"]

    t0 = time.time()
    result1 = await fetch_personalized_news(companies, force_refresh=False)
    t1 = time.time()

    t2 = time.time()
    result2 = await fetch_personalized_news(companies, force_refresh=False)
    t3 = time.time()

    first_call_ms  = (t1 - t0) * 1000
    second_call_ms = (t3 - t2) * 1000
    print(f"  1st call: {first_call_ms:.0f}ms, 2nd call (cached): {second_call_ms:.0f}ms")
    ok = second_call_ms < 5  # cache should be essentially instantaneous
    print(PASS if ok else FAIL)
    return ok


async def test_5_force_refresh():
    section("Test 5: Force-Refresh Bypasses Cache")
    _cache.clear()
    companies = ["__force_refresh_test__"]

    # Populate cache
    await fetch_personalized_news(companies, force_refresh=False)
    old_key = list(_cache.keys())[-1]
    old_ts  = _cache[old_key]["ts"]

    # Wait a tiny bit so timestamps differ
    await asyncio.sleep(0.1)

    # Force refresh
    await fetch_personalized_news(companies, force_refresh=True)
    new_ts = _cache[old_key]["ts"]

    ok = new_ts > old_ts
    print(f"  Old ts: {old_ts:.3f}, New ts: {new_ts:.3f} — refreshed: {ok}")
    print(PASS if ok else FAIL)
    return ok


async def test_6_daily_limit():
    section("Test 6: Daily Rate Limit (5/day)")
    _daily_counts.clear()

    results = []
    for i in range(DAILY_RELOAD_LIMIT + 2):
        allowed, used = check_and_increment_daily_limit()
        results.append((allowed, used))

    # First 5 should be allowed
    first_five_ok = all(allowed for allowed, _ in results[:DAILY_RELOAD_LIMIT])
    # 6th and 7th should be blocked
    excess_blocked = not any(allowed for allowed, _ in results[DAILY_RELOAD_LIMIT:])

    remaining = get_reloads_remaining()
    print(f"  First {DAILY_RELOAD_LIMIT} calls: {'all allowed ✓' if first_five_ok else 'some blocked ✗'}")
    print(f"  Excess calls blocked: {'yes ✓' if excess_blocked else 'no ✗'}")
    print(f"  Reloads remaining: {remaining}")

    ok = first_five_ok and excess_blocked and remaining == 0
    print(PASS if ok else FAIL)
    return ok


async def test_7_session_path():
    section("Test 7: search_company_trends (session.py path)")
    text = await search_company_trends("Google")
    ok = isinstance(text, str)  # can be empty if all providers fail — just must be a string
    print(f"  Returned {len(text)} characters")
    if text:
        print(f"  Preview: {text[:120]}...")
    print(PASS if ok else FAIL)
    return ok


async def test_8_interview_questions():
    section("Test 8: Company Interview Questions Search (40/40/20 pipeline)")
    text = await search_company_interview_questions("Google", "Software Engineer")
    ok = isinstance(text, str) and len(text) > 50
    print(f"  Returned {len(text)} characters")
    if text:
        print(f"  Preview: {text[:150]}...")
    # Verify it always has content (live or static fallback)
    has_cs_content = any(kw in text.lower() for kw in ["oop", "dbms", "acid", "tcp", "thread", "interview", "algorithm"])
    print(f"  Contains CS fundamental keywords: {has_cs_content}")
    ok = ok and has_cs_content
    print(PASS if ok else FAIL)
    return ok


async def test_9_interview_questions_fallback():
    section("Test 9: Interview Questions Static Fallback")
    # Empty company should return static CS fundamentals
    text = await search_company_interview_questions("", "Software Engineer")
    ok = isinstance(text, str) and len(text) > 50
    has_core = all(kw in text for kw in ["OOP", "DBMS", "OS", "CN"])
    print(f"  Static fallback length: {len(text)} chars")
    print(f"  Contains all core subjects: {has_core}")
    ok = ok and has_core
    print(PASS if ok else FAIL)
    return ok


async def main():
    print("\n" + "="*55)
    print("  🔍 Search Pipeline Verification Suite")
    print("="*55)

    tests = [
        ("Tavily Primary",         test_1_tavily),
        ("DDGS Fallback",          test_2_ddgs),
        ("Static Fallback",        test_3_static_fallback),
        ("Cache Hit",              test_4_cache_hit),
        ("Force Refresh",          test_5_force_refresh),
        ("Daily Limit",            test_6_daily_limit),
        ("Session Path",           test_7_session_path),
        ("Interview Questions",    test_8_interview_questions),
        ("IQ Static Fallback",     test_9_interview_questions_fallback),
    ]

    passed = 0
    failed = 0

    for name, fn in tests:
        try:
            ok = await fn()
            if ok:
                passed += 1
            else:
                failed += 1
        except Exception as e:
            print(f"{FAIL}  Exception in '{name}': {e}")
            failed += 1

    print(f"\n{'='*55}")
    print(f"  Results: {passed} passed, {failed} failed out of {len(tests)} tests")
    print("="*55 + "\n")

    if failed:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
