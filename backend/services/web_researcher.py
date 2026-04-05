"""
services/web_researcher.py

Resilient 3-tier search pipeline:
  1. Tavily (primary)  — AI-native, fast, LLM-ready results
  2. DuckDuckGo (fallback) — hardened with strict timeouts
  3. Static response (last resort) — always succeeds

Also includes:
  - In-memory TTL cache (15-minute freshness)
  - Per-day reload counter (max 5 per day, enforced server-side)
  - Jina Reader for URL scraping
"""

import os
import asyncio
import hashlib
import json
import time
import httpx
from datetime import datetime, timezone
from typing import Dict, Optional

# ── TTL Cache & Daily Rate Limiter ─────────────────────────────────────────────
_cache: dict = {}          # key → {"data": ..., "ts": float}
_CACHE_TTL   = 60 * 15     # 15 minutes

# Daily limit tracker: { "YYYY-MM-DD" → count }
_daily_counts: dict = {}
DAILY_RELOAD_LIMIT = 5

TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")
TAVILY_ENDPOINT = "https://api.tavily.com/search"


def _today_utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _cache_key(items: list) -> str:
    raw = json.dumps(sorted(items or []), separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _get_cached(key: str) -> Optional[list]:
    entry = _cache.get(key)
    if entry and (time.time() - entry["ts"]) < _CACHE_TTL:
        return entry["data"]
    return None


def _set_cached(key: str, data: list):
    _cache[key] = {"data": data, "ts": time.time()}


def check_and_increment_daily_limit() -> tuple[bool, int]:
    """
    Returns (is_allowed, reloads_used_today).
    Increments the counter if allowed.
    """
    today = _today_utc()
    # Reset counter for new day
    if today not in _daily_counts:
        _daily_counts.clear()
        _daily_counts[today] = 0

    used = _daily_counts[today]
    if used >= DAILY_RELOAD_LIMIT:
        return False, used

    _daily_counts[today] += 1
    return True, _daily_counts[today]


def get_reloads_remaining() -> int:
    today = _today_utc()
    used = _daily_counts.get(today, 0)
    return max(0, DAILY_RELOAD_LIMIT - used)


# ── Static Fallback ─────────────────────────────────────────────────────────────
_STATIC_FALLBACK = [
    {
        "title": "Tech Layoffs 2025: Which Companies Are Still Hiring?",
        "url": "https://techcrunch.com/tag/layoffs/",
        "source": "TechCrunch",
        "body": "Despite high-profile layoffs, engineering roles in AI, backend, and cloud infrastructure remain strong.",
    },
    {
        "title": "Software Engineering Salaries & Hiring Trends 2025",
        "url": "https://levels.fyi/blog/",
        "source": "Levels.fyi",
        "body": "Demand for engineers specializing in distributed systems and ML infrastructure is outpacing supply.",
    },
    {
        "title": "What Engineers Should Know About the Current Job Market",
        "url": "https://www.linkedin.com/pulse/topics/engineering-s166/",
        "source": "LinkedIn",
        "body": "Companies are increasingly favouring engineers with strong DSA foundations and system design experience.",
    },
]


# ── Provider 1: Tavily ──────────────────────────────────────────────────────────
async def _search_via_tavily(query: str) -> list:
    """Call Tavily's search API — async native, 10s timeout."""
    if not TAVILY_API_KEY:
        return []

    payload = {
        "api_key": TAVILY_API_KEY,
        "query": query,
        "search_depth": "basic",
        "max_results": 6,
        "topic": "news",
        "include_answer": False,
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(TAVILY_ENDPOINT, json=payload)
            resp.raise_for_status()
            results = resp.json().get("results", [])
            # Normalise to a common schema
            return [
                {
                    "title":  r.get("title", ""),
                    "url":    r.get("url", ""),
                    "source": r.get("url", "").split("/")[2].replace("www.", "") if r.get("url") else "",
                    "body":   r.get("content", "")[:400],
                }
                for r in results
                if r.get("title") and r.get("url")
            ]
    except Exception as e:
        print(f"[web_researcher] Tavily failed for '{query}': {e}")
        return []


# ── Provider 2: DuckDuckGo (hardened) ─────────────────────────────────────────
def _ddgs_news_sync(query: str) -> list:
    """Synchronous DDGS call — run in a thread pool."""
    try:
        try:
            from ddgs import DDGS  # new package name (pip install ddgs)
        except ImportError:
            from duckduckgo_search import DDGS  # legacy fallback
        with DDGS(timeout=8) as ddgs:
            results = list(ddgs.news(query, max_results=6))
        return [
            {
                "title":  r.get("title", ""),
                "url":    r.get("url", ""),
                "source": r.get("source", ""),
                "body":   r.get("body", "")[:400],
            }
            for r in results
            if r.get("title") and r.get("url")
        ]
    except Exception as e:
        print(f"[web_researcher] DDGS news failed for '{query}': {e}")
        return []


async def _search_via_ddgs(query: str) -> list:
    """Run hardened DDGS with a 10s asyncio-level timeout."""
    loop = asyncio.get_running_loop()
    try:
        return await asyncio.wait_for(
            loop.run_in_executor(None, _ddgs_news_sync, query),
            timeout=10.0,
        )
    except asyncio.TimeoutError:
        print(f"[web_researcher] DDGS timed out for '{query}'")
        return []


# ── Smart Query Builder ────────────────────────────────────────────────────────
def _build_queries(company: str) -> list[str]:
    """Return 3 queries from specific → broad → generic."""
    return [
        f"{company} software engineering hiring 2025",
        f"{company} tech layoffs OR hiring news",
        "software engineering tech hiring trends 2025",
    ]


# ── 3-Tier Provider Chain ──────────────────────────────────────────────────────
async def _fetch_with_fallback(query: str) -> list:
    """Try Tavily → DDGS → static fallback, returning the first non-empty result."""
    # Tier 1: Tavily
    results = await _search_via_tavily(query)
    if results:
        print(f"[web_researcher] Tavily returned {len(results)} results for '{query}'")
        return results

    # Tier 2: DDGS
    results = await _search_via_ddgs(query)
    if results:
        print(f"[web_researcher] DDGS returned {len(results)} results for '{query}'")
        return results

    # Tier 3: Static fallback
    print(f"[web_researcher] All providers failed for '{query}' — using static fallback")
    return _STATIC_FALLBACK


# ── Public API: Dashboard News Feed ───────────────────────────────────────────
async def fetch_personalized_news(companies: list, force_refresh: bool = False) -> list:
    """
    Fetch news for target companies using the 3-tier provider chain.
    - Caches results for 15 minutes per company set.
    - Tries progressively broader queries if results are sparse.
    """
    key = _cache_key(companies)

    if not force_refresh:
        cached = _get_cached(key)
        if cached is not None:
            print(f"[web_researcher] Cache hit for key={key}")
            return cached

    # Build the primary query
    if companies:
        primary_company = companies[0]
        queries = _build_queries(primary_company)
    else:
        queries = ["software engineering tech hiring trends 2025"]

    results = []
    for query in queries:
        results = await _fetch_with_fallback(query)
        if len(results) >= 2:
            break  # enough good results

    if not results:
        results = _STATIC_FALLBACK

    _set_cached(key, results)
    return results


# ── Public API: Session Start Market Trends ────────────────────────────────────
async def search_company_trends(company_name: str) -> str:
    """
    Called during session start to provide market context for question generation.
    Returns a formatted text string (not structured JSON).
    Uses the same 3-tier pipeline.
    """
    if not company_name:
        return ""

    queries = _build_queries(company_name)
    results = []

    for query in queries:
        results = await _fetch_with_fallback(query)
        if len(results) >= 2:
            break

    if not results:
        return ""

    snippets = [
        f"- Headline: {r.get('title')}\n  Snippet: {r.get('body', '')}"
        for r in results[:3]
    ]
    return "\n".join(snippets)


# ── URL Scraper (Jina Reader) ──────────────────────────────────────────────────
async def scrape_links(links_dict: Dict[str, str]) -> Dict[str, str]:
    """
    Asynchronously scrape multiple URLs via Jina Reader.
    Enforces a strict 5.0s timeout and truncates text to ~1500 chars.
    """
    results = {}

    async def fetch_url(key: str, url: str):
        if not url or not isinstance(url, str) or not url.startswith("http"):
            return key, ""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.get(f"https://r.jina.ai/{url}")
                res.raise_for_status()
                return key, res.text[:1500]
        except Exception as e:
            print(f"[web_researcher] Failed to scrape {key} ({url}): {e}")
            return key, ""

    tasks = [fetch_url(k, v) for k, v in links_dict.items()]
    if not tasks:
        return results

    responses = await asyncio.gather(*tasks)
    for key, content in responses:
        if content:
            results[key] = content

    return results
