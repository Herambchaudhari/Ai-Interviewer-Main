"""
benchmarking_service.py — peer-comparison and percentile computation.

compute_peer_comparison(user_score, radar_scores, benchmarks) → PeerComparison dict
"""
from __future__ import annotations
import statistics
from typing import Optional


def _percentile_rank(value: float, population: list[float]) -> float:
    """Return 0-100 percentile rank of value within population."""
    if not population:
        return 50.0
    below = sum(1 for v in population if v < value)
    return round((below / len(population)) * 100, 1)


def _grade_label(score: float) -> str:
    if score >= 90: return "S"
    if score >= 80: return "A"
    if score >= 70: return "B"
    if score >= 60: return "C"
    if score >= 50: return "D"
    return "F"


def compute_peer_comparison(
    user_overall: float,
    user_radar: dict,
    benchmarks: list[dict],
) -> dict:
    """
    Given the user's overall score, radar scores, and a list of benchmark rows,
    return a peer_comparison dict to embed in the report.

    Returns
    -------
    {
        "sample_size":          int,
        "overall_percentile":   float,           # 0-100
        "avg_peer_score":       float,
        "radar_comparison": [
            {
                "axis":           str,
                "user_score":     float,
                "peer_avg":       float,
                "percentile":     float,
                "delta":          float,          # user - peer_avg
            },
            ...
        ],
        "hire_rate":            float | None,    # % of peers recommended
        "grade_distribution": {                  # % share of each grade
            "S": float, "A": float, "B": float,
            "C": float, "D": float, "F": float,
        },
        "user_grade":           str,
        "insight":              str,             # one-sentence summary
    }
    """
    if not benchmarks:
        return _empty_comparison(user_overall, user_radar)

    overall_scores = [
        float(b["overall_score"])
        for b in benchmarks
        if b.get("overall_score") is not None
    ]
    if not overall_scores:
        return _empty_comparison(user_overall, user_radar)

    sample_size = len(overall_scores)
    overall_pct = _percentile_rank(user_overall, overall_scores)
    peer_avg    = round(statistics.mean(overall_scores), 1)

    # ── Radar comparison ─────────────────────────────────────────────────────
    radar_comparison: list[dict] = []
    if user_radar:
        # Collect per-axis lists from benchmark rows
        axis_data: dict[str, list[float]] = {}
        for b in benchmarks:
            rs = b.get("radar_scores") or {}
            if isinstance(rs, str):
                try:
                    import json
                    rs = json.loads(rs)
                except Exception:
                    rs = {}
            for axis, val in rs.items():
                try:
                    axis_data.setdefault(axis, []).append(float(val))
                except (TypeError, ValueError):
                    pass

        for axis, user_val in user_radar.items():
            try:
                user_f = float(user_val)
            except (TypeError, ValueError):
                continue
            peers = axis_data.get(axis, [])
            peer_axis_avg = round(statistics.mean(peers), 1) if peers else peer_avg
            axis_pct = _percentile_rank(user_f, peers) if peers else overall_pct
            radar_comparison.append({
                "axis":       axis,
                "user_score": round(user_f, 1),
                "peer_avg":   peer_axis_avg,
                "percentile": axis_pct,
                "delta":      round(user_f - peer_axis_avg, 1),
            })

    # ── Hire rate ────────────────────────────────────────────────────────────
    hire_count = sum(
        1 for b in benchmarks
        if str(b.get("hire_recommendation", "")).lower() in ("yes", "strong yes", "hire")
    )
    hire_rate = round((hire_count / sample_size) * 100, 1) if sample_size else None

    # ── Grade distribution ────────────────────────────────────────────────────
    grade_dist: dict[str, int] = {"S": 0, "A": 0, "B": 0, "C": 0, "D": 0, "F": 0}
    for s in overall_scores:
        g = _grade_label(s)
        grade_dist[g] = grade_dist.get(g, 0) + 1
    grade_pct = {g: round((n / sample_size) * 100, 1) for g, n in grade_dist.items()}

    # ── Insight sentence ──────────────────────────────────────────────────────
    user_grade = _grade_label(user_overall)
    if overall_pct >= 75:
        insight = f"You scored higher than {overall_pct:.0f}% of candidates in similar rounds — outstanding performance."
    elif overall_pct >= 50:
        insight = f"You're in the top half of candidates — {overall_pct:.0f}th percentile with room to push further."
    elif overall_pct >= 25:
        insight = f"You're below the median ({overall_pct:.0f}th percentile); focus on the weak axes in your radar."
    else:
        insight = f"You're in the bottom quartile ({overall_pct:.0f}th percentile) — targeted practice on each gap area is key."

    return {
        "sample_size":        sample_size,
        "overall_percentile": overall_pct,
        "avg_peer_score":     peer_avg,
        "radar_comparison":   radar_comparison,
        "hire_rate":          hire_rate,
        "grade_distribution": grade_pct,
        "user_grade":         user_grade,
        "insight":            insight,
    }


def _empty_comparison(user_overall: float, user_radar: dict) -> dict:
    return {
        "sample_size":        0,
        "overall_percentile": None,
        "avg_peer_score":     None,
        "radar_comparison":   [
            {"axis": k, "user_score": v, "peer_avg": None,
             "percentile": None, "delta": None}
            for k, v in (user_radar or {}).items()
        ],
        "hire_rate":          None,
        "grade_distribution": {},
        "user_grade":         _grade_label(user_overall),
        "insight":            "Not enough peer data yet to compute percentile — check back after more users complete this round.",
    }
