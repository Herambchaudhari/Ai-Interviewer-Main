-- Migration 019: HR Phase 2 — EQ Profile
-- ─────────────────────────────────────────────────────────────────────────────
-- Adds eq_profile column: Emotional Intelligence assessment across 5 dimensions.
--
-- Schema:
--   {
--     "self_awareness": 0-100,
--     "self_regulation": 0-100,
--     "empathy": 0-100,
--     "social_skills": 0-100,
--     "intrinsic_motivation": 0-100,
--     "eq_summary": "<2 sentences>",
--     "eq_overall_label": "High EQ|Moderate EQ|Developing EQ"
--   }
--
-- Inference methodology (from prompt):
--   self_awareness     → depth of self-disclosure and accuracy of self-critique
--   self_regulation    → composure language during adversity stories
--   empathy            → how they describe others (team members, customers)
--   social_skills      → collaboration and conflict resolution stories
--   intrinsic_motivation → stated reasons for actions and career choices
--
-- Old HR reports will have NULL — frontend shows empty state gracefully.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS eq_profile JSONB DEFAULT NULL;

COMMENT ON COLUMN reports.eq_profile IS
  'HR Phase 2: EQ assessment {self_awareness, self_regulation, empathy, social_skills, intrinsic_motivation (all 0-100), eq_summary, eq_overall_label}';
