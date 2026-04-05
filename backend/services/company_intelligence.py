"""
company_intelligence.py — Calibrates candidate performance against a real
company's hiring bar.

Two-part pipeline:
  Part A: Web Research — DuckDuckGo/Tavily search for company interview bar
  Part B: Groq Analysis — maps candidate scores to company requirements

Returns a `company_fit` dict that is stored in the reports table.
"""
import json
import os
import asyncio
from typing import Any, Optional

from services.web_researcher import _fetch_with_fallback
from services.groq_service import _achat, _clean


# ── Known hiring bar anchors (static seed data for common companies) ──────────
# Scores are on 0-100 scale. These are supplemented by live web research.
_COMPANY_BARS: dict[str, dict] = {
    "google":    {"bar_score": 78, "focus": ["System Design", "Algorithms", "Data-Driven Reasoning"], "culture": "Data Driven, Collaborative, Scale"},
    "amazon":    {"bar_score": 75, "focus": ["Leadership Principles", "System Design", "DSA"], "culture": "Customer Obsession, Ownership, LP stories"},
    "microsoft": {"bar_score": 72, "focus": ["System Design", "OOP", "Behavioral"], "culture": "Growth Mindset, Collaboration, Inclusion"},
    "meta":      {"bar_score": 78, "focus": ["Algorithms", "System Design", "Product Sense"], "culture": "Move Fast, Impact-driven, Data informed"},
    "apple":     {"bar_score": 75, "focus": ["OOP", "System Design", "Attention to Detail"], "culture": "Quality, Privacy, Innovation"},
    "netflix":   {"bar_score": 80, "focus": ["System Design", "Distributed Systems", "Culture Fit"], "culture": "Freedom & Responsibility, Context not Control"},
    "stripe":    {"bar_score": 80, "focus": ["System Design", "APIs", "CS Fundamentals"], "culture": "Craft, Rigor, Impact"},
    "uber":      {"bar_score": 73, "focus": ["System Design", "DSA", "Scalability"], "culture": "Customer Obsession, Efficiency"},
    "airbnb":    {"bar_score": 73, "focus": ["System Design", "OOP", "Product Thinking"], "culture": "Champion the Mission, Belong Anywhere"},
    "flipkart":  {"bar_score": 68, "focus": ["DSA", "System Design", "OOP"], "culture": "Customer First, Ownership"},
    "infosys":   {"bar_score": 58, "focus": ["OOP", "DBMS", "Aptitude"], "culture": "Client Value, Leadership, Integrity"},
    "tcs":       {"bar_score": 55, "focus": ["OOP", "SQL", "Aptitude", "Communication"], "culture": "Agile, Diverse, Responsible"},
    "wipro":     {"bar_score": 57, "focus": ["OOP", "SQL", "Reasoning"], "culture": "Client Centricity, Integrity"},
    "goldman sachs": {"bar_score": 77, "focus": ["DSA", "CS Fundamentals", "Problem Solving"], "culture": "Excellence, Integrity, Partnership"},
    "morgan stanley": {"bar_score": 75, "focus": ["DSA", "OOP", "System Design"], "culture": "Commitment, Integrity, Excellence"},
    "default":   {"bar_score": 70, "focus": ["DSA", "System Design", "Communication"], "culture": "Varies by company"},
}


def _normalize_company(company: str) -> str:
    return company.lower().strip()


def _get_bar(company: str) -> dict:
    key = _normalize_company(company)
    for k, v in _COMPANY_BARS.items():
        if k in key or key in k:
            return v
    return _COMPANY_BARS["default"]


async def _research_company_interview_bar(company: str, job_role: str) -> str:
    """
    Fetch live interview prep context for the company via web search.
    Returns a compact text snippet for the Groq prompt.
    """
    queries = [
        f"{company} {job_role} interview process technical bar 2025",
        f"{company} software engineering interview questions frequently asked",
    ]
    snippets = []
    for query in queries:
        try:
            results = await _fetch_with_fallback(query)
            for r in results[:2]:
                body = r.get("body", "")
                if body:
                    snippets.append(f"- {r.get('title', '')}: {body[:300]}")
        except Exception:
            pass
        if len(snippets) >= 3:
            break

    return "\n".join(snippets[:4]) if snippets else ""


async def analyze_company_fit(
    candidate_score: float,          # 0-100
    round_type: str,
    radar_scores: dict,               # {"Skill": score, ...}
    weak_areas: list,                 # [{"area": ..., "score": ...}]
    strong_areas: list,
    target_company: str,
    job_role: str = "Software Engineer",
    transcript_summary: str = "",
) -> dict[str, Any]:
    """
    Analyze how well the candidate performs against the target company's hiring bar.

    Returns company_fit dict:
    {
        target_company, target_role, bar_score_required, your_score,
        pass_probability, gap_to_clear, gap_breakdown,
        culture_gaps, next_round_vulnerabilities, company_specific_prep
    }
    """
    if not target_company:
        return {}

    bar_data = _get_bar(target_company)
    bar_score = bar_data["bar_score"]
    focus_areas = bar_data["focus"]
    culture_notes = bar_data["culture"]

    # Fetch live interview context
    live_context = await _research_company_interview_bar(target_company, job_role)

    # Build gap breakdown from radar scores vs. estimated required scores
    gap_breakdown = []
    for skill, your_score in radar_scores.items():
        # Estimate required based on focus areas
        is_focus = any(f.lower() in skill.lower() or skill.lower() in f.lower() for f in focus_areas)
        required = bar_score + 5 if is_focus else bar_score - 5
        delta = round(your_score - required, 1)
        if delta < -5:  # Only report meaningful gaps
            gap_breakdown.append({
                "dimension": skill,
                "required": required,
                "yours": your_score,
                "delta": delta,
                "is_focus_area": is_focus,
            })

    # Sort by biggest gap first
    gap_breakdown.sort(key=lambda x: x["delta"])

    # Simple pass probability formula
    # Base: linear interpolation between 0% at bar-20 and 90% at bar+10
    gap = candidate_score - bar_score
    if gap >= 10:
        pass_prob = 85
    elif gap >= 5:
        pass_prob = 70
    elif gap >= 0:
        pass_prob = 50
    elif gap >= -5:
        pass_prob = 30
    elif gap >= -10:
        pass_prob = 15
    else:
        pass_prob = 5

    # Build prompt for Groq to generate culture_gaps + next_round_vulnerabilities
    weak_summary = "; ".join(
        f"{w.get('area')} (score: {w.get('score', '?')})"
        for w in (weak_areas or [])[:5]
        if isinstance(w, dict)
    )
    strong_summary = "; ".join(
        s.get("area", "") for s in (strong_areas or [])[:3]
        if isinstance(s, dict)
    )

    prompt = f"""You are a senior recruiter at {target_company} calibrating a candidate's interview performance.

CANDIDATE SUMMARY
- Round type: {round_type.upper()}
- Overall score: {candidate_score}/100
- Strong areas: {strong_summary or "None identified"}
- Weak areas: {weak_summary or "None identified"}
- Applying for: {job_role}

{target_company.upper()} HIRING CONTEXT
- Bar score required: {bar_score}/100
- Company culture: {culture_notes}
- Focus areas: {", ".join(focus_areas)}
- Live research: {live_context[:600] if live_context else "Not available"}

TASK:
Based on the candidate's performance and {target_company}'s known interview style, generate:

1. culture_gaps: List 2-3 specific ways their answers misaligned with {target_company}'s culture/values.
   Example: "Did not provide data-backed metrics (Amazon values: Data-Driven Decision Making)"

2. next_round_vulnerabilities: List 2-3 things a human {target_company} interviewer would probe further.
   Be specific to the weak areas shown.
   Example: "Your CAP Theorem answer was vague — expect a deep-dive on Consistency vs Availability trade-offs in next round"

3. company_specific_prep: List 2-3 concrete things to study/practice before interviewing at {target_company}.

Return ONLY valid JSON:
{{
  "culture_gaps": ["gap 1", "gap 2"],
  "next_round_vulnerabilities": ["vulnerability 1", "vulnerability 2"],
  "company_specific_prep": ["prep item 1", "prep item 2"]
}}"""

    groq_result = {}
    try:
        content = await _achat([{"role": "user", "content": prompt}], temperature=0.3, max_tokens=1000)
        groq_result = json.loads(_clean(content))
    except Exception as e:
        print(f"[company_intelligence] Groq analysis failed: {e}")
        groq_result = {
            "culture_gaps": [f"Align answers with {target_company}'s core values: {culture_notes}"],
            "next_round_vulnerabilities": [f"Weak areas ({weak_summary}) will be probed further"],
            "company_specific_prep": [f"Study {', '.join(focus_areas[:2])} thoroughly"],
        }

    return {
        "target_company":           target_company,
        "target_role":              job_role,
        "bar_score_required":       bar_score,
        "your_score":               candidate_score,
        "pass_probability":         pass_prob,
        "gap_to_clear":             max(0, bar_score - candidate_score),
        "gap_breakdown":            gap_breakdown[:5],
        "culture_gaps":             groq_result.get("culture_gaps", []),
        "next_round_vulnerabilities": groq_result.get("next_round_vulnerabilities", []),
        "company_specific_prep":    groq_result.get("company_specific_prep", []),
        "live_context_available":   bool(live_context),
    }
