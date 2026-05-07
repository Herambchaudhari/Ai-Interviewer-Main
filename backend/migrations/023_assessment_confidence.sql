-- Migration 023: HR Phase 3 — Assessment Confidence Score
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds assessment_confidence column: the AI's self-rated confidence in its
-- own hire recommendation, with specific limiting factors and what evidence
-- would change the assessment.
--
-- Distinct from:
--   hire_confidence (str): "High|Medium|Low" deterministic threshold label
--   confidence_score (int): general LLM self-rating of report quality
-- This field is HR-specific and includes structured reasoning.
--
-- Schema:
--   {
--     "score": 0-100,
--     "label": "High Confidence|Moderate Confidence|Low Confidence",
--     "limiting_factors": ["<reason confidence is not higher>"],
--     "what_would_change_it": "<1 sentence actionable follow-up>"
--   }
--
-- Scoring formula (from prompt):
--   Start at 100, subtract: <4 answers (−20), hypothetical answers (−15 each),
--   uncovered competency areas (−10 each), inconsistent signals (−15),
--   very short answers (−10). Floor 10, ceiling 95.
--
-- Old HR reports will have NULL — frontend shows empty state gracefully.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS assessment_confidence JSONB DEFAULT NULL;

COMMENT ON COLUMN reports.assessment_confidence IS
  'HR Phase 3: AI assessment confidence {score 0-100, label, limiting_factors[], what_would_change_it}';
