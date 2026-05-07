-- Migration 015: HR 7-axis competency radar (schema documentation)
-- ─────────────────────────────────────────────────────────────────────────────
-- The radar_scores JSONB column already exists (migration 001).
-- No DDL change required — JSONB is schemaless.
--
-- From this migration onwards, HR round reports store 7 keys in radar_scores:
--   1. "Communication Clarity"
--   2. "STAR Story Craft"
--   3. "Self-Awareness & Accountability"
--   4. "Growth Mindset & Adaptability"
--   5. "Leadership & Ownership"
--   6. "Collaboration & Stakeholder Fit"
--   7. "Resilience Under Pressure"
--
-- Old HR reports (6-axis) are unaffected — they retain their original keys.
-- Frontend falls back gracefully when encountering 6-axis radar_scores.
-- ─────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN reports.radar_scores IS
  'JSONB dict of axis→score (0-100). HR: 7-axis. Technical/DSA/MCQ: 6-axis. Keys vary by round_type.';
