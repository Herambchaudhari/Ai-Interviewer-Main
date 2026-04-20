"""
Unit tests for _normalize_report_payload() in routers/report.py (Bug #1 fix).

All tests are fully offline — no Supabase, Groq, or FastAPI calls.
Heavy third-party modules are stubbed before any project import.

Covers:
  - List fields set to None → become []
  - Dict fields set to None → become {}
  - String fields set to None → become ""
  - Existing correct-type values are not overwritten
  - Nested peer_comparison.grade_distribution = None → {}
  - Nested code_quality_metrics.per_question = None → []
  - Nested interview_integrity.highlights = None → []
  - Nested proctoring_summary.counts = None → {}
  - Nested next_interview_blueprint.focus_topics = None → []
  - Normalizer is idempotent (running it twice produces identical result)
"""
import sys
import os
import types
import pytest

# ── Stub heavy third-party dependencies ──────────────────────────────────────

def _stub(name):
    m = types.ModuleType(name)
    sys.modules[name] = m
    return m

for _mod_name in (
    "supabase", "supabase.client",
    "groq", "groq._client",
    "dotenv",
    "auth",
    "fastapi", "fastapi.responses", "fastapi.routing", "fastapi.security",
    "starlette", "starlette.responses", "starlette.routing",
    "httpx",
):
    if _mod_name not in sys.modules:
        _stub(_mod_name)

from unittest.mock import MagicMock
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

# Provide the symbols report.py imports from its own service modules
# Provide symbols that report.py imports from service stubs
_groq_stub = sys.modules["services.groq_service"]
for _sym in ("_achat", "_clean", "_gen_core", "_gen_cv_audit", "_gen_code_quality_analysis"):
    setattr(_groq_stub, _sym, MagicMock())

_stage3_stub = sys.modules["prompts.stage3_prompt"]
_stage3_stub.build_communication_analysis_prompt = lambda *a, **kw: ""

_stage4_stub = sys.modules["prompts.stage4_prompt"]
_stage4_stub.build_playbook_prompt = lambda *a, **kw: ""

sys.modules["services.benchmarking_service"].compute_peer_comparison = MagicMock()
sys.modules["services.spaced_repetition_service"].build_study_schedule = MagicMock()
sys.modules["services.checklist_service"].generate_checklist = MagicMock()
sys.modules["services.code_runner"].analyze_code_quality = MagicMock()
sys.modules["services.code_runner"].aggregate_code_quality = MagicMock()
sys.modules["services.web_researcher"].search_company_trends = MagicMock()
sys.modules["services.company_intelligence"].analyze_company_fit = MagicMock()
sys.modules["services.session_history_analyzer"].analyze_cross_session = MagicMock()
sys.modules["services.voice_analyzer"].analyze_session_voice = MagicMock()

import importlib
import routers.report as _report_module

_normalize = _report_module._normalize_report_payload


# ── Helpers ───────────────────────────────────────────────────────────────────

_LIST_FIELDS = [
    "per_question_analysis", "question_scores", "skill_ratings",
    "strong_areas", "weak_areas", "red_flags", "failure_patterns",
    "study_recommendations", "interview_tips", "mock_ready_topics",
    "not_ready_topics", "repeated_offenders", "pattern_groups",
    "blind_spots", "bs_flag", "skill_decay", "skills_to_work_on",
    "auto_resources", "follow_up_questions", "category_breakdown",
    "checklist", "filler_heatmap",
]

_DICT_FIELDS = [
    "hire_signal", "communication_breakdown", "six_axis_radar",
    "delivery_consistency", "proctoring_summary", "swot",
    "thirty_day_plan", "cv_audit", "study_roadmap",
]

_STR_FIELDS = [
    "summary", "grade", "hire_recommendation", "difficulty",
    "compared_to_level", "session_label", "target_company", "candidate_name",
]


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestNormalizeListFields:

    def test_null_list_field_becomes_empty_list(self):
        for field in _LIST_FIELDS:
            result = _normalize({field: None})
            assert result[field] == [], f"{field}: expected [] got {result[field]}"

    def test_missing_list_field_becomes_empty_list(self):
        for field in _LIST_FIELDS:
            result = _normalize({})
            assert result[field] == [], f"{field}: expected [] got {result[field]}"

    def test_existing_list_value_is_preserved(self):
        items = [{"q": 1}, {"q": 2}]
        result = _normalize({"per_question_analysis": items})
        assert result["per_question_analysis"] == items

    def test_non_list_value_replaced_with_empty_list(self):
        result = _normalize({"strong_areas": "some string"})
        assert result["strong_areas"] == []


class TestNormalizeDictFields:

    def test_null_dict_field_becomes_dict(self):
        # proctoring_summary gets nested counts:{} added — check isinstance not exact equal
        for field in _DICT_FIELDS:
            result = _normalize({field: None})
            assert isinstance(result[field], dict), f"{field}: expected dict got {type(result[field])}"

    def test_missing_dict_field_becomes_dict(self):
        for field in _DICT_FIELDS:
            result = _normalize({})
            assert isinstance(result[field], dict), f"{field}: expected dict got {type(result[field])}"

    def test_existing_dict_value_is_preserved(self):
        data = {"Clarity": 72, "Confidence": 85}
        result = _normalize({"communication_breakdown": data})
        assert result["communication_breakdown"] == data


class TestNormalizeStringFields:

    def test_null_string_field_becomes_empty_string(self):
        for field in _STR_FIELDS:
            result = _normalize({field: None})
            assert result[field] == "", f"{field}: expected '' got {result[field]!r}"

    def test_existing_string_is_preserved(self):
        result = _normalize({"summary": "Great performance overall."})
        assert result["summary"] == "Great performance overall."

    def test_non_string_value_is_coerced(self):
        result = _normalize({"grade": 42})
        assert result["grade"] == "42"


class TestNormalizeNestedFields:

    def test_peer_comparison_grade_distribution_null_becomes_dict(self):
        result = _normalize({"peer_comparison": {"sample_size": 10, "grade_distribution": None}})
        assert result["peer_comparison"]["grade_distribution"] == {}

    def test_peer_comparison_radar_comparison_null_becomes_list(self):
        result = _normalize({"peer_comparison": {"radar_comparison": None}})
        assert result["peer_comparison"]["radar_comparison"] == []

    def test_peer_comparison_none_is_left_as_none(self):
        result = _normalize({"peer_comparison": None})
        assert result["peer_comparison"] is None

    def test_code_quality_per_question_null_becomes_list(self):
        result = _normalize({"code_quality_metrics": {"per_question": None, "avg_score": 70}})
        assert result["code_quality_metrics"]["per_question"] == []

    def test_code_quality_metrics_none_left_as_none(self):
        result = _normalize({"code_quality_metrics": None})
        assert result["code_quality_metrics"] is None

    def test_interview_integrity_highlights_null_becomes_list(self):
        result = _normalize({"interview_integrity": {"status": "Clear", "highlights": None}})
        assert result["interview_integrity"]["highlights"] == []

    def test_proctoring_summary_counts_null_becomes_dict(self):
        result = _normalize({"proctoring_summary": {"counts": None}})
        assert result["proctoring_summary"]["counts"] == {}

    def test_next_blueprint_focus_topics_null_becomes_list(self):
        result = _normalize({"next_interview_blueprint": {"round_type": "technical", "focus_topics": None}})
        assert result["next_interview_blueprint"]["focus_topics"] == []


class TestNormalizeIdempotent:

    def test_running_twice_produces_identical_result(self):
        payload = {
            "per_question_analysis": [{"q": 1}],
            "communication_breakdown": None,
            "peer_comparison": {"grade_distribution": None, "radar_comparison": []},
            "code_quality_metrics": {"per_question": None},
            "summary": None,
            "filler_heatmap": None,
        }
        first = _normalize(payload)
        second = _normalize(dict(first))
        assert first == second

    def test_complete_valid_payload_unchanged(self):
        payload = {
            "per_question_analysis": [{"score": 8}],
            "strong_areas": ["Python"],
            "communication_breakdown": {"Clarity": 80},
            "summary": "Good interview.",
            "grade": "B+",
            "peer_comparison": {
                "sample_size": 20,
                "grade_distribution": {"A": 30, "B": 50},
                "radar_comparison": [],
                "user_grade": "B+",
            },
        }
        result = _normalize(dict(payload))
        assert result["per_question_analysis"] == [{"score": 8}]
        assert result["strong_areas"] == ["Python"]
        assert result["communication_breakdown"] == {"Clarity": 80}
        assert result["summary"] == "Good interview."
        assert result["grade"] == "B+"
        assert result["peer_comparison"]["grade_distribution"] == {"A": 30, "B": 50}
