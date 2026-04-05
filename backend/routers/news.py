from fastapi import APIRouter, HTTPException, Query
import json
from services.db_service import get_profile
from services.web_researcher import (
    fetch_personalized_news,
    check_and_increment_daily_limit,
    get_reloads_remaining,
    DAILY_RELOAD_LIMIT,
)
from services.groq_service import synthesize_market_trends

router = APIRouter()


@router.get("/feed")
async def get_market_news(
    profile_id:    str  = Query(...,      description="The ID of the profile"),
    force_refresh: bool = Query(False,    description="Bypass the 15-min cache and fetch fresh news"),
):
    if not profile_id or profile_id == "null":
        return {"success": True, "data": None, "error": None}

    try:
        profile = get_profile(profile_id)
        if not profile:
            raise HTTPException(status_code=404, detail="Profile not found")

        student_meta = profile.get("student_meta") or {}
        if isinstance(student_meta, str):
            try:
                student_meta = json.loads(student_meta)
            except Exception:
                student_meta = {}

        target_companies = student_meta.get("target_companies", [])

        # ── Daily rate-limit check ─────────────────────────────────────────
        # Only consume a credit if the user explicitly forces a refresh.
        # Automatic loads (on page visit) skip the limit check.
        reloads_remaining = get_reloads_remaining()
        actually_forced   = False

        if force_refresh:
            allowed, used_today = check_and_increment_daily_limit()
            if not allowed:
                # Return a graceful "limit reached" response instead of erroring
                return {
                    "success": True,
                    "data": {
                        "insight": (
                            "You've used all 5 daily market intelligence refreshes. "
                            "Your feed will auto-refresh tomorrow. "
                            "Use your prep time wisely — review yesterday's insights!"
                        ),
                        "trend_label":     "Daily Limit Reached",
                        "trend_type":      "warning",
                        "articles":        [],
                        "reloads_remaining": 0,
                        "daily_limit":       DAILY_RELOAD_LIMIT,
                    },
                    "error": None,
                }
            actually_forced   = True
            reloads_remaining = get_reloads_remaining()

        # ── Fetch news ─────────────────────────────────────────────────────
        raw_news         = await fetch_personalized_news(target_companies, force_refresh=actually_forced)
        final_intelligence = await synthesize_market_trends(target_companies, raw_news)

        # Attach limit metadata so the frontend can show the counter
        final_intelligence["reloads_remaining"] = reloads_remaining
        final_intelligence["daily_limit"]       = DAILY_RELOAD_LIMIT

        return {"success": True, "data": final_intelligence, "error": None}

    except HTTPException:
        raise
    except Exception as e:
        print(f"[get_market_news] Failed: {e}")
        return {
            "success": True,
            "data": {
                "insight":           "Unable to fetch live market news at this moment.",
                "trend_label":       "System Offline",
                "trend_type":        "neutral",
                "articles":          [],
                "reloads_remaining": get_reloads_remaining(),
                "daily_limit":       DAILY_RELOAD_LIMIT,
            },
            "error": None,
        }
