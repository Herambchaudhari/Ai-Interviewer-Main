-- Migration 028: HR Peer Benchmarking (Group B Phase 2)
-- Adds peer_benchmarking JSONB column to reports table.
-- Shape: {overall_percentile, percentile_label, score_vs_avg, axis_percentiles{}, cohort_context}
-- Computed server-side (no LLM); populated for HR rounds only.

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS peer_benchmarking JSONB DEFAULT NULL;
