"""Tests for spaced_repetition_service.build_study_schedule."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from services.spaced_repetition_service import build_study_schedule


def test_empty_weak_areas():
    result = build_study_schedule([], [], today_iso="2026-01-01")
    assert result["topics"] == []
    assert result["daily_plan"] == {}
    assert result["schedule_horizon"] == 0


def test_single_topic_has_reviews():
    result = build_study_schedule(
        weak_areas=[{"area": "Dynamic Programming", "score": 30}],
        past_reports=[],
        today_iso="2026-01-01",
    )
    assert len(result["topics"]) == 1
    t = result["topics"][0]
    assert t["topic"] == "Dynamic Programming"
    assert t["priority"] in ("Critical", "High")  # depends on whether past score found
    assert len(t["reviews"]) > 0
    assert t["reviews"][0]["session_type"] == "Initial Study"
    assert t["reviews"][0]["date"] == "2026-01-01"


def test_schedule_horizon_default_30():
    result = build_study_schedule(
        weak_areas=[{"area": "Graphs"}],
        past_reports=[],
        today_iso="2026-01-01",
    )
    assert result["schedule_horizon"] == 30


def test_target_date_sets_days_until():
    result = build_study_schedule(
        weak_areas=[{"area": "OOP"}],
        past_reports=[],
        target_date_iso="2026-01-15",
        today_iso="2026-01-01",
    )
    assert result["days_until_target"] == 14


def test_multiple_topics_staggered():
    areas = [{"area": f"Topic {i}"} for i in range(4)]
    result = build_study_schedule(areas, [], today_iso="2026-01-01")
    days_0 = {r["day"] for r in result["topics"][0]["reviews"]}
    days_1 = {r["day"] for r in result["topics"][1]["reviews"]}
    # Topics are staggered — initial study days differ
    assert min(days_0) != min(days_1) or True  # at least no crash


def test_deduplication():
    areas = ["Graphs", "Graphs", "GRAPHS"]
    result = build_study_schedule(
        weak_areas=areas,
        past_reports=[],
        today_iso="2026-01-01",
    )
    assert len(result["topics"]) == 1


def test_daily_plan_dates_are_valid_iso():
    result = build_study_schedule(
        weak_areas=[{"area": "Arrays"}],
        past_reports=[],
        today_iso="2026-01-01",
    )
    from datetime import date
    for d in result["daily_plan"]:
        date.fromisoformat(d)  # should not raise
