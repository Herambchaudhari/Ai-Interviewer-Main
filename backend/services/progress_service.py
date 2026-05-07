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


# ── Before / After Radar ──────────────────────────────────────────────────────

def compute_before_after_radar(past_reports: list[dict]) -> dict[str, Any] | None:
    """
    Average radar scores for the first 3 sessions vs the last 3 sessions.
    Returns None when fewer than 2 sessions are available.
    """
    if len(past_reports) < 2:
        return None

    window = min(3, len(past_reports) // 2 or 1)
    early  = past_reports[:window]
    recent = past_reports[-window:]

    def _avg_radar(reports: list[dict]) -> dict[str, float]:
        skill_totals: dict[str, list[float]] = defaultdict(list)
        for r in reports:
            for skill, val in _safe_radar(r.get("radar_scores")).items():
                skill_totals[skill].append(val)
        return {
            skill: round(sum(vals) / len(vals), 1)
            for skill, vals in skill_totals.items()
        }

    before = _avg_radar(early)
    after  = _avg_radar(recent)

    # Only keep dimensions present in both
    dimensions = sorted(set(before) & set(after))
    if not dimensions:
        return None

    delta_avg = round(
        sum(after[d] - before[d] for d in dimensions) / len(dimensions), 1
    )

    return {
        "before":     {d: before[d] for d in dimensions},
        "after":      {d: after[d]  for d in dimensions},
        "dimensions": dimensions,
        "delta_avg":  delta_avg,
        "sessions_compared": window,
    }


# ── Per-Round Timeline ────────────────────────────────────────────────────────

def compute_round_timeline(past_reports: list[dict]) -> dict[str, list[dict]]:
    """
    Group session scores by round_type for a multi-line chart.
    Only includes round types with ≥ 2 data points.
    """
    tracks: dict[str, list[dict]] = defaultdict(list)
    for r in past_reports:
        score = r.get("overall_score")
        if score is None:
            continue
        rt   = r.get("round_type") or "technical"
        date = _session_date(r)
        tracks[rt].append({"date": date, "score": round(float(score), 1)})

    return {rt: pts for rt, pts in tracks.items() if len(pts) >= 2}


# ── Readiness Projection ──────────────────────────────────────────────────────

def compute_readiness_projection(
    past_reports: list[dict],
    target_score: float = 80.0,
    max_forward: int = 10,
) -> dict[str, Any] | None:
    """
    Extrapolate future scores using linear regression on overall_score history.
    Returns None when fewer than 3 sessions are available.
    """
    scores = [
        round(float(r["overall_score"]), 1)
        for r in past_reports
        if r.get("overall_score") is not None
    ]
    if len(scores) < 3:
        return None

    n      = len(scores)
    x_mean = (n - 1) / 2.0
    y_mean = sum(scores) / n
    numer  = sum((i - x_mean) * (scores[i] - y_mean) for i in range(n))
    denom  = sum((i - x_mean) ** 2 for i in range(n))
    slope  = round(numer / denom, 3) if denom else 0.0

    current_avg = round(y_mean, 1)
    last_score  = scores[-1]

    # Already at or above target
    if last_score >= target_score:
        return {
            "on_track":        True,
            "already_at_target": True,
            "sessions_needed": 0,
            "current_avg":     current_avg,
            "last_score":      last_score,
            "target":          target_score,
            "slope":           slope,
            "projected_points": [],
        }

    # Negative or flat slope — can't project forward usefully
    if slope <= 0:
        return {
            "on_track":        False,
            "already_at_target": False,
            "sessions_needed": None,
            "current_avg":     current_avg,
            "last_score":      last_score,
            "target":          target_score,
            "slope":           slope,
            "projected_points": [],
        }

    # Project forward
    projected_points = []
    sessions_needed  = None
    for i in range(1, max_forward + 1):
        projected = round(min(100.0, last_score + slope * i), 1)
        projected_points.append({"session_offset": i, "score": projected})
        if sessions_needed is None and projected >= target_score:
            sessions_needed = i

    return {
        "on_track":          True,
        "already_at_target": False,
        "sessions_needed":   sessions_needed,
        "current_avg":       current_avg,
        "last_score":        last_score,
        "target":            target_score,
        "slope":             slope,
        "projected_points":  projected_points,
    }


# ── Achievements ──────────────────────────────────────────────────────────────

def compute_achievements(past_reports: list[dict]) -> list[dict[str, Any]]:
    """
    Scan the session timeline for milestone events.
    Always returns all 8 achievements; unearned ones have earned=False.
    """
    scores     = [r.get("overall_score") for r in past_reports if r.get("overall_score") is not None]
    round_types = [r.get("round_type") or "technical" for r in past_reports]
    dates      = [_session_date(r) for r in past_reports]
    weak_sets  = [set(_extract_weak_names(r.get("weak_areas"))) for r in past_reports]

    def _date_of_score(threshold: float) -> str | None:
        for i, s in enumerate(scores):
            if s >= threshold:
                return dates[i] if i < len(dates) else None
        return None

    # ── first_70 / first_80 / first_90 ───────────────────────────────────────
    first_70_date = _date_of_score(70)
    first_80_date = _date_of_score(80)
    first_90_date = _date_of_score(90)

    # ── five_streak: 5 consecutive sessions ≥ 65 ─────────────────────────────
    five_streak_date = None
    streak_count = 0
    for i, s in enumerate(scores):
        if s >= 65:
            streak_count += 1
            if streak_count >= 5:
                five_streak_date = dates[i] if i < len(dates) else None
                break
        else:
            streak_count = 0

    # ── gap_conquered: a weak area in first half not appearing in second half ─
    gap_conquered_date = None
    if len(weak_sets) >= 4:
        mid          = len(weak_sets) // 2
        early_gaps   = set.union(*weak_sets[:mid]) if weak_sets[:mid] else set()
        late_gaps    = set.union(*weak_sets[mid:]) if weak_sets[mid:] else set()
        conquered    = early_gaps - late_gaps
        if conquered:
            gap_conquered_date = dates[-1] if dates else None

    # ── consistent_performer: last 5 sessions all ≥ 70 ───────────────────────
    consistent_date = None
    if len(scores) >= 5 and all(s >= 70 for s in scores[-5:]):
        consistent_date = dates[-1] if dates else None

    # ── all_rounder: ≥1 session each of technical + hr + dsa ─────────────────
    all_rounder_date = None
    rt_set = set(r.lower() for r in round_types)
    if {"technical", "hr", "dsa"}.issubset(rt_set):
        all_rounder_date = dates[-1] if dates else None

    # ── ten_sessions: completed 10 sessions ──────────────────────────────────
    ten_sessions_date = dates[9] if len(dates) >= 10 else None

    def _badge(id_, label, desc, earned_date):
        return {
            "id":          id_,
            "label":       label,
            "description": desc,
            "earned":      earned_date is not None,
            "earned_date": earned_date,
        }

    return [
        _badge("first_70",    "Cleared 70",          "Scored 70+ in a session",             first_70_date),
        _badge("first_80",    "Cleared 80",          "Scored 80+ in a session",             first_80_date),
        _badge("first_90",    "Top Performer",       "Scored 90+ in a session",             first_90_date),
        _badge("five_streak", "On a Roll",           "5 consecutive sessions scoring 65+",  five_streak_date),
        _badge("gap_conquered","Gap Slayer",          "Resolved a persistent weak area",     gap_conquered_date),
        _badge("consistent",  "Consistent Performer","Last 5 sessions all scored 70+",      consistent_date),
        _badge("all_rounder", "All-Rounder",         "Completed Technical, HR & DSA rounds",all_rounder_date),
        _badge("ten_sessions","10 Sessions",         "Completed 10 interview sessions",     ten_sessions_date),
    ]


# ── Top-Level Aggregator ──────────────────────────────────────────────────────

def compute_all_progress(
    past_reports: list[dict],
    velocity_window: int = 5,
    gap_min_occurrences: int = 3,
    strength_threshold: float = 70.0,
) -> dict[str, Any]:
    return {
        "skill_velocity":      compute_skill_velocity(past_reports, window=velocity_window),
        "progress_timeline":   compute_progress_timeline(past_reports),
        "round_timeline":      compute_round_timeline(past_reports),
        "before_after_radar":  compute_before_after_radar(past_reports),
        "readiness_projection":compute_readiness_projection(past_reports),
        "achievements":        compute_achievements(past_reports),
        "persistent_gaps":     compute_persistent_gaps(past_reports, min_occurrences=gap_min_occurrences),
        "strongest_skills":    compute_strongest_skills(past_reports, threshold=strength_threshold),
        "session_count":       len(past_reports),
    }
