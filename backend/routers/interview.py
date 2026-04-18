"""
Interview router — kept for legacy compatibility.
Core session logic has moved to routers/session.py (Phase 03+).
This router keeps the /interview/start and /interview/answer paths alive
without depending on the removed `models` or `supabase_service` modules.
"""
import uuid
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
from auth import get_current_user
from services.groq_service import generate_questions, evaluate_answer

router = APIRouter()


def _ok(data: dict) -> dict:
    return {"success": True, "data": data, "error": None}


def _err(error: str, status: int = 400):
    return JSONResponse(status_code=status, content={"success": False, "data": None, "error": error})


class SessionCreate(BaseModel):
    resume_id:     Optional[str] = None
    round_type:    str = "technical"
    difficulty:    str = "medium"
    num_questions: int = 8
    timer_minutes: int = 30


class AnswerSubmit(BaseModel):
    session_id:         str
    question_id:        str
    answer_text:        str
    time_taken_seconds: Optional[int] = None


@router.post("/start")
async def start_interview(body: SessionCreate, user: dict = Depends(get_current_user)):
    """Legacy endpoint — redirects clients to use /session/start instead."""
    questions = await generate_questions(
        resume_data={},
        round_type=body.round_type,
        difficulty=body.difficulty,
        num_questions=body.num_questions,
    )
    session_id = str(uuid.uuid4())
    for i, q in enumerate(questions):
        q["id"] = str(uuid.uuid4())
        q["order_index"] = i
    return _ok({
        "session_id":    session_id,
        "round_type":    body.round_type,
        "difficulty":    body.difficulty,
        "num_questions": body.num_questions,
        "timer_minutes": body.timer_minutes,
        "questions":     questions,
    })


@router.post("/answer")
async def submit_answer_legacy(body: AnswerSubmit, user: dict = Depends(get_current_user)):
    """Legacy answer endpoint — evaluates and returns result without DB."""
    evaluation = await evaluate_answer(
        question="",
        answer=body.answer_text,
        round_type="technical",
    )
    return _ok({
        "question_id":  body.question_id,
        "score":        evaluation.get("score", 5),
        "feedback":     evaluation.get("feedback", ""),
        "strengths":    evaluation.get("strengths", []),
        "improvements": evaluation.get("improvements", []),
    })


@router.get("/session/{session_id}")
async def get_session_legacy(session_id: str, user: dict = Depends(get_current_user)):
    """Legacy session fetch — use GET /api/v1/session/:id instead."""
    from services.db_service import get_session
    try:
        session = get_session(session_id)
        if session:
            return _ok(data=session)
    except Exception:
        pass
    return _err("Session not found.", 404)
