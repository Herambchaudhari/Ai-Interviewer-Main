"""
Session router — create interview sessions and generate questions.
POST /api/v1/session/start
"""
import uuid
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional

from auth import get_current_user
from services.groq_service import generate_questions
from services.db_service import save_session, get_profile as _get_profile

router = APIRouter()


def _ok(data: dict, message: str = "Success") -> dict:
    return {"success": True, "data": data, "error": None, "message": message}


def _err(error: str, status: int = 400):
    return JSONResponse(
        status_code=status,
        content={"success": False, "data": None, "error": error},
    )


class StudentMetaPayload(BaseModel):
    name:             Optional[str]       = None
    year:             Optional[str]       = None
    branch:           Optional[str]       = None
    cgpa:             Optional[float]     = None
    target_sectors:   Optional[list]      = None
    target_companies: Optional[list]      = None


class SessionStartRequest(BaseModel):
    profile_id:   str
    round_type:   str           # technical | hr | dsa | system_design
    difficulty:   str           # fresher | mid-level | senior  (maps to easy/medium/hard)
    timer_mins:   int = 30
    num_questions: int = 8
    student_meta: Optional[StudentMetaPayload] = None  # forwarded from localStorage
    target_company: Optional[str] = None
    job_role: Optional[str] = None
    is_full_loop: Optional[bool] = False


_DIFFICULTY_MAP = {
    "fresher":    "easy",
    "mid-level":  "medium",
    "senior":     "hard",
    # accept the old names too
    "easy":   "easy",
    "medium": "medium",
    "hard":   "hard",
}

_TIME_LIMITS = {
    "easy":   120,   # secs per question
    "medium": 180,
    "hard":   240,
}


@router.post("/start")
async def start_session(
    body: SessionStartRequest,
    user: dict = Depends(get_current_user),
):
    """
    1. Validate difficulty
    2. Fetch candidate profile from Supabase
    3. Generate num_questions questions via Groq
    4. Persist session to Supabase
    5. Return { session_id, first_question, questions }
    """
    difficulty = _DIFFICULTY_MAP.get(body.difficulty.lower())
    if not difficulty:
        return _err(f"Invalid difficulty '{body.difficulty}'. Use: fresher, mid-level, senior.")

    round_type = body.round_type.lower()
    if round_type not in ("technical", "hr", "dsa", "system_design"):
        return _err(f"Invalid round_type '{body.round_type}'.")

    # ── Assemble full candidate context (Phase 1) ──────────────────────────
    from services.context_assembler import assemble_context
    try:
        context = await assemble_context(
            user_id=user["user_id"],
            profile_id=body.profile_id,
            student_meta=body.student_meta.model_dump() if body.student_meta else None,
            target_company=body.target_company,
            job_role=body.job_role,
            round_type=round_type,
            difficulty=difficulty,
            is_full_loop=body.is_full_loop or False,
        )
    except Exception as e:
        print(f"[start_session] context assembly failed: {e}")
        # Graceful fallback — minimal context from profile only
        context = {}
        try:
            profile = _get_profile(body.profile_id)
            if profile:
                context = profile.get("parsed_data") or {}
        except Exception:
            pass
        if body.student_meta:
            context.update({k: v for k, v in body.student_meta.model_dump().items() if v is not None})
        context["target_company"] = body.target_company or ""
        context["job_role"] = body.job_role or "Software Engineer"

    # resume_data alias kept for generate_questions() compat below
    resume_data = context

    # ── Generate questions ─────────────────────────────────────────────────
    try:
        questions = await generate_questions(
            resume_data=resume_data,
            round_type=round_type,
            difficulty=difficulty,
            num_questions=body.num_questions,
        )
    except Exception as e:
        return _err(f"Failed to generate questions: {str(e)}", status=500)

    # Attach stable IDs and time limits to each question
    time_limit = _TIME_LIMITS[difficulty]
    for i, q in enumerate(questions):
        q["id"]          = str(uuid.uuid4())
        q["order_index"] = i
        q["type"]        = "code" if round_type == "dsa" else "speech"
        q["time_limit_secs"] = time_limit

    # ── Save session ───────────────────────────────────────────────────────
    session_data = {
        "user_id":               user["user_id"],
        "profile_id":            body.profile_id,
        "round_type":            round_type,
        "difficulty":            difficulty,
        "timer_mins":            body.timer_mins,
        "num_questions":         body.num_questions,
        "questions":             questions,
        "transcript":            [],
        "scores":                [],
        "status":                "active",
        "target_company":        context.get("target_company", ""),
        "target_role":           context.get("job_role", ""),
        "current_question_index": 0,
        "context_bundle":        context,      # full assembled context for adaptive engine
        "conversation_history":  [],
        "detected_weaknesses":   {},
        "avoided_topics":        [],
    }

    # Save session
    session_id = save_session(session_data)

    first_question = questions[0] if questions else {}

    return _ok(
        data={
            "session_id":     session_id,
            "first_question": {
                "id":              first_question.get("id"),
                "text":            first_question.get("question_text", ""),
                "type":            first_question.get("type", "speech"),
                "time_limit_secs": first_question.get("time_limit_secs", 180),
                "category":        first_question.get("category", ""),
            },
            "questions": questions,          # all questions — frontend stores in sessionStorage
            "timer_mins":    body.timer_mins,
            "round_type":    round_type,
            "difficulty":    difficulty,
            "num_questions": body.num_questions,
        },
        message="Session created successfully",
    )


@router.get("/{session_id}")
async def get_session_endpoint(
    session_id: str,
    user: dict = Depends(get_current_user),
):
    """Fetch an existing session by ID."""
    from services.db_service import get_session
    try:
        session = get_session(session_id)
    except Exception:
        return _err("Database not configured.", status=503)

    if not session:
        return _err("Session not found.", status=404)
    if session.get("user_id") != user["user_id"]:
        return _err("Access denied.", status=403)

    return _ok(data=session)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# POST /api/v1/session/transcribe  — audio → text via faster-whisper
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
import os
import tempfile
import re as _re
from fastapi import UploadFile, File, Form
from services.stt import transcribe_audio

_FILLER_WORDS = {"um", "uh", "like", "basically", "you know", "kind of",
                 "sort of", "actually", "literally", "right", "okay so"}


def _extract_audio_meta(transcript: str, audio_bytes: int) -> dict:
    """
    Derives soft-skill delivery signals from transcript text and audio size.
    Used by Phase 4 scoring calibration.
    """
    words = _re.findall(r"\b\w+\b", transcript.lower())
    word_count   = len(words)
    filler_words = [w for w in words if w in _FILLER_WORDS]
    # Estimate duration from audio bytes (webm ~32kbps ≈ 4000 bytes/sec, rough proxy)
    est_duration = max(1.0, audio_bytes / 4000.0)
    wpm = round((word_count / est_duration) * 60, 1) if est_duration > 0 else 0
    # Silence gap proxy: if WPM < 60, likely long pauses
    silence_gaps = wpm < 60 and word_count > 10
    return {
        "word_count":            word_count,
        "duration_secs":         round(est_duration, 1),
        "filler_words":          list(set(filler_words)),
        "filler_count":          len(filler_words),
        "words_per_minute":      wpm,
        "silence_gaps_detected": silence_gaps,
    }


@router.post("/transcribe")
async def transcribe_answer(
    audio:       UploadFile = File(...),
    session_id:  str        = Form(...),
    question_id: str        = Form(...),
    user: dict = Depends(get_current_user),
):
    """
    Accept an audio file upload, transcribe locally with faster-whisper,
    and return the transcript string.
    """
    contents = await audio.read()
    if not contents:
        return _err("Empty audio file received.")

    # Detect extension from content-type or filename
    ct = audio.content_type or ""
    ext = ".webm"
    if "ogg" in ct:    ext = ".ogg"
    elif "wav" in ct:  ext = ".wav"
    elif "mp4" in ct:  ext = ".mp4"

    tmp_path = os.path.join(tempfile.gettempdir(), f"audio_{uuid.uuid4()}{ext}")
    try:
        with open(tmp_path, "wb") as f:
            f.write(contents)

        transcript = await transcribe_audio(tmp_path)

    except RuntimeError as e:
        return _err(f"Transcription failed: {e}", status=500)
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

    # ── Phase 4: Derive soft-skill delivery metadata ───────────────────────
    meta = _extract_audio_meta(transcript, len(contents))

    return _ok(data={"transcript": transcript, "question_id": question_id, "meta": meta})


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# POST /api/v1/session/answer  — evaluate answer, advance session
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
from services.evaluator import evaluate_code, evaluate_answer as _eval_verbal
from services.db_service import get_session, update_session


class AnswerRequest(BaseModel):
    session_id:       str
    question_id:      str
    transcript:       str
    time_taken_secs:  Optional[int] = None
    current_question: Optional[dict] = None
    is_last_question: Optional[bool] = False
    scoring_context:  Optional[dict] = None   # Phase 4: audio/delivery metadata


@router.post("/answer")
async def submit_answer(
    body: AnswerRequest,
    user: dict = Depends(get_current_user),
):
    """
    1. Fetch session → find current question
    2. Evaluate answer via Groq (with scoring_context for soft skills)
    3. Persist answer + score + topic to Supabase
    4. Determine next via adaptive engine (follow-up / weak probe / critical / default)
    5. Return { evaluation, next_question | session_complete }
    """
    # ── Load session ───────────────────────────────────────────────────────
    try:
        session = get_session(body.session_id)
    except Exception:
        session = None

    if not session:
        session = {"questions": [], "transcript": [], "scores": [],
                   "round_type": "technical", "num_questions": 8}

    round_type      = session.get("round_type", "technical")
    questions       = session.get("questions", [])
    num_questions   = session.get("num_questions", 8)
    context_bundle  = session.get("context_bundle") or {}

    # Find current question object
    current_q = next((q for q in questions if q.get("id") == body.question_id), body.current_question)
    q_text    = (current_q or {}).get("question_text", "")
    q_index   = (current_q or {}).get("order_index", 0)
    q_topic   = (current_q or {}).get("topic") or (current_q or {}).get("category", "")

    # ── Evaluate — choose evaluator based on round type ────────────────────
    is_code_round = round_type == "dsa"
    looks_like_code = (
        body.transcript.startswith(("def ", "class ", "#", "//", "import ", "public ", "package ", "func "))
        or "\n" in body.transcript[:100]
    )

    if is_code_round or looks_like_code:
        evaluation = await evaluate_code(
            question=current_q or {"question_text": q_text},
            code=body.transcript,
            language=getattr(body, "language", "python"),
        )
        evaluation["feedback"]      = evaluation.get("correctness_analysis", "")
        evaluation["strengths"]     = evaluation.get("code_quality", {}).get("positives", [])
        evaluation["improvements"]  = evaluation.get("optimization_hints", [])
        evaluation["verdict"]       = evaluation.get("verdict", "Satisfactory")
    else:
        evaluation = await _eval_verbal(
            question=current_q or {"question_text": q_text},
            transcript=body.transcript,
            round_type=round_type,
            scoring_context=body.scoring_context,
        )

    evaluation["question_id"]    = body.question_id
    evaluation["question_text"]  = q_text
    evaluation["answer_text"]    = body.transcript
    evaluation["question_topic"] = q_topic
    evaluation["is_follow_up"]   = bool((current_q or {}).get("is_follow_up", False))

    # ── Persist transcript + session state ────────────────────────────────
    answered_count = 0
    try:
        existing_transcript = list(session.get("transcript") or [])
        existing_scores     = list(session.get("scores") or [])
        detected_weaknesses = dict(session.get("detected_weaknesses") or {})

        existing_transcript.append({
            "question_id":        body.question_id,
            "question":           q_text,
            "answer":             body.transcript,
            "score":              evaluation.get("score"),
            "feedback":           evaluation.get("feedback", ""),
            "verdict":            evaluation.get("verdict", ""),
            "strengths":          evaluation.get("strengths", []),
            "improvements":       evaluation.get("improvements", []),
            "key_concept_missed": evaluation.get("key_concept_missed", ""),
            "answer_summary":     evaluation.get("answer_summary", ""),
            "category":           q_topic,
            "topic":              q_topic,
            "is_follow_up":       evaluation.get("is_follow_up", False),
            "scoring_meta":       body.scoring_context or {},
            "dimension_scores":   evaluation.get("dimension_scores", {}),
        })
        existing_scores.append(evaluation.get("score"))
        answered_count = len(existing_transcript)

        # Update weakness tracker
        from services.adaptive_engine import _update_detected_weaknesses
        detected_weaknesses = _update_detected_weaknesses(
            detected_weaknesses, q_topic, float(evaluation.get("score") or 5)
        )

        update_session(body.session_id, {
            "transcript":            existing_transcript,
            "scores":                existing_scores,
            "current_question_index": q_index + 1,
            "detected_weaknesses":   detected_weaknesses,
        })
    except Exception as e:
        print(f"[submit_answer] persist failed: {e}")
        answered_count = q_index + 1

    # ── Check completion ───────────────────────────────────────────────────
    if body.is_last_question or answered_count >= num_questions:
        return _ok(data={
            "evaluation":       evaluation,
            "session_complete": True,
            "next_question":    None,
        })

    # ── Generate next question via adaptive engine ─────────────────────────
    from services.adaptive_engine import generate_adaptive_next_question
    try:
        # Pass the freshest session state to the engine
        fresh_session = {
            **session,
            "transcript": existing_transcript if 'existing_transcript' in dir() else session.get("transcript", []),
        }
        next_q = await generate_adaptive_next_question(
            session=fresh_session,
            last_evaluation=evaluation,
            context_bundle=context_bundle,
        )
        next_q["order_index"]     = answered_count
        next_q["id"]              = str(uuid.uuid4())
        next_q["time_limit_secs"] = _TIME_LIMITS.get(session.get("difficulty", "medium"), 180)
        next_q["type"]            = "code" if round_type == "dsa" else "speech"

        # Append newly generated question to session
        try:
            updated_questions = list(questions) + [next_q]
            update_session(body.session_id, {"questions": updated_questions})
        except Exception:
            pass

    except Exception as e:
        print(f"[submit_answer] adaptive engine failed: {e}")
        # Fallback: serve next pre-generated question if available
        next_index = q_index + 1
        next_q = questions[next_index] if next_index < len(questions) else None
        if next_q is None:
            return _ok(data={
                "evaluation":       evaluation,
                "session_complete": True,
                "next_question":    None,
            })
        next_q["order_index"] = next_index

    return _ok(data={
        "evaluation":       evaluation,
        "session_complete": False,
        "next_question": {
            "id":              next_q.get("id"),
            "text":            next_q.get("question_text", next_q.get("text", "")),
            "question_text":   next_q.get("question_text", next_q.get("text", "")),
            "category":        next_q.get("topic", next_q.get("category", "")),
            "type":            next_q.get("type", "speech"),
            "time_limit_secs": next_q.get("time_limit_secs", 180),
            "expected_points": next_q.get("expected_concepts", next_q.get("expected_points", [])),
            "title":           next_q.get("title", ""),
            "description":     next_q.get("description", next_q.get("question_text", "")),
            "examples":        next_q.get("examples", []),
            "constraints":     next_q.get("constraints", []),
            "difficulty":      next_q.get("difficulty_level", ""),
            "hint":            next_q.get("hint", ""),
            "order_index":     next_q.get("order_index", answered_count),
            "is_follow_up":    next_q.get("is_follow_up", False),
            "decision_reason": next_q.get("decision_reason", ""),
        },
        "is_follow_up": next_q.get("is_follow_up", False),
    })


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# POST /api/v1/session/run-code  — Judge0 code execution
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class RunCodeRequest(BaseModel):
    code:       str
    language:   str = "python"
    stdin:      Optional[str] = None
    session_id: Optional[str] = None


@router.post("/run-code")
async def run_code_endpoint(
    body: RunCodeRequest,
    user: dict = Depends(get_current_user),
):
    """
    Execute code via Judge0 CE and return stdout / stderr / timing.
    Rate-limited by Judge0 free tier (~50 req/day without API key).
    """
    from services.code_runner import run_code
    try:
        result = await run_code(
            code=body.code,
            language=body.language,
            stdin=body.stdin or "",
        )
    except Exception as e:
        return _err(f"Code runner error: {e}", status=500)

    return _ok(data=result)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# POST /api/v1/session/code-eval  — standalone AI code review
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class CodeEvalRequest(BaseModel):
    code:        str
    language:    str = "python"
    question_id: Optional[str] = None
    session_id:  Optional[str] = None


@router.post("/code-eval")
async def ai_code_review(
    body: CodeEvalRequest,
    user: dict = Depends(get_current_user),
):
    """
    Evaluate code against the session question using Groq.
    Returns verdict, complexity, quality, hints, follow-up.
    """
    # Try to fetch the question for context
    question = {"question_text": "", "title": "", "constraints": [], "examples": []}
    try:
        session = get_session(body.session_id) if body.session_id else None
        if session and body.question_id:
            qs = session.get("questions", [])
            found = next((q for q in qs if q.get("id") == body.question_id), None)
            if found:
                question = found
    except Exception:
        pass

    evaluation = await evaluate_code(
        question=question,
        code=body.code,
        language=body.language,
    )
    return _ok(data=evaluation)


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# POST /api/v1/session/skip  — skip current question, generate next
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class SkipRequest(BaseModel):
    session_id:       str
    question_id:      str
    current_question: Optional[dict] = None
    is_last_question: Optional[bool] = False


@router.post("/skip")
async def skip_question(
    body: SkipRequest,
    user: dict = Depends(get_current_user),
):
    """
    Mark the current question as skipped and generate the next question
    adaptively. Skip does NOT count as a weakness signal.
    """
    try:
        session = get_session(body.session_id)
    except Exception:
        session = None

    if not session:
        session = {"questions": [], "transcript": [], "scores": [],
                   "round_type": "technical", "num_questions": 8}

    questions      = session.get("questions", [])
    num_questions  = session.get("num_questions", 8)
    context_bundle = session.get("context_bundle") or {}

    current_q  = next((q for q in questions if q.get("id") == body.question_id), body.current_question)
    q_index    = (current_q or {}).get("order_index", 0)
    next_index = q_index + 1
    q_topic    = (current_q or {}).get("topic") or (current_q or {}).get("category", "")

    # Persist skip record
    answered_count = next_index
    try:
        existing_transcript = list(session.get("transcript") or [])
        existing_transcript.append({
            "question_id": body.question_id,
            "question":    (current_q or {}).get("question_text", ""),
            "answer":      "[SKIPPED]",
            "score":       0,
            "skipped":     True,
            "category":    q_topic,
        })
        answered_count = len(existing_transcript)
        update_session(body.session_id, {
            "transcript":             existing_transcript,
            "current_question_index": next_index,
        })
    except Exception:
        pass

    # Check completion
    if body.is_last_question or answered_count >= num_questions:
        return _ok(data={"session_complete": True, "next_question": None, "skipped": True})

    # Generate next question via adaptive engine (skip = neutral score 5, no follow-up)
    from services.adaptive_engine import generate_adaptive_next_question
    try:
        fresh_session = {**session, "transcript": existing_transcript}
        skip_eval = {"score": 5, "question_topic": q_topic, "is_follow_up": False,
                     "missing_concepts": [], "weak_points": []}
        next_q = await generate_adaptive_next_question(
            session=fresh_session,
            last_evaluation=skip_eval,
            context_bundle=context_bundle,
        )
        next_q["order_index"]     = answered_count
        next_q["id"]              = str(uuid.uuid4())
        next_q["time_limit_secs"] = _TIME_LIMITS.get(session.get("difficulty", "medium"), 180)
        next_q["type"]            = "code" if session.get("round_type") == "dsa" else "speech"
        try:
            update_session(body.session_id, {"questions": list(questions) + [next_q]})
        except Exception:
            pass
    except Exception as e:
        print(f"[skip_question] adaptive engine failed: {e}")
        next_q = questions[next_index] if next_index < len(questions) else None
        if next_q is None:
            return _ok(data={"session_complete": True, "next_question": None, "skipped": True})
        next_q["order_index"] = next_index

    return _ok(data={
        "session_complete": False,
        "next_question": {
            "id":              next_q.get("id"),
            "text":            next_q.get("question_text", next_q.get("text", "")),
            "question_text":   next_q.get("question_text", next_q.get("text", "")),
            "category":        next_q.get("topic", next_q.get("category", "")),
            "type":            next_q.get("type", "speech"),
            "time_limit_secs": next_q.get("time_limit_secs", 180),
            "expected_points": next_q.get("expected_concepts", next_q.get("expected_points", [])),
            "title":           next_q.get("title", ""),
            "description":     next_q.get("description", next_q.get("question_text", "")),
            "examples":        next_q.get("examples", []),
            "constraints":     next_q.get("constraints", []),
            "difficulty":      next_q.get("difficulty_level", ""),
            "hint":            next_q.get("hint", ""),
            "order_index":     next_q.get("order_index", answered_count),
            "is_follow_up":    next_q.get("is_follow_up", False),
            "decision_reason": next_q.get("decision_reason", ""),
        },
        "skipped": True,
    })


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# POST /api/v1/session/answer/stream  — SSE streaming evaluation + next question
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
import json as _json
from fastapi.responses import StreamingResponse


@router.post("/answer/stream")
async def submit_answer_stream(
    body: AnswerRequest,
    user: dict = Depends(get_current_user),
):
    """
    Server-Sent Events version of /answer.

    Event sequence:
      1. evaluation_start   — immediately, shows processing indicator
      2. feedback_chunk     — token-by-token feedback text as LLM streams
      3. evaluation_complete — full structured evaluation JSON
      4. next_question      — next adaptive question (or absent if complete)
      5. session_complete   — if no more questions
      6. [DONE]             — stream end sentinel
    """
    async def event_generator():
        # ── Load session ───────────────────────────────────────────────────
        try:
            session = get_session(body.session_id)
        except Exception:
            session = None
        if not session:
            session = {"questions": [], "transcript": [], "scores": [],
                       "round_type": "technical", "num_questions": 8}

        round_type      = session.get("round_type", "technical")
        questions       = session.get("questions", [])
        num_questions   = session.get("num_questions", 8)
        context_bundle  = session.get("context_bundle") or {}

        current_q = next((q for q in questions if q.get("id") == body.question_id), body.current_question)
        q_text    = (current_q or {}).get("question_text", "")
        q_index   = (current_q or {}).get("order_index", 0)
        q_topic   = (current_q or {}).get("topic") or (current_q or {}).get("category", "")
        is_code   = round_type == "dsa" or body.transcript.startswith(
            ("def ", "class ", "#", "//", "import ", "public ", "package ", "func ")
        )

        yield f"data: {_json.dumps({'type': 'evaluation_start', 'question_id': body.question_id})}\n\n"

        # ── Stream evaluation ──────────────────────────────────────────────
        full_text = ""
        if is_code:
            # Code eval is non-streaming (structured JSON required)
            evaluation = await evaluate_code(
                question=current_q or {"question_text": q_text},
                code=body.transcript,
                language=getattr(body, "language", "python"),
            )
            evaluation["feedback"]     = evaluation.get("correctness_analysis", "")
            evaluation["strengths"]    = evaluation.get("code_quality", {}).get("positives", [])
            evaluation["improvements"] = evaluation.get("optimization_hints", [])
            full_text = evaluation.get("feedback", "")
            yield f"data: {_json.dumps({'type': 'feedback_chunk', 'text': full_text})}\n\n"
        else:
            # Build eval prompt for streaming
            from services.evaluator import _build_eval_system_prompt, _build_eval_user_prompt
            from services.groq_service import stream_chat
            try:
                sys_p  = _build_eval_system_prompt(round_type)
                user_p = _build_eval_user_prompt(q_text, body.transcript, round_type, body.scoring_context)
                async for chunk in stream_chat(sys_p, user_p, temperature=0.3, max_tokens=1000):
                    full_text += chunk
                    yield f"data: {_json.dumps({'type': 'feedback_chunk', 'text': chunk})}\n\n"
            except Exception as e:
                print(f"[answer/stream] streaming eval failed, falling back: {e}")
                evaluation = await _eval_verbal(
                    question=current_q or {"question_text": q_text},
                    transcript=body.transcript,
                    round_type=round_type,
                    scoring_context=body.scoring_context,
                )
                full_text = evaluation.get("feedback", "")
                yield f"data: {_json.dumps({'type': 'feedback_chunk', 'text': full_text})}\n\n"

        # Parse full streamed text → structured evaluation
        if not is_code:
            try:
                import re
                cleaned = full_text.strip().strip("```json").strip("```").strip()
                # Find JSON object in streamed text
                match = re.search(r'\{.*\}', cleaned, re.DOTALL)
                if match:
                    evaluation = _json.loads(match.group())
                else:
                    evaluation = _json.loads(cleaned)
            except Exception:
                evaluation = {
                    "score": 5, "feedback": full_text[:500],
                    "strong_points": [], "weak_points": [],
                    "missing_concepts": [], "communication_score": 5,
                    "verdict": "Satisfactory", "answer_summary": "",
                    "key_concept_missed": "", "follow_up_needed": False,
                }

        evaluation["question_id"]    = body.question_id
        evaluation["question_text"]  = q_text
        evaluation["answer_text"]    = body.transcript
        evaluation["question_topic"] = q_topic
        evaluation["is_follow_up"]   = bool((current_q or {}).get("is_follow_up", False))

        # ── Persist ────────────────────────────────────────────────────────
        answered_count = q_index + 1
        existing_transcript = list(session.get("transcript") or [])
        try:
            existing_transcript.append({
                "question_id":        body.question_id,
                "question":           q_text,
                "answer":             body.transcript,
                "score":              evaluation.get("score"),
                "feedback":           evaluation.get("feedback", ""),
                "verdict":            evaluation.get("verdict", ""),
                "strengths":          evaluation.get("strong_points", evaluation.get("strengths", [])),
                "improvements":       evaluation.get("weak_points", evaluation.get("improvements", [])),
                "key_concept_missed": evaluation.get("key_concept_missed", ""),
                "answer_summary":     evaluation.get("answer_summary", ""),
                "category":           q_topic,
                "scoring_meta":       body.scoring_context or {},
                "dimension_scores":   evaluation.get("dimension_scores", {}),
            })
            answered_count = len(existing_transcript)
            from services.adaptive_engine import _update_detected_weaknesses
            dw = _update_detected_weaknesses(
                dict(session.get("detected_weaknesses") or {}),
                q_topic, float(evaluation.get("score") or 5)
            )
            update_session(body.session_id, {
                "transcript":             existing_transcript,
                "scores":                 list(session.get("scores") or []) + [evaluation.get("score")],
                "current_question_index": q_index + 1,
                "detected_weaknesses":    dw,
            })
        except Exception as e:
            print(f"[answer/stream] persist failed: {e}")

        yield f"data: {_json.dumps({'type': 'evaluation_complete', 'payload': evaluation})}\n\n"

        # ── Completion check ───────────────────────────────────────────────
        if body.is_last_question or answered_count >= num_questions:
            yield f"data: {_json.dumps({'type': 'session_complete'})}\n\n"
            yield "data: [DONE]\n\n"
            return

        # ── Generate next question adaptively ─────────────────────────────
        from services.adaptive_engine import generate_adaptive_next_question
        try:
            fresh_session = {**session, "transcript": existing_transcript}
            next_q = await generate_adaptive_next_question(
                session=fresh_session,
                last_evaluation=evaluation,
                context_bundle=context_bundle,
            )
            next_q["order_index"]     = answered_count
            next_q["id"]              = str(uuid.uuid4())
            next_q["time_limit_secs"] = _TIME_LIMITS.get(session.get("difficulty", "medium"), 180)
            next_q["type"]            = "code" if round_type == "dsa" else "speech"
            try:
                update_session(body.session_id, {"questions": list(questions) + [next_q]})
            except Exception:
                pass
            yield f"data: {_json.dumps({'type': 'next_question', 'payload': {**next_q, 'order_index': answered_count}})}\n\n"
        except Exception as e:
            print(f"[answer/stream] adaptive engine failed: {e}")
            yield f"data: {_json.dumps({'type': 'session_complete'})}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# POST /api/v1/session/end  — complete session + async report generation
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
from fastapi import BackgroundTasks


class EndSessionRequest(BaseModel):
    session_id: str
    reason:     Optional[str] = "completed"   # completed | timeout | manual


async def _generate_report_bg(session_id: str):
    """Background task: generate and persist the interview report."""
    try:
        from services.groq_service import generate_report as _gen_report
        from services.db_service import save_report

        session = get_session(session_id)
        if not session:
            return

        transcript   = session.get("transcript") or []
        round_type   = session.get("round_type", "technical")

        question_scores = [
            {
                "question_text": e.get("question", ""),
                "answer_text":   e.get("answer", ""),
                "score":         e.get("score") or 0,
                "feedback":      e.get("feedback", ""),
            }
            for e in transcript
        ]
        valid = [q["score"] for q in question_scores if q["score"]]
        overall = round(sum(valid) / len(valid), 1) if valid else 0.0

        insights = await _gen_report(
            round_type=round_type,
            question_scores=question_scores,
            overall_score=overall,
        )
        save_report(session_id, {
            "overall_score":   overall,
            "skill_ratings":   insights.get("skill_ratings", []),
            "strong_areas":    insights.get("strong_areas", []),
            "weak_areas":      insights.get("weak_areas", []),
            "recommendations": insights.get("recommendations", []),
            "summary":         insights.get("summary", ""),
        })
    except Exception:
        pass   # Non-fatal — report can be generated on demand via GET /api/v1/report/:id


@router.post("/end")
async def end_session(
    body:             EndSessionRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    """
    Mark the session as completed and trigger async report generation.
    Returns immediately so the frontend can navigate to its own /report/:id route.
    """
    try:
        session = get_session(body.session_id)
        if session and session.get("user_id") != user["user_id"]:
            return _err("Access denied.", status=403)

        update_session(body.session_id, {
            "status":     "completed",
            "ended_at":   __import__("datetime").datetime.utcnow().isoformat(),
            "end_reason": body.reason,
        })
    except Exception:
        pass   # Non-fatal if DB not configured

    # Fire-and-forget report generation
    background_tasks.add_task(_generate_report_bg, body.session_id)

    return _ok(data={
        "session_id": body.session_id,
        "status":     "completed",
        # Frontend route only. Do not treat this as a backend URL.
        "report_route": f"/report/{body.session_id}",
        "message":    "Session ended. Report is being generated in the background.",
    })
