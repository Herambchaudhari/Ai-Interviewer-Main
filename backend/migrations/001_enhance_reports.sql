-- ============================================================
-- Migration 001: Enhance reports table for USP report features
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- Voice & Behavioral Intelligence
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS voice_metrics          JSONB    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS delivery_consistency   JSONB    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS filler_heatmap         JSONB    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS transcript_annotated   JSONB    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS audio_clips_index      JSONB    DEFAULT NULL;

-- Communication & Structure (6-Axis)
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS communication_breakdown JSONB   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS six_axis_radar          JSONB   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS bs_flag                 JSONB   DEFAULT NULL;

-- Root Cause Analysis
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS pattern_groups         JSONB    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS blind_spots            JSONB    DEFAULT NULL;

-- Company Fit Calibration
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS company_fit            JSONB    DEFAULT NULL;

-- Cross-Session Intelligence
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS skill_decay            JSONB    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS repeated_offenders     JSONB    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS growth_trajectory      JSONB    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS improvement_vs_last    JSONB    DEFAULT NULL;

-- Playbook & Resources
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS swot                   JSONB    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS what_went_wrong        TEXT     DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS skills_to_work_on      JSONB    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS thirty_day_plan        JSONB    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS auto_resources         JSONB    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS follow_up_questions    JSONB    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS next_interview_blueprint JSONB  DEFAULT NULL;

-- Meta
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS confidence_score       INTEGER  DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS interview_agent        TEXT     DEFAULT NULL;

-- Index for fast user-level report queries via session join
CREATE INDEX IF NOT EXISTS idx_reports_session_id ON reports(session_id);

-- ============================================================
-- Verify columns were added (run this to confirm)
-- ============================================================
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name = 'reports'
-- ORDER BY ordinal_position;
