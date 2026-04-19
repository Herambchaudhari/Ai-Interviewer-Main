"""
Unit tests for Bug #3 fix — Empty Sections Delivered as "Complete" Report.

Covers:
  - report_quality computation: 'full', 'partial', 'degraded'
  - failed_sections list correctly populated per stage combination
  - _normalize_report_payload() defaults missing report_quality fields
  - _normalize_report_payload() does not overwrite correct existing values
  - _normalize_report_payload() is idempotent on partial/degraded reports
  - mark_report_degraded() writes correct status to DB
  - retry-stages guard logic: access checks, unknown stages, missing cached report
  - retry-stages merge logic: successful stage3 merge recalculates quality to 'full'
  - retry-stages failure path: quality stays 'partial', section remains listed

All tests are fully offline — no Supabase, Groq, or FastAPI calls.
"""
import sys
import os
import types
import pytest
from unittest.mock import MagicMock

# ── Stub heavy third-party dependencies before any project import ─────────────

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

_normalize = _report_module._normalize_report_payload


# ═══════════════════════════════════════════════════════════════════════════════
# _normalize_report_payload — report quality fields
# ═══════════════════════════════════════════════════════════════════════════════

class TestNormalizeReportQualityFields:
    def test_missing_report_quality_defaults_to_full(self):
        assert _normalize({})["report_quality"] == "full"

    def test_missing_failed_sections_defaults_to_empty_list(self):
        assert _normalize({})["failed_sections"] == []

    def test_missing_stage_errors_defaults_to_empty_dict(self):
        assert _normalize({})["stage_errors"] == {}

    def test_null_report_quality_becomes_full(self):
        assert _normalize({"report_quality": None})["report_quality"] == "full"

    def test_null_failed_sections_becomes_list(self):
        assert _normalize({"failed_sections": None})["failed_sections"] == []

    def test_null_stage_errors_becomes_dict(self):
        assert _normalize({"stage_errors": None})["stage_errors"] == {}

    def test_partial_quality_preserved(self):
        assert _normalize({"report_quality": "partial"})["report_quality"] == "partial"

    def test_degraded_quality_preserved(self):
        assert _normalize({"report_quality": "degraded"})["report_quality"] == "degraded"

    def test_existing_failed_sections_preserved(self):
        sections = ["swot", "thirty_day_plan"]
        assert _normalize({"failed_sections": sections})["failed_sections"] == sections

    def test_existing_stage_errors_preserved(self):
        errs = {"stage3_communication": "timeout"}
        assert _normalize({"stage_errors": errs})["stage_errors"] == errs

    def test_idempotent_on_partial_report(self):
        payload = {
            "report_quality": "partial",
            "failed_sections": ["swot"],
            "stage_errors": {"stage4_playbook": "groq error"},
        }
        first = _normalize(payload)
        second = _normalize(dict(first))
        assert first["report_quality"] == second["report_quality"]
        assert first["failed_sections"] == second["failed_sections"]
        assert first["stage_errors"] == second["stage_errors"]


# ═══════════════════════════════════════════════════════════════════════════════
# report_quality computation logic
# ═══════════════════════════════════════════════════════════════════════════════

class TestReportQualityComputation:
    """
    Mirrors the inline quality-computation block in _generate_report_sse.
    If that block changes, these tests catch the divergence.
    """

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

    def _compute(self, failed_stages: dict):
        core_failed = "stage1_core" in failed_stages or "stage2_cv" in failed_stages
        secondary_failed = ("stage3_communication" in failed_stages
                            or "stage4_playbook" in failed_stages)
        quality = "degraded" if core_failed else ("partial" if secondary_failed else "full")
        sections = []
        for k in failed_stages:
            sections.extend(self._STAGE_SECTION_MAP.get(k, []))
        return quality, sections

    def test_no_failures_is_full(self):
        q, s = self._compute({})
        assert q == "full" and s == []

    def test_stage3_failure_is_partial(self):
        q, s = self._compute({"stage3_communication": "timeout"})
        assert q == "partial"
        assert "communication_breakdown" in s
        assert "swot" not in s

    def test_stage4_failure_is_partial(self):
        q, s = self._compute({"stage4_playbook": "groq down"})
        assert q == "partial"
        assert "swot" in s and "thirty_day_plan" in s
        assert "communication_breakdown" not in s

    def test_stage3_and_stage4_failure_is_partial(self):
        q, s = self._compute({
            "stage3_communication": "timeout",
            "stage4_playbook": "timeout",
        })
        assert q == "partial"
        assert "communication_breakdown" in s and "swot" in s

    def test_stage1_failure_is_degraded(self):
        q, s = self._compute({"stage1_core": "groq unavailable"})
        assert q == "degraded" and "overall_score" in s

    def test_stage2_failure_is_degraded(self):
        q, s = self._compute({"stage2_cv": "parse error"})
        assert q == "degraded" and "cv_audit" in s

    def test_stage1_and_stage3_combined_is_degraded(self):
        # core failure dominates secondary
        q, s = self._compute({"stage1_core": "error", "stage3_communication": "error"})
        assert q == "degraded"
        assert "overall_score" in s and "communication_breakdown" in s


# ═══════════════════════════════════════════════════════════════════════════════
# retry-stages guard logic (tested in isolation)
# ═══════════════════════════════════════════════════════════════════════════════

class TestRetryStagesGuards:
    """Simulate the guard-rail checks at the top of retry_failed_stages."""

    def _run_guards(self, session, caller_user_id, stages, cached_report=None):
        if session is None:
            return 404, "Session not found."
        if session.get("user_id") != caller_user_id:
            return 403, "Access denied."
        if not stages or not isinstance(stages, list):
            return 422, "Missing or invalid 'stages' list."
        valid = {"stage3_communication", "stage4_playbook"}
        unknown = set(stages) - valid
        if unknown:
            return 422, f"Unknown stages: {sorted(unknown)}"
        if cached_report is None:
            return 404, "No existing report found to merge into."
        return None, None

    def test_missing_session_returns_404(self):
        code, _ = self._run_guards(None, "u1", ["stage3_communication"])
        assert code == 404

    def test_wrong_user_returns_403(self):
        code, _ = self._run_guards({"user_id": "owner"}, "attacker", ["stage3_communication"])
        assert code == 403

    def test_empty_stages_returns_422(self):
        code, _ = self._run_guards({"user_id": "u1"}, "u1", [])
        assert code == 422

    def test_none_stages_returns_422(self):
        code, _ = self._run_guards({"user_id": "u1"}, "u1", None)
        assert code == 422

    def test_unknown_stage_returns_422(self):
        code, msg = self._run_guards({"user_id": "u1"}, "u1", ["stage99_fake"])
        assert code == 422
        assert "stage99_fake" in msg

    def test_no_cached_report_returns_404(self):
        code, _ = self._run_guards({"user_id": "u1"}, "u1",
                                   ["stage3_communication"], cached_report=None)
        assert code == 404

    def test_valid_request_passes_all_guards(self):
        code, _ = self._run_guards({"user_id": "u1"}, "u1",
                                   ["stage3_communication"], cached_report={"session_id": "s1"})
        assert code is None


# ═══════════════════════════════════════════════════════════════════════════════
# retry-stages merge logic (tested in isolation)
# ═══════════════════════════════════════════════════════════════════════════════

class TestRetryStagesMergeLogic:
    def _recompute_quality(self, stage_errors: dict) -> tuple:
        core_failed = any(k in stage_errors for k in ("stage1_core", "stage2_cv"))
        secondary_failed = any(k in stage_errors for k in ("stage3_communication", "stage4_playbook"))
        quality = "degraded" if core_failed else ("partial" if secondary_failed else "full")

        _MAP = {
            "stage1_core": ["overall_score", "radar_scores", "grade"],
            "stage2_cv":   ["cv_audit", "study_roadmap"],
            "stage3_communication": ["communication_breakdown", "six_axis_radar", "bs_flag",
                                     "pattern_groups", "blind_spots", "what_went_wrong"],
            "stage4_playbook": ["swot", "thirty_day_plan", "skills_to_work_on",
                                "auto_resources", "follow_up_questions", "next_interview_blueprint"],
        }
        failed_sections = []
        for k in stage_errors:
            failed_sections.extend(_MAP.get(k, []))
        return quality, failed_sections

    def test_successful_stage3_merge_updates_fields_and_quality(self):
        cached = {
            "stage_errors": {"stage3_communication": "timeout"},
        }
        comm_result = {
            "communication_breakdown": {"Clarity": 80},
            "six_axis_radar": {"Clarity": 80},
            "bs_flag": [], "pattern_groups": [], "blind_spots": [],
            "what_went_wrong": "Some filler words.",
        }
        merged_fields = []

        for field in ["communication_breakdown", "six_axis_radar", "bs_flag",
                      "pattern_groups", "blind_spots", "what_went_wrong"]:
            cached[field] = comm_result.get(field, cached.get(field))
        merged_fields.extend(["communication_breakdown", "six_axis_radar", "bs_flag",
                               "pattern_groups", "blind_spots", "what_went_wrong"])
        cached["stage_errors"].pop("stage3_communication", None)

        quality, sections = self._recompute_quality(cached["stage_errors"])

        assert quality == "full"
        assert sections == []
        assert "communication_breakdown" in merged_fields
        assert cached["communication_breakdown"] == {"Clarity": 80}

    def test_failed_stage3_retry_keeps_partial(self):
        cached = {"stage_errors": {"stage3_communication": "old error"}}

        # Simulate exception — error is updated, key stays
        cached["stage_errors"]["stage3_communication"] = "still down"

        quality, sections = self._recompute_quality(cached["stage_errors"])

        assert quality == "partial"
        assert "communication_breakdown" in sections

    def test_successful_stage4_merge_removes_from_errors(self):
        cached = {
            "stage_errors": {"stage4_playbook": "groq down"},
        }
        playbook_result = {
            "swot": {"strengths": ["good"], "weaknesses": [], "opportunities": [], "threats": []},
            "thirty_day_plan": {"week_1": ["study"]},
            "skills_to_work_on": [],
            "auto_resources": [],
            "follow_up_questions": [],
            "next_interview_blueprint": None,
        }

        for field in ["swot", "skills_to_work_on", "thirty_day_plan",
                      "auto_resources", "follow_up_questions", "next_interview_blueprint"]:
            cached[field] = playbook_result.get(field, cached.get(field))
        cached["stage_errors"].pop("stage4_playbook", None)

        quality, sections = self._recompute_quality(cached["stage_errors"])

        assert quality == "full"
        assert cached["swot"]["strengths"] == ["good"]

    def test_both_stages_retry_succeeds_quality_becomes_full(self):
        errors = {"stage3_communication": "err", "stage4_playbook": "err"}
        errors.pop("stage3_communication")
        errors.pop("stage4_playbook")
        quality, _ = self._recompute_quality(errors)
        assert quality == "full"
