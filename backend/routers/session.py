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
from services.interviewer import generate_first_question
from services.db_service import (
    save_session, get_profile as _get_profile,
    save_checkpoint, get_session_with_auth, get_active_sessions,
    upload_audio_clip, get_audio_signed_url,
)
from services.evaluator import evaluate_mcq_response

router = APIRouter()

_ROUND_LABELS = {
    "technical": "Technical",
    "hr": "HR",
    "dsa": "DSA",
    "mcq_practice": "MCQ Practice",
}


def _ok(data: dict, message: str = "Success") -> dict:
    return {"success": True, "data": data, "error": None, "message": message}


def _err(error: str, status: int = 400):
    return JSONResponse(
        status_code=status,
        content={"success": False, "data": None, "error": error},
    )


def _resolve_context_bundle(session: dict) -> dict:
    context_bundle = dict(session.get("context_bundle") or {})
    profile_id = session.get("profile_id")

    if profile_id:
        try:
            profile = _get_profile(profile_id) or {}
            parsed = profile.get("parsed_data") or {}
            if isinstance(parsed, dict):
                context_bundle = {**parsed, **context_bundle}
        except Exception:
            pass

    target_company = session.get("target_company") or context_bundle.get("target_company") or ""
    target_role = (
        session.get("target_role")
        or session.get("job_role")
        or context_bundle.get("target_role")
        or context_bundle.get("job_role")
        or ""
    )

    if target_company:
        context_bundle["target_company"] = target_company
    if target_role:
        context_bundle["job_role"] = target_role

    return context_bundle


def _build_session_label(round_type: str, target_company: str = "", job_role: str = "") -> str:
    round_label = _ROUND_LABELS.get(round_type or "technical", "Interview")
    role = (job_role or "").strip()
    company = (target_company or "").strip()

    if role and company:
        return f"{round_label} - {role} @ {company}"
    if role:
        return f"{round_label} - {role}"
    if company:
        return f"{round_label} - {company}"
    return f"{round_label} Interview"


def _resolve_question_type(round_type: str) -> str:
    if round_type == "dsa":
        return "code"
    if round_type == "mcq_practice":
        return "mcq"
    return "speech"


def _resolve_question_time_limit(round_type: str, difficulty: str) -> int:
    if round_type == "mcq_practice":
        return {"easy": 75, "medium": 90, "hard": 120}.get(difficulty, 90)
    return _TIME_LIMITS[difficulty]


def _serialize_question_payload(question: dict, fallback_order: int = 0) -> dict:
    return {
        "id": question.get("id"),
        "text": question.get("question_text", question.get("text", "")),
        "question_text": question.get("question_text", question.get("text", "")),
        "category": question.get("topic", question.get("category", "")),
        "type": question.get("type", "speech"),
        "time_limit_secs": question.get("time_limit_secs", 180),
        "expected_points": question.get("expected_concepts", question.get("expected_points", [])),
        "title": question.get("title", ""),
        "description": question.get("description", question.get("question_text", "")),
        "examples": question.get("examples", []),
        "constraints": question.get("constraints", []),
        "difficulty": question.get("difficulty_level", ""),
        "hint": question.get("hint", ""),
        "order_index": question.get("order_index", fallback_order),
        "is_follow_up": question.get("is_follow_up", False),
        "decision_reason": question.get("decision_reason", ""),
        "options": question.get("options", []),
        "explanation": question.get("explanation", ""),
        "source_signal": question.get("source_signal", ""),
    }


def _normalize_verbal_evaluation(evaluation: dict) -> dict:
    evaluation = dict(evaluation or {})

    strengths = evaluation.get("strengths") or evaluation.get("strong_points") or []
    improvements = evaluation.get("improvements") or evaluation.get("weak_points") or []

    if isinstance(strengths, str):
        strengths = [strengths]
    if isinstance(improvements, str):
        improvements = [improvements]

    evaluation["strengths"] = [str(item).strip() for item in strengths if str(item).strip()]
    evaluation["improvements"] = [str(item).strip() for item in improvements if str(item).strip()]
    evaluation.setdefault("feedback", "")
    evaluation.setdefault("dimension_scores", {})
    evaluation.setdefault("missing_concepts", [])
    return evaluation


def _feedback_chunks(text: str, target_chars: int = 120) -> list[str]:
    cleaned = (text or "").strip()
    if not cleaned:
        return []

    words = cleaned.split()
    if len(cleaned) <= target_chars or len(words) <= 8:
        return [cleaned]

    chunks = []
    current = []
    current_len = 0
    for word in words:
        projected = current_len + len(word) + (1 if current else 0)
        if current and projected > target_chars:
            chunks.append(" ".join(current))
            current = [word]
            current_len = len(word)
        else:
            current.append(word)
            current_len = projected

    if current:
        chunks.append(" ".join(current))

    return chunks


class StudentMetaPayload(BaseModel):
    name:             Optional[str]       = None
    year:             Optional[str]       = None
    branch:           Optional[str]       = None
    cgpa:             Optional[float]     = None
    target_sectors:   Optional[list]      = None
    target_companies: Optional[list]      = None


class SessionStartRequest(BaseModel):
    profile_id:   str
    round_type:   str           # technical | hr | dsa | mcq_practice
    difficulty:   str           # fresher | mid-level | senior  (maps to easy/medium/hard)
    timer_mins:   int = 30
    num_questions: int = 8
    student_meta: Optional[StudentMetaPayload] = None  # forwarded from localStorage
    target_company: Optional[str] = None
    job_role: Optional[str] = None
    is_full_loop: Optional[bool] = False
    target_interview_date: Optional[str] = None       # ISO date e.g. "2026-05-10"; feeds study schedule horizon


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
    2. Assemble full candidate context (Phase 1)
    3. Generate ONLY the first question — adaptive engine generates subsequent ones
    4. Persist session to Supabase
    5. Return { session_id, first_question, questions: [first_question] }
    """
    difficulty = _DIFFICULTY_MAP.get(body.difficulty.lower())
    if not difficulty:
        return _err(f"Invalid difficulty '{body.difficulty}'. Use: fresher, mid-level, senior.")

    round_type = body.round_type.lower()
    if round_type not in ("technical", "hr", "dsa", "mcq_practice"):
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

    session_label = _build_session_label(
        round_type=round_type,
        target_company=context.get("target_company", ""),
        job_role=context.get("job_role", ""),
    )
    context["session_label"] = session_label

    # ── Generate only the first question — adaptive engine generates the rest ──
    try:
        first_q = await generate_first_question(
            profile=context,
            round_type=round_type,
            difficulty=difficulty,
        )
    except Exception as e:
        err_str = str(e)
        if "rate_limit_exceeded" in err_str or "429" in err_str:
            return _err(
                "AI service is temporarily rate-limited. Please wait a few minutes and try again.",
                status=429,
            )
        return _err(f"Failed to generate first question: {err_str}", status=500)

    time_limit = _resolve_question_time_limit(round_type, difficulty)
    first_q["id"]             = str(uuid.uuid4())
    first_q["order_index"]    = 0
    first_q["type"]           = _resolve_question_type(round_type)
    first_q["time_limit_secs"] = time_limit
    questions = [first_q]

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
        "target_interview_date": body.target_interview_date or None,
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
                "type":            first_question.get("type", _resolve_question_type(round_type)),
                "time_limit_secs": first_question.get("time_limit_secs", 180),
                "category":        first_question.get("category", ""),
                "options":         first_question.get("options", []),
                "explanation":     first_question.get("explanation", ""),
            },
            "questions": questions,          # only first question — rest generated adaptively via /answer
            "timer_mins":    body.timer_mins,
            "round_type":    round_type,
            "difficulty":    difficulty,
            "num_questions": body.num_questions,
            "session_label": session_label,
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

    # ── Upload audio clip to Supabase Storage (best-effort, never blocks) ──
    audio_path = None
    audio_url  = None
    try:
        ct = audio.content_type or "audio/webm"
        audio_path = upload_audio_clip(session_id, question_id, contents, ct)
        if audio_path:
            audio_url = get_audio_signed_url(audio_path)
    except Exception as _au_err:
        print(f"[transcribe] audio upload skipped: {_au_err}")

    return _ok(data={
        "transcript":  transcript,
        "question_id": question_id,
        "meta":        meta,
        "audio_url":   audio_url,   # signed URL (None if storage not configured)
        "audio_path":  audio_path,  # storage path for later URL refresh
    })


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# POST /api/v1/session/answer  — evaluate answer, advance session
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
from services.evaluator import evaluate_code, evaluate_answer as _eval_verbal
from services.db_service import get_session, update_session


class AnswerRequest(BaseModel):
    session_id:       str
    question_id:      str
    transcript:       str
    language:         Optional[str] = "python"
    selected_option:  Optional[str] = None
    selected_option_index: Optional[int] = None
    time_taken_secs:  Optional[int] = None
    current_question: Optional[dict] = None
    is_last_question: Optional[bool] = False
    scoring_context:  Optional[dict] = None   # Phase 4: audio/delivery metadata
    audio_url:        Optional[str] = None    # signed URL from /transcribe
    audio_path:       Optional[str] = None    # storage path for URL refresh at report time


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
    context_bundle  = _resolve_context_bundle(session)

    # Find current question object
    current_q = next((q for q in questions if q.get("id") == body.question_id), body.current_question)
    q_text    = (current_q or {}).get("question_text", "")
    q_index   = (current_q or {}).get("order_index", 0)
    q_topic   = (current_q or {}).get("topic") or (current_q or {}).get("category", "")

    # ── Evaluate — choose evaluator based on round type ────────────────────
    is_mcq_round = round_type == "mcq_practice"
    is_code_round = round_type == "dsa"
    looks_like_code = (
        body.transcript.startswith(("def ", "class ", "#", "//", "import ", "public ", "package ", "func "))
        or "\n" in body.transcript[:100]
    )

    if is_mcq_round:
        evaluation = evaluate_mcq_response(
            question=current_q or {"question_text": q_text},
            selected_option_index=body.selected_option_index,
            selected_option_text=body.selected_option or body.transcript,
        )
    elif is_code_round or looks_like_code:
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
        evaluation = _normalize_verbal_evaluation(evaluation)

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
            "language":           body.language,
            "question_type":      "mcq" if is_mcq_round else ("code" if is_code_round or looks_like_code else "speech"),
            "selected_option":    evaluation.get("selected_option", body.selected_option),
            "selected_option_index": evaluation.get("selected_option_index", body.selected_option_index),
            "correct_option":     evaluation.get("correct_option", (current_q or {}).get("correct_option")),
            "correct_option_index": evaluation.get("correct_option_index", (current_q or {}).get("correct_option_index")),
            "is_correct":         evaluation.get("is_correct"),
            "explanation":        (current_q or {}).get("explanation", ""),
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
            "red_flag_detected":  evaluation.get("red_flag_detected", ""),
            # Audio playback — stored path allows signed URL refresh at report time
            "audio_url":          body.audio_url or None,
            "audio_path":         body.audio_path or None,
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

    if is_mcq_round:
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
            "next_question":    _serialize_question_payload(next_q, answered_count),
            "is_follow_up":     False,
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
        next_q["time_limit_secs"] = _resolve_question_time_limit(round_type, session.get("difficulty", "medium"))
        next_q["type"]            = _resolve_question_type(round_type)

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
        "next_question":    _serialize_question_payload(next_q, answered_count),
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


# Judge0 runner retired from active workflow
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
    round_type     = session.get("round_type", "technical")

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
            "score":       None,
            "skipped":     True,
            "verdict":     "skipped",
            "feedback":    "Question skipped by candidate.",
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

    if round_type == "mcq_practice":
        next_q = questions[next_index] if next_index < len(questions) else None
        if next_q is None:
            return _ok(data={"session_complete": True, "next_question": None, "skipped": True})
        next_q["order_index"] = next_index
        return _ok(data={
            "session_complete": False,
            "next_question": _serialize_question_payload(next_q, answered_count),
            "skipped": True,
        })

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
        next_q["time_limit_secs"] = _resolve_question_time_limit(round_type, session.get("difficulty", "medium"))
        next_q["type"]            = _resolve_question_type(round_type)
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
        "next_question": _serialize_question_payload(next_q, answered_count),
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
        context_bundle  = _resolve_context_bundle(session)

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
        else:
            evaluation = await _eval_verbal(
                question=current_q or {"question_text": q_text},
                transcript=body.transcript,
                round_type=round_type,
                scoring_context=body.scoring_context,
            )
            evaluation = _normalize_verbal_evaluation(evaluation)

        # Parse full streamed text → structured evaluation
        feedback_text = evaluation.get("feedback", "") if not is_code else full_text
        for chunk in _feedback_chunks(feedback_text):
            yield f"data: {_json.dumps({'type': 'feedback_chunk', 'text': chunk})}\n\n"

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
                "strengths":          evaluation.get("strengths", evaluation.get("strong_points", [])),
                "improvements":       evaluation.get("improvements", evaluation.get("weak_points", [])),
                "key_concept_missed": evaluation.get("key_concept_missed", ""),
                "answer_summary":     evaluation.get("answer_summary", ""),
                "category":           q_topic,
                "topic":              q_topic,
                "scoring_meta":       body.scoring_context or {},
                "dimension_scores":   evaluation.get("dimension_scores", {}),
                "red_flag_detected":  evaluation.get("red_flag_detected", ""),
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
    proctoring_summary: Optional[dict] = None


async def _generate_report_bg(session_id: str):
    """
    Background task: pre-seed a lightweight report so the DB row exists before
    the user opens the report page.

    If a full report already exists (generated by the SSE endpoint) this task
    does nothing — we must never overwrite rich 4-stage data with a partial summary.
    """
    try:
        from services.groq_service import generate_report as _gen_report
        from services.db_service import save_report, get_report as _get_report

        # Skip if a report row already exists — SSE generation takes priority.
        existing = _get_report(session_id)
        if existing:
            return

        session = get_session(session_id)
        if not session:
            return

        transcript = session.get("transcript") or []
        round_type = session.get("round_type", "technical")

        question_scores = [
            {
                "question_text":      e.get("question", ""),
                "answer_text":        e.get("answer", ""),
                "score":              e.get("score") or 0,
                "feedback":           e.get("feedback", ""),
                "category":           e.get("category") or e.get("topic") or round_type,
                "verdict":            e.get("verdict", ""),
                "answer_summary":     e.get("answer_summary", ""),
                "key_concept_missed": e.get("key_concept_missed", ""),
            }
            for e in transcript
        ]
        valid   = [q["score"] for q in question_scores if q["score"]]
        overall = round(sum(valid) / len(valid), 1) if valid else 0.0

        insights = await _gen_report(
            round_type=round_type,
            question_scores=question_scores,
            overall_score=overall,
        )
        # Check again in case SSE finished while we were running the LLM call
        if _get_report(session_id):
            return

        # Intentionally omit per_question_analysis so _is_complete_report() returns
        # False on this pre-seed row.  The first View Report click will trigger SSE
        # to generate the full 4-stage report, which then updates this row.
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

        updates = {
            "status":     "completed",
            "ended_at":   __import__("datetime").datetime.utcnow().isoformat(),
            "end_reason": body.reason,
        }
        if session and isinstance(body.proctoring_summary, dict):
            context_bundle = dict(session.get("context_bundle") or {})
            context_bundle["proctoring_summary"] = body.proctoring_summary
            context_bundle.setdefault(
                "session_label",
                _build_session_label(
                    round_type=session.get("round_type", "technical"),
                    target_company=session.get("target_company", ""),
                    job_role=session.get("target_role") or context_bundle.get("job_role", ""),
                ),
            )
            updates["context_bundle"] = context_bundle

        update_session(body.session_id, updates)
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


# ── Checkpoint / Resume endpoints ─────────────────────────────────────────────

class CheckpointBody(BaseModel):
    current_question_index: Optional[int]        = None
    conversation_history:   Optional[list]        = None
    scores:                 Optional[list]        = None
    transcript:             Optional[list]        = None
    detected_weaknesses:    Optional[list]        = None
    avoided_topics:         Optional[list]        = None
    timer_remaining_secs:   Optional[int]         = None


@router.post("/{session_id}/checkpoint")
async def save_session_checkpoint(
    session_id: str,
    body: CheckpointBody,
    user: dict = Depends(get_current_user),
):
    """
    Persist a mid-session snapshot so the candidate can resume later.
    Only saves fields that are explicitly provided in the request body.
    """
    state = {k: v for k, v in body.model_dump().items() if v is not None}
    if not state:
        return _err("No checkpoint fields provided.", status=400)

    try:
        ok = save_checkpoint(session_id, user["user_id"], state)
    except RuntimeError as e:
        return _err(str(e), status=503)
    except Exception as e:
        return _err(f"Checkpoint failed: {e}", status=500)

    if not ok:
        return _err("Session not found or access denied.", status=404)

    return _ok(data={"session_id": session_id, "checkpointed": True})


@router.get("/active")
async def list_active_sessions(
    user: dict = Depends(get_current_user),
):
    """
    Return all incomplete sessions for the current user (newest first).
    Used by the frontend to offer a 'Resume interview?' prompt.
    """
    try:
        sessions = get_active_sessions(user["user_id"])
    except RuntimeError as e:
        return _err(str(e), status=503)
    except Exception as e:
        return _err(f"Could not fetch active sessions: {e}", status=500)

    return _ok(data={"sessions": sessions})


@router.get("/{session_id}/resume")
async def resume_session(
    session_id: str,
    user: dict = Depends(get_current_user),
):
    """
    Fetch a session's full state for resuming.
    Returns 404 if session doesn't belong to this user or is already completed.
    """
    try:
        session = get_session_with_auth(session_id, user["user_id"])
    except RuntimeError as e:
        return _err(str(e), status=503)
    except Exception as e:
        return _err(f"Could not fetch session: {e}", status=500)

    if not session:
        return _err("Session not found or access denied.", status=404)

    if session.get("status") == "completed":
        return _err("Session already completed. View the report instead.", status=409)

    return _ok(data={
        "session_id":             session["id"],
        "round_type":             session.get("round_type"),
        "difficulty":             session.get("difficulty"),
        "current_question_index": session.get("current_question_index", 0),
        "questions":              session.get("questions", []),
        "transcript":             session.get("transcript", []),
        "scores":                 session.get("scores", []),
        "conversation_history":   session.get("conversation_history", []),
        "detected_weaknesses":    session.get("detected_weaknesses", []),
        "avoided_topics":         session.get("avoided_topics", []),
        "timer_remaining_secs":   session.get("timer_remaining_secs"),
        "last_checkpoint_at":     session.get("last_checkpoint_at"),
        "context_bundle":         session.get("context_bundle", {}),
    })
