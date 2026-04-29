"""
routers/reports.py — Comprehensive report generation & retrieval.

POST /api/v1/reports/generate      — generate from session + Groq, persist
GET  /api/v1/reports/:session_id   — fetch saved report
GET  /api/v1/reports/user/:user_id — list user's past reports
"""
import json
import uuid
import os
import asyncio
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional

from auth import get_current_user
from services.db_service import get_session, get_profile, get_report, save_report
from prompts.report_prompt import build_report_prompt

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────
def _ok(data: dict, message: str = "Success") -> dict:
    return {"success": True, "data": data, "error": None, "message": message}


def _err(error: str, status: int = 400):
    return JSONResponse(
        status_code=status,
        content={"success": False, "data": None, "error": error},
    )


def _grade(score: int) -> str:
    if score >= 90: return "A+"
    if score >= 80: return "A"
    if score >= 70: return "B+"
    if score >= 60: return "B"
    if score >= 50: return "C+"
    if score >= 40: return "C"
    return "D"


def _hire(score: int) -> str:
    if score >= 85: return "Strong Yes"
    if score >= 70: return "Yes"
    if score >= 50: return "Maybe"
    return "No"


def _mock_report(session_id: str, round_type: str = "technical") -> dict:
    """Demo report when Supabase / Groq unavailable."""
    return {
        "report_id":       "mock_" + session_id[:8],
        "session_id":      session_id,
        "overall_score":   72,
        "grade":           "B+",
        "summary":         "The candidate demonstrated solid foundational knowledge with clear communication. They performed well on core concepts but showed gaps in screening accuracy and edge case handling. With targeted practice, they can significantly improve.",
        "hire_recommendation": "Yes",
        "radar_scores": {
            "technical_knowledge": 70,
            "problem_solving":     65,
            "communication":       80,
            "confidence":          75,
            "depth_of_knowledge":  60,
        },
        "strong_areas": [
            {"area": "Communication", "evidence": "Explained concepts clearly and structured answers well.", "score": 80},
            {"area": "Core Concepts", "evidence": "Demonstrated solid understanding of fundamental topics.", "score": 75},
        ],
        "weak_areas": [
            {"area": "Screening Accuracy", "what_was_missed": "Core concept recall under time pressure", "how_to_improve": "Review explanations and practice timed company-style MCQs.", "score": 45},
            {"area": "Edge Cases",    "what_was_missed": "Null inputs, empty arrays, overflow scenarios", "how_to_improve": "Practice defensive coding. Always ask 'what if?' before finalising a solution.", "score": 50},
        ],
        "per_question_analysis": [],
        "study_recommendations": [
            {"topic": "Company-Specific Screening Prep", "priority": "High",   "resources": ["LeetCode Discuss", "GeeksForGeeks"], "reason": "Largest gap identified in the interview."},
            {"topic": "DSA Practice",  "priority": "Medium", "resources": ["LeetCode", "NeetCode.io"],                    "reason": "Edge cases and optimal solutions need reinforcement."},
            {"topic": "Networking",    "priority": "Low",    "resources": ["CS50 on YouTube", "Beej's Guide to Networking"], "reason": "Basic networking questions were partially answered."},
        ],
        "compared_to_level": f"Performs at Junior level for {round_type} interviews",
        "round_type": round_type,
        "is_mock": True,
    }


def _parse_report_json(raw: str) -> Optional[dict]:
    try:
        cleaned = raw.strip().strip("```json").strip("```").strip()
        return json.loads(cleaned)
    except Exception:
        return None


async def _call_groq(prompt: str, transcript_qa: str, max_tokens: int = 3000) -> str:
    """Call Groq with the report prompt."""
    loop = asyncio.get_running_loop()
    def _sync():
        from services.api_manager import create_chat_completion
        return create_chat_completion(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user",   "content": "Generate the complete interview evaluation report now."},
            ],
            temperature=0.3,
            max_tokens=max_tokens,
        ).choices[0].message.content
    return await loop.run_in_executor(None, _sync)


# ── POST /generate ─────────────────────────────────────────────────────────────
class GenerateReportRequest(BaseModel):
    session_id: str


@router.post("/generate")
async def generate_report(
    body: GenerateReportRequest,
    user: dict = Depends(get_current_user),
):
    """
    1. Load session + profile from DB
    2. Build Groq prompt with full transcript
    3. Call Groq (max_tokens=3000)
    4. Parse + enrich report JSON
    5. Persist to Supabase
    6. Return { report_id, report }
    """
    # ── Load session ──────────────────────────────────────────────────────────
    try:
        session = get_session(body.session_id)
    except RuntimeError:
        return _ok(data={"report_id": "mock", "report": _mock_report(body.session_id)})
    except Exception as e:
        return _err(str(e), status=500)

    if not session:
        return _err("Session not found.", status=404)
    if session.get("user_id") != user["user_id"]:
        return _err("Access denied.", status=403)

    # ── Try cached report first ────────────────────────────────────────────────
    try:
        cached = get_report(body.session_id)
        if cached:
            return _ok(data={"report_id": cached.get("id", "cached"), "report": cached})
    except Exception:
        pass

    # ── Load profile ───────────────────────────────────────────────────────────
    profile = {}
    try:
        profile_id = session.get("profile_id")
        if profile_id:
            raw = get_profile(profile_id)
            profile = (raw or {}).get("parsed_data") or {}
    except Exception:
        pass

    round_type = session.get("round_type", "technical")
    transcript = session.get("transcript") or []

    # ── Build prompt + call Groq ───────────────────────────────────────────────
    prompt = build_report_prompt(session=session, profile=profile)
    report_data = None
    try:
        raw_response = await _call_groq(prompt, "", max_tokens=3000)
        report_data  = _parse_report_json(raw_response)
    except Exception:
        pass

    # ── Fallback / enrich ─────────────────────────────────────────────────────
    if not report_data:
        valid = [e.get("score", 0) for e in transcript if e.get("score")]
        raw_avg = (sum(valid) / len(valid) * 10) if valid else 50
        overall = int(min(100, max(0, raw_avg)))
        report_data = _mock_report(body.session_id, round_type)
        report_data["overall_score"] = overall
        report_data["grade"]         = _grade(overall)
        report_data["hire_recommendation"] = _hire(overall)

    # Enrich with session metadata
    report_data["session_id"] = body.session_id
    report_data["round_type"] = round_type
    report_data["difficulty"] = session.get("difficulty", "medium")
    report_data["candidate_name"] = profile.get("name") or "Candidate"
    report_data.setdefault("grade", _grade(report_data.get("overall_score", 50)))
    report_data.setdefault("hire_recommendation", _hire(report_data.get("overall_score", 50)))

    # Fill per_question_analysis from transcript if Groq missed it
    if not report_data.get("per_question_analysis") and transcript:
        verdicts = ["Poor", "Needs Improvement", "Satisfactory", "Good", "Excellent"]
        report_data["per_question_analysis"] = [
            {
                "question_id":    f"Q{i+1}",
                "question_text":  e.get("question", ""),
                "answer_summary": (e.get("answer") or "")[:150],
                "score":          e.get("score") or 0,
                "verdict":        verdicts[min(4, (e.get("score") or 0) * 5 // 11)],
                "key_insight":    e.get("feedback") or "Review this topic further.",
            }
            for i, e in enumerate(transcript)
        ]

    report_id = str(uuid.uuid4())
    report_data["report_id"] = report_id

    # ── Persist ────────────────────────────────────────────────────────────────
    try:
        save_report(body.session_id, report_data)
    except Exception:
        pass

    return _ok(data={"report_id": report_id, "report": report_data})


# ── GET /:session_id ──────────────────────────────────────────────────────────
@router.get("/{session_id}")
async def get_report_endpoint(
    session_id: str,
    user: dict = Depends(get_current_user),
):
    """Fetch a saved report for the given session."""
    try:
        session = get_session(session_id)
        if not session:
            return _err("Session not found.", status=404)
        if session.get("user_id") != user["user_id"]:
            return _err("Access denied.", status=403)

        cached = get_report(session_id)
        if cached:
            return _ok(data=cached)
    except RuntimeError:
        return _ok(data=_mock_report(session_id))
    except Exception as e:
        return _err(str(e), status=500)

    # Not cached — trigger generation
    from fastapi import Request
    class _B(BaseModel):
        session_id: str
    return await generate_report(_B(session_id=session_id), user)


# ── GET /user/:user_id ────────────────────────────────────────────────────────
@router.get("/user/{user_id}")
async def get_user_reports(
    user_id: str,
    user: dict = Depends(get_current_user),
):
    """Return a summary list of all reports for a user."""
    if user["user_id"] != user_id:
        return _err("Access denied.", status=403)

    try:
        from services.db_service import get_user_reports as _get_ur
        reports = _get_ur(user_id)
        return _ok(data={"reports": reports or []})
    except RuntimeError:
        return _ok(data={"reports": []})
    except Exception as e:
        return _err(str(e), status=500)
