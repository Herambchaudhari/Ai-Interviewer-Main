"""
checklist_service.py — generate a structured preparation checklist
from weak areas, the playbook's skills_to_work_on, and the 30-day plan.

Main export:
    generate_checklist(weak_areas, skills_to_work_on, thirty_day_plan, round_type) → list[ChecklistItem]
"""
from __future__ import annotations
import uuid
from datetime import date, timedelta


CATEGORY_COLORS = {
    "Concept Review":     "#7c3aed",
    "Practice":           "#06b6d4",
    "Mock Interview":     "#4ade80",
    "Resource":           "#f59e0b",
    "Weak Area Fix":      "#f87171",
    "Company Research":   "#a78bfa",
}

ROUND_CORE_TOPICS = {
    "dsa":           ["Arrays", "Strings", "DP", "Graphs", "Trees", "Binary Search"],
    "technical":     ["OOP", "SOLID Principles", "System Design Basics", "REST APIs", "Databases"],
    "hr":            ["STAR Method", "Conflict Resolution", "Leadership Stories", "Why this company"],
    "system_design": ["Load Balancing", "Caching", "DB Sharding", "CAP Theorem", "Microservices"],
    "mcq_practice":  ["Data Structures", "Algorithms", "OS Concepts", "Networking Basics"],
}


def _make_item(
    title: str,
    category: str,
    priority: str = "Medium",
    due_days: int = 7,
    details: str = "",
) -> dict:
    today = date.today()
    return {
        "id":         str(uuid.uuid4()),
        "title":      title,
        "category":   category,
        "priority":   priority,
        "due_date":   (today + timedelta(days=due_days)).isoformat(),
        "checked":    False,
        "details":    details,
    }


def generate_checklist(
    weak_areas: list[dict | str],
    skills_to_work_on: list[dict],
    thirty_day_plan: dict,
    round_type: str = "",
    target_company: str = "",
) -> list[dict]:
    """
    Produce a flat list of checklist items (≤ 20 items).

    Priority sources (in order):
    1. Critical weak areas from the report
    2. Top skills_to_work_on items
    3. Week-1 tasks from thirty_day_plan
    4. Round-type core topics (filler, max 3)
    5. Company research if target_company is set
    6. Mock interview reminder
    """
    items: list[dict] = []

    # 1. Weak areas (critical first)
    for wa in (weak_areas or [])[:6]:
        if isinstance(wa, dict):
            area  = wa.get("area", "")
            score = wa.get("score", 0)
            missed = wa.get("what_was_missed", "")
            priority = "High" if (score or 100) < 50 else "Medium"
        else:
            area, missed, priority = str(wa), "", "Medium"
        if not area:
            continue
        items.append(_make_item(
            title=f"Review: {area}",
            category="Weak Area Fix",
            priority=priority,
            due_days=3 if priority == "High" else 7,
            details=f"Missed: {missed}" if missed else "",
        ))

    # 2. Skills to work on from playbook
    for sk in (skills_to_work_on or [])[:4]:
        if not isinstance(sk, dict):
            continue
        skill = sk.get("skill", "")
        if not skill:
            continue
        resources = sk.get("resources", [])
        detail = f"Resource: {resources[0]}" if resources else ""
        items.append(_make_item(
            title=f"Practice: {skill}",
            category="Practice",
            priority=sk.get("priority", "Medium"),
            due_days=5,
            details=detail,
        ))

    # 3. Week-1 tasks from 30-day plan
    week1 = (thirty_day_plan or {}).get("week_1", [])
    for task in week1[:3]:
        if not isinstance(task, dict):
            continue
        topic = task.get("topic", "")
        t = task.get("task", "")
        resource = task.get("resource", "")
        if not topic:
            continue
        items.append(_make_item(
            title=f"Week 1: {topic}",
            category="Resource",
            priority="High",
            due_days=7,
            details=t or resource,
        ))

    # 4. Round-type core topics (filler, max 3)
    core = ROUND_CORE_TOPICS.get(round_type, [])
    covered = {i["title"].split(": ", 1)[-1].lower() for i in items}
    added_core = 0
    for topic in core:
        if added_core >= 3:
            break
        if topic.lower() in covered:
            continue
        items.append(_make_item(
            title=f"Concept Review: {topic}",
            category="Concept Review",
            priority="Low",
            due_days=10,
        ))
        added_core += 1

    # 5. Company research
    if target_company:
        items.append(_make_item(
            title=f"Research {target_company}: culture, recent news, interview format",
            category="Company Research",
            priority="Medium",
            due_days=5,
        ))

    # 6. Mock interview reminder
    items.append(_make_item(
        title="Complete 1 full timed mock interview",
        category="Mock Interview",
        priority="High",
        due_days=14,
        details="Use this platform — pick your weakest round type",
    ))

    # Deduplicate by title (case-insensitive) and cap at 20
    seen: set[str] = set()
    unique: list[dict] = []
    for item in items:
        key = item["title"].lower()
        if key not in seen:
            seen.add(key)
            unique.append(item)
        if len(unique) >= 20:
            break

    return unique
