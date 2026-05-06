-- Migration 030: HR Story Uniqueness & Rehearsal Signal (Group B Phase 6)
-- Adds story_uniqueness JSONB column to reports table.
-- Shape: {uniqueness_score, uniqueness_label, rehearsal_signals[], repeated_scenarios[],
--         scenario_diversity_score, diversity_feedback, per_question_originality[]}
-- LLM-generated from Stage 1 core analysis prompt; HR rounds only.

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS story_uniqueness JSONB DEFAULT NULL;
