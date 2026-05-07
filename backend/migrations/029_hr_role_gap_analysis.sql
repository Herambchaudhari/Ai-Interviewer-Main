-- Migration 029: HR Role-Level Gap Analysis (Group B Phase 3)
-- Adds role_gap_analysis JSONB column to reports table.
-- Shape: {target_role, target_level, expected_competencies[], readiness_score, readiness_label, summary}
-- LLM-generated from Stage 1 core analysis prompt; HR rounds only.

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS role_gap_analysis JSONB DEFAULT NULL;
