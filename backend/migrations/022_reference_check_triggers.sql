-- Migration 022: HR Phase 3 — Reference Check Triggers
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds reference_check_triggers column: a structured list of topics and
-- suggested questions for verifying ambiguous or concerning interview patterns
-- through reference checks.
--
-- Schema:
--   [
--     {
--       "topic": "<short label, max 8 words>",
--       "priority": "High|Medium|Low",
--       "suggested_question": "<behavioral question for a reference, max 25 words>",
--       "reason": "<1 sentence on why this warrants verification>"
--     }
--   ]
--
-- Inference methodology (from prompt):
--   High   → patterns suggesting potential dishonesty, toxic behavior, major inconsistency
--   Medium → ambiguous stories where confirmation adds hiring confidence
--   Low    → minor gaps that don't change the decision but add context
--   Max 4 items. Empty array [] if no concerns warrant verification.
--
-- Defaults to empty array. Old HR reports will have NULL — coerced to [] by
-- _normalize_report_payload() in report.py.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS reference_check_triggers JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN reports.reference_check_triggers IS
  'HR Phase 3: Reference check topics [{topic, priority: High|Medium|Low, suggested_question, reason}]. Max 4 items.';
