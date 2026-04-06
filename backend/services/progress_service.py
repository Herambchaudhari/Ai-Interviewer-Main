"""
progress_service.py — Per-user skill progression analytics.

Functions:
  - compute_skill_velocity()    Rate of change per skill over time
  - compute_progress_timeline() Ordered list of session scores for charting
  - compute_persistent_gaps()   Weak areas appearing in ≥N sessions
  - compute_strongest_skills()  Skills consistently ≥ threshold across sessions
"""
from __future__ import annotations

import json
from collections import defaultdict
from typing import Any


# ── Helpers ───────────────────────────────────────────────────────────────────

def _safe_radar(radar_scores) -> dict[str, float]:
    if isinstance(radar_scores, dict):
        return {k: float(v) for k, v in radar_scores.items() if isinstance(v, (int, float))}
    if isinstance(radar_scores, str):
        try:
            return json.loads(radar_scores)
        except Exception:
            return {}
    return {}


def _safe_list(val) -> list:
    if isinstance(val, list):
        return val
    if isinstance(val, str):
        try:
            return json.loads(val)
        except Exception:
            return []
    return []


def _extract_weak_names(weak_areas) -> list[str]:
    areas = _safe_list(weak_areas)
    result = []
    for item in areas:
        if isinstance(item, dict):
            name = item.get("area") or item.get("topic") or ""
            if name:
                result.append(name.strip().lower())
        elif isinstance(item, str):
            result.append(item.strip().lower())
    return result


def _session_date(report: dict) -> str:
    """Return ISO date string (YYYY-MM-DD) from a report row."""
    return (report.get("created_at") or report.get("session_date") or "")[:10]


# ── Skill Velocity ────────────────────────────────────────────────────────────

def compute_skill_velocity(
    past_reports: list[dict],
    window: int = 5,
) -> list[dict[str, Any]]:
    """
    Compute the rate-of-change (velocity) for each radar skill over the most
    recent `window` sessions.

    Args:
        past_reports: Report dicts ordered oldest → newest.
                      Each must have `radar_scores` and `created_at`.
        window:       Number of most-recent sessions to calculate velocity over.

    Returns:
        List of dicts sorted by abs(velocity) descending:
        [
          {
            "skill":       str,
            "velocity":    float,   # points per session, positive = improving
            "direction":   "up" | "down" | "stable",
            "first_score": float,
            "last_score":  float,
            "data_points": int,
          }, ...
        ]
    """
    if not past_reports:
        return []

    # Collect all (date, skill, score) tuples
    skill_history: dict[str, list[tuple[str, float]]] = defaultdict(list)
    for report in past_reports:
        radar = _safe_radar(report.get("radar_scores"))
        date = _session_date(report)
        for skill, score in radar.items():
            skill_history[skill].append((date, score))

    results = []
    for skill, entries in skill_history.items():
        # Already ordered oldest→newest since past_reports are in that order
        recent = entries[-window:]
        if len(recent) < 2:
            continue

        scores = [s for _, s in recent]
        first = scores[0]
        last = scores[-1]
        n = len(scores)

        # Linear regression slope as velocity (points per session)
        x_mean = (n - 1) / 2
        y_mean = sum(scores) / n
        numerator   = sum((i - x_mean) * (scores[i] - y_mean) for i in range(n))
        denominator = sum((i - x_mean) ** 2 for i in range(n))
        velocity = round(numerator / denominator, 2) if denominator else 0.0

        if velocity >= 1.5:
            direction = "up"
        elif velocity <= -1.5:
            direction = "down"
        else:
            direction = "stable"

        results.append({
            "skill":       skill,
            "velocity":    velocity,
            "direction":   direction,
            "first_score": round(first, 1),
            "last_score":  round(last, 1),
            "data_points": n,
        })

    results.sort(key=lambda x: abs(x["velocity"]), reverse=True)
    return results


# ── Progress Timeline ─────────────────────────────────────────────────────────

def compute_progress_timeline(
    past_reports: list[dict],
) -> list[dict[str, Any]]:
    """
    Build an ordered timeline of sessions suitable for a line/area chart.

    Args:
        past_reports: Report dicts ordered oldest → newest.

    Returns:
        [
          {
            "session_id":    str,
            "date":          str,       # YYYY-MM-DD
            "round_type":    str,
            "overall_score": float,
            "grade":         str,
            "hire_recommendation": str,
          }, ...
        ]
    """
    timeline = []
    for report in past_reports:
        score = report.get("overall_score")
        if score is None:
            continue
        timeline.append({
            "session_id":         report.get("session_id") or "",
            "date":               _session_date(report),
            "round_type":         report.get("round_type") or "technical",
            "overall_score":      round(float(score), 1),
            "grade":              report.get("grade") or "",
            "hire_recommendation": report.get("hire_recommendation") or "",
        })
    return timeline


# ── Persistent Gaps ───────────────────────────────────────────────────────────

def compute_persistent_gaps(
    past_reports: list[dict],
    min_occurrences: int = 3,
) -> list[dict[str, Any]]:
    """
    Identify weak areas that appear across ≥ min_occurrences distinct sessions.

    Args:
        past_reports:    Report dicts ordered oldest → newest.
        min_occurrences: Minimum number of sessions the area must appear in.

    Returns:
        [
          {
            "area":               str,
            "occurrences":        int,
            "first_seen":         str,   # YYYY-MM-DD
            "last_seen":          str,   # YYYY-MM-DD
            "severity":           "critical" | "high" | "medium",
            "improvement_trend":  "improving" | "worsening" | "stuck",
            "avg_score":          float | None,
          }, ...
        ]
        Sorted by occurrences descending.
    """
    # area_key → list of {date, score} appearances
    area_appearances: dict[str, list[dict]] = defaultdict(list)

    for report in past_reports:
        date = _session_date(report)
        weak_areas = _safe_list(report.get("weak_areas"))
        for item in weak_areas:
            if isinstance(item, dict):
                name = (item.get("area") or item.get("topic") or "").strip()
                score = item.get("score")
            elif isinstance(item, str):
                name = item.strip()
                score = None
            else:
                continue
            if not name:
                continue
            key = name.lower()
            area_appearances[key].append({"date": date, "name": name, "score": score})

    results = []
    for key, appearances in area_appearances.items():
        # De-dup per session date
        seen_dates: set[str] = set()
        unique = []
        for app in appearances:
            if app["date"] not in seen_dates:
                seen_dates.add(app["date"])
                unique.append(app)

        if len(unique) < min_occurrences:
            continue

        unique_sorted = sorted(unique, key=lambda x: x["date"])
        first_seen = unique_sorted[0]["date"]
        last_seen  = unique_sorted[-1]["date"]
        count      = len(unique_sorted)

        severity = "critical" if count >= 5 else "high" if count >= 4 else "medium"

        # Score trend
        scores = [u["score"] for u in unique_sorted if u["score"] is not None]
        avg_score = round(sum(scores) / len(scores), 1) if scores else None
        if len(scores) >= 2:
            trend_delta = scores[-1] - scores[0]
            improvement_trend = "improving" if trend_delta >= 5 else "worsening" if trend_delta <= -5 else "stuck"
        else:
            improvement_trend = "stuck"

        results.append({
            "area":              unique_sorted[0]["name"].title(),
            "occurrences":       count,
            "first_seen":        first_seen,
            "last_seen":         last_seen,
            "severity":          severity,
            "improvement_trend": improvement_trend,
            "avg_score":         avg_score,
        })

    results.sort(key=lambda x: x["occurrences"], reverse=True)
    return results[:10]


# ── Strongest Skills ──────────────────────────────────────────────────────────

def compute_strongest_skills(
    past_reports: list[dict],
    threshold: float = 70.0,
    min_sessions: int = 2,
) -> list[dict[str, Any]]:
    """
    Find radar skills that are consistently above `threshold` across sessions.

    Args:
        past_reports:  Report dicts ordered oldest → newest.
        threshold:     Minimum average score to qualify as strong (0-100).
        min_sessions:  Minimum number of sessions the skill must appear in.

    Returns:
        [
          {
            "skill":          str,
            "avg_score":      float,
            "peak_score":     float,
            "consistency":    float,   # % of sessions above threshold
            "trend":          "up" | "down" | "stable",
            "sessions_count": int,
          }, ...
        ]
        Sorted by avg_score descending.
    """
    skill_history: dict[str, list[float]] = defaultdict(list)
    for report in past_reports:
        radar = _safe_radar(report.get("radar_scores"))
        for skill, score in radar.items():
            skill_history[skill].append(score)

    results = []
    for skill, scores in skill_history.items():
        if len(scores) < min_sessions:
            continue

        avg   = round(sum(scores) / len(scores), 1)
        peak  = round(max(scores), 1)
        above = sum(1 for s in scores if s >= threshold)
        consistency = round((above / len(scores)) * 100, 1)

        if avg < threshold:
            continue

        # Trend from last 3 scores
        last3 = scores[-3:]
        if len(last3) >= 2:
            delta = last3[-1] - last3[0]
            trend = "up" if delta >= 3 else "down" if delta <= -3 else "stable"
        else:
            trend = "stable"

        results.append({
            "skill":          skill,
            "avg_score":      avg,
            "peak_score":     peak,
            "consistency":    consistency,
            "trend":          trend,
            "sessions_count": len(scores),
        })

    results.sort(key=lambda x: x["avg_score"], reverse=True)
    return results[:8]


# ── Top-Level Aggregator ──────────────────────────────────────────────────────

def compute_all_progress(
    past_reports: list[dict],
    velocity_window: int = 5,
    gap_min_occurrences: int = 3,
    strength_threshold: float = 70.0,
) -> dict[str, Any]:
    """
    Run all progress analytics and return a combined dict.

    Args:
        past_reports:        From db_service.get_past_reports_for_analysis(),
                             ordered oldest → newest.
        velocity_window:     Number of recent sessions for velocity calc.
        gap_min_occurrences: Minimum sessions for a gap to be 'persistent'.
        strength_threshold:  Avg score floor for strongest skills.

    Returns:
        {
            "skill_velocity":    [...],
            "progress_timeline": [...],
            "persistent_gaps":   [...],
            "strongest_skills":  [...],
            "session_count":     int,
        }
    """
    return {
        "skill_velocity":    compute_skill_velocity(past_reports, window=velocity_window),
        "progress_timeline": compute_progress_timeline(past_reports),
        "persistent_gaps":   compute_persistent_gaps(past_reports, min_occurrences=gap_min_occurrences),
        "strongest_skills":  compute_strongest_skills(past_reports, threshold=strength_threshold),
        "session_count":     len(past_reports),
    }
