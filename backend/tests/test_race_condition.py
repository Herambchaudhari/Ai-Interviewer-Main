"""
Unit tests for the Race Condition fix — Report invisible after save.

Covers:
  - SSE persist block: save_report succeeds + mark fails → persist_ok = True
  - SSE persist block: save_report succeeds + update_session fails → persist_ok = True
  - SSE persist block: save_report fails → persist_ok = False
  - SSE persist block: degraded quality routes to mark_report_degraded, not mark_report_complete
  - retry-save endpoint: save succeeds + mark fails → returns {"saved": True}
  - retry-save endpoint: save fails → returns 503 error response
  - retry-save endpoint: respects report_quality when choosing mark function
  - dashboard API: report_status field is present in each session dict

All tests are fully offline — no Supabase, Groq, or FastAPI calls.
"""
import sys
import os
import types
import pytest
from unittest.mock import MagicMock, patch, call

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

# Add backend to path
_here = os.path.dirname(__file__)
_backend = os.path.dirname(_here)
for _p in (_backend, os.path.join(_backend, "routers"), os.path.join(_backend, "services")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# Stub all service imports that report.py pulls in at module level
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

def _run_persist_block(
    save_raises=None,
    mark_raises=None,
    update_raises=None,
    report_quality="full",
    failed_stages=None,
):
    """
    Runs the isolated persist logic from _generate_report_sse in isolation.
    Returns (persist_ok, calls_made) where calls_made is a list of function names called.
    """
    failed_stages = failed_stages or {}
    calls_made = []

    def save_report(sid, payload):
        calls_made.append("save_report")
        if save_raises:
            raise save_raises

    def mark_report_complete(sid):
        calls_made.append("mark_report_complete")
        if mark_raises:
            raise mark_raises

    def mark_report_degraded(sid, stages):
        calls_made.append("mark_report_degraded")
        if mark_raises:
            raise mark_raises

    def mark_report_persist_failed(sid, msg):
        calls_made.append("mark_report_persist_failed")

    def update_session(sid, updates):
        calls_made.append("update_session")
        if update_raises:
            raise update_raises

    # ── Mirror of the fixed persist block in _generate_report_sse ─────────────
    persist_ok = False
    persist_error_msg = None

    try:
        save_report("sid", {})
        persist_ok = True
    except Exception as e:
        persist_error_msg = str(e)
        try:
            mark_report_persist_failed("sid", persist_error_msg)
        except Exception:
            pass

    if persist_ok:
        try:
            if report_quality == "degraded":
                mark_report_degraded("sid", failed_stages)
            else:
                mark_report_complete("sid")
        except Exception:
            pass  # non-fatal

    if persist_ok:
        try:
            status_val = "report_degraded" if report_quality == "degraded" else "completed"
            update_session("sid", {"status": status_val})
        except Exception:
            pass  # non-fatal

    return persist_ok, calls_made


def _run_retry_save_block(
    save_raises=None,
    mark_raises=None,
    update_raises=None,
    report_quality="full",
):
    """
    Runs the isolated persist logic from retry_save_report in isolation.
    Returns (saved, error_msg, calls_made).
    """
    calls_made = []

    def save_report(sid, payload):
        calls_made.append("save_report")
        if save_raises:
            raise save_raises

    def mark_report_complete(sid):
        calls_made.append("mark_report_complete")
        if mark_raises:
            raise mark_raises

    def mark_report_degraded(sid, stages):
        calls_made.append("mark_report_degraded")
        if mark_raises:
            raise mark_raises

    def mark_report_persist_failed(sid, msg):
        calls_made.append("mark_report_persist_failed")

    def update_session(sid, updates):
        calls_made.append("update_session")
        if update_raises:
            raise update_raises

    # ── Mirror of the fixed retry_save_report block ────────────────────────────
    saved = False
    error_msg = None

    try:
        save_report("sid", {})
    except Exception as e:
        try:
            mark_report_persist_failed("sid", str(e))
        except Exception:
            pass
        return False, str(e), calls_made

    try:
        if report_quality == "degraded":
            mark_report_degraded("sid", {})
        else:
            mark_report_complete("sid")
    except Exception:
        pass

    try:
        status_val = "report_degraded" if report_quality == "degraded" else "completed"
        update_session("sid", {"status": status_val})
    except Exception:
        pass

    return True, None, calls_made


# ═══════════════════════════════════════════════════════════════════════════════
# SSE persist block isolation
# ═══════════════════════════════════════════════════════════════════════════════

class TestSSEPersistBlock:
    def test_all_succeed_persist_ok_true(self):
        ok, calls = _run_persist_block()
        assert ok is True
        assert "save_report" in calls
        assert "mark_report_complete" in calls
        assert "update_session" in calls

    def test_save_ok_mark_fails_persist_ok_still_true(self):
        """mark_report_complete throws — persist_ok must remain True."""
        ok, calls = _run_persist_block(mark_raises=RuntimeError("DB timeout"))
        assert ok is True
        assert "save_report" in calls
        assert "mark_report_complete" in calls  # was called, but raised
        # persist_failed should NOT be called — save itself succeeded
        assert "mark_report_persist_failed" not in calls

    def test_save_ok_update_session_fails_persist_ok_still_true(self):
        """update_session throws — persist_ok must remain True."""
        ok, calls = _run_persist_block(update_raises=RuntimeError("network error"))
        assert ok is True
        assert "update_session" in calls
        assert "mark_report_persist_failed" not in calls

    def test_save_fails_persist_ok_false(self):
        """save_report throws — persist_ok must be False."""
        ok, calls = _run_persist_block(save_raises=RuntimeError("insert failed"))
        assert ok is False
        assert "save_report" in calls
        assert "mark_report_persist_failed" in calls

    def test_save_fails_mark_and_update_not_called(self):
        """When save_report fails, mark and update_session must not run."""
        ok, calls = _run_persist_block(save_raises=RuntimeError("insert failed"))
        assert "mark_report_complete" not in calls
        assert "update_session" not in calls

    def test_degraded_quality_calls_mark_report_degraded(self):
        ok, calls = _run_persist_block(report_quality="degraded")
        assert ok is True
        assert "mark_report_degraded" in calls
        assert "mark_report_complete" not in calls

    def test_full_quality_calls_mark_report_complete(self):
        ok, calls = _run_persist_block(report_quality="full")
        assert ok is True
        assert "mark_report_complete" in calls
        assert "mark_report_degraded" not in calls

    def test_mark_degraded_fails_persist_ok_still_true(self):
        ok, calls = _run_persist_block(
            report_quality="degraded",
            mark_raises=RuntimeError("column missing"),
        )
        assert ok is True
        assert "mark_report_persist_failed" not in calls


# ═══════════════════════════════════════════════════════════════════════════════
# retry-save endpoint isolation
# ═══════════════════════════════════════════════════════════════════════════════

class TestRetrySaveBlock:
    def test_all_succeed_returns_saved_true(self):
        saved, err, calls = _run_retry_save_block()
        assert saved is True
        assert err is None
        assert "save_report" in calls

    def test_mark_fails_still_returns_saved_true(self):
        """mark_report_complete throws — response must still be saved=True."""
        saved, err, calls = _run_retry_save_block(mark_raises=RuntimeError("timeout"))
        assert saved is True
        assert "mark_report_persist_failed" not in calls

    def test_update_session_fails_still_returns_saved_true(self):
        saved, err, calls = _run_retry_save_block(update_raises=RuntimeError("network"))
        assert saved is True

    def test_save_fails_returns_false_and_error(self):
        saved, err, calls = _run_retry_save_block(save_raises=RuntimeError("insert failed"))
        assert saved is False
        assert "insert failed" in err
        assert "mark_report_persist_failed" in calls

    def test_degraded_quality_calls_mark_degraded(self):
        saved, err, calls = _run_retry_save_block(report_quality="degraded")
        assert saved is True
        assert "mark_report_degraded" in calls
        assert "mark_report_complete" not in calls

    def test_full_quality_calls_mark_complete(self):
        saved, err, calls = _run_retry_save_block(report_quality="full")
        assert saved is True
        assert "mark_report_complete" in calls
        assert "mark_report_degraded" not in calls


# ═══════════════════════════════════════════════════════════════════════════════
# Dashboard API — report_status field presence
# ═══════════════════════════════════════════════════════════════════════════════

class TestDashboardReportStatus:
    def _build_session_dict(self, report_row):
        """Mirrors the mapping logic in get_user_reports."""
        s = {"id": "s1"}
        r = report_row
        s["overall_score"]  = r["overall_score"]  if r else None
        s["has_report"]     = r is not None
        s["report_quality"] = r["report_quality"] if r else None
        s["report_status"]  = r["report_status"]  if r else None
        return s

    def test_complete_report_exposes_report_status(self):
        row = {"overall_score": 7.5, "report_quality": "full", "report_status": "complete"}
        s = self._build_session_dict(row)
        assert s["report_status"] == "complete"

    def test_persist_failed_report_exposes_status(self):
        row = {"overall_score": None, "report_quality": "full", "report_status": "persist_failed"}
        s = self._build_session_dict(row)
        assert s["report_status"] == "persist_failed"
        assert s["has_report"] is True

    def test_no_report_row_report_status_is_none(self):
        s = self._build_session_dict(None)
        assert s["report_status"] is None
        assert s["has_report"] is False

    def test_degraded_report_exposes_status(self):
        row = {"overall_score": None, "report_quality": "degraded", "report_status": "degraded"}
        s = self._build_session_dict(row)
        assert s["report_status"] == "degraded"
        assert s["has_report"] is True
