"""
Unit tests for the qaData normalization fix — C2: chart crashes silently.

Covers:
  - source selection: per_question_analysis preferred when non-empty
  - source selection: falls back to question_scores when per_question_analysis is empty
  - source selection: returns [] when both arrays are absent/empty
  - score normalisation: string "null" → None
  - score normalisation: numeric string "7" → 7.0
  - score normalisation: skipped=True → score=None regardless of raw score value
  - score normalisation: score=0 preserved (not treated as skipped)
  - score normalisation: NaN raw value → None
  - question_text fallback: uses 'question' field when 'question_text' absent
  - question_text fallback: generates placeholder when both absent
  - mcqCategoryData: entries with total=0 are filtered out
  - mcqCategoryData: entries with total>0 are kept
  - mcqCategoryData: non-array category_breakdown defaults to []

All tests are fully offline — pure Python equivalents of the JS normalization logic.
"""
import math
import pytest


# ── Mirror of the JS qaData normalization logic ───────────────────────────────

def _normalize_qa_source(per_question_analysis, question_scores):
    """Mirrors ReportPage.jsx _qaSource selection."""
    if per_question_analysis and len(per_question_analysis) > 0:
        return per_question_analysis
    if question_scores and len(question_scores) > 0:
        return question_scores
    return []


def _build_qa_entry(q, i):
    """Mirrors ReportPage.jsx qaData .map() after the C2 fix."""
    is_skipped = q.get("skipped", False) or False
    raw = q.get("score")

    if raw is None:
        num_score = None
    else:
        try:
            num_score = float(raw)
            if math.isnan(num_score):
                num_score = None
        except (TypeError, ValueError):
            num_score = None

    safe_score = None if (is_skipped or num_score is None) else num_score

    question_text_raw = q.get("question_text") or q.get("question") or f"Question {i + 1}"

    return {
        "label":         f"Q{i + 1}",
        "question_text": question_text_raw.strip(),
        "score":         safe_score,
        "skipped":       is_skipped,
        "verdict":       q.get("verdict", ""),
        "feedback":      q.get("feedback", ""),
    }


def _build_qa_data(per_question_analysis, question_scores):
    source = _normalize_qa_source(per_question_analysis, question_scores)
    return [_build_qa_entry(q, i) for i, q in enumerate(source)]


def _build_mcq_category_data(category_breakdown):
    """Mirrors ReportPage.jsx mcqCategoryData after the C2 fix."""
    if not isinstance(category_breakdown, list):
        category_breakdown = []
    return [
        {
            "category": d.get("category") or "Uncategorized",
            "accuracy": d.get("accuracy", 0),
            "correct":  d.get("correct", 0),
            "total":    d.get("total"),
        }
        for d in category_breakdown
        if (d.get("total") or 0) > 0
    ]


# ═══════════════════════════════════════════════════════════════════════════════
# Source selection
# ═══════════════════════════════════════════════════════════════════════════════

class TestSourceSelection:
    def test_prefers_per_question_analysis_when_non_empty(self):
        pqa = [{"question_text": "from pqa", "score": 8}]
        qs  = [{"question_text": "from qs",  "score": 5}]
        data = _build_qa_data(pqa, qs)
        assert data[0]["question_text"] == "from pqa"

    def test_falls_back_to_question_scores_when_pqa_empty(self):
        pqa = []
        qs  = [{"question_text": "from qs", "score": 6}]
        data = _build_qa_data(pqa, qs)
        assert data[0]["question_text"] == "from qs"

    def test_falls_back_to_question_scores_when_pqa_none(self):
        qs  = [{"question_text": "from qs", "score": 6}]
        data = _build_qa_data(None, qs)
        assert len(data) == 1

    def test_returns_empty_when_both_absent(self):
        data = _build_qa_data(None, None)
        assert data == []

    def test_returns_empty_when_both_empty(self):
        data = _build_qa_data([], [])
        assert data == []


# ═══════════════════════════════════════════════════════════════════════════════
# Score normalisation
# ═══════════════════════════════════════════════════════════════════════════════

class TestScoreNormalisation:
    def test_string_null_becomes_none(self):
        q = {"score": "null", "question_text": "Q"}
        entry = _build_qa_entry(q, 0)
        assert entry["score"] is None

    def test_numeric_string_parsed(self):
        q = {"score": "7", "question_text": "Q"}
        entry = _build_qa_entry(q, 0)
        assert entry["score"] == 7.0

    def test_none_score_stays_none(self):
        q = {"score": None, "question_text": "Q"}
        entry = _build_qa_entry(q, 0)
        assert entry["score"] is None

    def test_skipped_true_forces_score_to_none(self):
        q = {"score": 9, "skipped": True, "question_text": "Q"}
        entry = _build_qa_entry(q, 0)
        assert entry["score"] is None
        assert entry["skipped"] is True

    def test_score_zero_preserved_when_not_skipped(self):
        q = {"score": 0, "skipped": False, "question_text": "Q"}
        entry = _build_qa_entry(q, 0)
        assert entry["score"] == 0.0
        assert entry["skipped"] is False

    def test_nan_raw_score_becomes_none(self):
        q = {"score": float("nan"), "question_text": "Q"}
        entry = _build_qa_entry(q, 0)
        assert entry["score"] is None

    def test_float_score_preserved(self):
        q = {"score": 7.5, "question_text": "Q"}
        entry = _build_qa_entry(q, 0)
        assert entry["score"] == 7.5

    def test_integer_score_preserved(self):
        q = {"score": 8, "question_text": "Q"}
        entry = _build_qa_entry(q, 0)
        assert entry["score"] == 8.0


# ═══════════════════════════════════════════════════════════════════════════════
# question_text fallbacks
# ═══════════════════════════════════════════════════════════════════════════════

class TestQuestionTextFallback:
    def test_question_text_field_used_first(self):
        q = {"question_text": "primary", "question": "secondary"}
        entry = _build_qa_entry(q, 0)
        assert entry["question_text"] == "primary"

    def test_question_field_used_when_question_text_absent(self):
        q = {"question": "fallback question"}
        entry = _build_qa_entry(q, 0)
        assert entry["question_text"] == "fallback question"

    def test_placeholder_generated_when_both_absent(self):
        q = {}
        entry = _build_qa_entry(q, 2)
        assert entry["question_text"] == "Question 3"

    def test_whitespace_stripped(self):
        q = {"question_text": "  padded  "}
        entry = _build_qa_entry(q, 0)
        assert entry["question_text"] == "padded"

    def test_label_format_correct(self):
        q = {"question_text": "Q"}
        entry = _build_qa_entry(q, 4)
        assert entry["label"] == "Q5"


# ═══════════════════════════════════════════════════════════════════════════════
# MCQ category data — zero-total filter
# ═══════════════════════════════════════════════════════════════════════════════

class TestMCQCategoryData:
    def test_zero_total_entries_filtered_out(self):
        breakdown = [
            {"category": "OS",   "accuracy": 0.5, "correct": 5, "total": 10},
            {"category": "Net",  "accuracy": 0.0, "correct": 0, "total": 0},
        ]
        data = _build_mcq_category_data(breakdown)
        assert len(data) == 1
        assert data[0]["category"] == "OS"

    def test_positive_total_entries_kept(self):
        breakdown = [
            {"category": "DS",  "accuracy": 0.8, "correct": 8, "total": 10},
            {"category": "Alg", "accuracy": 0.6, "correct": 3, "total": 5},
        ]
        data = _build_mcq_category_data(breakdown)
        assert len(data) == 2

    def test_non_array_defaults_to_empty(self):
        data = _build_mcq_category_data(None)
        assert data == []

    def test_all_zero_total_returns_empty(self):
        breakdown = [
            {"category": "A", "total": 0},
            {"category": "B", "total": 0},
        ]
        data = _build_mcq_category_data(breakdown)
        assert data == []

    def test_missing_total_treated_as_zero(self):
        breakdown = [{"category": "X", "accuracy": 0.5}]
        data = _build_mcq_category_data(breakdown)
        assert data == []

    def test_category_fallback_to_uncategorized(self):
        breakdown = [{"total": 5, "accuracy": 0.5, "correct": 2}]
        data = _build_mcq_category_data(breakdown)
        assert data[0]["category"] == "Uncategorized"
