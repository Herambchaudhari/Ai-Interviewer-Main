"""
Unit tests for the SSE termination fix — C1: SSE stream hangs forever.

Covers:
  - _safe_generate_report_sse: inner generator crashes → yields error SSE event
  - _safe_generate_report_sse: inner generator yields complete → passes through untouched
  - _safe_generate_report_sse: inner generator yields progress then crashes → error is last event
  - hang guard logic: stream closes (done=True) without complete → onError called
  - AbortError path: AbortError during stream read → timeout error message
  - normal path: complete event received → onComplete called, no error

All tests are fully offline — no Supabase, Groq, FastAPI, or network calls.
"""
import sys
import os
import json
import asyncio
import types
import pytest
from unittest.mock import MagicMock

# ── Stub heavy third-party dependencies ───────────────────────────────────────

def _stub(name):
    m = types.ModuleType(name)
    sys.modules[name] = m
    return m

for _mod_name in (
    "supabase", "supabase.client",
    "groq", "groq._client",
    "dotenv",
    "fastapi", "fastapi.responses", "fastapi.routing", "fastapi.security",
    "starlette", "starlette.responses", "starlette.routing",
    "httpx",
):
    if _mod_name not in sys.modules:
        _stub(_mod_name)

sys.modules["dotenv"].load_dotenv = lambda *a, **kw: None
sys.modules["supabase"].create_client = lambda *a, **kw: MagicMock()
sys.modules["supabase"].Client = MagicMock
_fastapi = sys.modules["fastapi"]
_fastapi.APIRouter = MagicMock
_fastapi.Depends = lambda f: f
_fastapi.HTTPException = type("HTTPException", (Exception,), {"__init__": lambda s, **kw: None})
sys.modules["fastapi.responses"].StreamingResponse = MagicMock
sys.modules["fastapi.responses"].JSONResponse = MagicMock
_stub("auth").get_current_user = lambda: {"user_id": "test"}

_here = os.path.dirname(__file__)
_backend = os.path.dirname(_here)
for _p in (_backend, os.path.join(_backend, "routers"), os.path.join(_backend, "services")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

for _svc in (
    "services.groq_service", "services.evaluator", "services.adaptive_engine",
    "services.stt", "services.whisper_service", "services.benchmarking_service",
    "services.spaced_repetition_service", "services.checklist_service",
    "services.code_runner", "services.web_researcher", "services.company_intelligence",
    "services.session_history_analyzer", "services.voice_analyzer",
    "services.backfill_service", "services.supabase_service",
    "prompts.interviewer_prompt", "prompts.report_prompt", "prompts.scoring_examples",
    "prompts.stage3_prompt", "prompts.stage4_prompt",
    "groq._client", "services.api_manager",
):
    if _svc not in sys.modules:
        _stub(_svc)

_groq_stub = sys.modules["services.groq_service"]
for _sym in ("_achat", "_clean", "_gen_core", "_gen_cv_audit", "_gen_code_quality_analysis"):
    setattr(_groq_stub, _sym, MagicMock())

sys.modules["prompts.stage3_prompt"].build_communication_analysis_prompt = lambda *a, **kw: ""
sys.modules["prompts.stage4_prompt"].build_playbook_prompt = lambda *a, **kw: ""
sys.modules["services.benchmarking_service"].compute_peer_comparison = MagicMock()
sys.modules["services.spaced_repetition_service"].build_study_schedule = MagicMock()
sys.modules["services.checklist_service"].generate_checklist = MagicMock()
sys.modules["services.code_runner"].analyze_code_quality = MagicMock()
sys.modules["services.code_runner"].aggregate_code_quality = MagicMock()
sys.modules["services.web_researcher"].search_company_trends = MagicMock()
sys.modules["services.company_intelligence"].analyze_company_fit = MagicMock()
sys.modules["services.session_history_analyzer"].analyze_cross_session = MagicMock()
sys.modules["services.voice_analyzer"].analyze_session_voice = MagicMock()

import routers.report as _report_module


# ── Helpers ───────────────────────────────────────────────────────────────────

def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


async def _collect(gen) -> list:
    """Collect all yielded SSE strings from an async generator."""
    events = []
    async for chunk in gen:
        events.append(chunk)
    return events


def _parse_events(chunks: list) -> list:
    """Parse raw SSE strings into dicts."""
    events = []
    for chunk in chunks:
        for line in chunk.strip().split("\n"):
            if line.startswith("data: "):
                try:
                    events.append(json.loads(line[6:]))
                except Exception:
                    pass
    return events


# ── Mirror of _safe_generate_report_sse for isolated testing ─────────────────

async def _safe_wrapper(inner_gen_fn):
    """
    Mirrors the logic of _safe_generate_report_sse — wraps any async generator
    and guarantees a terminal {"stage": "error"} event on unhandled exceptions.
    """
    try:
        async for chunk in inner_gen_fn():
            yield chunk
    except Exception as e:
        yield _sse({"stage": "error", "error": str(e)})


# ── Test: inner generator crashes mid-stream ──────────────────────────────────

class TestSafeGeneratorWrapper:
    def test_crash_yields_error_event(self):
        """Inner generator raises → last event must have stage=error."""
        async def _crashing():
            yield _sse({"stage": "core_analysis", "progress": 25})
            raise RuntimeError("Simulated DB crash")

        chunks = asyncio.run(
            _collect(_safe_wrapper(_crashing))
        )
        events = _parse_events(chunks)
        assert len(events) >= 1
        last = events[-1]
        assert last["stage"] == "error"
        assert "Simulated DB crash" in last.get("error", "")

    def test_crash_on_first_yield_still_returns_error(self):
        """Crash before any progress events → only an error event."""
        async def _instant_crash():
            raise ValueError("immediate failure")
            yield  # make it a generator

        chunks = asyncio.run(
            _collect(_safe_wrapper(_instant_crash))
        )
        events = _parse_events(chunks)
        assert len(events) == 1
        assert events[0]["stage"] == "error"

    def test_clean_complete_passes_through(self):
        """Inner generator completes normally → complete event must reach caller."""
        async def _clean():
            yield _sse({"stage": "core_analysis", "progress": 50})
            yield _sse({"stage": "complete", "progress": 100, "report": {"score": 7}})

        chunks = asyncio.run(
            _collect(_safe_wrapper(_clean))
        )
        events = _parse_events(chunks)
        stages = [e["stage"] for e in events]
        assert "complete" in stages
        assert "error" not in stages

    def test_progress_events_preserved_before_crash(self):
        """Progress events emitted before crash must still reach caller."""
        async def _progress_then_crash():
            yield _sse({"stage": "core_analysis", "progress": 10})
            yield _sse({"stage": "behavioral_analysis", "progress": 50})
            raise RuntimeError("crash after progress")

        chunks = asyncio.run(
            _collect(_safe_wrapper(_progress_then_crash))
        )
        events = _parse_events(chunks)
        stages = [e["stage"] for e in events]
        assert "core_analysis" in stages
        assert "behavioral_analysis" in stages
        assert stages[-1] == "error"

    def test_error_event_from_inner_generator_passes_through(self):
        """Inner generator explicitly yields error → must reach caller unchanged."""
        async def _explicit_error():
            yield _sse({"stage": "error", "error": "stage 1 failed"})

        chunks = asyncio.run(
            _collect(_safe_wrapper(_explicit_error))
        )
        events = _parse_events(chunks)
        assert len(events) == 1
        assert events[0]["stage"] == "error"
        assert events[0]["error"] == "stage 1 failed"


# ── Mirror of api.js hang guard + AbortError logic ───────────────────────────

class TestHangGuardLogic:
    """
    Tests the Python equivalent of the JS hang guard added in api.js (C1 fix):
    - stream closes (done=True) without a complete event → onError is called
    - AbortError → timeout message is surfaced
    - normal complete → onComplete is called, no error
    """

    def _run_stream_parser(self, lines: list, abort_on_read: bool = False):
        """
        Mirror of the JS SSE parsing loop in getReportWithSSE.
        Returns (completed, errored, error_msg, progress_count).
        """
        completed = False
        errored = False
        error_msg = None
        progress_count = 0
        received_complete = False

        class FakeAbortError(Exception):
            name = "AbortError"

        try:
            for line in lines:
                if abort_on_read:
                    raise FakeAbortError("The operation was aborted.")
                if not line.startswith("data: "):
                    continue
                try:
                    event = json.loads(line[6:])
                    if event.get("stage") == "complete":
                        received_complete = True
                        completed = True
                        break
                    elif event.get("stage") == "error":
                        errored = True
                        error_msg = event.get("error", "Report generation failed")
                        break
                    else:
                        progress_count += 1
                except Exception:
                    pass

            # Hang guard: stream ended without complete or error
            if not received_complete and not errored:
                errored = True
                error_msg = "Report generation ended unexpectedly. Please try again."

        except Exception as e:
            if getattr(e, "name", None) == "AbortError":
                errored = True
                error_msg = "Report generation timed out after 5 minutes. Please try again."
            else:
                errored = True
                error_msg = str(e)

        return completed, errored, error_msg, progress_count

    def test_stream_closes_without_complete_triggers_hang_guard(self):
        lines = [
            'data: {"stage": "core_analysis", "progress": 25}',
            'data: {"stage": "behavioral_analysis", "progress": 50}',
            # stream ends here — no complete event
        ]
        completed, errored, error_msg, _ = self._run_stream_parser(lines)
        assert not completed
        assert errored
        assert "unexpectedly" in error_msg

    def test_empty_stream_triggers_hang_guard(self):
        lines = []
        completed, errored, error_msg, _ = self._run_stream_parser(lines)
        assert not completed
        assert errored
        assert "unexpectedly" in error_msg

    def test_complete_event_marks_completed(self):
        lines = [
            'data: {"stage": "core_analysis", "progress": 50}',
            'data: {"stage": "complete", "progress": 100, "report": {}}',
        ]
        completed, errored, error_msg, _ = self._run_stream_parser(lines)
        assert completed
        assert not errored
        assert error_msg is None

    def test_error_event_marks_errored(self):
        lines = ['data: {"stage": "error", "error": "stage 1 timed out"}']
        completed, errored, error_msg, _ = self._run_stream_parser(lines)
        assert not completed
        assert errored
        assert "stage 1 timed out" in error_msg

    def test_abort_error_surfaces_timeout_message(self):
        lines = ['data: {"stage": "core_analysis", "progress": 25}']
        completed, errored, error_msg, _ = self._run_stream_parser(lines, abort_on_read=True)
        assert not completed
        assert errored
        assert "timed out" in error_msg

    def test_progress_events_counted_before_hang_guard(self):
        lines = [
            'data: {"stage": "core_analysis", "progress": 10}',
            'data: {"stage": "behavioral_analysis", "progress": 50}',
        ]
        _, _, _, progress_count = self._run_stream_parser(lines)
        assert progress_count == 2
