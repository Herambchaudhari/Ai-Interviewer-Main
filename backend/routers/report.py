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
import json
import asyncio
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, StreamingResponse
from auth import get_current_user
from services.groq_service import _achat, _clean, _gen_core, _gen_cv_audit
from services.db_service import (
    get_session, get_report, save_report, get_profile,
    compute_improvement_vs_last, get_past_reports_for_analysis, update_session,
)
from services.web_researcher import search_company_trends
from services.company_intelligence import analyze_company_fit
from services.session_history_analyzer import analyze_cross_session
from services.voice_analyzer import analyze_session_voice
from prompts.stage3_prompt import build_communication_analysis_prompt
from prompts.stage4_prompt import build_playbook_prompt

router = APIRouter()

_ROUND_AGENT_LABELS = {
    "technical":    "Technical",
    "hr":           "HR",
    "dsa":          "DSA",
    "system_design": "System Design",
}


def _ok(data: dict, message: str = "Success") -> dict:
    return {"success": True, "data": data, "error": None, "message": message}


def _err(error: str, status: int = 400):
    return JSONResponse(
        status_code=status,
        content={"success": False, "data": None, "error": error},
    )


def _mock_report(session_id: str, round_type: str = "technical") -> dict:
    return {
        "session_id":    session_id,
        "overall_score": 72,
        "round_type":    round_type,
        "interview_agent": _ROUND_AGENT_LABELS.get(round_type, "Technical"),
        "grade": "B+",
        "hire_recommendation": "Yes",
        "summary": "Solid overall performance. Focus on system design to level up.",
        "radar_scores": {
            "OOP & Design Patterns": 70, "Data Structures & Algorithms": 65,
            "DBMS & SQL": 72, "OS & CN Concepts": 55,
            "Project Knowledge": 78, "Communication": 80,
        },
        "six_axis_radar": {
            "Communication Clarity": 75, "Confidence": 65,
            "Answer Structure": 70, "Pacing": 72,
            "Relevance": 80, "Example Quality": 60,
        },
        "communication_breakdown": {
            "Communication Clarity": 75, "Confidence": 65,
            "Answer Structure": 70, "Pacing": 72,
            "Relevance": 80, "Example Quality": 60,
        },
        "strong_areas": [{"area": "Communication", "evidence": "Explained concepts clearly.", "score": 80}],
        "weak_areas":   [{"area": "System design depth", "what_was_missed": "Scalability trade-offs", "how_to_improve": "Study ByteByteGo.", "score": 45}],
        "what_went_wrong": "Candidate struggled with depth in system design and distributed systems concepts.",
        "swot": {
            "strengths":     ["Clear communication", "Good OOP knowledge"],
            "weaknesses":    ["System design depth", "Distributed systems"],
            "opportunities": ["Strong communication can shine in HR rounds"],
            "threats":       ["Weak system design will block FAANG-level interviews"],
        },
        "per_question_analysis": [],
        "study_recommendations": [{"topic": "System Design", "priority": "High", "resources": ["ByteByteGo"], "reason": "Biggest gap."}],
        "thirty_day_plan": {"week_1": [], "week_2": [], "week_3": [], "week_4": []},
        "follow_up_questions": [],
        "skills_to_work_on": [{"skill": "System Design", "priority": "High", "reason": "Scored lowest", "resources": ["ByteByteGo"]}],
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
        "market_intelligence": None,
        "company_fit": None, "skill_decay": [],
        "repeated_offenders": [], "growth_trajectory": None,
        "interview_tips": ["Use the STAR method for behavioural questions."],
        "red_flags": [],
        "next_interview_blueprint": None,
        "auto_resources": [],
        "improvement_vs_last": None,
        "confidence_score": 70,
        "is_mock": True,
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
    try:
        content = await _achat([{"role": "user", "content": prompt}], temperature=0.3, max_tokens=3500)
        result = json.loads(_clean(content))
        for k, v in _EMPTY.items():
            result.setdefault(k, v)
        return result
    except Exception as e:
        print(f"[report] Stage 3 (communication) failed: {e}")
        return _EMPTY


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
    try:
        content = await _achat([{"role": "user", "content": prompt}], temperature=0.4, max_tokens=4000)
        result = json.loads(_clean(content))
        for k, v in _EMPTY.items():
            result.setdefault(k, v)
        return result
    except Exception as e:
        print(f"[report] Stage 4 (playbook) failed: {e}")
        return _EMPTY


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
                target_company = session.get("target_company") or (companies[0] if companies else "")
    except Exception as e:
        print(f"[report/sse] Profile fetch failed: {e}")

    round_type = session.get("round_type", "technical")
    difficulty = session.get("difficulty", "medium")
    job_role = session.get("job_role") or "Software Engineer"
    candidate_year = student_meta.get("year", "")

    # ── Build question_scores from transcript ─────────────────────────────────
    transcript: list = session.get("transcript") or []
    question_scores = []
    for entry in transcript:
        question_scores.append({
            "question_id":        entry.get("question_id", ""),
            "question_text":      entry.get("question", ""),
            "answer_text":        entry.get("answer", ""),
            "score":              entry.get("score") or 0,
            "feedback":           entry.get("feedback", ""),
            "strengths":          entry.get("strengths", []),
            "improvements":       entry.get("improvements", []),
            "verdict":            entry.get("verdict", ""),
            "key_concept_missed": entry.get("key_concept_missed", ""),
            "answer_summary":     entry.get("answer_summary", ""),
            "category":           entry.get("category", round_type),
            "red_flag_detected":  entry.get("red_flag_detected", ""),
        })

    valid_scores = [q["score"] for q in question_scores if q["score"]]
    overall_raw  = round(sum(valid_scores) / len(valid_scores), 1) if valid_scores else 0.0
    overall_pct  = round(overall_raw * 10, 1)

    # ── Run voice analysis on stored transcript ───────────────────────────────
    voice_result = {}
    try:
        voice_result = analyze_session_voice(transcript_entries=transcript)
    except Exception as e:
        print(f"[report/sse] Voice analysis failed: {e}")

    voice_metrics       = voice_result.get("voice_metrics")
    delivery_consistency = voice_result.get("delivery_consistency")
    filler_heatmap      = voice_result.get("filler_heatmap")
    transcript_annotated = voice_result.get("transcript_annotated")

    # ── Stage 1+2: core + cv_audit + market + company_fit + cross-session ────
    yield _sse({"stage": "core_analysis", "progress": 10, "label": "Scoring your answers..."})

    market_context = ""
    if target_company:
        try:
            market_context = await search_company_trends(target_company)
        except Exception:
            pass

    past_reports = []
    try:
        past_reports = get_past_reports_for_analysis(
            user_id=user_id, exclude_session_id=session_id, limit=10
        )
    except Exception:
        pass

    # Fire Stage 1 + Stage 2 + company_fit in parallel
    core_task    = _gen_core(round_type, question_scores, overall_raw, session, profile_parsed, market_context)
    cv_task      = _gen_cv_audit(profile_parsed, question_scores)
    company_task = analyze_company_fit(
        candidate_score=overall_pct,
        round_type=round_type,
        radar_scores={},
        weak_areas=[],
        strong_areas=[],
        target_company=target_company,
        job_role=job_role,
    ) if target_company else asyncio.coroutine(lambda: {})()

    yield _sse({"stage": "core_analysis", "progress": 25, "label": "Analyzing performance depth..."})

    core_result, cv_result, company_fit_prelim = await asyncio.gather(
        core_task, cv_task, company_task, return_exceptions=True
    )

    if isinstance(core_result, Exception):
        print(f"[report/sse] Core failed: {core_result}")
        core_result = {}
    if isinstance(cv_result, Exception):
        print(f"[report/sse] CV audit failed: {cv_result}")
        cv_result = {}
    if isinstance(company_fit_prelim, Exception):
        company_fit_prelim = {}

    # Now rerun company_fit with actual radar scores from core
    radar_scores = core_result.get("radar_scores", {})
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
    if isinstance(comm_result, Exception):
        print(f"[report/sse] Stage 3 failed: {comm_result}")
        comm_result = {}
    if isinstance(playbook_result, Exception):
        print(f"[report/sse] Stage 4 failed: {playbook_result}")
        playbook_result = {}

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

    # ── Market intelligence payload ───────────────────────────────────────────
    market_intel = None
    if target_company and market_context:
        market_intel = {
            "target_company": target_company,
            "raw_context": market_context[:800],
        }

    # ── Assemble final payload ────────────────────────────────────────────────
    report_payload = {
        # Identity
        "session_id":           session_id,
        "round_type":           round_type,
        "difficulty":           difficulty,
        "interview_agent":      _ROUND_AGENT_LABELS.get(round_type, "Technical"),
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
        "category_breakdown":   core_result.get("category_breakdown", []),

        # Strong / Weak
        "strong_areas":         core_result.get("strong_areas", []),
        "weak_areas":           core_result.get("weak_areas", []),
        "red_flags":            core_result.get("red_flags", []),

        # Hire signal + failure patterns
        "hire_signal":          core_result.get("hire_signal", {}),
        "failure_patterns":     core_result.get("failure_patterns", []),

        # Per-question
        "per_question_analysis": core_result.get("per_question_analysis", question_scores),
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

        # Market Intelligence
        "market_intelligence":  market_intel,

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
        "audio_clips_index":      None,  # populated separately if audio stored

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

        # Meta
        "confidence_score": 85,
    }

    # ── Persist ───────────────────────────────────────────────────────────────
    try:
        save_report(session_id, report_payload)
        update_session(session_id, {"status": "completed"})
    except Exception as e:
        print(f"[report/sse] Persist failed: {e}")

    yield _sse({"stage": "complete", "progress": 100, "report": report_payload})


# ── GET /api/v1/report/:session_id  (SSE stream) ─────────────────────────────
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
    # Check cache first
    try:
        cached = get_report(session_id)
        if cached:
            return _ok(data=cached)
    except RuntimeError:
        return _ok(data=_mock_report(session_id))
    except Exception:
        pass

    # Verify session exists before starting SSE
    try:
        session = get_session(session_id)
        if not session:
            return _err("Session not found.", status=404)
        if session.get("user_id") != user["user_id"]:
            return _err("Access denied.", status=403)
    except RuntimeError:
        return _ok(data=_mock_report(session_id))
    except Exception as e:
        return _err(str(e), status=500)

    # Stream SSE
    return StreamingResponse(
        _generate_report_sse(session_id, user["user_id"]),
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
        if not cached:
            return _err("Report not yet generated.", status=404)
        if cached.get("session_id"):
            session = get_session(session_id)
            if session and session.get("user_id") != user["user_id"]:
                return _err("Access denied.", status=403)
        return _ok(data=cached)
    except RuntimeError:
        return _ok(data=_mock_report(session_id))
    except Exception as e:
        return _err(str(e), status=500)
