-- Migration 017: HR Phase 2 — Culture Fit Dimensions
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds culture_fit_dimensions column: 5 bipolar spectrum dimensions showing
-- where a candidate sits on each work-style axis.
--
-- Schema per entry:
--   { dimension, candidate_position (1-5), pole_left, pole_right, rationale }
--
-- The 5 fixed dimensions:
--   1. Collaborative ↔ Independent
--   2. Process-Driven ↔ Adaptive/Agile
--   3. Risk-Averse ↔ Risk-Tolerant
--   4. Analytical ↔ Intuitive
--   5. Depth-Focused ↔ Breadth-Focused
--
-- Old HR reports will have NULL — frontend shows empty state gracefully.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS culture_fit_dimensions JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN reports.culture_fit_dimensions IS
  'HR Phase 2: 5 bipolar spectrum dimensions [{dimension, candidate_position (1-5), pole_left, pole_right, rationale}]';
