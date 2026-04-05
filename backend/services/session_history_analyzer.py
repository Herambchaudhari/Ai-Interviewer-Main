"""
session_history_analyzer.py — Cross-session intelligence.

Analyzes a user's historical report data to produce:
  - skill_decay:        Skills that have dropped since the previous session
  - repeated_offenders: Issues that appear across multiple sessions (≥2)
  - growth_trajectory:  Score trend, direction, prediction, milestones
"""
import json
from typing import Any, Optional


# ── Helpers ───────────────────────────────────────────────────────────────────

def _safe_list(val) -> list:
    if isinstance(val, list):
        return val
    if isinstance(val, str):
        try:
            return json.loads(val)
        except Exception:
            return []
    return []


def _extract_weak_area_names(weak_areas) -> list[str]:
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


def _extract_radar(radar_scores) -> dict[str, float]:
    if isinstance(radar_scores, dict):
        return {k: float(v) for k, v in radar_scores.items() if isinstance(v, (int, float))}
    if isinstance(radar_scores, str):
        try:
            return json.loads(radar_scores)
        except Exception:
            return {}
    return {}


# ── Skill Decay ───────────────────────────────────────────────────────────────

def compute_skill_decay(
    current_radar: dict[str, float],
    past_reports: list[dict],
) -> list[dict[str, Any]]:
    """
    Compare current radar scores to the most recent prior session's radar scores.
    Returns list of skills that dropped by ≥ 8 points.

    Args:
        current_radar:  {"Skill Name": score, ...} for the current report
        past_reports:   list of report dicts from get_past_reports_for_analysis(),
                        ordered oldest → newest (most recent is last)
    """
    if not past_reports or not current_radar:
        return []

    # Use the most recent past report's radar
    prior_radar = {}
    for report in reversed(past_reports):
        r = _extract_radar(report.get("radar_scores"))
        if r:
            prior_radar = r
            break

    if not prior_radar:
        return []

    decay = []
    for skill, current_score in current_radar.items():
        prior_score = prior_radar.get(skill)
        if prior_score is None:
            continue
        delta = round(current_score - prior_score, 1)
        if delta <= -8:
            severity = "critical" if delta <= -15 else "warning"
            decay.append({
                "skill":        skill,
                "prev_score":   prior_score,
                "curr_score":   current_score,
                "delta":        delta,
                "severity":     severity,
                "alert_msg":    (
                    f"{skill} dropped {abs(delta)} points since last session. "
                    "You may have skipped practice in this area."
                ),
            })

    # Sort by biggest drop first
    decay.sort(key=lambda x: x["delta"])
    return decay


# ── Repeated Offenders ────────────────────────────────────────────────────────

def compute_repeated_offenders(
    current_weak_areas: list,
    past_reports: list[dict],
    min_occurrences: int = 2,
) -> list[dict[str, Any]]:
    """
    Find issues that appear in the current session AND in ≥ min_occurrences prior sessions.

    Args:
        current_weak_areas: weak_areas list from the current report
        past_reports:       past report dicts with weak_areas field
        min_occurrences:    minimum total appearances to flag as repeated offender

    Returns list of {issue, count_across_sessions, first_seen, last_seen, severity}
    """
    # Aggregate all weak area names across history (including current)
    all_sessions_weak: list[list[str]] = []

    # Past sessions first
    for report in past_reports:
        names = _extract_weak_area_names(report.get("weak_areas"))
        if names:
            all_sessions_weak.append({
                "areas": names,
                "date": (report.get("created_at") or "")[:10],
            })

    # Current session last
    current_names = _extract_weak_area_names(current_weak_areas)
    current_date = ""  # will be filled by caller if needed
    if current_names:
        all_sessions_weak.append({"areas": current_names, "date": current_date})

    if not all_sessions_weak:
        return []

    # Count occurrences across sessions (one count per session, not per mention)
    issue_data: dict[str, dict] = {}
    for session_entry in all_sessions_weak:
        seen_in_session = set()
        for area in session_entry["areas"]:
            key = area.lower().strip()
            if key in seen_in_session:
                continue
            seen_in_session.add(key)
            if key not in issue_data:
                issue_data[key] = {
                    "issue":      area.title(),
                    "count":      0,
                    "dates":      [],
                }
            issue_data[key]["count"] += 1
            if session_entry["date"]:
                issue_data[key]["dates"].append(session_entry["date"])

    # Filter to repeated ones that also appear in current session
    current_names_lower = {n.lower() for n in current_names}
    offenders = []
    for key, data in issue_data.items():
        if data["count"] < min_occurrences:
            continue
        if key not in current_names_lower:
            continue  # only flag if it's still present NOW

        dates_sorted = sorted(data["dates"])
        severity = "critical" if data["count"] >= 4 else "high" if data["count"] >= 3 else "medium"

        offenders.append({
            "issue":                data["issue"],
            "count_across_sessions": data["count"],
            "first_seen":           dates_sorted[0] if dates_sorted else "",
            "last_seen":            dates_sorted[-1] if dates_sorted else "",
            "severity":             severity,
            "alert_msg": (
                f"'{data['issue']}' has appeared as a weakness in {data['count']} sessions. "
                "This is a recurring gap — prioritise fixing it."
            ),
        })

    # Sort by count descending
    offenders.sort(key=lambda x: x["count_across_sessions"], reverse=True)
    return offenders[:8]  # cap at 8


# ── Growth Trajectory ─────────────────────────────────────────────────────────

def compute_growth_trajectory(
    past_reports: list[dict],
    current_score: float,
    target_score: float = 80.0,
) -> dict[str, Any]:
    """
    Compute score trend, direction, and prediction.

    Args:
        past_reports:  ordered oldest → newest
        current_score: score of the current report (0-100)
        target_score:  user's target (default 80)

    Returns growth_trajectory dict.
    """
    # Collect scores in chronological order
    scores = []
    for report in past_reports:
        s = report.get("overall_score")
        if s is not None:
            scores.append(float(s))
    scores.append(current_score)

    # Last 10 for trend
    last_10 = scores[-10:]
    n = len(last_10)

    if n < 2:
        return {
            "last_10_scores":       last_10,
            "trend_direction":      "insufficient_data",
            "weekly_gain_avg":      0,
            "predicted_next_score": current_score,
            "sessions_to_target":   None,
            "milestone_reached":    None,
        }

    # Simple linear trend: compare first half vs second half averages
    half = max(1, n // 2)
    first_half_avg = sum(last_10[:half]) / half
    second_half_avg = sum(last_10[half:]) / max(1, n - half)
    trend_delta = second_half_avg - first_half_avg

    if trend_delta >= 3:
        direction = "improving"
    elif trend_delta <= -3:
        direction = "declining"
    else:
        direction = "plateau"

    # Average gain per session (last 5)
    last_5 = scores[-5:]
    if len(last_5) >= 2:
        session_gains = [last_5[i] - last_5[i - 1] for i in range(1, len(last_5))]
        avg_gain = round(sum(session_gains) / len(session_gains), 1)
    else:
        avg_gain = 0

    # Predicted next score
    predicted = round(min(100, current_score + max(avg_gain, 0)), 1)

    # Sessions to target
    sessions_to_target = None
    if avg_gain > 0 and current_score < target_score:
        sessions_to_target = max(1, round((target_score - current_score) / avg_gain))

    # Milestone detection
    milestone = None
    prev_scores = scores[:-1]
    if prev_scores:
        prev_max = max(prev_scores)
        if current_score > prev_max:
            milestone = f"New personal best! {current_score:.0f} beats previous best of {prev_max:.0f}"
    if not milestone:
        for threshold in [50, 60, 70, 75, 80, 85, 90]:
            if current_score >= threshold and (not prev_scores or max(prev_scores) < threshold):
                milestone = f"First time crossing {threshold}!"
                break

    return {
        "last_10_scores":       last_10,
        "trend_direction":      direction,
        "weekly_gain_avg":      avg_gain,
        "predicted_next_score": predicted,
        "sessions_to_target":   sessions_to_target,
        "milestone_reached":    milestone,
    }


# ── Top-Level Analyzer ────────────────────────────────────────────────────────

def analyze_cross_session(
    current_score: float,
    current_radar: dict[str, float],
    current_weak_areas: list,
    past_reports: list[dict],
    target_score: float = 80.0,
) -> dict[str, Any]:
    """
    Run all three cross-session analyses and return combined result.

    Args:
        current_score:      overall_score of the current report (0-100)
        current_radar:      radar_scores dict of the current report
        current_weak_areas: weak_areas list of the current report
        past_reports:       from db_service.get_past_reports_for_analysis()
        target_score:       user's target score for trajectory prediction

    Returns:
        {
            skill_decay:         [...],
            repeated_offenders:  [...],
            growth_trajectory:   {...},
        }
    """
    skill_decay = compute_skill_decay(current_radar, past_reports)
    repeated_offenders = compute_repeated_offenders(current_weak_areas, past_reports)
    growth_trajectory = compute_growth_trajectory(past_reports, current_score, target_score)

    return {
        "skill_decay":        skill_decay,
        "repeated_offenders": repeated_offenders,
        "growth_trajectory":  growth_trajectory,
    }
