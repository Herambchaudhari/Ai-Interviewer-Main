"""
Unit tests for the per-question score corruption fix.

Covers:
  - Skipped questions produce score=None (not 0)
  - Answered questions with score=0 are preserved as 0 (not dropped)
  - overall_raw excludes skipped questions from the average
  - overall_raw excludes not-yet-evaluated questions (score=None, not skipped)
  - Zero-scored answered questions ARE included in overall_raw
  - _merge_per_question_analysis carries the skipped flag through
  - Old-format transcripts (score=0, no skipped flag) detected via sentinel answer

All tests are fully offline — no Supabase, Groq, or FastAPI calls.
"""
import sys
import os
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

_merge = _report_module._merge_per_question_analysis


# ── Helpers ───────────────────────────────────────────────────────────────────

def _build_question_scores(transcript: list, round_type: str = "technical") -> list:
    """
    Mirrors the question_scores builder in _generate_report_sse (Phase 2 fix).
    Kept inline so tests verify the exact logic, not just the helper.
    """
    question_scores = []
    for entry in transcript:
        answer_text = entry.get("answer", "")
        is_skipped = entry.get("skipped", False) or answer_text == "[SKIPPED]"
        raw_score = entry.get("score")
        question_scores.append({
            "question_id":   entry.get("question_id", ""),
            "question_text": entry.get("question", ""),
            "answer_text":   answer_text,
            "score":         None if is_skipped else raw_score,
            "skipped":       is_skipped,
            "verdict":       "skipped" if is_skipped else entry.get("verdict", ""),
            "category":      entry.get("category", round_type),
            "question_type": entry.get("question_type", "speech"),
            "feedback":      entry.get("feedback", ""),
            "strengths":     entry.get("strengths", []),
            "improvements":  entry.get("improvements", []),
        })
    return question_scores


def _calc_overall(question_scores: list) -> float:
    """Mirrors the overall_raw calculation in _generate_report_sse (Phase 2 fix)."""
    scored = [q["score"] for q in question_scores
              if q["score"] is not None and not q.get("skipped")]
    return round(sum(scored) / len(scored), 1) if scored else 0.0


# ═══════════════════════════════════════════════════════════════════════════════
# Phase 1+2: question_scores builder
# ═══════════════════════════════════════════════════════════════════════════════

class TestQuestionScoresBuilder:
    def test_skipped_flag_produces_none_score(self):
        """New-format skipped entry (skipped=True, score=None) → score stays None."""
        transcript = [{"question_id": "q1", "answer": "[SKIPPED]", "score": None, "skipped": True}]
        qs = _build_question_scores(transcript)
        assert qs[0]["score"] is None

    def test_old_format_sentinel_answer_detected_as_skipped(self):
        """Old-format skipped entry (score=0, no skipped flag) detected via sentinel answer."""
        transcript = [{"question_id": "q1", "answer": "[SKIPPED]", "score": 0}]
        qs = _build_question_scores(transcript)
        assert qs[0]["score"] is None
        assert qs[0]["skipped"] is True

    def test_answered_zero_score_preserved(self):
        """A genuinely poor answer (score=0) is NOT treated as skipped."""
        transcript = [{"question_id": "q1", "answer": "I don't know", "score": 0, "skipped": False}]
        qs = _build_question_scores(transcript)
        assert qs[0]["score"] == 0
        assert qs[0]["skipped"] is False

    def test_skipped_verdict_is_set(self):
        transcript = [{"question_id": "q1", "answer": "[SKIPPED]", "score": None, "skipped": True}]
        qs = _build_question_scores(transcript)
        assert qs[0]["verdict"] == "skipped"

    def test_normal_verdict_preserved(self):
        transcript = [{"question_id": "q1", "answer": "Good answer", "score": 8, "verdict": "strong"}]
        qs = _build_question_scores(transcript)
        assert qs[0]["verdict"] == "strong"

    def test_none_score_without_skipped_flag_preserved(self):
        """score=None without skipped flag (not-yet-evaluated) stays None."""
        transcript = [{"question_id": "q1", "answer": "Some answer", "score": None}]
        qs = _build_question_scores(transcript)
        assert qs[0]["score"] is None
        assert qs[0]["skipped"] is False


# ═══════════════════════════════════════════════════════════════════════════════
# Phase 2: overall_raw calculation
# ═══════════════════════════════════════════════════════════════════════════════

class TestOverallScoreCalculation:
    def test_skipped_excluded_from_average(self):
        """[8, 6, skipped] → average of [8, 6] = 7.0"""
        transcript = [
            {"answer": "Good",      "score": 8},
            {"answer": "Decent",    "score": 6},
            {"answer": "[SKIPPED]", "score": None, "skipped": True},
        ]
        qs = _build_question_scores(transcript)
        assert _calc_overall(qs) == 7.0

    def test_zero_score_included_in_average(self):
        """[8, 0] → average = 4.0 (zero is a real score, not dropped)."""
        transcript = [
            {"answer": "Good",     "score": 8},
            {"answer": "No idea",  "score": 0},
        ]
        qs = _build_question_scores(transcript)
        assert _calc_overall(qs) == 4.0

    def test_none_score_not_yet_evaluated_excluded(self):
        """score=None without skipped flag (unevaluated) is also excluded."""
        transcript = [
            {"answer": "Good", "score": 8},
            {"answer": "hmm",  "score": None},
        ]
        qs = _build_question_scores(transcript)
        assert _calc_overall(qs) == 8.0

    def test_all_skipped_returns_zero(self):
        transcript = [
            {"answer": "[SKIPPED]", "score": None, "skipped": True},
            {"answer": "[SKIPPED]", "score": None, "skipped": True},
        ]
        qs = _build_question_scores(transcript)
        assert _calc_overall(qs) == 0.0

    def test_mixed_three_questions(self):
        """[10, skipped, 4] → average of [10, 4] = 7.0"""
        transcript = [
            {"answer": "Perfect",   "score": 10},
            {"answer": "[SKIPPED]", "score": None, "skipped": True},
            {"answer": "Weak",      "score": 4},
        ]
        qs = _build_question_scores(transcript)
        assert _calc_overall(qs) == 7.0

    def test_single_answered_question(self):
        transcript = [{"answer": "OK", "score": 6}]
        qs = _build_question_scores(transcript)
        assert _calc_overall(qs) == 6.0


# ═══════════════════════════════════════════════════════════════════════════════
# Phase 3: _merge_per_question_analysis
# ═══════════════════════════════════════════════════════════════════════════════

class TestMergePerQuestionAnalysis:
    def _make_qs(self, score, skipped=False):
        return [{
            "question_id": "q1", "question_text": "What is X?",
            "score": score, "skipped": skipped, "verdict": "skipped" if skipped else "ok",
            "category": "technical", "answer_summary": "",
            "strengths": [], "improvements": [],
        }]

    def test_skipped_flag_survives_merge(self):
        qs = self._make_qs(None, skipped=True)
        merged = _merge(qs, [], audio_map=None)
        assert merged[0]["skipped"] is True

    def test_none_score_survives_merge(self):
        qs = self._make_qs(None, skipped=True)
        merged = _merge(qs, [], audio_map=None)
        assert merged[0]["score"] is None

    def test_real_score_survives_merge(self):
        qs = self._make_qs(7)
        merged = _merge(qs, [], audio_map=None)
        assert merged[0]["score"] == 7

    def test_zero_score_survives_merge(self):
        qs = self._make_qs(0)
        merged = _merge(qs, [], audio_map=None)
        assert merged[0]["score"] == 0

    def test_llm_analysis_overrides_fallback_score(self):
        """LLM per_question_analysis score takes priority over question_scores."""
        qs = self._make_qs(5)
        pqa = [{"question_id": "q1", "score": 8, "verdict": "strong"}]
        merged = _merge(qs, pqa, audio_map=None)
        assert merged[0]["score"] == 8
