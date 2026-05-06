-- Migration 031: HR Model Answer Comparison (Group B Phase 7)
-- Adds model_answer_comparison JSONB column to reports table.
-- Shape: [{question_id, candidate_score, what_was_missing[], model_answer_outline, improvement_instruction}]
-- LLM-generated from Stage 1 core analysis prompt; HR rounds only.

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS model_answer_comparison JSONB DEFAULT NULL;
