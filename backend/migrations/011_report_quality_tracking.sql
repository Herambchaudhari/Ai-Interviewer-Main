-- Migration 011: Report quality and partial-stage tracking
-- Run in Supabase SQL Editor (Dashboard > SQL Editor)
-- Depends on: 010_report_status_tracking.sql
-- ============================================================

-- Step 1: Add quality-tracking columns.
ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS report_quality   TEXT    DEFAULT 'full',
    ADD COLUMN IF NOT EXISTS failed_sections  JSONB   DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS stage_errors     JSONB   DEFAULT '{}';

-- Step 2: Backfill existing rows as full (they were persisted before this tracking existed).
UPDATE reports
    SET report_quality  = 'full',
        failed_sections = '[]',
        stage_errors    = '{}'
    WHERE report_quality IS NULL;

-- Step 3: Index for querying partial/degraded reports (useful for monitoring + backfill).
CREATE INDEX IF NOT EXISTS idx_reports_quality
    ON reports (report_quality);

-- Verify
-- SELECT report_quality, COUNT(*) FROM reports GROUP BY report_quality;
