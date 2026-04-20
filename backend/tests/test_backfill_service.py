"""
Unit tests for services/backfill_service.py

These tests are fully offline — no Supabase, no Groq calls.
All external calls are patched with unittest.mock.

We stub out the heavy dependencies (supabase, groq, etc.) in sys.modules
BEFORE importing any project code, so module-level imports don't fail.
"""
import sys
import os
import json
import types
import pytest
from unittest.mock import MagicMock, patch

# ── Stub out all heavy third-party dependencies ───────────────────────────────
def _stub(name):
    m = types.ModuleType(name)
    sys.modules[name] = m
    return m

for _mod_name in (
    "supabase", "supabase.client",
    "groq", "groq._client",
    "dotenv",
    "auth",
    "fastapi", "fastapi.responses", "fastapi.routing",
    "starlette", "starlette.responses", "starlette.routing",
):
    if _mod_name not in sys.modules:
        _stub(_mod_name)

sys.modules["dotenv"].load_dotenv = lambda *a, **kw: None           # type: ignore
sys.modules["supabase"].create_client = lambda *a, **kw: MagicMock()  # type: ignore
sys.modules["supabase"].Client = MagicMock                           # type: ignore

# Stub routers.report so the late import inside backfill_single_session works
# without pulling in fastapi.  We'll replace the two callables per-test.
_report_stub = _stub("routers.report")
_report_stub._generate_report_sse = MagicMock()   # type: ignore
_report_stub._is_complete_report = lambda r: False  # type: ignore

# Stub routers package itself
if "routers" not in sys.modules:
    _routers_pkg = _stub("routers")
_routers_pkg = sys.modules["routers"]
_routers_pkg.report = _report_stub  # type: ignore

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.backfill_service import (
    _drain_sse_generator,
    backfill_single_session,
    run_backfill_batch,
    is_backfill_running,
    _backfill_lock,
)


# ── helpers ───────────────────────────────────────────────────────────────────

def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


async def _make_sse_gen(*events):
    """Async generator that yields SSE strings."""
    for e in events:
        yield _sse(e)


# ── _drain_sse_generator ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_drain_returns_report_on_complete():
    gen = _make_sse_gen(
        {"stage": "core_analysis", "progress": 25},
        {"stage": "complete", "progress": 100, "report": {"overall_score": 78}},
    )
    result = await _drain_sse_generator(gen)
    assert result == {"overall_score": 78}


@pytest.mark.asyncio
async def test_drain_returns_none_on_error_event():
    gen = _make_sse_gen(
        {"stage": "error", "error": "Session not found"},
    )
    result = await _drain_sse_generator(gen)
    assert result is None


@pytest.mark.asyncio
async def test_drain_returns_none_when_generator_exhausted_early():
    # Generator ends without ever yielding "complete"
    gen = _make_sse_gen({"stage": "core_analysis", "progress": 10})
    result = await _drain_sse_generator(gen)
    assert result is None


@pytest.mark.asyncio
async def test_drain_ignores_malformed_lines():
    async def _bad_gen():
        yield "data: not-json\n\n"
        yield _sse({"stage": "complete", "report": {"grade": "B"}})

    result = await _drain_sse_generator(_bad_gen())
    assert result == {"grade": "B"}


# ── backfill_single_session ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_backfill_single_session_skips_if_report_exists():
    import sys
    report_stub = sys.modules["routers.report"]
    complete_report = {k: "x" for k in [
        "question_scores", "per_question_analysis", "category_breakdown",
        "cv_audit", "study_roadmap", "communication_breakdown",
        "what_went_wrong", "thirty_day_plan", "follow_up_questions",
    ]}
    original_is_complete = report_stub._is_complete_report
    original_gen         = report_stub._generate_report_sse
    report_stub._is_complete_report = lambda r: True
    gen_called = []
    report_stub._generate_report_sse = lambda *a: gen_called.append(1)

    with patch("services.backfill_service.get_report", return_value=complete_report):
        result = await backfill_single_session("session-123", "user-abc")

    report_stub._is_complete_report   = original_is_complete
    report_stub._generate_report_sse  = original_gen
    assert result is True
    assert gen_called == [], "Generator should NOT be called when report already exists"


@pytest.mark.asyncio
async def test_backfill_single_session_generates_when_no_report():
    import sys
    report_stub = sys.modules["routers.report"]
    report_payload = {k: "x" for k in [
        "question_scores", "per_question_analysis", "category_breakdown",
        "cv_audit", "study_roadmap", "communication_breakdown",
        "what_went_wrong", "thirty_day_plan", "follow_up_questions",
    ]}

    async def _fake_gen(session_id, user_id):
        yield _sse({"stage": "core_analysis", "progress": 25})
        yield _sse({"stage": "complete", "progress": 100, "report": report_payload})

    original_is_complete = report_stub._is_complete_report
    original_gen         = report_stub._generate_report_sse
    report_stub._is_complete_report  = lambda r: False
    report_stub._generate_report_sse = _fake_gen

    with patch("services.backfill_service.get_report", return_value=None):
        result = await backfill_single_session("session-123", "user-abc")

    report_stub._is_complete_report  = original_is_complete
    report_stub._generate_report_sse = original_gen
    assert result is True


@pytest.mark.asyncio
async def test_backfill_single_session_returns_false_on_sse_error():
    import sys
    report_stub = sys.modules["routers.report"]

    async def _error_gen(session_id, user_id):
        yield _sse({"stage": "error", "error": "Groq API failed"})

    original_is_complete = report_stub._is_complete_report
    original_gen         = report_stub._generate_report_sse
    report_stub._is_complete_report  = lambda r: False
    report_stub._generate_report_sse = _error_gen

    with patch("services.backfill_service.get_report", return_value=None):
        result = await backfill_single_session("session-456", "user-abc")

    report_stub._is_complete_report  = original_is_complete
    report_stub._generate_report_sse = original_gen
    assert result is False


@pytest.mark.asyncio
async def test_backfill_single_session_returns_false_on_exception():
    with patch("services.backfill_service.get_report", side_effect=Exception("DB down")):
        result = await backfill_single_session("session-789", "user-abc")
    assert result is False


# ── run_backfill_batch ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_run_backfill_batch_processes_all_pending():
    pending = [
        {"session_id": "s1", "user_id": "u1"},
        {"session_id": "s2", "user_id": "u1"},
    ]

    async def _fake_backfill(session_id, user_id):
        return True

    with patch("services.backfill_service.get_sessions_pending_report", return_value=pending), \
         patch("services.backfill_service.backfill_single_session", side_effect=_fake_backfill):

        result = await run_backfill_batch(limit=10, delay_seconds=0)
        assert result["processed"] == 2
        assert result["failed"] == 0
        assert result["status"] == "done"


@pytest.mark.asyncio
async def test_run_backfill_batch_counts_failures():
    pending = [
        {"session_id": "s1", "user_id": "u1"},
        {"session_id": "s2", "user_id": "u1"},
        {"session_id": "s3", "user_id": "u1"},
    ]
    calls = {"n": 0}

    async def _mixed(session_id, user_id):
        calls["n"] += 1
        return calls["n"] % 2 == 1  # s1 ok, s2 fail, s3 ok

    with patch("services.backfill_service.get_sessions_pending_report", return_value=pending), \
         patch("services.backfill_service.backfill_single_session", side_effect=_mixed):

        result = await run_backfill_batch(limit=10, delay_seconds=0)
        assert result["processed"] == 2
        assert result["failed"] == 1


@pytest.mark.asyncio
async def test_run_backfill_batch_skips_rows_missing_ids():
    pending = [
        {"session_id": None, "user_id": "u1"},   # bad row — skipped
        {"session_id": "s1", "user_id": "u1"},
    ]

    async def _ok(session_id, user_id):
        return True

    with patch("services.backfill_service.get_sessions_pending_report", return_value=pending), \
         patch("services.backfill_service.backfill_single_session", side_effect=_ok):

        result = await run_backfill_batch(limit=10, delay_seconds=0)
        assert result["processed"] == 1
        assert result["skipped"] == 1


@pytest.mark.asyncio
async def test_run_backfill_batch_returns_already_running_if_locked():
    async with _backfill_lock:
        result = await run_backfill_batch(limit=5, delay_seconds=0)
    assert result["status"] == "already_running"


@pytest.mark.asyncio
async def test_run_backfill_batch_empty_queue():
    with patch("services.backfill_service.get_sessions_pending_report", return_value=[]):
        result = await run_backfill_batch(limit=10, delay_seconds=0)
    assert result["processed"] == 0
    assert result["status"] == "done"
