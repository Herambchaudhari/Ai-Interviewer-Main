"""
DSA router — coding-round endpoints.

  GET  /api/v1/dsa/problems                — list problem bank (filter by difficulty/topic)
  GET  /api/v1/dsa/problems/:slug          — full problem (statement + samples + starter)
  POST /api/v1/dsa/run                     — run user code against sample tests (fast, no scoring)
  POST /api/v1/dsa/submit                  — run all hidden tests + LLM evaluation

Hidden tests, driver code, and full problem internals are NEVER returned to the
client — they only flow server-side into the runner.
"""
import traceback
import uuid
from typing import Optional, List
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from auth import get_current_user
from services.db_service import init_supabase
from services.code_runner import run_against_tests
from services.dsa_evaluator import evaluate_dsa_submission

# Stable namespace UUID — paired with (session_id, slug) it produces a
# deterministic question_id whenever the frontend forgets to send one. Same
# submission always maps to the same id, so resubmits cleanly replace prior
# entries instead of duplicating.
_DSA_NAMESPACE = uuid.UUID("3a6e21a8-5b0e-4d1d-9d2c-2cab6c3a3a55")


def _resolve_question_id(
    db, session_id: str, slug: str, supplied_qid: Optional[str]
) -> str:
    """
    Make sure every persisted DSA submission has a question_id.

    Resolution order:
      1. Whatever the client sent (trusted as long as it's non-empty)
      2. Match by problem_slug against the session's `questions` list
      3. Deterministic UUID5 from (session_id, slug) — last-resort fallback
         that still lets the report enrichment path key off the same id when
         the user resubmits the same problem.
    """
    if supplied_qid:
        return supplied_qid

    try:
        sess = (
            db.table("sessions")
            .select("questions")
            .eq("id", session_id)
            .limit(1)
            .execute()
        )
        for q in (sess.data[0].get("questions") if sess.data else []) or []:
            if q.get("problem_slug") == slug and q.get("id"):
                return q["id"]
    except Exception as e:
        print(f"[dsa/submit] questions lookup failed: {e}")

    return str(uuid.uuid5(_DSA_NAMESPACE, f"{session_id}:{slug}"))

router = APIRouter()


def _ok(data, message: str = "Success") -> dict:
    return {"success": True, "data": data, "error": None, "message": message}


def _err(error: str, status: int = 400):
    return JSONResponse(
        status_code=status,
        content={"success": False, "data": None, "error": error},
    )


# ── Public-safe projection (omit hidden tests + driver code) ─────────────────
_PUBLIC_FIELDS = (
    "id, slug, title, difficulty, topics, statement_md, constraints_md, "
    "examples, sample_tests, function_signature, starter_code, "
    "reference_complexity_time, reference_complexity_space, "
    "time_limit_ms, memory_limit_mb, created_at"
)


# ── GET /api/v1/dsa/problems ─────────────────────────────────────────────────
@router.get("/problems")
async def list_problems(
    difficulty: Optional[str] = Query(None, description="easy|medium|hard"),
    topic:      Optional[str] = Query(None),
    limit:      int           = Query(50, le=100),
    user: dict = Depends(get_current_user),
):
    try:
        db = init_supabase()
        q = db.table("dsa_problems").select(
            "id, slug, title, difficulty, topics, "
            "reference_complexity_time, reference_complexity_space"
        )
        if difficulty:
            q = q.eq("difficulty", difficulty.lower())
        if topic:
            q = q.contains("topics", [topic])
        res = q.order("difficulty").order("title").limit(limit).execute()
    except RuntimeError:
        return _err("Database not configured.", status=503)
    except Exception as e:
        return _err(f"Failed to list problems: {e}", status=500)

    return _ok(data={"problems": res.data or [], "total": len(res.data or [])})


# ── GET /api/v1/dsa/problems/:slug ───────────────────────────────────────────
@router.get("/problems/{slug}")
async def get_problem(slug: str, user: dict = Depends(get_current_user)):
    try:
        db = init_supabase()
        res = db.table("dsa_problems").select(_PUBLIC_FIELDS).eq("slug", slug).limit(1).execute()
    except RuntimeError:
        return _err("Database not configured.", status=503)
    except Exception as e:
        return _err(f"Failed to fetch problem: {e}", status=500)

    rows = res.data or []
    if not rows:
        return _err("Problem not found.", status=404)

    return _ok(data=rows[0])


# ── Internal helper: load problem with hidden tests + driver (server-only) ───
def _load_problem_with_internals(slug: str) -> Optional[dict]:
    db = init_supabase()
    res = db.table("dsa_problems").select(
        "id, slug, title, difficulty, topics, statement_md, constraints_md, "
        "sample_tests, hidden_tests, function_signature, driver_code, "
        "reference_complexity_time, reference_complexity_space, time_limit_ms"
    ).eq("slug", slug).limit(1).execute()
    rows = res.data or []
    return rows[0] if rows else None


# ── POST /api/v1/dsa/run — sample tests only (fast feedback) ─────────────────
class RunRequest(BaseModel):
    slug:     str
    language: str
    code:     str


@router.post("/run")
async def run_sample(body: RunRequest, user: dict = Depends(get_current_user)):
    """Run user code against the *visible* sample tests. No scoring, no LLM."""
    if not body.code.strip():
        return _err("Code is empty.", status=400)

    try:
        problem = _load_problem_with_internals(body.slug)
    except RuntimeError:
        return _err("Database not configured.", status=503)
    except Exception as e:
        return _err(f"Failed to load problem: {e}", status=500)

    if not problem:
        return _err("Problem not found.", status=404)

    driver = (problem.get("driver_code") or {}).get(body.language.lower())
    if not driver:
        return _err(f"Language '{body.language}' is not supported for this problem.", status=400)

    samples = problem.get("sample_tests") or []
    cpu_limit = max(1.0, min(5.0, (problem.get("time_limit_ms") or 2000) / 1000))

    results = await run_against_tests(
        user_code   = body.code,
        language    = body.language.lower(),
        driver_code = driver,
        tests       = samples,
        cpu_limit_sec = cpu_limit,
    )

    passed = sum(1 for r in results if r["passed"])
    return _ok(data={
        "results":      results,
        "tests_passed": passed,
        "tests_total":  len(results),
        "all_passed":   passed == len(results) and len(results) > 0,
    })


# ── POST /api/v1/dsa/submit — hidden tests + LLM evaluation ─────────────────
class SubmitRequest(BaseModel):
    slug:        str
    language:    str
    code:        str
    session_id:  Optional[str] = None
    question_id: Optional[str] = None


@router.post("/submit")
async def submit_solution(body: SubmitRequest, user: dict = Depends(get_current_user)):
    if not body.code.strip():
        return _err("Code is empty.", status=400)

    try:
        problem = _load_problem_with_internals(body.slug)
    except RuntimeError:
        return _err("Database not configured.", status=503)
    except Exception as e:
        return _err(f"Failed to load problem: {e}", status=500)

    if not problem:
        return _err("Problem not found.", status=404)

    driver = (problem.get("driver_code") or {}).get(body.language.lower())
    if not driver:
        return _err(f"Language '{body.language}' is not supported for this problem.", status=400)

    # Run sample + hidden tests together so we report on every test the user can see.
    samples = problem.get("sample_tests") or []
    hidden  = problem.get("hidden_tests") or []
    all_tests = list(samples) + list(hidden)

    cpu_limit = max(1.0, min(5.0, (problem.get("time_limit_ms") or 2000) / 1000))

    test_results = await run_against_tests(
        user_code   = body.code,
        language    = body.language.lower(),
        driver_code = driver,
        tests       = all_tests,
        cpu_limit_sec = cpu_limit,
    )

    # Tag samples vs hidden in the response so frontend can show only sample diffs
    sample_count = len(samples)
    for i, r in enumerate(test_results):
        r["kind"] = "sample" if i < sample_count else "hidden"

    # ── LLM evaluation (verdict, complexity, hints) ──────────────────────────
    evaluation = await evaluate_dsa_submission(
        problem      = problem,
        language     = body.language.lower(),
        code         = body.code,
        test_results = test_results,
    )

    # ── Persist into sessions.scores + code_execution_results + transcript ──
    # `scores`                  → drives overall_score + per-question table
    # `code_execution_results`  → drives the DSA Code Quality pre-stage in report.py
    # `transcript`              → drives the entire question_scores list — without
    #                             this entry the DSA submission is INVISIBLE to the
    #                             report pipeline (root cause of "0 solved" reports).
    #
    # We persist whenever `session_id` is present. If question_id was missing on
    # the request, _resolve_question_id() either matches it from session.questions
    # by slug or deterministically derives one — so a flaky frontend never causes
    # a silent drop. Errors are caught but printed with traceback.
    persisted = False
    persist_error: Optional[str] = None
    resolved_qid: Optional[str] = None

    if body.session_id:
        try:
            db = init_supabase()
            resolved_qid = _resolve_question_id(
                db, body.session_id, body.slug, body.question_id
            )

            sess_res = db.table("sessions").select("scores, code_execution_results, transcript") \
                .eq("id", body.session_id).limit(1).execute()
            sess_row = sess_res.data[0] if sess_res.data else {}

            tests_total  = evaluation.get("tests_total")  or 0
            tests_passed = evaluation.get("tests_passed") or 0
            pass_rate    = (tests_passed / tests_total) if tests_total else 0.0

            # 1) Append to scores (replace any prior entry for the same question)
            scores = sess_row.get("scores") or []
            scores = [s for s in scores if s.get("question_id") != resolved_qid]
            scores.append({
                "question_id":     resolved_qid,
                "problem_slug":    body.slug,
                "problem_title":   problem.get("title"),
                "language":        body.language.lower(),
                "score":           evaluation.get("correctness_score", 0),
                "verdict":         evaluation.get("verdict"),
                "time_complexity": evaluation.get("time_complexity"),
                "space_complexity": evaluation.get("space_complexity"),
                "tests_passed":    tests_passed,
                "tests_total":     tests_total,
                "pass_rate":       pass_rate,
                "avg_runtime_ms":  evaluation.get("avg_runtime_ms", 0),
                "code_excerpt":    (body.code or "")[:2000],
            })

            # 2) Append to code_execution_results (consumed by report DSA pre-stage)
            cer = sess_row.get("code_execution_results") or []
            cer = [c for c in cer if c.get("question_id") != resolved_qid]
            cer.append({
                "question_id":   resolved_qid,
                "question_text": f"{problem.get('title')} ({problem.get('difficulty')})",
                "problem_slug":  body.slug,
                "language":      body.language.lower(),
                "code":          body.code,
                "execution": {
                    "tests_passed":   tests_passed,
                    "tests_total":    tests_total,
                    "all_passed":     tests_total > 0 and tests_passed == tests_total,
                    "avg_runtime_ms": evaluation.get("avg_runtime_ms", 0),
                    "avg_memory_kb":  evaluation.get("avg_memory_kb", 0),
                    "verdict":        evaluation.get("verdict"),
                },
                "evaluation": evaluation,
            })

            # 3) Append a transcript entry — report.py builds per-question analysis
            #    from sessions.transcript, so dropping this is what causes the
            #    "0 solved" report. Always write this entry.
            transcript = sess_row.get("transcript") or []
            transcript = [t for t in transcript if t.get("question_id") != resolved_qid]
            transcript.append({
                "question_id":   resolved_qid,
                "question":      f"{problem.get('title')} ({problem.get('difficulty')})",
                "question_type": "code",
                "answer":        body.code,
                "answer_summary": evaluation.get("approach_summary", ""),
                "score":         evaluation.get("correctness_score", 0),
                "verdict":       evaluation.get("verdict"),
                "feedback":      evaluation.get("approach_summary", ""),
                "strengths":     evaluation.get("strengths", []),
                "improvements": (evaluation.get("improvements", []) or []) + (evaluation.get("bugs_or_smells", []) or []),
                "category":      ", ".join(problem.get("topics") or []) or "DSA",
                "topic":         (problem.get("topics") or ["DSA"])[0],
                "difficulty":    problem.get("difficulty", "medium"),
                "skipped":       False,
                # DSA execution metadata embedded directly so report.py can build
                # question_scores from transcript alone — no separate enrichment
                # look-up required. If sessions.scores enrichment also runs it
                # will overwrite with identical values, which is harmless.
                "problem_slug":     body.slug,
                "problem_title":    problem.get("title", ""),
                "language":         body.language.lower(),
                "tests_passed":     tests_passed,
                "tests_total":      tests_total,
                "pass_rate":        pass_rate,
                "avg_runtime_ms":   evaluation.get("avg_runtime_ms", 0),
                "time_complexity":  evaluation.get("time_complexity", ""),
                "space_complexity": evaluation.get("space_complexity", ""),
            })

            db.table("sessions").update({
                "scores":                  scores,
                "code_execution_results":  cer,
                "transcript":              transcript,
            }).eq("id", body.session_id).execute()
            persisted = True
        except Exception as _persist_err:
            # Persistence is best-effort — never block the response — but PRINT
            # full traceback so silent drops surface in the logs.
            persist_error = str(_persist_err)
            print(f"[dsa/submit] persist failed for session={body.session_id} "
                  f"slug={body.slug} qid_in={body.question_id!r} qid_resolved={resolved_qid!r}: "
                  f"{_persist_err}")
            traceback.print_exc()

    # Hide test-input/expected for hidden tests if the user fails them (anti-cheat)
    public_results = []
    for r in test_results:
        is_hidden = r.get("kind") == "hidden"
        public_results.append({
            "index":      r["index"],
            "kind":       r["kind"],
            "passed":     r["passed"],
            "status":     r["status"],
            "runtime_ms": r["runtime_ms"],
            "memory_kb":  r["memory_kb"],
            # For samples we always show the diff. For hidden tests, only show
            # the user's stdout (truncated) so they can debug, but never the expected.
            **({"stdout": r["stdout"], "expected": r["expected"], "error": r["error"]}
               if not is_hidden else
               {"stdout": (r["stdout"][:120] if r["stdout"] else ""), "error": r["error"]}),
        })

    return _ok(data={
        "results":     public_results,
        "evaluation":  evaluation,
        "all_passed":  evaluation["tests_passed"] == evaluation["tests_total"],
        "persisted":   persisted,
        "persist_error": persist_error,
        "question_id": resolved_qid,   # echo back so frontend can sync state
    })
