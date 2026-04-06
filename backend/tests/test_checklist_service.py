"""Tests for checklist_service.generate_checklist."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from services.checklist_service import generate_checklist


def test_empty_inputs_returns_mock_interview_item():
    items = generate_checklist([], [], {})
    titles = [i["title"] for i in items]
    assert any("mock" in t.lower() for t in titles)


def test_weak_areas_become_checklist_items():
    items = generate_checklist(
        weak_areas=[
            {"area": "Dynamic Programming", "score": 30, "what_was_missed": "memoization"},
            {"area": "System Design", "score": 45},
        ],
        skills_to_work_on=[],
        thirty_day_plan={},
    )
    titles = [i["title"] for i in items]
    assert any("Dynamic Programming" in t for t in titles)
    assert any("System Design" in t for t in titles)


def test_high_priority_weak_area_due_soon():
    items = generate_checklist(
        weak_areas=[{"area": "Graphs", "score": 25}],
        skills_to_work_on=[],
        thirty_day_plan={},
    )
    graphs = [i for i in items if "Graphs" in i["title"]][0]
    assert graphs["priority"] == "High"


def test_company_research_added_when_target_set():
    items = generate_checklist([], [], {}, target_company="Google")
    titles = [i["title"] for i in items]
    assert any("Google" in t for t in titles)


def test_max_20_items():
    weak_areas = [{"area": f"Topic {i}", "score": i * 5} for i in range(20)]
    items = generate_checklist(weak_areas, [], {})
    assert len(items) <= 20


def test_no_duplicate_titles():
    items = generate_checklist(
        weak_areas=[{"area": "Arrays"}, {"area": "Arrays"}],
        skills_to_work_on=[],
        thirty_day_plan={},
    )
    titles = [i["title"].lower() for i in items]
    assert len(titles) == len(set(titles))


def test_all_items_have_required_fields():
    items = generate_checklist(
        weak_areas=[{"area": "OOP"}],
        skills_to_work_on=[{"skill": "System Design", "priority": "High", "resources": ["MIT OCW"]}],
        thirty_day_plan={"week_1": [{"topic": "OS Concepts", "task": "Read OSTEP", "resource": "OSTEP book", "hours": 4}]},
    )
    required = {"id", "title", "category", "priority", "due_date", "checked"}
    for item in items:
        assert required.issubset(item.keys()), f"Missing fields in {item}"


def test_progress_service_import():
    """Smoke test — progress_service imports cleanly."""
    from services.progress_service import compute_all_progress
    assert callable(compute_all_progress)
