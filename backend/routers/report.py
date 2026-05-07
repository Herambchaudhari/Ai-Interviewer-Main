"""
Report router — 4-stage Ultra-Report with SSE progress streaming.

GET  /api/v1/report/:session_id         → generate + cache + SSE stream
GET  /api/v1/report/:session_id/cached  → return cached report only (no generation)

4-Stage Pipeline:
  Stage 1: Core Analysis           (grade, radar, strong/weak, per-question, hire_signal)
  Stage 2: CV Audit                (honesty check, 4-week roadmap)
  Stage 3: Communication Analysis  (6-axis, BS detector, root cause, blind spots)
  Stage 4: Playbook & Resources    (SWOT, 30-day plan, follow-up Qs, next blueprint)

Stages 1+2 run in parallel. Stages 3+4 run in parallel after 1+2 complete.
Company Fit + Cross-Session analyses run concurrently with stages 1+2.
"""
import os
import json
import asyncio
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, StreamingResponse
from auth import get_current_user

_DEBUG = os.getenv("DEBUG", "").lower() in ("1", "true", "yes")
from services.groq_service import _achat, _clean, _gen_core, _gen_cv_audit, _gen_code_quality_analysis
from services.db_service import (
    get_session, get_report, save_report, get_profile,
    compute_improvement_vs_last, get_past_reports_for_analysis, update_session,
    save_benchmark, save_checklist, get_benchmarks,
    get_audio_signed_url,
    mark_report_complete, mark_report_persist_failed, mark_report_degraded,
)
from services.benchmarking_service import compute_peer_comparison
from services.spaced_repetition_service import build_study_schedule
from services.checklist_service import generate_checklist
from services.code_runner import analyze_code_quality, aggregate_code_quality
from services.company_intelligence import analyze_company_fit
from services.session_history_analyzer import analyze_cross_session
from services.voice_analyzer import analyze_session_voice
from prompts.stage3_prompt import build_communication_analysis_prompt
from prompts.stage4_prompt import build_playbook_prompt
from prompts.report_prompt import _RADAR_AXES

router = APIRouter()


def _mask_uncovered_radar_axes(
    radar_scores: dict, question_scores: list, radar_skills: list
) -> dict:
    """
    Zero out radar axes that have no matching questions in the transcript.
    The LLM fills all axes regardless — this masks axes for topics not actually covered.
    Uses broad keyword matching so "NurseConnect Authentication" matches "Project Knowledge".
    HR rounds are excluded — their axes are always fully covered by behavioral questions.
    """
    import re

    def _words(s: str) -> set:
        return set(re.sub(r"[^a-z0-9 ]", " ", s.lower()).split())

    _AXIS_KEYWORDS: dict[str, set] = {
        "oop & design patterns":            {"oop", "design", "pattern", "solid", "inherit",
                                             "polymorphism", "class", "object", "encapsul"},
        "data structures & algorithms":     {"dsa", "algorithm", "array", "tree", "graph",
                                             "sort", "search", "dynamic", "complexity", "hash"},
        "dbms & sql":                       {"dbms", "sql", "database", "query", "normaliz",
                                             "acid", "index", "transaction", "join", "schema"},
        "os & cn concepts":                 {"os", "cn", "process", "thread", "network", "tcp",
                                             "http", "dns", "socket", "memory", "deadlock", "osi"},
        "project knowledge":                {"project", "authentication", "auth", "api", "react",
                                             "node", "flask", "django", "mern", "implementation",
                                             "architecture", "feature", "build", "develop"},
        "communication":                    {"communication", "clarity", "delivery", "structure"},
    }

    # Collect all question categories/topics asked this session
    asked_words: set = set()
    for q in question_scores:
        cat = (q.get("category") or q.get("topic") or "").lower()
        asked_words |= _words(cat)

    result: dict = {}
    for skill in radar_skills:
        keywords = _AXIS_KEYWORDS.get(skill.lower(), _words(skill))
        covered = bool(keywords & asked_words)
        result[skill] = radar_scores.get(skill, 0) if covered else 0
    return result

def _compute_hire_confidence(overall_pct: float, question_scores: list) -> str:
    """
    Deterministic confidence level for the HR executive summary.
    High confidence = strong score + low variance across answers.
    Low confidence = inconsistent signals or borderline score.
    """
    scored = [
        q["score"] for q in question_scores
        if q.get("score") is not None and not q.get("skipped")
    ]
    if len(scored) < 2:
        return "Low"
    mean = sum(scored) / len(scored)
    variance = sum((s - mean) ** 2 for s in scored) / len(scored)
    if overall_pct >= 75 and variance < 4:
        return "High"
    elif overall_pct >= 55 and variance < 9:
        return "Medium"
    return "Low"


_ROUND_AGENT_LABELS = {
    "technical":    "Technical",
    "hr":           "HR",
    "dsa":          "DSA",
    "mcq_practice": "MCQ Practice",
    "system_design": "Legacy System Design",
}


def _compute_peer_benchmarking(
    overall_score: float,
    radar_scores: dict,
    round_type: str,
) -> dict:
    """
    Compute simulated peer benchmarking for HR rounds.
    Uses a logistic-curve approximation: scores cluster around 60-70 in practice.
    Returns percentile, per-axis percentile approximation, and cohort context.
    """
    import math

    def _score_to_percentile(score: float) -> int:
        # Logistic approximation: mean=65, std≈12
        # P(X < score) approximated with sigmoid scaled to 0-100
        z = (score - 65) / 12
        pct = 1 / (1 + math.exp(-z * 1.7)) * 100
        return max(1, min(99, round(pct)))

    overall_pct = _score_to_percentile(overall_score)  # already 0-100

    axis_percentiles: dict = {}
    for axis, val in (radar_scores or {}).items():
        axis_percentiles[axis] = _score_to_percentile(val)

    # Determine label
    if overall_pct >= 90:
        label = "Top 10%"
    elif overall_pct >= 75:
        label = "Top 25%"
    elif overall_pct >= 50:
        label = "Top 50%"
    elif overall_pct >= 25:
        label = "Bottom 50%"
    else:
        label = "Bottom 25%"

    # Score vs. average (avg overall is ~65, on 0-100 scale)
    score_vs_avg = round(overall_score - 65, 1)

    return {
        "overall_percentile": overall_pct,
        "percentile_label": label,
        "score_vs_avg": score_vs_avg,
        "axis_percentiles": axis_percentiles,
        "cohort_context": f"Compared to candidates in {round_type.upper()} interview sessions at similar difficulty level",
    }


def _enforce_grade_consistency(payload: dict, overall_pct: float) -> dict:
    """
    Override the LLM-generated grade and hire_recommendation with deterministic
    values derived from overall_pct so they never contradict the numeric score.
    """
    if overall_pct >= 90:      grade = "A+"
    elif overall_pct >= 85:    grade = "A"
    elif overall_pct >= 78:    grade = "B+"
    elif overall_pct >= 70:    grade = "B"
    elif overall_pct >= 62:    grade = "B-"
    elif overall_pct >= 55:    grade = "C+"
    elif overall_pct >= 48:    grade = "C"
    else:                      grade = "D"

    if overall_pct >= 85:      hire_rec = "Strong Yes"
    elif overall_pct >= 70:    hire_rec = "Yes"
    elif overall_pct >= 55:    hire_rec = "Maybe"
    else:                      hire_rec = "No"

    payload["grade"]               = grade
    payload["hire_recommendation"] = hire_rec
    return payload


import re as _re

_BLOOMS_PATTERNS = [
    (6, "Create",     r"\b(design|build|create|propose|architect|invent|devise|formulate)\b"),
    (5, "Evaluate",   r"\b(evaluate|assess|justify|critique|argue|compare and contrast|defend|rank)\b"),
    (4, "Analyze",    r"\b(analyz|differentiat|compar|distinguish|examin|why|how does|break down)\b"),
    (3, "Apply",      r"\b(implement|use|solve|demonstrat|calculat|show|apply|write|code)\b"),
    (2, "Understand", r"\b(explain|describ|summariz|paraphras|classif|interpret|illustrat)\b"),
    (1, "Remember",   r"\b(what is|defin|list|name|identif|recall|state|tell me)\b"),
]

def _classify_blooms(question_text: str) -> dict:
    """Classify a question into Bloom's Taxonomy level 1-6 by keyword matching."""
    q_lower = question_text.lower()
    for level, label, pattern in _BLOOMS_PATTERNS:
        if _re.search(pattern, q_lower):
            return {"level": level, "label": label}
    return {"level": 3, "label": "Apply"}   # sensible default for most technical Qs


def _build_hiring_summary(
    overall_pct: float,
    grade: str,
    hire_recommendation: str,
    strong_areas: list,
    weak_areas: list,
    interview_integrity: dict | None,
    summary: str,
    hire_confidence: str,
) -> dict:
    """
    Compact summary card for hiring teams — computed deterministically, no LLM.
    """
    if overall_pct >= 85:      verdict = "STRONG HIRE"
    elif overall_pct >= 70:    verdict = "HIRE"
    elif overall_pct >= 55:    verdict = "HOLD"
    else:                      verdict = "REJECT"

    risk = (interview_integrity or {}).get("risk_level", "Low")

    def _area_label(a) -> str:
        if isinstance(a, dict):
            return a.get("area", "")
        return str(a)

    return {
        "overall_score":       round(overall_pct),
        "grade":               grade,
        "hire_recommendation": hire_recommendation,
        "hire_verdict":        verdict,
        "hire_confidence":     hire_confidence,
        "top_strengths":       [_area_label(s) for s in (strong_areas or [])[:3]],
        "top_gaps":            [_area_label(w) for w in (weak_areas or [])[:3]],
        "integrity_flag":      risk,
        "one_liner":           (summary or "")[:180],
    }


def _ok(data: dict, message: str = "Success") -> dict:
    return {"success": True, "data": data, "error": None, "message": message}


def _err(error: str, status: int = 400):
    return JSONResponse(
        status_code=status,
        content={"success": False, "data": None, "error": error},
    )


async def _empty_async_dict() -> dict:
    return {}


def _normalize_report_payload(payload: dict) -> dict:
    """
    Enforce correct types on every report field before the payload leaves the
    backend.  The frontend destructures these fields with defaults, but a cached
    report saved before a schema migration — or a report where an LLM stage
    silently failed — can carry null where an array or dict is expected, crashing
    the React render.  This normalizer is idempotent: running it twice is safe.
    """
    # ── Fields that must always be lists ─────────────────────────────────────
    _LIST_FIELDS = [
        "per_question_analysis", "question_scores", "skill_ratings",
        "strong_areas", "weak_areas", "red_flags", "failure_patterns",
        "study_recommendations", "interview_tips", "mock_ready_topics",
        "not_ready_topics", "repeated_offenders", "pattern_groups",
        "blind_spots", "bs_flag", "skill_decay", "skills_to_work_on",
        "auto_resources", "follow_up_questions", "category_breakdown",
        "checklist", "filler_heatmap",
        # New universal fields
        "time_per_question",
        # HR Phase 1
        "star_story_matrix", "behavioral_category_coverage", "behavioral_red_flags",
        "key_signals", "competency_scorecard",
        # HR Phase 2
        "culture_fit_dimensions",
        # HR Phase 3
        "reference_check_triggers",
        # HR Report Enhancement — Group A
        "explicit_red_flags",
        # HR Report Enhancement — Group B
        "model_answer_comparison",
        # HR Report Enhancement — Group C
        "pipeline_followup_questions",
    ]
    # ── Fields that must always be dicts ─────────────────────────────────────
    _DICT_FIELDS = [
        "hire_signal", "communication_breakdown", "six_axis_radar",
        "delivery_consistency", "proctoring_summary", "swot",
        "thirty_day_plan", "cv_audit", "study_roadmap",
        # New universal fields
        "hiring_summary",
        # HR Phase 2
        "eq_profile",
        # HR Phase 3
        "coachability_index", "leadership_ic_fit", "assessment_confidence",
        # HR Report Enhancement — Group A
        "seniority_calibration", "answer_depth_progression",
        # HR Report Enhancement — Group B
        "peer_benchmarking", "role_gap_analysis", "story_uniqueness",
        # HR Report Enhancement — Group C
        "hr_improvement_plan", "executive_brief",
    ]
    # ── String fields that must not be null ──────────────────────────────────
    _STR_FIELDS = [
        "summary", "grade", "hire_recommendation", "difficulty",
        "compared_to_level", "session_label", "target_company", "candidate_name",
        # HR Phase 1
        "hire_confidence", "interview_datetime", "job_role",
        "communication_pattern", "culture_fit_narrative",
    ]

    result = dict(payload)

    for field in _LIST_FIELDS:
        if not isinstance(result.get(field), list):
            result[field] = []

    for field in _DICT_FIELDS:
        if not isinstance(result.get(field), dict):
            result[field] = {}

    for field in _STR_FIELDS:
        val = result.get(field)
        if not isinstance(val, str):
            result[field] = "" if val is None else str(val)

    # ── Nested: code_quality_metrics ─────────────────────────────────────────
    cqm = result.get("code_quality_metrics")
    if isinstance(cqm, dict):
        if not isinstance(cqm.get("per_question"), list):
            cqm["per_question"] = []

    # ── Nested: peer_comparison ───────────────────────────────────────────────
    pc = result.get("peer_comparison")
    if isinstance(pc, dict):
        if not isinstance(pc.get("grade_distribution"), dict):
            pc["grade_distribution"] = {}
        if not isinstance(pc.get("radar_comparison"), list):
            pc["radar_comparison"] = []

    # ── Nested: next_interview_blueprint ─────────────────────────────────────
    nib = result.get("next_interview_blueprint")
    if isinstance(nib, dict):
        if not isinstance(nib.get("focus_topics"), list):
            nib["focus_topics"] = []

    # ── Nested: interview_integrity ───────────────────────────────────────────
    ii = result.get("interview_integrity")
    if isinstance(ii, dict):
        if not isinstance(ii.get("highlights"), list):
            ii["highlights"] = []

    # ── Nested: proctoring_summary ────────────────────────────────────────────
    ps = result.get("proctoring_summary")
    if isinstance(ps, dict):
        if not isinstance(ps.get("counts"), dict):
            ps["counts"] = {}

    # ── Backward compat: behavioral_red_flags Phase 1→Phase 2 coercion ──────────
    # Old reports store List[str]; Phase 2 expects List[Dict[flag,severity,evidence]].
    brf = result.get("behavioral_red_flags")
    if isinstance(brf, list) and brf and isinstance(brf[0], str):
        result["behavioral_red_flags"] = [
            {"flag": f, "severity": "Moderate", "evidence": ""} for f in brf
        ]

    # ── Forward compat: star_story_matrix Q&A enrichment (Phase 0) ───────────
    # Old entries lack question_text / answer_summary — default to "" so the
    # frontend can render without crashing on undefined.
    for entry in result.get("star_story_matrix") or []:
        if isinstance(entry, dict):
            entry.setdefault("question_text", "")
            entry.setdefault("answer_summary", "")

    # ── Forward compat: strong_areas HR enrichment (Phase 9) ─────────────────
    # Old HR reports lack exact_moment / evidence_quote / why_it_landed.
    for entry in result.get("strong_areas") or []:
        if isinstance(entry, dict):
            entry.setdefault("exact_moment", "")
            entry.setdefault("evidence_quote", "")
            entry.setdefault("why_it_landed", "")

    # ── Forward compat: Group C fields ───────────────────────────────────────
    for entry in result.get("pipeline_followup_questions") or []:
        if isinstance(entry, dict):
            entry.setdefault("target_competency", "")
            entry.setdefault("purpose", "")
            entry.setdefault("difficulty", "Medium")
            entry.setdefault("question_id_source", "General")
    plan = result.get("hr_improvement_plan") or {}
    if isinstance(plan, dict):
        for sprint in plan.get("weekly_sprints") or []:
            if isinstance(sprint, dict):
                sprint.setdefault("exercises", [])
        plan.setdefault("quick_wins", [])
        plan.setdefault("curated_resources", [])
    brief = result.get("executive_brief") or {}
    if isinstance(brief, dict):
        brief.setdefault("evidence_for", [])
        brief.setdefault("evidence_against", [])

    # ── Forward compat: Group B fields ───────────────────────────────────────
    for entry in result.get("model_answer_comparison") or []:
        if isinstance(entry, dict):
            entry.setdefault("what_was_missing", [])
            entry.setdefault("model_answer_outline", "")
            entry.setdefault("improvement_instruction", "")
    for entry in (result.get("story_uniqueness") or {}).get("per_question_originality") or []:
        if isinstance(entry, dict):
            entry.setdefault("originality_score", 70)
            entry.setdefault("rehearsal_flag", False)
            entry.setdefault("signal", "")
    for entry in (result.get("role_gap_analysis") or {}).get("expected_competencies") or []:
        if isinstance(entry, dict):
            entry.setdefault("gap", 0)
            entry.setdefault("gap_severity", "Low")
            entry.setdefault("gap_narrative", "")

    # ── Report quality metadata (migration 011) ───────────────────────────────
    # Ensures old cached reports (pre-fix) served from DB never crash the new
    # frontend code that reads these fields.
    if not isinstance(result.get("report_quality"), str):
        result["report_quality"] = "full"
    if not isinstance(result.get("failed_sections"), list):
        result["failed_sections"] = []
    if not isinstance(result.get("stage_errors"), dict):
        result["stage_errors"] = {}

    return result


def _is_complete_report(report: dict) -> bool:
    """
    A report is 'complete enough to serve from cache' when:
    - overall_score exists (always computed)
    - grade is a non-empty string ("A", "B+", etc.) — confirms Stage 1 LLM succeeded
    An empty grade ("") means Stage 1 returned bad data and the report needs regeneration.
    """
    if not isinstance(report, dict):
        return False
    if "overall_score" not in report:
        return False
    grade = report.get("grade")
    return bool(grade) and isinstance(grade, str) and len(grade.strip()) >= 1


def _merge_per_question_analysis(
    question_scores: list,
    per_question_analysis: list,
    audio_map: dict | None = None,
) -> list:
    """
    Merge per-question LLM analysis with raw scores and (optionally) audio URLs.

    audio_map: {question_id: {"audio_url": str, "audio_path": str}} from session transcript.
    """
    merged = []
    source = per_question_analysis or question_scores
    audio_map = audio_map or {}

    for idx, item in enumerate(source):
        fallback = question_scores[idx] if idx < len(question_scores) else {}
        payload = {**fallback, **(item or {})}
        payload.setdefault("question_id", fallback.get("question_id", f"Q{idx + 1}"))
        payload.setdefault("question_text", fallback.get("question_text", ""))
        payload.setdefault("score",   fallback.get("score"))       # None preserved for skipped
        payload.setdefault("skipped", fallback.get("skipped", False))
        payload.setdefault("verdict", fallback.get("verdict", ""))
        payload.setdefault("answer_summary", fallback.get("answer_summary", ""))
        payload.setdefault("category", fallback.get("category", "General"))
        payload.setdefault("strengths", fallback.get("strengths", []))
        payload.setdefault("improvements", fallback.get("improvements", []))

        # Merge audio playback data from transcript
        qid = payload.get("question_id", "")
        if qid in audio_map:
            audio_entry = audio_map[qid]
            audio_path = audio_entry.get("audio_path")
            # Regenerate signed URL at report time so it's fresh (24 h TTL)
            fresh_url = get_audio_signed_url(audio_path) if audio_path else None
            payload["audio_url"]       = fresh_url or audio_entry.get("audio_url")
            payload["audio_path"]      = audio_path
            payload["audio_start_sec"] = audio_entry.get("audio_start_sec", 0)
        else:
            payload.setdefault("audio_url", None)
            payload.setdefault("audio_path", None)
            payload.setdefault("audio_start_sec", None)

        merged.append(payload)

    return merged


def _build_verbal_category_breakdown(question_scores: list) -> list:
    """
    Build category_breakdown deterministically from question_scores for verbal rounds.
    Groups questions by category, computes average score and verdict.
    Never returns []. Replaces unreliable LLM generation for this field.
    """
    from collections import defaultdict
    buckets: dict = defaultdict(lambda: {"scores": [], "count": 0})

    for q in (question_scores or []):
        if q.get("skipped"):
            continue
        cat = (q.get("category") or q.get("topic") or "General").strip()
        score = q.get("score")
        if score is not None:
            buckets[cat]["scores"].append(float(score))
            buckets[cat]["count"] += 1

    result = []
    for cat, data in buckets.items():
        if not data["scores"]:
            continue
        avg = round(sum(data["scores"]) / len(data["scores"]), 1)
        avg_pct = round(avg * 10)
        verdict = (
            "Strong"  if avg_pct >= 75 else
            "Good"    if avg_pct >= 60 else
            "Average" if avg_pct >= 40 else
            "Weak"
        )
        result.append({
            "category": cat,
            "score":    avg_pct,
            "verdict":  verdict,
            "comment":  f"{data['count']} question(s) — avg {avg}/10",
        })

    result.sort(key=lambda x: x["score"], reverse=True)
    return result


def _build_mcq_category_breakdown(transcript: list) -> list:
    """
    Aggregate MCQ transcript entries by category.
    Returns a list of {category, correct, total, accuracy, avg_score, score, verdict, comment}
    so the shape is identical to what the LLM produces for non-MCQ rounds.
    Only includes entries where question_type == 'mcq'.
    """
    from collections import defaultdict
    buckets: dict = defaultdict(lambda: {"correct": 0, "total": 0, "score_sum": 0.0})
    for entry in (transcript or []):
        if entry.get("question_type") != "mcq":
            continue
        cat = (entry.get("category") or entry.get("topic") or "Uncategorized").strip()
        buckets[cat]["total"] += 1
        buckets[cat]["score_sum"] += float(entry.get("score") or 0)
        if entry.get("is_correct"):
            buckets[cat]["correct"] += 1

    result = []
    for cat, data in buckets.items():
        total = data["total"]
        accuracy = round(data["correct"] / total * 100, 1) if total else 0.0
        avg_score = round(data["score_sum"] / total, 1) if total else 0.0
        result.append({
            "category":  cat,
            "correct":   data["correct"],
            "total":     total,
            "accuracy":  accuracy,
            "avg_score": avg_score,
            # Unified fields so frontend can render both MCQ and non-MCQ the same way
            "score":     round(avg_score * 10),
            "verdict":   "Strong" if accuracy >= 80 else "Needs Work" if accuracy >= 50 else "Weak",
            "comment":   f"{data['correct']}/{total} correct ({accuracy}%)",
        })
    # Sort by accuracy descending so best categories appear first
    result.sort(key=lambda x: x["accuracy"], reverse=True)
    return result


def _build_session_label(round_type: str, target_company: str = "", job_role: str = "") -> str:
    round_label = _ROUND_AGENT_LABELS.get(round_type or "technical", "Interview")
    role = (job_role or "").strip()
    company = (target_company or "").strip()

    if role and company:
        return f"{round_label} - {role} @ {company}"
    if role:
        return f"{round_label} - {role}"
    if company:
        return f"{round_label} - {company}"
    return f"{round_label} Interview"


def _build_interview_integrity(proctoring_summary: dict | None) -> dict | None:
    if not isinstance(proctoring_summary, dict) or not proctoring_summary:
        return None

    counts = proctoring_summary.get("counts") or {}
    score = int(round(float(proctoring_summary.get("integrity_score", 100) or 100)))
    total_incidents = int(proctoring_summary.get("total_incidents") or sum(
        int(counts.get(key, 0) or 0)
        for key in ("camera_blocked", "multiple_faces", "looking_away", "poor_posture", "phone_detected")
    ))

    blocked = int(counts.get("camera_blocked", 0) or 0)
    multiple = int(counts.get("multiple_faces", 0) or 0)
    gaze = int(counts.get("looking_away", 0) or 0)
    posture = int(counts.get("poor_posture", 0) or 0)
    phone = int(counts.get("phone_detected", 0) or 0)

    if phone or blocked >= 3 or multiple >= 2 or score < 60:
        status = "High Risk"
    elif total_incidents >= 4 or score < 80:
        status = "Review Recommended"
    elif total_incidents > 0:
        status = "Minor Concerns"
    else:
        status = "Clear"

    highlights = []
    if blocked:
        highlights.append(f"Camera obstruction or face loss detected {blocked} time(s).")
    if multiple:
        highlights.append(f"Multiple faces were detected {multiple} time(s).")
    if phone:
        highlights.append(f"A phone-like device was detected {phone} time(s).")
    if gaze:
        highlights.append(f"Attention drift was flagged {gaze} time(s).")
    if posture:
        highlights.append(f"Posture drift was flagged {posture} time(s).")
    if not highlights:
        highlights.append("No major camera or attention concerns were detected during the session.")

    uptime = proctoring_summary.get("camera_uptime_ratio")
    uptime_text = None
    if isinstance(uptime, (int, float)):
        uptime_text = f"{round(uptime * 100, 1)}%"

    summary = (
        f"Integrity status: {status}. "
        f"Integrity score: {score}/100 across {total_incidents} flagged event(s)."
    )
    if uptime_text:
        summary += f" Camera visibility uptime was {uptime_text}."

    return {
        "status": status,
        "score": score,
        "summary": summary,
        "highlights": highlights,
        "total_incidents": total_incidents,
    }


def _compute_answer_depth_progression(question_scores: list) -> dict:
    """
    Deterministic trend arc across the HR interview.
    Returns {} when fewer than 2 scored answers exist (not enough data to show a trend).
    """
    scored = [
        {"q": f"Q{i+1}", "score": round(q["score"] * 10), "skipped": False}
        for i, q in enumerate(question_scores or [])
        if q.get("score") is not None and not q.get("skipped")
    ]
    if len(scored) < 2:
        return {}

    scores = [s["score"] for s in scored]
    mid = len(scores) // 2
    first_half_avg  = sum(scores[:mid]) / mid if mid else scores[0]
    second_half_avg = sum(scores[mid:]) / (len(scores) - mid) if (len(scores) - mid) else scores[-1]
    delta = second_half_avg - first_half_avg

    if delta > 8:
        trend = "Improving"
    elif delta < -8:
        trend = "Declining"
    elif max(scores) - min(scores) < 20:
        trend = "Consistent"
    else:
        trend = "Inconsistent"

    peak_idx = scores.index(max(scores))
    low_idx  = scores.index(min(scores))

    direction = "improved" if delta > 0 else "declined"
    trend_rationale = (
        f"Scores {direction} by {abs(round(delta))} points across the second half of the interview."
        if abs(delta) > 2
        else "Performance was consistent throughout the interview with no significant arc."
    )

    return {
        "arc":            scored,
        "trend":          trend,
        "peak_question":  scored[peak_idx]["q"],
        "lowest_question": scored[low_idx]["q"],
        "trend_rationale": trend_rationale,
    }


def _compute_executive_brief(
    hire_recommendation: str,
    hire_confidence: str,
    overall_score: float,
    key_signals: list,
    explicit_red_flags: list,
    competency_scorecard: list,
    reference_check_triggers: list,
    summary: str,
    job_role: str,
) -> dict:
    """
    Deterministically compute a hiring-committee executive brief from already-generated fields.
    No LLM call — derived entirely from Stage 1 output.
    """
    # Map hire_recommendation → executive verdict + color
    _REC_MAP = {
        "Strong Yes": ("Strong Hire",     "green"),
        "Yes":        ("Conditional Yes", "green"),
        "Maybe":      ("Conditional No",  "amber"),
        "No":         ("No Hire",         "red"),
    }
    hire_verdict, verdict_color = _REC_MAP.get(hire_recommendation, ("Pending", "amber"))

    # Confidence modulates verdict color (High confidence + Maybe → stronger red)
    if hire_verdict == "Conditional No" and hire_confidence == "High":
        verdict_color = "red"
    if hire_verdict == "Conditional Yes" and hire_confidence == "Low":
        verdict_color = "amber"

    # Split key_signals into evidence_for / evidence_against
    evidence_for    = [s for s in (key_signals or []) if s.get("valence") == "positive"]
    evidence_against = [s for s in (key_signals or []) if s.get("valence") in ("negative", "mixed")]

    # One-liner: first 2 sentences of summary (up to 200 chars)
    sentences = [s.strip() for s in (summary or "").split(".") if s.strip()]
    one_liner = ". ".join(sentences[:2]) + "." if sentences else "No summary available."
    if len(one_liner) > 220:
        one_liner = one_liner[:217] + "..."

    # Key risk: highest-severity explicit red flag, or lowest-scoring competency
    key_risk = ""
    high_flags = [f for f in (explicit_red_flags or []) if f.get("severity") == "High"]
    if high_flags:
        f = high_flags[0]
        key_risk = f.get("signal_meaning") or f.get("type", "High-severity flag detected")
    elif competency_scorecard:
        lowest = min(competency_scorecard, key=lambda x: x.get("rating_1_7", 7))
        key_risk = f"{lowest.get('axis', 'Key competency')} scored {lowest.get('anchor_label', 'Below Bar')} — {lowest.get('rationale', '')}"

    # Recommended action
    _ACTION_MAP = {
        "Strong Hire":     f"Advance to offer — confidence level is {hire_confidence.lower()}.",
        "Conditional Yes": f"Advance with one additional {job_role or 'role-specific'} interview to confirm.",
        "Conditional No":  "Hold — address key risk before advancing. One structured follow-up interview recommended.",
        "No Hire":         "Do not advance — hire recommendation is No with supporting evidence.",
    }
    recommended_action = _ACTION_MAP.get(hire_verdict, "Consult hiring committee before advancing.")

    # Committee question: from reference_check_triggers if available, else derive from key_risk
    committee_question = ""
    if reference_check_triggers:
        committee_question = reference_check_triggers[0].get("suggested_question", "")
    elif key_risk:
        committee_question = f"How does the candidate handle situations where {key_risk[:80].lower()}?"

    return {
        "hire_verdict":       hire_verdict,
        "verdict_color":      verdict_color,
        "one_liner":          one_liner,
        "evidence_for":       evidence_for[:3],
        "evidence_against":   evidence_against[:2],
        "key_risk":           key_risk,
        "recommended_action": recommended_action,
        "committee_question": committee_question,
    }


def _mock_report(session_id: str, round_type: str = "technical") -> dict:
    return {
        "session_id":    session_id,
        "overall_score": 72,
        "round_type":    round_type,
        "interview_agent": _ROUND_AGENT_LABELS.get(round_type, "Technical"),
        "session_label": f"{_ROUND_AGENT_LABELS.get(round_type, 'Interview')} Interview",
        "grade": "B+",
        "hire_recommendation": "Yes",
        "summary": "Solid overall performance. The candidate demonstrated clear ownership and communication skills but needs to sharpen STAR story structure — results were absent or vague in most behavioural answers.",
        "six_axis_radar": {
            "Communication Clarity": 75, "Confidence": 65,
            "Answer Structure": 70, "Pacing": 72,
            "Relevance": 80, "Example Quality": 60,
            "Technical Accuracy": 70,
        },
        "communication_breakdown": {
            "Communication Clarity": 75, "Confidence": 65,
            "Answer Structure": 70, "Pacing": 72,
            "Relevance": 80, "Example Quality": 60,
        },
        "strong_areas": [
            {"area": "Communication", "evidence": "Explained concepts clearly.", "score": 80},
        ] if round_type != "hr" else [
            {"area": "Self-Awareness & Accountability", "evidence": "Owned mistake without deflection in Q3.", "score": 82, "exact_moment": "Q3", "evidence_quote": "I realised I had made an assumption without validating it with the client first.", "why_it_landed": "Signals genuine self-accountability — a rare quality that hiring committees weight heavily against coached candidates."},
            {"area": "Leadership & Ownership", "evidence": "Set up war-room proactively in Q1.", "score": 76, "exact_moment": "Q1", "evidence_quote": "I took initiative and set up the war-room myself without being asked.", "why_it_landed": "Demonstrates proactive ownership at the team level, not just task-level execution."},
        ],
        "weak_areas":   [{"area": "Screening accuracy", "what_was_missed": "Missed a few core fundamentals under time pressure", "how_to_improve": "Review explanations and practice timed company-style MCQs.", "score": 45}],
        "what_went_wrong": "Candidate lost points on accuracy and concept recall under screening-style time pressure.",
        "swot": {
            "strengths":     ["Clear communication", "Good OOP knowledge"],
            "weaknesses":    ["Screening accuracy", "Timed concept recall"],
            "opportunities": ["Strong communication can shine in HR rounds"],
            "threats":       ["Weak screening accuracy can block early-round shortlisting"],
        },
        "per_question_analysis": [],
        "study_recommendations": [{"topic": "Company-Specific Screening Prep", "priority": "High", "resources": ["LeetCode Discuss", "GeeksForGeeks"], "reason": "Biggest gap."}],
        "thirty_day_plan": {"week_1": [], "week_2": [], "week_3": [], "week_4": []},
        "follow_up_questions": [],
        "skills_to_work_on": [{"skill": "MCQ Decision Accuracy", "priority": "High", "reason": "Scored lowest", "resources": ["LeetCode Discuss", "GeeksForGeeks"]}],
        "hire_signal": {
            "technical_depth":  {"score": 6, "rationale": "Solid basics, gaps in depth."},
            "communication":    {"score": 8, "rationale": "Articulate and structured."},
            "problem_solving":  {"score": 7, "rationale": "Methodical approach."},
            "cultural_fit":     {"score": 7, "rationale": "Positive demeanor."},
            "growth_potential": {"score": 8, "rationale": "Receptive to feedback."},
        },
        "failure_patterns": [],
        "bs_flag": [],
        "pattern_groups": [],
        "blind_spots": [],
        "cv_audit": {"overall_cv_honesty_score": 0, "note": "Demo report.", "items": []},
        "study_roadmap": {"week_1": [], "week_2": [], "week_3": [], "week_4": []},
        "mock_ready_topics": [], "not_ready_topics": [],
        "company_fit": None, "skill_decay": [],
        "repeated_offenders": [], "growth_trajectory": None,
        "interview_tips": ["Use the STAR method for behavioural questions."],
        "red_flags": [],
        "next_interview_blueprint": None,
        "auto_resources": [],
        "improvement_vs_last": None,
        "confidence_score": 70,
        "proctoring_summary": None,
        "interview_integrity": None,
        "is_mock": True,
        "_debug_mock": True,
        # HR Phase 1 — populated only for hr rounds; empty fallbacks for others
        "star_story_matrix": [
            {"question_id": "Q1", "question_text": "Tell me about a time you took ownership of a project without being asked.", "answer_summary": "The candidate described coordinating two engineering teams during a production outage at their previous company. They set up a war-room, divided responsibilities, and tracked progress until the issue was resolved. They mentioned delivering on time but did not state the business impact of the resolution.", "competency_category": "Leadership", "situation_present": True, "task_present": True, "action_present": True, "result_present": False, "star_score": 7, "star_completeness_pct": 68, "missing_element": "Result", "specificity_level": "Medium", "best_verbatim_quote": "I took ownership and coordinated both teams to deliver on time."},
            {"question_id": "Q2", "question_text": "Describe a situation where you had a conflict with a colleague and how you resolved it.", "answer_summary": "The candidate described a disagreement with a product manager over feature prioritization. They mentioned having a one-on-one conversation and eventually reaching an agreement, but did not specify what they personally argued for, what concessions were made, or what the outcome was for the product.", "competency_category": "Conflict Resolution", "situation_present": True, "task_present": False, "action_present": True, "result_present": True, "star_score": 6, "star_completeness_pct": 56, "missing_element": "Task", "specificity_level": "Low", "best_verbatim_quote": "We resolved the issue by aligning on priorities."},
            {"question_id": "Q3", "question_text": "Tell me about a time you made a significant mistake and what you learned from it.", "answer_summary": "The candidate described launching a feature without validating assumptions with a key client stakeholder. When the client flagged the issue, they went back, rebuilt the affected component, and implemented a new pre-launch stakeholder review process. They acknowledged their initial assumption without deflecting blame.", "competency_category": "Failure & Learning", "situation_present": True, "task_present": True, "action_present": True, "result_present": True, "star_score": 8, "star_completeness_pct": 87, "missing_element": "None", "specificity_level": "High", "best_verbatim_quote": "I realised I had made an assumption without validating it with the client first, and I went back and rebuilt that piece."},
        ] if round_type == "hr" else [],
        "behavioral_category_coverage": [
            {"category": "Leadership & Ownership", "covered": True, "question_numbers": [1], "performance": "Adequate"},
            {"category": "Conflict Resolution", "covered": True, "question_numbers": [2], "performance": "Adequate"},
            {"category": "Failure & Learning", "covered": False, "question_numbers": [], "performance": "Not Asked"},
        ] if round_type == "hr" else [],
        "communication_pattern": "Abstract-first (needs grounding)" if round_type == "hr" else "",
        "culture_fit_narrative": "Candidate shows strong alignment with collaborative, structured environments. Likely better suited to mid-size or enterprise settings than early-stage startups." if round_type == "hr" else "",
        "behavioral_red_flags": [
            {"flag": "Individual contribution unclear across conflict story", "severity": "Moderate", "evidence": "\"We resolved the issue\" — Q2 used collective language without specifying personal action."},
            {"flag": "Result missing in 2 of 3 answers", "severity": "Minor", "evidence": "Q2 and Q3 ended with process descriptions; no quantified outcome or follow-up was provided."},
        ] if round_type == "hr" else [],
        "key_signals": [
            {"signal": "Demonstrated ownership on leadership question", "evidence": "\"I took initiative and set up the war-room myself without being asked\" (Q1)", "valence": "positive"},
            {"signal": "STAR results missing on 2 of 3 answers", "evidence": "Q2 and Q3 ended with process descriptions, no quantified outcome", "valence": "negative"},
            {"signal": "Self-reflection on failure story was genuine", "evidence": "\"I realised I had made an assumption without validating it with the client\" (Q3)", "valence": "positive"},
        ] if round_type == "hr" else [],
        "competency_scorecard": [
            {"axis": "Communication Clarity", "rating_1_7": 5, "anchor_label": "Meets Bar", "verbatim_quote": "I explained the situation clearly to all stakeholders before taking action.", "rationale": "Answers were structured but occasionally verbose with unnecessary context."},
            {"axis": "STAR Story Craft", "rating_1_7": 4, "anchor_label": "Below Bar", "verbatim_quote": "We worked through the problem and eventually got it resolved.", "rationale": "Results were absent or vague in most answers; situations were well-set."},
            {"axis": "Self-Awareness & Accountability", "rating_1_7": 6, "anchor_label": "Exceeds Bar", "verbatim_quote": "I realised I had made an assumption without validating it with the client first.", "rationale": "Genuine reflection with personal ownership language in Q3."},
            {"axis": "Growth Mindset & Adaptability", "rating_1_7": 5, "anchor_label": "Meets Bar", "verbatim_quote": "After that experience I started doing pre-mortems before kicking off any project.", "rationale": "Demonstrated behavioral change but limited to one example."},
            {"axis": "Leadership & Ownership", "rating_1_7": 6, "anchor_label": "Exceeds Bar", "verbatim_quote": "I took initiative and set up the war-room myself without being asked.", "rationale": "Proactive ownership clearly evidenced in Q1."},
            {"axis": "Collaboration & Stakeholder Fit", "rating_1_7": 4, "anchor_label": "Below Bar", "verbatim_quote": "We resolved the issue by aligning on priorities.", "rationale": "Individual contribution unclear; defaulted to 'we' throughout conflict story."},
            {"axis": "Resilience Under Pressure", "rating_1_7": 5, "anchor_label": "Meets Bar", "verbatim_quote": "It was stressful, but I kept the team focused on what we could control.", "rationale": "Composed language under adversity; could have elaborated on coping strategies."},
        ] if round_type == "hr" else [],
        "hire_confidence": "Medium" if round_type == "hr" else "",
        "interview_datetime": "2026-05-06T10:30:00+00:00",
        "job_role": "Product Manager" if round_type == "hr" else "Software Engineer",
        # HR Phase 2
        "culture_fit_dimensions": [
            {"dimension": "Collaborative ↔ Independent", "candidate_position": 2, "pole_left": "Collaborative", "pole_right": "Independent", "rationale": "Consistently framed decisions as team consensus in Q1 and Q2; rarely described unilateral action."},
            {"dimension": "Process-Driven ↔ Adaptive", "candidate_position": 3, "pole_left": "Process-Driven", "pole_right": "Adaptive/Agile", "rationale": "Mixed signals — described structured planning in Q1 but improvised under pressure in Q3."},
            {"dimension": "Risk-Averse ↔ Risk-Tolerant", "candidate_position": 2, "pole_left": "Risk-Averse", "pole_right": "Risk-Tolerant", "rationale": "Emphasized validation and sign-off steps before launching; avoided ambiguous situations when possible."},
            {"dimension": "Analytical ↔ Intuitive", "candidate_position": 4, "pole_left": "Analytical", "pole_right": "Intuitive", "rationale": "Made a key call in Q3 based on gut feel after one stakeholder conversation, not a data review."},
            {"dimension": "Depth-Focused ↔ Breadth-Focused", "candidate_position": 3, "pole_left": "Depth-Focused", "pole_right": "Breadth-Focused", "rationale": "Showed solid depth in their core domain but cited cross-functional exposure as a growth area."},
        ] if round_type == "hr" else [],
        "eq_profile": {
            "self_awareness": 78,
            "self_regulation": 65,
            "empathy": 72,
            "social_skills": 70,
            "intrinsic_motivation": 80,
            "eq_summary": "Candidate shows strong intrinsic motivation and genuine self-awareness, particularly in the failure story where they owned their assumptions without deflecting. Self-regulation needs development — language became slightly defensive when discussing the conflict in Q2.",
            "eq_overall_label": "Moderate EQ",
        } if round_type == "hr" else {},
        "coachability_index": {
            "score": 72,
            "label": "Coachable",
            "positive_signals": [
                "In Q2, mentioned incorporating manager feedback after a missed deadline: 'my manager pointed out I wasn't escalating early enough, and I changed that.'",
                "In Q4, described actively seeking peer code review even when not required.",
            ],
            "negative_signals": [
                "In Q3, justified initial approach without fully acknowledging the stakeholder's concern ('I still think my solution was right, but...').",
            ],
            "summary": "Candidate shows genuine openness to feedback in structured scenarios, especially around process and communication. A mild pattern of self-justification appears under direct challenge but does not dominate the overall impression.",
        } if round_type == "hr" else {},
        "leadership_ic_fit": {
            "spectrum_position": 4,
            "label": "IC-Leaning",
            "recommended_track": "Hybrid IC-Lead",
            "evidence": "Q2 answer focused on personal technical contribution ('I rebuilt the data pipeline myself over two weekends'). Q4 mentioned coordinating a 3-person sub-team but minimized people-management aspects, framing it as task delegation rather than leadership.",
            "reasoning": "Best suited for senior IC roles with light tech-lead responsibilities. Would likely thrive as a staff engineer or tech lead but may struggle in full people-management positions without deliberate coaching.",
        } if round_type == "hr" else {},
        "reference_check_triggers": [
            {
                "topic": "Conflict resolution with cross-functional teams",
                "priority": "Medium",
                "suggested_question": "Can you describe how this candidate handled disagreements with stakeholders from other departments?",
                "reason": "Q3 story about a stakeholder conflict was vague on how the disagreement was ultimately resolved — candidate moved past this quickly.",
            },
            {
                "topic": "Consistency of ownership under pressure",
                "priority": "Low",
                "suggested_question": "How did this candidate respond when assigned high-stakes work with tight deadlines?",
                "reason": "Strong ownership language in Q1 and Q2, but Q5 answer was noticeably brief — a reference would confirm whether this is consistent.",
            },
        ] if round_type == "hr" else [],
        "assessment_confidence": {
            "score": 68,
            "label": "Moderate Confidence",
            "limiting_factors": [
                "Only 4 behavioral stories sampled — small dataset for a holistic HR assessment.",
                "Two answers (Q3 and Q5) were partially hypothetical ('I think I would handle it by...').",
            ],
            "what_would_change_it": "A follow-up structured case interview focused specifically on conflict resolution and cross-functional stakeholder management would sharpen the hire recommendation significantly.",
        } if round_type == "hr" else {},
        "explicit_red_flags": [
            {"type": "Vague Ending", "severity": "Medium", "evidence_quote": "We resolved the issue by aligning on priorities.", "signal_meaning": "No quantified outcome or named resolution — candidate avoids committing to what actually changed.", "question_id": "Q2"},
            {"type": "Hypothetical-as-Real", "severity": "High", "evidence_quote": "I think I would probably escalate it to my manager in that situation.", "signal_meaning": "Q5 answer was framed as hypothetical despite a real-experience prompt — suggests either inexperience or avoidance.", "question_id": "Q5"},
        ] if round_type == "hr" else [],
        "seniority_calibration": {
            "level": "Mid-Level",
            "rationale": "Behavioral stories in Q1 and Q3 show project-level ownership and initiative, but cross-functional influence is limited to one team. No evidence of mentoring, strategy-setting, or multi-stakeholder decisions across org boundaries.",
            "evidence_signals": [
                "Q1: Coordinated two teams during an outage — project-level, not org-level scope.",
                "Q3: Identified and fixed a self-created problem — strong ownership but narrow blast radius.",
            ],
            "confidence": "Medium",
        } if round_type == "hr" else {},
        "answer_depth_progression": _compute_answer_depth_progression([
            {"score": 7, "skipped": False},
            {"score": 6, "skipped": False},
            {"score": 8, "skipped": False},
        ]) if round_type == "hr" else {},
        # HR Report Enhancement — Group B
        "peer_benchmarking": _compute_peer_benchmarking(72, {
            "Communication Clarity": 72, "STAR Story Craft": 55,
            "Self-Awareness & Accountability": 78, "Growth Mindset & Adaptability": 68,
            "Leadership & Ownership": 76, "Collaboration & Stakeholder Fit": 52,
            "Resilience Under Pressure": 65,
        }, round_type) if round_type == "hr" else {},
        "role_gap_analysis": {
            "target_role": "Product Manager",
            "target_level": "Mid-Level",
            "expected_competencies": [
                {"competency": "Communication Clarity", "expected_score": 70, "actual_score": 72, "gap": -2, "gap_severity": "Low", "gap_narrative": "Candidate exceeds the bar — answers are structured and jargon-free."},
                {"competency": "STAR Story Craft", "expected_score": 70, "actual_score": 55, "gap": 15, "gap_severity": "Medium", "gap_narrative": "Moderate gap — results are absent or vague in most answers, which PMs at this level are expected to demonstrate clearly."},
                {"competency": "Self-Awareness & Accountability", "expected_score": 65, "actual_score": 78, "gap": -13, "gap_severity": "Low", "gap_narrative": "Candidate exceeds expectation — genuine failure reflection was observed."},
                {"competency": "Growth Mindset & Adaptability", "expected_score": 65, "actual_score": 68, "gap": -3, "gap_severity": "Low", "gap_narrative": "Candidate meets and slightly exceeds the expected adaptability bar for this level."},
                {"competency": "Leadership & Ownership", "expected_score": 70, "actual_score": 76, "gap": -6, "gap_severity": "Low", "gap_narrative": "Ownership signals are clear; candidate exceeds the Mid-Level bar here."},
                {"competency": "Collaboration & Stakeholder Fit", "expected_score": 72, "actual_score": 52, "gap": 20, "gap_severity": "High", "gap_narrative": "Critical gap — PMs at this level must articulate cross-functional influence; individual contribution was consistently unclear."},
                {"competency": "Resilience Under Pressure", "expected_score": 65, "actual_score": 65, "gap": 0, "gap_severity": "Low", "gap_narrative": "Candidate meets the baseline expected at Mid-Level."},
            ],
            "readiness_score": 68,
            "readiness_label": "Approaching Ready",
            "summary": "Candidate is approaching readiness for a Mid-Level Product Manager role. The critical gap is Collaboration & Stakeholder Fit — a core PM competency where individual contribution language was weak across multiple answers. Strength in self-awareness and leadership ownership partially offsets this deficit.",
        } if round_type == "hr" else {},
        "story_uniqueness": {
            "uniqueness_score": 62,
            "uniqueness_label": "Mostly Original",
            "rehearsal_signals": [
                "Q1 had no natural hedges, corrections, or pauses — delivery was unusually polished for an impromptu answer.",
                "Q3 produced an immediate, structured response without any thinking pauses — suggests this 'failure story' is a prepared set-piece.",
            ],
            "repeated_scenarios": [
                "Production incident referenced in Q1 and indirectly echoed in Q4's 'high-pressure situation'.",
            ],
            "scenario_diversity_score": 58,
            "diversity_feedback": "Two of the three main stories drew from the same category of experience (production incidents). Stronger answers would diversify across distinct contexts — e.g., a relationship conflict, a personal growth moment, and a cross-functional delivery challenge.",
            "per_question_originality": [
                {"question_id": "Q1", "originality_score": 55, "rehearsal_flag": True, "signal": "Immediate structured delivery with no hesitation — reads as a rehearsed 'leadership story' set-piece."},
                {"question_id": "Q2", "originality_score": 72, "rehearsal_flag": False, "signal": "Answer contained natural course-corrections ('actually, let me back up') suggesting genuine recall."},
                {"question_id": "Q3", "originality_score": 68, "rehearsal_flag": False, "signal": "Showed specificity and self-correction mid-answer — hallmarks of authentic recall rather than rehearsal."},
            ],
        } if round_type == "hr" else {},
        "model_answer_comparison": [
            {
                "question_id": "Q1",
                "candidate_score": 7,
                "what_was_missing": [
                    "Quantified business impact of the resolution (e.g., downtime reduced, revenue saved)",
                    "Named stakeholders — who was affected, who approved the war-room setup",
                    "Result: what happened after the incident was resolved (follow-up process change, recognition, etc.)",
                ],
                "model_answer_outline": "- Set the scene: team size, timeline, and what was at stake (SLA, revenue, customer impact)\n- Define the task: what was unclear or leaderless about the situation\n- Action: specific steps YOU took — not 'we'; name the decisions made\n- Result: quantified outcome (e.g., 'restored service in 40 minutes vs. 2-hour SLA') and a follow-up change\n- Reflection: what this experience revealed about your leadership style",
                "improvement_instruction": "Practice ending the story with a number — even an approximate one ('roughly 30% faster than the previous incident'). Your setup and action were strong; the missing result makes the story feel unfinished to a hiring panel.",
            },
            {
                "question_id": "Q2",
                "candidate_score": 6,
                "what_was_missing": [
                    "Your specific argument or position — what did YOU want vs. what did the PM want",
                    "How the disagreement was actually resolved — who conceded, what changed, why",
                    "Individual contribution: 'we' used throughout without clarifying your personal role",
                ],
                "model_answer_outline": "- Situation: context of the relationship and why the conflict mattered\n- Task: your individual stake in the outcome — not just that a conflict existed\n- Action: the exact conversation or steps you personally took to address it\n- Resolution: who moved, what was agreed, what you each got\n- Learning: how this shaped your approach to cross-functional disagreements going forward",
                "improvement_instruction": "Replace 'we resolved it' with 'I proposed X; the PM agreed to Y in exchange for Z' — give the hiring committee the specifics they need to assess your negotiation and influence skills.",
            },
            {
                "question_id": "Q3",
                "candidate_score": 8,
                "what_was_missing": [
                    "Stakeholder name or role — who was the client that flagged the issue",
                    "Scale of impact — how many users/accounts were affected by the mistake",
                ],
                "model_answer_outline": "- Situation: what the project was and what assumption you made\n- Task: what you were responsible for delivering\n- Action: how you discovered and confirmed the mistake, what you rebuilt, and how quickly\n- Result: what changed (the rebuilt feature + the new stakeholder review process) — quantify if possible\n- Learning: what personal principle or practice changed permanently as a result",
                "improvement_instruction": "This was your strongest answer. The only upgrade needed is adding one specific detail — the client's role or the scope of impact — to make the story feel concrete enough to share in a reference check.",
            },
        ] if round_type == "hr" else [],
        "radar_scores": {
            "Communication Clarity": 72, "STAR Story Craft": 55,
            "Self-Awareness & Accountability": 78, "Growth Mindset & Adaptability": 68,
            "Leadership & Ownership": 76, "Collaboration & Stakeholder Fit": 52,
            "Resilience Under Pressure": 65,
        } if round_type == "hr" else {
            "OOP & Design Patterns": 70, "Data Structures & Algorithms": 65,
            "DBMS & SQL": 72, "OS & CN Concepts": 55,
            "Project Knowledge": 78, "Communication": 80,
        },
        # HR Report Enhancement — Group C
        "pipeline_followup_questions": [
            {"question": "You mentioned 'we resolved the issue' in Q2 — walk me through exactly what you personally said or did to break the deadlock with the product manager.", "target_competency": "Collaboration & Stakeholder Fit", "purpose": "Probe individual contribution — candidate used collective 'we' language throughout the conflict story without specifying personal action.", "difficulty": "High", "question_id_source": "Q2"},
            {"question": "In Q1 you set up the war-room — who gave you the authority to do that, and what would you have done if your manager had disagreed?", "target_competency": "Leadership & Ownership", "purpose": "Test whether the ownership story reflects genuine proactive authority or was implicitly sanctioned — key differentiator for senior vs mid-level placement.", "difficulty": "High", "question_id_source": "Q1"},
            {"question": "You described rebuilding the feature in Q3 — what was the timeline, and how did you manage stakeholder expectations while the fix was in progress?", "target_competency": "STAR Story Craft", "purpose": "Surface the missing Result element — the resolution and its business impact were not stated.", "difficulty": "Medium", "question_id_source": "Q3"},
            {"question": "Tell me about a time you had to influence a decision without formal authority — in a different context from the ones you've already shared.", "target_competency": "Collaboration & Stakeholder Fit", "purpose": "Cross-cutting — tests whether cross-functional influence is a consistent pattern or limited to the one example given.", "difficulty": "High", "question_id_source": "General"},
        ] if round_type == "hr" else [],
        "hr_improvement_plan": {
            "priority_focus": "STAR Story Craft",
            "overall_plan_label": "2-Week Intensive",
            "weekly_sprints": [
                {
                    "week": 1,
                    "theme": "Build Your Story Bank",
                    "exercises": [
                        {"exercise": "Rewrite all 3 stories with explicit Results", "duration_mins": 30, "frequency": "Daily", "how_to_practice": "Take each of your Q1, Q2, Q3 stories from today's interview. For each one, add one sentence at the end that states a number or outcome: 'As a result, [X happened] — [measurable impact].' If you don't know the exact number, use a range. Practice saying each revised ending aloud until it feels natural.", "target_competency": "STAR Story Craft"},
                        {"exercise": "Replace 'we' with 'I' drill", "duration_mins": 15, "frequency": "Daily", "how_to_practice": "Record yourself re-answering Q2 (the conflict story). Listen back and count how many times you say 'we'. Rewrite the story replacing every 'we' with 'I [did X], then the team [did Y]' — separating your contribution from the group outcome. Your goal: zero unexplained 'we' in the action section.", "target_competency": "Collaboration & Stakeholder Fit"},
                        {"exercise": "STAR timed answer drill", "duration_mins": 20, "frequency": "3x/week", "how_to_practice": "Set a 2-minute timer. Answer a behavioral question (e.g. 'Tell me about a conflict'). Stop at 2 minutes. Check: did you cover S, T, A, R? If any element is missing, re-answer with the missing element added. Repeat until all 4 elements appear within the 2-minute window.", "target_competency": "STAR Story Craft"},
                    ],
                },
                {
                    "week": 2,
                    "theme": "Sharpen Under Pressure",
                    "exercises": [
                        {"exercise": "Mock interview with follow-up probing", "duration_mins": 45, "frequency": "3x/week", "how_to_practice": "Ask a friend or use an AI to give you a behavioral question, then immediately follow up with 'And what specifically did YOU do?' and 'What was the measurable outcome?' Practice answering these follow-ups smoothly — without starting over. These are the exact questions you'll face in a panel interview.", "target_competency": "STAR Story Craft"},
                        {"exercise": "Scenario diversity audit", "duration_mins": 20, "frequency": "Weekly", "how_to_practice": "List your 5-6 prepared STAR stories and categorize each: Leadership, Conflict, Failure, Cross-functional, Innovation, Technical. If any category has 0 or 2+ stories, write a new one for the empty category. Your goal: at least one distinct, concrete story per category before your next interview.", "target_competency": "Growth Mindset & Adaptability"},
                    ],
                },
            ],
            "quick_wins": [
                "End every story with a number — even approximate: 'roughly 30% faster', 'about 2 hours saved per week'.",
                "When you say 'we', immediately add 'and my specific contribution was…' before moving on.",
                "Before your next interview, write one sentence for each story: 'The measurable result was __.' Memorize it.",
                "Start answers with the Situation in one sentence — don't pre-amble with context that isn't the story.",
            ],
            "curated_resources": [
                {"title": "STAR Method — Amazon Leadership Principles Guide", "type": "Article", "why": "Amazon's STAR framework is the most rigorous behavioral answer structure used by top-tier companies — directly closes the Result gap observed in Q1 and Q2."},
                {"title": "Lenny's Newsletter: How to ace behavioral interviews", "type": "Article", "why": "PM-specific behavioral interview patterns, including stakeholder conflict and cross-functional ownership stories — directly targets your target role gap."},
                {"title": "Cracking the PM Interview by Gayle McDowell", "type": "Book", "why": "Chapter on behavioral interviews covers story structure and individual-vs-team attribution — the exact gap flagged in your Collaboration axis."},
                {"title": "Mock Interview with ChatGPT (STAR follow-up drill)", "type": "Framework", "why": "Prompt: 'Ask me a behavioral question, then immediately follow up with two probing questions about my specific contribution and measurable outcome.' Repeat 10 times."},
            ],
        } if round_type == "hr" else {},
        "executive_brief": _compute_executive_brief(
            hire_recommendation="Yes",
            hire_confidence="Medium",
            overall_score=72,
            key_signals=[
                {"signal": "Demonstrated ownership on leadership question", "evidence": "\"I took initiative and set up the war-room myself without being asked\" (Q1)", "valence": "positive"},
                {"signal": "STAR results missing on 2 of 3 answers", "evidence": "Q2 and Q3 ended with process descriptions, no quantified outcome", "valence": "negative"},
                {"signal": "Self-reflection on failure story was genuine", "evidence": "\"I realised I had made an assumption without validating it with the client\" (Q3)", "valence": "positive"},
            ] if round_type == "hr" else [],
            explicit_red_flags=[
                {"type": "Hypothetical-as-Real", "severity": "High", "evidence_quote": "I think I would probably escalate it to my manager in that situation.", "signal_meaning": "Q5 answer was framed as hypothetical despite a real-experience prompt.", "question_id": "Q5"},
            ] if round_type == "hr" else [],
            competency_scorecard=[
                {"axis": "Collaboration & Stakeholder Fit", "rating_1_7": 4, "anchor_label": "Below Bar", "verbatim_quote": "We resolved the issue by aligning on priorities.", "rationale": "Individual contribution unclear."},
            ] if round_type == "hr" else [],
            reference_check_triggers=[
                {"topic": "Conflict resolution", "priority": "Medium", "suggested_question": "Can you describe how this candidate handled disagreements with stakeholders from other departments?", "reason": "Q3 story was vague on resolution."},
            ] if round_type == "hr" else [],
            summary="Solid overall performance. The candidate demonstrated clear ownership and communication skills but needs to sharpen STAR story structure — results were absent or vague in most behavioural answers.",
            job_role="Product Manager",
        ) if round_type == "hr" else {},
        # Phase 5/6: always include these so the UI sections render in debug mode
        "peer_comparison": None,
        "study_schedule": None,
        "checklist": generate_checklist(
            weak_areas=[{"area": "Screening accuracy", "what_was_missed": "Missed core fundamentals under time pressure", "score": 45}],
            skills_to_work_on=[{"skill": "MCQ Decision Accuracy", "priority": "High", "resources": ["LeetCode Discuss"]}],
            thirty_day_plan={"week_1": [{"topic": "Arrays & Strings", "task": "Solve 10 LeetCode Easy", "resource": "LeetCode"}]},
            round_type=round_type,
            target_company="",
        ),
    }


# ── Stage 3: Communication + Behavioral ──────────────────────────────────────

async def _gen_communication(
    question_scores: list,
    voice_metrics: list | None,
    delivery_consistency: dict | None,
    round_type: str,
    overall_score: float,
) -> dict:
    prompt = build_communication_analysis_prompt(
        question_scores=question_scores,
        voice_metrics=voice_metrics,
        delivery_consistency=delivery_consistency,
        round_type=round_type,
        overall_score=overall_score,
    )
    _EMPTY = {
        "communication_breakdown": {ax: 60 for ax in ["Communication Clarity", "Confidence", "Answer Structure", "Pacing", "Relevance", "Example Quality"]},
        "six_axis_radar": {ax: 60 for ax in ["Communication Clarity", "Confidence", "Answer Structure", "Pacing", "Relevance", "Example Quality"]},
        "bs_flag": [],
        "pattern_groups": [],
        "blind_spots": [],
        "what_went_wrong": "Unable to generate behavioral analysis for this session.",
    }
    content = await _achat([{"role": "user", "content": prompt}], temperature=0.3, max_tokens=3500)
    result = json.loads(_clean(content))
    for k, v in _EMPTY.items():
        result.setdefault(k, v)

    # Inject Technical Accuracy as the 7th axis from per-question dimension_scores.
    # These are deterministic values from the evaluator — not LLM-generated here.
    scored_qs = [q for q in (question_scores or []) if not q.get("skipped") and isinstance((q.get("dimension_scores") or {}).get("technical_accuracy"), (int, float))]
    if scored_qs:
        avg_tech = round(sum(float(q["dimension_scores"]["technical_accuracy"]) for q in scored_qs) / len(scored_qs) * 10)
        result["six_axis_radar"]["Technical Accuracy"] = avg_tech
        result["communication_breakdown"]["Technical Accuracy"] = avg_tech

    return result


# ── Stage 4: Playbook & Resources ────────────────────────────────────────────

async def _gen_playbook(
    weak_areas: list,
    strong_areas: list,
    pattern_groups: list,
    company_fit: dict | None,
    round_type: str,
    overall_score: float,
    target_company: str = "",
    candidate_year: str = "",
) -> dict:
    prompt = build_playbook_prompt(
        weak_areas=weak_areas,
        strong_areas=strong_areas,
        pattern_groups=pattern_groups,
        company_fit=company_fit,
        round_type=round_type,
        overall_score=overall_score,
        target_company=target_company,
        candidate_year=candidate_year,
    )
    _EMPTY = {
        "swot": {"strengths": [], "weaknesses": [], "opportunities": [], "threats": []},
        "skills_to_work_on": [],
        "thirty_day_plan": {"week_1": [], "week_2": [], "week_3": [], "week_4": []},
        "auto_resources": [],
        "follow_up_questions": [],
        "next_interview_blueprint": None,
    }
    content = await _achat([{"role": "user", "content": prompt}], temperature=0.4, max_tokens=4000)
    result = json.loads(_clean(content))
    for k, v in _EMPTY.items():
        result.setdefault(k, v)
    return result


# ── SSE generator ─────────────────────────────────────────────────────────────

async def _generate_report_sse(session_id: str, user_id: str):
    """
    Async generator that yields SSE events during the 4-stage pipeline.
    Yields: data: {stage, progress, label} or data: {stage: "complete", report: {...}}
    """
    def _sse(payload: dict) -> str:
        return f"data: {json.dumps(payload)}\n\n"

    # ── Load session ──────────────────────────────────────────────────────────
    try:
        session = get_session(session_id)
    except RuntimeError:
        yield _sse({"stage": "error", "error": "Database unavailable"})
        return
    except Exception as e:
        yield _sse({"stage": "error", "error": str(e)})
        return

    if not session:
        yield _sse({"stage": "error", "error": "Session not found"})
        return
    if session.get("user_id") != user_id:
        yield _sse({"stage": "error", "error": "Access denied"})
        return

    # ── Load profile ──────────────────────────────────────────────────────────
    profile_parsed, student_meta, target_company = {}, {}, ""
    try:
        profile_id = session.get("profile_id")
        if profile_id:
            raw = get_profile(profile_id)
            if raw:
                profile_parsed = raw.get("parsed_data") or {}
                sm = raw.get("student_meta") or {}
                if isinstance(sm, str):
                    try:
                        sm = json.loads(sm)
                    except Exception:
                        sm = {}
                student_meta = sm
                companies = student_meta.get("target_companies") or []
                target_company = session.get("target_company") or profile_parsed.get("target_company") or (companies[0] if companies else "")
    except Exception as e:
        print(f"[report/sse] Profile fetch failed: {e}")

    round_type = session.get("round_type", "technical")
    difficulty = session.get("difficulty", "medium")
    context_bundle = dict(session.get("context_bundle") or {})
    job_role = session.get("target_role") or session.get("job_role") or context_bundle.get("job_role") or profile_parsed.get("job_role") or "Software Engineer"
    candidate_year = student_meta.get("year", "")
    session_label = (
        context_bundle.get("session_label")
        or _build_session_label(
            round_type=round_type,
            target_company=target_company,
            job_role=job_role,
        )
    )
    proctoring_summary = context_bundle.get("proctoring_summary") if isinstance(context_bundle, dict) else None
    interview_integrity = _build_interview_integrity(proctoring_summary)

    # ── Build question_scores from transcript ─────────────────────────────────
    transcript: list = session.get("transcript") or []
    question_scores = []
    for entry in transcript:
        answer_text = entry.get("answer", "")
        # Detect skipped questions via the explicit flag or the sentinel answer string
        is_skipped = entry.get("skipped", False) or answer_text == "[SKIPPED]"
        if entry.get("question_type") == "mcq":
            selected = entry.get("selected_option") or answer_text or "No option selected"
            correct = entry.get("correct_option") or ""
            answer_text = f"Selected: {selected}"
            if correct:
                answer_text += f" | Correct: {correct}"
        raw_score = entry.get("score")
        qs_entry = {
            "question_id":        entry.get("question_id", ""),
            "question_text":      entry.get("question", ""),
            "answer_text":        answer_text,
            "score":              None if is_skipped else raw_score,
            "skipped":            is_skipped,
            "feedback":           entry.get("feedback", ""),
            "strengths":          entry.get("strengths", []),
            "improvements":       entry.get("improvements", []),
            "verdict":            "skipped" if is_skipped else entry.get("verdict", ""),
            "key_concept_missed": entry.get("key_concept_missed", ""),
            "answer_summary":     entry.get("answer_summary", ""),
            "category":           entry.get("category", round_type),
            "topic":              entry.get("topic", entry.get("category", round_type)),
            "red_flag_detected":  entry.get("red_flag_detected", ""),
            "question_type":      entry.get("question_type", "speech"),
            "dimension_scores":   entry.get("dimension_scores", {}),
            "time_secs":          entry.get("time_taken_secs") or entry.get("time_taken_seconds") or 0,
            "blooms":             _classify_blooms(entry.get("question", "")),
        }
        # MCQ-specific fields — surface raw answer data for per-question report UI
        if entry.get("question_type") == "mcq":
            qs_entry["is_correct"]             = entry.get("is_correct")
            qs_entry["selected_option"]        = entry.get("selected_option") or ""
            qs_entry["selected_option_index"]  = entry.get("selected_option_index")
            qs_entry["correct_option"]         = entry.get("correct_option") or ""
            qs_entry["correct_option_index"]   = entry.get("correct_option_index")
            qs_entry["explanation"]            = entry.get("explanation") or ""
            qs_entry["time_taken_seconds"]     = entry.get("time_taken_secs") or entry.get("time_taken_seconds") or 0
            qs_entry["difficulty"]             = entry.get("difficulty") or ""
        # DSA-specific fields — transcript entries now embed execution metadata
        # directly (see dsa.py /submit). Copy them so question_scores is self-contained
        # and the dashboard renders even when sessions.scores enrichment is unavailable.
        if entry.get("question_type") == "code":
            for _dsa_k in ("problem_slug", "problem_title", "language",
                           "tests_passed", "tests_total", "pass_rate",
                           "avg_runtime_ms", "time_complexity", "space_complexity",
                           "difficulty"):
                if entry.get(_dsa_k) is not None:
                    qs_entry[_dsa_k] = entry[_dsa_k]
        question_scores.append(qs_entry)

    # ── DSA: enrich question_scores with code-submission metadata ─────────────
    # transcript carries the score + verdict, but DSA-specific fields
    # (code_excerpt, language, complexities, tests passed) live in sessions.scores.
    # Overlay them by question_id so the DSA report block renders cleanly.
    if round_type == "dsa":
        scores_by_qid = {}
        for s in (session.get("scores") or []):
            qid = s.get("question_id")
            if qid:
                scores_by_qid[qid] = s
        for qs in question_scores:
            extra = scores_by_qid.get(qs.get("question_id"))
            if extra:
                for k in ("problem_slug", "problem_title", "language", "code_excerpt",
                         "time_complexity", "space_complexity",
                         "tests_passed", "tests_total", "pass_rate", "avg_runtime_ms"):
                    if extra.get(k) is not None:
                        qs[k] = extra[k]

    # Build time-per-question array (uses time_secs already on each qs_entry)
    time_per_question = [
        {
            "label":         f"Q{i+1}",
            "question_text": qs.get("question_text", "")[:80],
            "time_secs":     qs.get("time_secs", 0),
            "score":         qs.get("score"),
            "skipped":       qs.get("skipped", False),
        }
        for i, qs in enumerate(question_scores)
    ]

    # Only average questions that were answered and evaluated (score is a real number)
    scored = [q["score"] for q in question_scores
              if q["score"] is not None and not q.get("skipped")]
    overall_raw  = round(sum(scored) / len(scored), 1) if scored else 0.0
    overall_pct  = round(overall_raw * 10, 1)

    # ── Run voice analysis on stored transcript ───────────────────────────────
    # Skip for DSA: coding rounds have no spoken transcript and no voice/filler axis.
    voice_result = {}
    if round_type != "dsa":
        try:
            voice_result = analyze_session_voice(transcript_entries=transcript)
        except Exception as e:
            print(f"[report/sse] Voice analysis failed: {e}")

    voice_metrics        = voice_result.get("voice_metrics")
    delivery_consistency = voice_result.get("delivery_consistency")
    filler_heatmap       = voice_result.get("filler_heatmap") or []
    transcript_annotated = voice_result.get("transcript_annotated")

    # Remap raw question_ids (UUIDs) in filler_heatmap to human-readable Q-numbers
    _qid_to_label = {
        entry.get("question_id", ""): f"Q{i+1}"
        for i, entry in enumerate(transcript)
        if entry.get("question_id")
    }
    for _fh in filler_heatmap:
        _raw = _fh.get("question_id", "")
        _fh["question_id"] = _qid_to_label.get(_raw, _raw)

    # ── DSA Pre-Stage: code quality analysis (DSA rounds only) ───────────────
    code_quality_metrics = None
    if round_type == "dsa":
        try:
            raw_code_results = session.get("code_execution_results") or []
            if raw_code_results:
                per_q_metrics = []
                cq_tasks = []
                for cr in raw_code_results:
                    static_m = analyze_code_quality(
                        code=cr.get("code", ""),
                        language=cr.get("language", "python"),
                        execution_result=cr.get("execution", {}),
                    )
                    cq_tasks.append(
                        _gen_code_quality_analysis(
                            code=cr.get("code", ""),
                            language=cr.get("language", "python"),
                            static_metrics=static_m,
                            question_text=cr.get("question_text", ""),
                        )
                    )
                    per_q_metrics.append(static_m)

                llm_cq_results = await asyncio.gather(*cq_tasks, return_exceptions=True)

                # Merge static metrics + LLM analysis per question
                merged_per_q = []
                for i, llm_r in enumerate(llm_cq_results):
                    entry = dict(per_q_metrics[i]) if i < len(per_q_metrics) else {}
                    if isinstance(llm_r, dict):
                        entry.update(llm_r)
                    entry["question_id"] = raw_code_results[i].get("question_id", f"Q{i+1}")
                    entry["question_text"] = raw_code_results[i].get("question_text", "")
                    merged_per_q.append(entry)

                code_quality_metrics = aggregate_code_quality(merged_per_q)
        except Exception as _cq_err:
            print(f"[report/sse] DSA code quality pre-stage failed: {_cq_err}")

    # ── Stage 1+2: core + cv_audit + market + company_fit + cross-session ────
    yield _sse({"stage": "core_analysis", "progress": 10, "label": "Scoring your answers..."})

    market_context = ""  # Tavily removed from report path — saves cost, was only news not interview Q data

    past_reports = []
    try:
        past_reports = get_past_reports_for_analysis(
            user_id=user_id, exclude_session_id=session_id, limit=10
        )
    except Exception:
        pass

    # Fire Stage 1 + Stage 2 + company_fit in parallel
    core_task    = _gen_core(round_type, question_scores, overall_raw, session, profile_parsed, market_context, code_quality_metrics)
    cv_task      = _gen_cv_audit(profile_parsed, question_scores)
    company_task = analyze_company_fit(
        candidate_score=overall_pct,
        round_type=round_type,
        radar_scores={},
        weak_areas=[],
        strong_areas=[],
        target_company=target_company,
        job_role=job_role,
    ) if target_company else _empty_async_dict()

    yield _sse({"stage": "core_analysis", "progress": 25, "label": "Analyzing performance depth..."})

    core_result, cv_result, company_fit_prelim = await asyncio.gather(
        core_task, cv_task, company_task, return_exceptions=True
    )

    failed_stages: dict[str, str] = {}

    if isinstance(core_result, Exception):
        failed_stages["stage1_core"] = str(core_result)
        print(f"[report/sse] Core failed: {core_result}")
        core_result = {}
    if isinstance(cv_result, Exception):
        failed_stages["stage2_cv"] = str(cv_result)
        print(f"[report/sse] CV audit failed: {cv_result}")
        cv_result = {}
    if isinstance(company_fit_prelim, Exception):
        company_fit_prelim = {}

    # Build audio_map from session transcript — question_id → {audio_url, audio_path}
    audio_map = {
        entry["question_id"]: {
            "audio_url":       entry.get("audio_url"),
            "audio_path":      entry.get("audio_path"),
            "audio_start_sec": entry.get("audio_start_sec", 0),
        }
        for entry in (transcript or [])
        if entry.get("question_id") and (entry.get("audio_url") or entry.get("audio_path"))
    }

    per_question_analysis = _merge_per_question_analysis(
        question_scores,
        core_result.get("per_question_analysis", question_scores),
        audio_map=audio_map,
    )

    # Now rerun company_fit with actual radar scores from core
    radar_scores = core_result.get("radar_scores", {})

    # ── Post-process radar: zero out axes with no matching questions ─────────
    # The LLM fills in all axes even if only 2/6 topics were covered. We patch
    # them to 0 so the radar only shows dimensions that were actually tested.
    # HR is excluded — behavioral questions always cover all 7 axes by design.
    radar_skills = _RADAR_AXES.get(round_type, [])
    if radar_skills and question_scores and round_type != "hr":
        radar_scores = _mask_uncovered_radar_axes(radar_scores, question_scores, radar_skills)
    if target_company and radar_scores:
        try:
            company_fit = await analyze_company_fit(
                candidate_score=overall_pct,
                round_type=round_type,
                radar_scores=radar_scores,
                weak_areas=core_result.get("weak_areas", []),
                strong_areas=core_result.get("strong_areas", []),
                target_company=target_company,
                job_role=job_role,
            )
        except Exception:
            company_fit = company_fit_prelim or {}
    else:
        company_fit = {}

    yield _sse({"stage": "behavioral_analysis", "progress": 50, "label": "Analyzing your delivery..."})

    # ── Stage 3+4: communication + playbook (parallel) ───────────────────────
    # DSA rounds: skip Stage 3 entirely. Communication/delivery/BS-detector axes
    # don't apply to a coding submission — running them just produces irrelevant
    # data the DSA report doesn't render and burns LLM credits.
    if round_type == "dsa":
        comm_task = _empty_async_dict()
    else:
        comm_task = _gen_communication(
            question_scores=question_scores,
            voice_metrics=voice_metrics,
            delivery_consistency=delivery_consistency,
            round_type=round_type,
            overall_score=overall_pct,
        )
    playbook_task = _gen_playbook(
        weak_areas=core_result.get("weak_areas", []),
        strong_areas=core_result.get("strong_areas", []),
        pattern_groups=core_result.get("failure_patterns", []),
        company_fit=company_fit,
        round_type=round_type,
        overall_score=overall_pct,
        target_company=target_company,
        candidate_year=candidate_year,
    )

    comm_result, playbook_result = await asyncio.gather(
        comm_task, playbook_task, return_exceptions=True
    )
    _COMM_EMPTY = {
        "communication_breakdown": {},
        "six_axis_radar": {},
        "bs_flag": [],
        "pattern_groups": [],
        "blind_spots": [],
        "what_went_wrong": "",
    }
    _PLAYBOOK_EMPTY = {
        "swot": {},
        "skills_to_work_on": [],
        "thirty_day_plan": {},
        "auto_resources": [],
        "follow_up_questions": [],
        "next_interview_blueprint": None,
    }

    if isinstance(comm_result, Exception):
        failed_stages["stage3_communication"] = str(comm_result)
        print(f"[report/sse] Stage 3 failed: {comm_result}")
        comm_result = _COMM_EMPTY
    if isinstance(playbook_result, Exception):
        failed_stages["stage4_playbook"] = str(playbook_result)
        print(f"[report/sse] Stage 4 failed: {playbook_result}")
        playbook_result = _PLAYBOOK_EMPTY

    yield _sse({"stage": "company_fit", "progress": 70, "label": "Calibrating against hiring bar..."})

    # ── Cross-session analysis ────────────────────────────────────────────────
    cross_session = {}
    try:
        cross_session = analyze_cross_session(
            current_score=overall_pct,
            current_radar=radar_scores,
            current_weak_areas=core_result.get("weak_areas", []),
            past_reports=past_reports,
        )
    except Exception as e:
        print(f"[report/sse] Cross-session analysis failed: {e}")

    # ── Improvement vs last ───────────────────────────────────────────────────
    improvement_vs_last = None
    try:
        improvement_vs_last = compute_improvement_vs_last(
            user_id=user_id,
            session_id=session_id,
            round_type=round_type,
            current_score=overall_pct,
        )
    except Exception:
        pass

    yield _sse({"stage": "playbook_generation", "progress": 85, "label": "Building your 30-day plan..."})

    # ── Preparation Checklist ─────────────────────────────────────────────────
    checklist_items = []
    try:
        checklist_items = generate_checklist(
            weak_areas=core_result.get("weak_areas", []),
            skills_to_work_on=playbook_result.get("skills_to_work_on", []),
            thirty_day_plan=playbook_result.get("thirty_day_plan", {}),
            round_type=round_type,
            target_company=target_company,
        )
        if checklist_items:
            save_checklist(
                user_id=user_id,
                session_id=session_id,
                items=checklist_items,
            )
    except Exception as _cl_e:
        print(f"[report/sse] Checklist generation failed: {_cl_e}")

    # ── Adaptive Study Schedule (Spaced Repetition) ──────────────────────────
    study_schedule = None
    try:
        target_date = session.get("target_interview_date") or ""
        study_schedule = build_study_schedule(
            weak_areas=core_result.get("weak_areas", []),
            past_reports=past_reports,
            target_date_iso=target_date,
            round_type=round_type,
        )
    except Exception as _sr_e:
        print(f"[report/sse] Study schedule failed: {_sr_e}")

    # ── Save benchmark row BEFORE computing peer comparison ──────────────────
    # Saving first ensures the current user's score is included in their own
    # percentile pool, not excluded because the insert happens too late.
    try:
        save_benchmark(
            round_type=round_type,
            difficulty=difficulty,
            overall_score=overall_pct,
            radar_scores=radar_scores,
            grade=core_result.get("grade", ""),
            hire_recommendation=core_result.get("hire_recommendation", ""),
            target_company=target_company,
            job_role=job_role,
        )
    except Exception as _bm_pre_err:
        print(f"[report/sse] Early benchmark save failed: {_bm_pre_err}")

    # ── Peer comparison (Industry Benchmarking) ──────────────────────────────
    peer_comparison = None
    try:
        benchmark_rows = get_benchmarks(
            round_type=round_type,
            difficulty=difficulty,
            target_company=target_company,
        )
        peer_comparison = compute_peer_comparison(
            user_overall=overall_pct,
            user_radar=radar_scores,
            benchmarks=benchmark_rows,
        )
    except Exception as _bm_e:
        print(f"[report/sse] Peer comparison failed: {_bm_e}")

    # ── Compute report quality from which stages failed ───────────────────────
    _core_failed = "stage1_core" in failed_stages or "stage2_cv" in failed_stages
    _secondary_failed = "stage3_communication" in failed_stages or "stage4_playbook" in failed_stages

    if _core_failed:
        report_quality = "degraded"
    elif _secondary_failed:
        report_quality = "partial"
    else:
        report_quality = "full"

    # Map failed stage keys to human-readable section names
    _STAGE_SECTION_MAP = {
        "stage1_core": ["overall_score", "radar_scores", "grade", "hire_recommendation",
                        "strong_areas", "weak_areas", "failure_patterns", "per_question_analysis",
                        # HR Phase 1
                        "star_story_matrix", "behavioral_category_coverage",
                        "key_signals", "competency_scorecard",
                        "communication_pattern", "culture_fit_narrative", "behavioral_red_flags",
                        # HR Phase 2
                        "culture_fit_dimensions", "eq_profile",
                        # HR Phase 3
                        "coachability_index", "leadership_ic_fit",
                        "reference_check_triggers", "assessment_confidence",
                        # HR Report Enhancement — Group A
                        "explicit_red_flags", "seniority_calibration", "answer_depth_progression",
                        # HR Report Enhancement — Group B
                        "peer_benchmarking", "role_gap_analysis", "story_uniqueness", "model_answer_comparison",
                        # HR Report Enhancement — Group C
                        "pipeline_followup_questions", "hr_improvement_plan", "executive_brief"],
        "stage2_cv":   ["cv_audit", "study_roadmap", "study_recommendations",
                        "mock_ready_topics", "not_ready_topics"],
        "stage3_communication": ["communication_breakdown", "six_axis_radar", "bs_flag",
                                 "pattern_groups", "blind_spots", "what_went_wrong"],
        "stage4_playbook": ["swot", "thirty_day_plan", "skills_to_work_on",
                            "auto_resources", "follow_up_questions", "next_interview_blueprint"],
    }
    failed_sections: list[str] = []
    for stage_key in failed_stages:
        failed_sections.extend(_STAGE_SECTION_MAP.get(stage_key, []))

    # ── Assemble final payload ────────────────────────────────────────────────
    report_payload = {
        # Identity
        "session_id":           session_id,
        "round_type":           round_type,
        "difficulty":           difficulty,
        "interview_agent":      _ROUND_AGENT_LABELS.get(round_type, "Technical"),
        "session_label":        session_label,
        "target_company":       target_company,
        "candidate_name":       profile_parsed.get("name") or "Candidate",
        "timer_mins":           session.get("timer_mins", session.get("timer_minutes", 30)),
        "num_questions":        session.get("num_questions", len(question_scores)),

        # Core scores
        "overall_score":        overall_pct,
        "raw_score":            overall_raw,
        "grade":                core_result.get("grade", "C"),
        "hire_recommendation":  core_result.get("hire_recommendation", "Maybe"),
        "summary":              core_result.get("summary", ""),
        "compared_to_level":    core_result.get("compared_to_level", ""),

        # Charts
        "radar_scores":         radar_scores,
        # category_breakdown: always built deterministically from question_scores
        # so it's never empty. MCQ uses accuracy %; other rounds use avg score per category.
        "category_breakdown":   (
            _build_mcq_category_breakdown(transcript)
            if round_type == "mcq_practice"
            else _build_verbal_category_breakdown(question_scores)
        ),

        # Strong / Weak
        "strong_areas":         core_result.get("strong_areas", []),
        "weak_areas":           core_result.get("weak_areas", []),
        "red_flags":            core_result.get("red_flags", []),

        # Hire signal + failure patterns
        "hire_signal":          core_result.get("hire_signal", {}),
        "failure_patterns":     core_result.get("failure_patterns", []),

        # ── HR-specific behavioral analysis (populated only for hr rounds) ──
        "star_story_matrix":            core_result.get("star_story_matrix", []),
        "behavioral_category_coverage": core_result.get("behavioral_category_coverage", []),
        "communication_pattern":        core_result.get("communication_pattern", ""),
        "culture_fit_narrative":        core_result.get("culture_fit_narrative", ""),
        "behavioral_red_flags":         core_result.get("behavioral_red_flags", []),
        # HR Phase 1 — new professional report fields
        "key_signals":                  core_result.get("key_signals", []),
        "competency_scorecard":         core_result.get("competency_scorecard", []),
        "hire_confidence":              _compute_hire_confidence(overall_pct, question_scores),
        "interview_datetime":           session.get("created_at") or session.get("started_at") or "",
        "job_role":                     job_role,
        # HR Phase 2 — visual enhancement fields
        "culture_fit_dimensions":       core_result.get("culture_fit_dimensions", []),
        "eq_profile":                   core_result.get("eq_profile", {}),
        # HR Phase 3 — coaching & confidence fields
        "coachability_index":           core_result.get("coachability_index", {}),
        "leadership_ic_fit":            core_result.get("leadership_ic_fit", {}),
        "reference_check_triggers":     core_result.get("reference_check_triggers", []),
        "assessment_confidence":        core_result.get("assessment_confidence", {}),
        # HR Report Enhancement — Group A new fields
        "explicit_red_flags":           core_result.get("explicit_red_flags", []) if round_type == "hr" else [],
        "seniority_calibration":        core_result.get("seniority_calibration", {}) if round_type == "hr" else {},
        "answer_depth_progression":     _compute_answer_depth_progression(question_scores) if round_type == "hr" else {},
        # HR Report Enhancement — Group B new fields
        "peer_benchmarking":            _compute_peer_benchmarking(overall_pct, radar_scores, round_type) if round_type == "hr" else {},
        "role_gap_analysis":            core_result.get("role_gap_analysis", {}) if round_type == "hr" else {},
        "story_uniqueness":             core_result.get("story_uniqueness", {}) if round_type == "hr" else {},
        "model_answer_comparison":      core_result.get("model_answer_comparison", []) if round_type == "hr" else [],
        # HR Report Enhancement — Group C new fields
        "pipeline_followup_questions":  core_result.get("pipeline_followup_questions", []) if round_type == "hr" else [],
        "hr_improvement_plan":          core_result.get("hr_improvement_plan", {}) if round_type == "hr" else {},
        "executive_brief":              _compute_executive_brief(
            hire_recommendation=core_result.get("hire_recommendation", ""),
            hire_confidence=_compute_hire_confidence(overall_pct, question_scores),
            overall_score=overall_pct,
            key_signals=core_result.get("key_signals", []),
            explicit_red_flags=core_result.get("explicit_red_flags", []),
            competency_scorecard=core_result.get("competency_scorecard", []),
            reference_check_triggers=core_result.get("reference_check_triggers", []),
            summary=core_result.get("summary", ""),
            job_role=job_role,
        ) if round_type == "hr" else {},

        # Per-question
        "per_question_analysis": per_question_analysis,
        "question_scores":      question_scores,
        "skill_ratings":        [{"skill": k, "score": v} for k, v in radar_scores.items()],

        # Recommendations & tips
        "study_recommendations": cv_result.get("study_recommendations", []),
        "interview_tips":       core_result.get("interview_tips", []),
        "recommendations":      [r.get("topic", "") for r in cv_result.get("study_recommendations", [])],

        # CV Audit + Roadmap
        "cv_audit":             cv_result.get("cv_audit", {}),
        "study_roadmap":        cv_result.get("study_roadmap", {}),
        "mock_ready_topics":    cv_result.get("mock_ready_topics", []),
        "not_ready_topics":     cv_result.get("not_ready_topics", []),

        # ── NEW: Communication & Behavioral (Stage 3) ──
        "communication_breakdown": comm_result.get("communication_breakdown", {}),
        "six_axis_radar":          comm_result.get("six_axis_radar", {}),
        "bs_flag":                 comm_result.get("bs_flag", []),
        "pattern_groups":          comm_result.get("pattern_groups", []),
        "blind_spots":             comm_result.get("blind_spots", []),
        "what_went_wrong":         comm_result.get("what_went_wrong", ""),

        # ── NEW: Voice Analysis ──
        "voice_metrics":          voice_metrics,
        "delivery_consistency":   delivery_consistency,
        "filler_heatmap":         filler_heatmap,
        "transcript_annotated":   transcript_annotated,
        "audio_clips_index":      audio_map if audio_map else None,
        "proctoring_summary":     proctoring_summary,
        "interview_integrity":    interview_integrity,

        # ── NEW: Company Fit Calibration (Phase 3) ──
        "company_fit":            company_fit or None,

        # ── NEW: Cross-Session Intelligence (Phase 4) ──
        "skill_decay":            cross_session.get("skill_decay", []),
        "repeated_offenders":     cross_session.get("repeated_offenders", []),
        "growth_trajectory":      cross_session.get("growth_trajectory"),
        "improvement_vs_last":    improvement_vs_last,

        # ── NEW: Playbook & Resources (Stage 4) ──
        "swot":                    playbook_result.get("swot", {}),
        "skills_to_work_on":       playbook_result.get("skills_to_work_on", []),
        "thirty_day_plan":         playbook_result.get("thirty_day_plan", {}),
        "auto_resources":          playbook_result.get("auto_resources", []),
        "follow_up_questions":     playbook_result.get("follow_up_questions", []),
        "next_interview_blueprint": playbook_result.get("next_interview_blueprint"),

        # ── NEW: Code Quality Metrics (DSA rounds) ──
        "code_quality_metrics": code_quality_metrics,

        # ── NEW: Peer Comparison / Industry Benchmarking ──
        "peer_comparison": peer_comparison,

        # ── NEW: Adaptive Study Schedule (Spaced Repetition) ──
        "study_schedule": study_schedule,

        # ── NEW: Preparation Checklist ──
        "checklist": checklist_items,

        # ── NEW: Time-per-question breakdown ──
        "time_per_question": time_per_question,

        # Meta
        "confidence_score": 85,

        # ── Report quality metadata ──
        "report_quality":   report_quality,
        "failed_sections":  failed_sections,
        "stage_errors":     failed_stages,
    }

    # ── Build hiring team summary (deterministic — uses finalized core fields) ──
    report_payload["hiring_summary"] = _build_hiring_summary(
        overall_pct=overall_pct,
        grade=report_payload.get("grade", ""),
        hire_recommendation=report_payload.get("hire_recommendation", ""),
        strong_areas=report_payload.get("strong_areas", []),
        weak_areas=report_payload.get("weak_areas", []),
        interview_integrity=interview_integrity,
        summary=report_payload.get("summary", ""),
        hire_confidence=report_payload.get("hire_confidence", "Medium"),
    )

    # ── Enforce grade + hire_recommendation consistency with numeric score ────
    report_payload = _enforce_grade_consistency(report_payload, overall_pct)

    # ── Normalize types before persist and emit ───────────────────────────────
    report_payload = _normalize_report_payload(report_payload)

    # ── Persist ───────────────────────────────────────────────────────────────
    # Each DB call is isolated so a failure in status-update calls does NOT
    # falsely report the whole persist as failed. The report row existence is
    # the source of truth for has_report on the dashboard (Bug #2 fix) — so
    # even if mark/update_session fail, the user still sees the View Report button.
    persist_ok = False
    persist_error_msg = None

    # Step 1 — Save the report row. This is the only call that sets persist_ok.
    try:
        save_report(session_id, report_payload)
        persist_ok = True
    except Exception as e:
        persist_error_msg = str(e)
        print(f"[report/sse] save_report failed: {e}")
        try:
            mark_report_persist_failed(session_id, persist_error_msg)
        except Exception:
            pass  # DB is truly unavailable; still deliver the report to the user

    # Step 2 — Update report_status column. Best-effort; does NOT affect persist_ok.
    if persist_ok:
        try:
            if report_quality == "degraded":
                mark_report_degraded(session_id, failed_stages)
            else:
                mark_report_complete(session_id)
        except Exception as e:
            print(f"[report/sse] mark_report_status failed (non-fatal): {e}")

    # Step 3 — Update session status. Best-effort; does NOT affect persist_ok.
    if persist_ok:
        try:
            status_val = "report_degraded" if report_quality == "degraded" else "completed"
            update_session(session_id, {"status": status_val})
        except Exception as e:
            print(f"[report/sse] update_session failed (non-fatal): {e}")

    yield _sse({
        "stage": "complete",
        "progress": 100,
        "report": report_payload,
        "persist_status": "saved" if persist_ok else "failed",
    })


async def _safe_generate_report_sse(session_id: str, user_id: str):
    """
    Thin safety wrapper around _generate_report_sse.
    If the inner generator raises an unhandled exception at any point, this
    wrapper catches it and yields a terminal {"stage": "error"} event so the
    frontend never hangs on an abruptly closed stream (C1 fix).
    """
    def _sse(payload: dict) -> str:
        return f"data: {json.dumps(payload)}\n\n"

    try:
        async for chunk in _generate_report_sse(session_id, user_id):
            yield chunk
    except Exception as e:
        print(f"[report/sse] Unhandled generator crash for session {session_id}: {e}")
        yield _sse({
            "stage": "error",
            "error": "An unexpected error occurred during report generation. Please try again.",
        })


# ── GET /api/v1/report/:session_id  (SSE stream) ─────────────────────────────
@router.get("/mock-{round_type}")
async def get_mock_report(round_type: str):
    """Public endpoint — returns sample report data for UI development/testing."""
    return _ok(data=_mock_report(f"mock-{round_type}", round_type=round_type))


@router.get("/{session_id}")
async def get_or_generate_report(
    session_id: str,
    user: dict = Depends(get_current_user),
):
    """
    If a cached report exists → return it immediately (JSON).
    Otherwise → stream SSE events during 4-stage generation,
    ending with data: {"stage": "complete", "report": {...}}.
    """
    # ── Cache check ───────────────────────────────────────────────────────────
    # Serve ANY existing report row — don't regenerate if a row exists, even if
    # it only has Stage 1 data (prevents looping regeneration on partial saves).
    #
    # DSA exception: a DSA report generated before all submissions arrived
    # will be cached with question_scores: []. Detect staleness by comparing
    # cached question count vs live session transcript length — if the session
    # has grown since the report was generated, invalidate and regenerate.
    try:
        cached = get_report(session_id)
        if cached and _is_complete_report(cached):
            if cached.get("round_type") == "dsa":
                try:
                    live_sess = get_session(session_id)
                    if not live_sess:
                        return _err("Session not found.", status=404)
                    if live_sess.get("user_id") != user["user_id"]:
                        return _err("Access denied.", status=403)
                    live_q_count    = len((live_sess or {}).get("transcript") or [])
                    cached_q_count  = len(cached.get("question_scores") or [])
                    if live_q_count <= cached_q_count:
                        return _ok(data=_normalize_report_payload(cached))
                    # Session has more submissions than the cached report captured.
                    # Fall through to regeneration — session already loaded above.
                    print(f"[report] DSA stale cache {session_id}: "
                          f"{cached_q_count} qs in cache vs {live_q_count} in transcript → regenerating")
                except RuntimeError:
                    if _DEBUG:
                        return _ok(data=_mock_report(session_id))
                    return _err("Database not configured.", status=503)
                except Exception:
                    # DB error during staleness check — serve cache to avoid blocking user
                    return _ok(data=_normalize_report_payload(cached))
            else:
                return _ok(data=_normalize_report_payload(cached))
        if cached:
            # A row exists but is still too sparse (e.g. a schema migration column
            # was just added). Log and fall through to regeneration only when
            # the row is truly incomplete (missing overall_score / per_question_analysis).
            print(f"[report] Cached row found but incomplete for {session_id}, regenerating")
    except RuntimeError:
        if _DEBUG:
            return _ok(data=_mock_report(session_id))
        return _err("Database not configured. Set SUPABASE_URL and SUPABASE_KEY.", status=503)
    except Exception:
        pass

    # ── Session ownership check ───────────────────────────────────────────────
    try:
        session = get_session(session_id)
        if not session:
            return _err("Session not found.", status=404)
        if session.get("user_id") != user["user_id"]:
            return _err("Access denied.", status=403)
    except RuntimeError:
        if _DEBUG:
            return _ok(data=_mock_report(session_id))
        return _err("Database not configured. Set SUPABASE_URL and SUPABASE_KEY.", status=503)
    except Exception as e:
        return _err(str(e), status=500)

    # ── Stream SSE generation ─────────────────────────────────────────────────
    return StreamingResponse(
        _safe_generate_report_sse(session_id, user["user_id"]),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ── GET /api/v1/report/:session_id/cached  (cached only, no generation) ──────
@router.get("/{session_id}/cached")
async def get_cached_report(
    session_id: str,
    user: dict = Depends(get_current_user),
):
    """Return cached report only. Returns 404 if not yet generated."""
    try:
        cached = get_report(session_id)
        if not cached or not _is_complete_report(cached):
            return _err("Full report not yet generated.", status=404)
        if cached.get("session_id"):
            session = get_session(session_id)
            if session and session.get("user_id") != user["user_id"]:
                return _err("Access denied.", status=403)
        return _ok(data=_normalize_report_payload(cached))
    except RuntimeError:
        if _DEBUG:
            return _ok(data=_mock_report(session_id))
        return _err("Database not configured. Set SUPABASE_URL and SUPABASE_KEY.", status=503)
    except Exception as e:
        return _err(str(e), status=500)


# ── POST /api/v1/report/:session_id/retry-save ────────────────────────────────
@router.post("/{session_id}/retry-save")
async def retry_save_report(
    session_id: str,
    body: dict,
    user: dict = Depends(get_current_user),
):
    """
    Called by the frontend when a persist_failed SSE event was received.
    Accepts the full report payload and attempts to save it to the database.
    """
    try:
        session = get_session(session_id)
        if not session:
            return _err("Session not found.", status=404)
        if session.get("user_id") != user["user_id"]:
            return _err("Access denied.", status=403)
    except RuntimeError:
        return _err("Database not configured.", status=503)
    except Exception as e:
        return _err(str(e), status=500)

    report_payload = body.get("report")
    if not report_payload or not isinstance(report_payload, dict):
        return _err("Missing or invalid report payload.", status=422)

    # Step 1 — Save the report row. Only this determines the success response.
    try:
        save_report(session_id, report_payload)
    except Exception as e:
        try:
            mark_report_persist_failed(session_id, str(e))
        except Exception:
            pass
        return _err(f"Save failed: {e}", status=503)

    # Step 2 — Update report_status. Best-effort; does not affect the response.
    report_quality = report_payload.get("report_quality", "full")
    try:
        if report_quality == "degraded":
            mark_report_degraded(session_id, report_payload.get("stage_errors") or {})
        else:
            mark_report_complete(session_id)
    except Exception as e:
        print(f"[retry-save] mark_report_status failed (non-fatal): {e}")

    # Step 3 — Update session status. Best-effort; does not affect the response.
    try:
        status_val = "report_degraded" if report_quality == "degraded" else "completed"
        update_session(session_id, {"status": status_val})
    except Exception as e:
        print(f"[retry-save] update_session failed (non-fatal): {e}")

    return _ok(data={"saved": True})


# ── POST /api/v1/report/:session_id/retry-stages ─────────────────────────────
@router.post("/{session_id}/retry-stages")
async def retry_failed_stages(
    session_id: str,
    body: dict,
    user: dict = Depends(get_current_user),
):
    """
    Re-runs only the specified failed stages (stage3_communication, stage4_playbook)
    and merges the results back into the stored report payload.
    Called by the frontend SectionRetryCard when a user clicks "Regenerate Section".
    """
    try:
        session = get_session(session_id)
        if not session:
            return _err("Session not found.", status=404)
        if session.get("user_id") != user["user_id"]:
            return _err("Access denied.", status=403)
    except RuntimeError:
        return _err("Database not configured.", status=503)
    except Exception as e:
        return _err(str(e), status=500)

    stages = body.get("stages", [])
    if not stages or not isinstance(stages, list):
        return _err("Missing or invalid 'stages' list.", status=422)

    valid_stages = {"stage3_communication", "stage4_playbook"}
    unknown = set(stages) - valid_stages
    if unknown:
        return _err(f"Unknown stages: {sorted(unknown)}. Valid: {sorted(valid_stages)}", status=422)

    # Load existing partial report
    cached = get_report(session_id)
    if not cached:
        return _err("No existing report found to merge into.", status=404)

    # Pull context needed to re-run stages
    question_scores = cached.get("question_scores") or []
    voice_metrics = cached.get("voice_metrics")
    delivery_consistency = cached.get("delivery_consistency")
    round_type = cached.get("round_type", "technical_fundamentals")
    overall_pct = cached.get("overall_score", 0.0)
    weak_areas = cached.get("weak_areas", [])
    strong_areas = cached.get("strong_areas", [])
    failure_patterns = cached.get("failure_patterns", [])
    company_fit = cached.get("company_fit") or {}
    target_company = cached.get("target_company", "")
    candidate_year = session.get("candidate_year", "")

    merged_fields: list[str] = []
    new_failed_stages: dict[str, str] = dict(cached.get("stage_errors") or {})

    # Re-run stage3 if requested
    if "stage3_communication" in stages:
        try:
            comm_result = await _gen_communication(
                question_scores=question_scores,
                voice_metrics=voice_metrics,
                delivery_consistency=delivery_consistency,
                round_type=round_type,
                overall_score=overall_pct,
            )
            for field in ["communication_breakdown", "six_axis_radar", "bs_flag",
                          "pattern_groups", "blind_spots", "what_went_wrong"]:
                cached[field] = comm_result.get(field, cached.get(field))
            merged_fields.extend(["communication_breakdown", "six_axis_radar", "bs_flag",
                                   "pattern_groups", "blind_spots", "what_went_wrong"])
            new_failed_stages.pop("stage3_communication", None)
        except Exception as e:
            new_failed_stages["stage3_communication"] = str(e)
            print(f"[retry-stages] Stage 3 retry failed: {e}")

    # Re-run stage4 if requested
    if "stage4_playbook" in stages:
        try:
            playbook_result = await _gen_playbook(
                weak_areas=weak_areas,
                strong_areas=strong_areas,
                pattern_groups=failure_patterns,
                company_fit=company_fit,
                round_type=round_type,
                overall_score=overall_pct,
                target_company=target_company,
                candidate_year=candidate_year,
            )
            for field in ["swot", "skills_to_work_on", "thirty_day_plan",
                          "auto_resources", "follow_up_questions", "next_interview_blueprint"]:
                cached[field] = playbook_result.get(field, cached.get(field))
            merged_fields.extend(["swot", "skills_to_work_on", "thirty_day_plan",
                                   "auto_resources", "follow_up_questions", "next_interview_blueprint"])
            new_failed_stages.pop("stage4_playbook", None)
        except Exception as e:
            new_failed_stages["stage4_playbook"] = str(e)
            print(f"[retry-stages] Stage 4 retry failed: {e}")

    # Recompute quality after retry
    _core_still_failed = any(k in new_failed_stages for k in ("stage1_core", "stage2_cv"))
    _secondary_still_failed = any(k in new_failed_stages for k in ("stage3_communication", "stage4_playbook"))
    if _core_still_failed:
        new_quality = "degraded"
    elif _secondary_still_failed:
        new_quality = "partial"
    else:
        new_quality = "full"

    # Rebuild failed_sections list
    _STAGE_SECTION_MAP = {
        "stage1_core": ["overall_score", "radar_scores", "grade", "hire_recommendation",
                        "strong_areas", "weak_areas", "failure_patterns", "per_question_analysis"],
        "stage2_cv":   ["cv_audit", "study_roadmap", "study_recommendations",
                        "mock_ready_topics", "not_ready_topics"],
        "stage3_communication": ["communication_breakdown", "six_axis_radar", "bs_flag",
                                 "pattern_groups", "blind_spots", "what_went_wrong"],
        "stage4_playbook": ["swot", "thirty_day_plan", "skills_to_work_on",
                            "auto_resources", "follow_up_questions", "next_interview_blueprint"],
    }
    new_failed_sections: list[str] = []
    for stage_key in new_failed_stages:
        new_failed_sections.extend(_STAGE_SECTION_MAP.get(stage_key, []))

    cached["report_quality"] = new_quality
    cached["failed_sections"] = new_failed_sections
    cached["stage_errors"] = new_failed_stages

    # Normalize and persist
    cached = _normalize_report_payload(cached)
    try:
        save_report(session_id, cached)
        if new_quality != "degraded":
            mark_report_complete(session_id)
            update_session(session_id, {"status": "completed"})
        else:
            mark_report_degraded(session_id, new_failed_stages)
    except Exception as e:
        print(f"[retry-stages] Persist after retry failed: {e}")

    return _ok(data={
        "merged_fields": merged_fields,
        "report_quality": new_quality,
        "failed_sections": new_failed_sections,
        "report": cached,
    })
