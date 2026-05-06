-- Migration 020: HR Phase 3 — Coachability Index
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds coachability_index column: measures how receptive the candidate is to
-- feedback and correction, inferred from behavioral interview language.
--
-- Schema:
--   {
--     "score": 0-100,
--     "label": "Highly Coachable|Coachable|Moderately Coachable|Resistant to Feedback",
--     "positive_signals": ["<observed behavior>"],
--     "negative_signals": ["<observed behavior>"],
--     "summary": "<2 sentences>"
--   }
--
-- Inference methodology (from prompt):
--   positive_signals → mentions acting on feedback, uses "I learned", pivots approach
--   negative_signals → blame-shifts, justifies mistakes without acknowledgment
--   score thresholds: Highly Coachable ≥75, Coachable 55-74, Moderately Coachable 35-54, Resistant <35
--
-- Old HR reports will have NULL — frontend shows empty state gracefully.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS coachability_index JSONB DEFAULT NULL;

COMMENT ON COLUMN reports.coachability_index IS
  'HR Phase 3: Coachability assessment {score 0-100, label, positive_signals[], negative_signals[], summary}';
