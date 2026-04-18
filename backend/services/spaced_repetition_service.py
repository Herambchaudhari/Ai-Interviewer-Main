"""
spaced_repetition_service.py — SM-2–inspired adaptive study schedule.

Given the user's weak areas, past performance, and target interview date,
generates a day-by-day review schedule with spaced intervals.

Main export:
    build_study_schedule(weak_areas, past_reports, target_date_iso, round_type) → StudySchedule
"""
from __future__ import annotations
import math
from datetime import date, timedelta
from typing import Optional


# ── SM-2 constants ──────────────────────────────────────────────────────────
_MIN_EF   = 1.3   # minimum easiness factor
_INIT_EF  = 2.5   # default easiness factor
_INIT_I   = 1     # first interval in days


def _easiness(score: float) -> float:
    """Map a 0–100 score to SM-2 easiness factor (1.3–3.0)."""
    normalised = max(0.0, min(1.0, score / 100.0))
    return round(_MIN_EF + (_INIT_EF - _MIN_EF) * normalised, 2)


def _next_intervals(ef: float, repetitions: int = 3) -> list[int]:
    """Return first `repetitions` review intervals (days) for a given EF."""
    intervals = [_INIT_I, 6]
    for _ in range(repetitions - 2):
        intervals.append(round(intervals[-1] * ef))
    return intervals[:repetitions]


def _topic_score(topic: str, past_reports: list[dict]) -> Optional[float]:
    """
    Find the most recent score for a topic across past reports.
    Returns None if not found.
    """
    for report in reversed(past_reports):
        # Check radar_scores dict
        radar = report.get("radar_scores") or {}
        for k, v in radar.items():
            if k.lower() == topic.lower():
                try:
                    return float(v)
                except (TypeError, ValueError):
                    pass
        # Check weak_areas
        for wa in (report.get("weak_areas") or []):
            if isinstance(wa, dict) and wa.get("area", "").lower() == topic.lower():
                try:
                    return float(wa.get("score", 0))
                except (TypeError, ValueError):
                    return 30.0
    return None


def _priority_rank(score: Optional[float]) -> int:
    """Lower score → higher priority number."""
    if score is None:      return 2   # unknown → medium
    if score < 40:        return 1   # critical
    if score < 60:        return 2   # high
    if score < 75:        return 3   # medium
    return 4                          # low — still schedule, but less frequent


def build_study_schedule(
    weak_areas: list[dict | str],
    past_reports: list[dict],
    target_date_iso: str = "",
    round_type: str = "",
    today_iso: str = "",
) -> dict:
    """
    Build an SM-2–inspired study schedule for the candidate's weak areas.

    Parameters
    ----------
    weak_areas       : list of weak area dicts (or strings) from the report
    past_reports     : list of past report dicts (from db_service)
    target_date_iso  : ISO date string for the target interview (optional)
    round_type       : e.g. "technical", "dsa"
    today_iso        : override today's date (for testing)

    Returns
    -------
    {
        "topics": [
            {
                "topic":      str,
                "score":      float | None,
                "priority":   "Critical"|"High"|"Medium"|"Low",
                "ef":         float,
                "reviews": [
                    {"day": int, "date": "YYYY-MM-DD", "session_type": "Initial"|"Review 1"|...},
                    ...
                ],
                "total_sessions": int,
            },
            ...
        ],
        "daily_plan": {
            "YYYY-MM-DD": ["<topic>", ...],
            ...
        },
        "days_until_target":  int | None,
        "schedule_horizon":   int,   # days covered
    }
    """
    today = date.fromisoformat(today_iso) if today_iso else date.today()

    # ── Parse weak areas ─────────────────────────────────────────────────────
    topics_raw: list[str] = []
    for wa in (weak_areas or []):
        if isinstance(wa, dict):
            t = wa.get("area") or wa.get("skill") or wa.get("topic")
        else:
            t = str(wa)
        if t:
            topics_raw.append(t.strip())

    # Deduplicate while preserving order
    seen: set[str] = set()
    topics: list[str] = []
    for t in topics_raw:
        if t.lower() not in seen:
            seen.add(t.lower())
            topics.append(t)

    if not topics:
        return {
            "topics":            [],
            "daily_plan":        {},
            "days_until_target": None,
            "schedule_horizon":  0,
        }

    # ── Days until target interview ───────────────────────────────────────────
    days_until_target: Optional[int] = None
    if target_date_iso:
        try:
            target_date = date.fromisoformat(target_date_iso)
            days_until_target = max(0, (target_date - today).days)
        except ValueError:
            pass

    # Use a 30-day horizon if no target set, else clamp to target + 7
    horizon = min(
        (days_until_target + 7) if days_until_target is not None else 30,
        60,
    )

    # ── Build per-topic SM-2 schedule ─────────────────────────────────────────
    PRIORITY_LABELS = {1: "Critical", 2: "High", 3: "Medium", 4: "Low"}
    NUM_REVIEWS = 4  # initial + 3 spaced reviews

    topic_data: list[dict] = []
    daily_plan: dict[str, list[str]] = {}

    for idx, topic in enumerate(topics):
        score = _topic_score(topic, past_reports)
        ef = _easiness(score if score is not None else 40.0)
        priority = _priority_rank(score)

        # Stagger initial study day: priority 1 → day 0, priority 2 → day 1, etc.
        initial_offset = idx  # spread topics one day apart to avoid overload
        intervals = _next_intervals(ef, repetitions=NUM_REVIEWS)

        reviews: list[dict] = []
        session_labels = ["Initial Study", "Review 1", "Review 2", "Review 3"]
        current_day = initial_offset
        for rep_i, (label, interval) in enumerate(zip(session_labels, [0] + intervals[:-1])):
            if rep_i > 0:
                current_day += intervals[rep_i - 1]
            if current_day > horizon:
                break
            review_date = today + timedelta(days=current_day)
            date_str = review_date.isoformat()
            reviews.append({
                "day":          current_day,
                "date":         date_str,
                "session_type": label,
            })
            daily_plan.setdefault(date_str, [])
            if topic not in daily_plan[date_str]:
                daily_plan[date_str].append(topic)

        topic_data.append({
            "topic":          topic,
            "score":          score,
            "priority":       PRIORITY_LABELS[priority],
            "ef":             ef,
            "reviews":        reviews,
            "total_sessions": len(reviews),
        })

    # Sort topics by priority (Critical first)
    topic_data.sort(key=lambda t: list(PRIORITY_LABELS.values()).index(t["priority"]))

    return {
        "topics":            topic_data,
        "daily_plan":        dict(sorted(daily_plan.items())),
        "days_until_target": days_until_target,
        "schedule_horizon":  horizon,
    }
