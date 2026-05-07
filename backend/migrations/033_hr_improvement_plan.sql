-- Migration 033: HR Improvement Plan (Group C Phase 8)
-- Adds hr_improvement_plan JSONB column to reports table.
-- Shape: {priority_focus, overall_plan_label, weekly_sprints[], quick_wins[], curated_resources[]}
-- LLM-generated from Stage 1 core analysis prompt; HR rounds only.

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS hr_improvement_plan JSONB DEFAULT NULL;
