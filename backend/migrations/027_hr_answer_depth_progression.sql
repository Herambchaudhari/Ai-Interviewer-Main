-- 027: HR Answer Depth Progression — deterministic trend arc across the interview.
-- Computed in Python from question_scores; no LLM call required.
ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS answer_depth_progression JSONB DEFAULT NULL;

COMMENT ON COLUMN reports.answer_depth_progression IS
  'HR Enhancement: {arc: [{q, score, skipped}], trend: Improving|Declining|Consistent|Inconsistent, peak_question, lowest_question, trend_rationale}. Computed deterministically from question_scores.';
