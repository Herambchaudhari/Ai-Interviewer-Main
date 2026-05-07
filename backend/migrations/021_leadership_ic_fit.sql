-- Migration 021: HR Phase 3 — Leadership vs IC Fit
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds leadership_ic_fit column: a 1-10 spectrum positioning the candidate
-- between pure Individual Contributor and pure People Leader.
--
-- Schema:
--   {
--     "spectrum_position": 1-10,
--     "label": "Strong IC|IC-Leaning|Hybrid|Leader-Leaning|Strong Leader",
--     "recommended_track": "Individual Contributor|Tech Lead|People Manager|Hybrid IC-Lead",
--     "evidence": "<1-2 sentences from their stories>",
--     "reasoning": "<1-2 sentences on role/team fit>"
--   }
--
-- Inference methodology (from prompt):
--   1-2 = Strong IC (loves deep solo work, avoids people management)
--   3-4 = IC-Leaning
--   5   = Hybrid (balanced evidence of both)
--   6-7 = Leader-Leaning
--   8-10 = Strong Leader (manages teams, influences without authority)
--
-- Old HR reports will have NULL — frontend shows empty state gracefully.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS leadership_ic_fit JSONB DEFAULT NULL;

COMMENT ON COLUMN reports.leadership_ic_fit IS
  'HR Phase 3: Leadership vs IC spectrum {spectrum_position 1-10, label, recommended_track, evidence, reasoning}';
