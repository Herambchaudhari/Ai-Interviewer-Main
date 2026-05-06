-- Migration 016: HR Phase 1 — Professional Report Fields
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds new columns for the HR report enhancement (Phase 1):
--   key_signals          — 3 decisive hiring-committee evidence points (JSONB array)
--   competency_scorecard — 7-entry 1-7 scale scorecard with verbatim quotes (JSONB array)
--   hire_confidence      — deterministic confidence level: High | Medium | Low (TEXT)
--   interview_datetime   — ISO 8601 session creation timestamp (TEXT)
--   job_role             — role being practiced for (TEXT)
--
-- Run BEFORE deploying the backend that writes these fields.
-- Old HR reports will have NULLs in these columns — the frontend and
-- _normalize_report_payload both default to [] / "" safely.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS key_signals          JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS competency_scorecard JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS hire_confidence      TEXT  DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS interview_datetime   TEXT  DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS job_role             TEXT  DEFAULT NULL;

-- Index for HR-specific report queries
CREATE INDEX IF NOT EXISTS idx_reports_round_hr
    ON reports(round_type)
    WHERE round_type = 'hr';

-- Documentation
COMMENT ON COLUMN reports.key_signals IS
  'HR Phase 1: array of 3 decisive hiring signals [{signal, evidence, valence}]';
COMMENT ON COLUMN reports.competency_scorecard IS
  'HR Phase 1: 7-entry scorecard [{axis, rating_1_7, anchor_label, verbatim_quote, rationale}]';
COMMENT ON COLUMN reports.hire_confidence IS
  'HR Phase 1: deterministic confidence level — High | Medium | Low';
COMMENT ON COLUMN reports.interview_datetime IS
  'ISO 8601 timestamp of session creation (from sessions.created_at)';
COMMENT ON COLUMN reports.job_role IS
  'Role the candidate was practicing for (from session or profile context)';
