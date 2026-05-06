-- Migration 032: HR Pipeline Follow-Up Questions (Group C Phase 4)
-- Adds pipeline_followup_questions JSONB column to reports table.
-- Shape: [{question, target_competency, purpose, difficulty, question_id_source}]
-- LLM-generated from Stage 1 core analysis prompt; HR rounds only.

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS pipeline_followup_questions JSONB DEFAULT NULL;
