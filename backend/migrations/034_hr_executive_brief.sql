-- Migration 034: HR Executive Brief (Group C Phase 11)
-- Adds executive_brief JSONB column to reports table.
-- Shape: {hire_verdict, verdict_color, one_liner, evidence_for[], evidence_against[], key_risk, recommended_action, committee_question}
-- Computed deterministically server-side from existing report fields; HR rounds only.

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS executive_brief JSONB DEFAULT NULL;
