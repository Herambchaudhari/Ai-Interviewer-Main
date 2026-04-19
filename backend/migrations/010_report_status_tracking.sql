-- Migration 010: Proper persist-status tracking on reports
-- Run in Supabase SQL Editor (Dashboard > SQL Editor)
-- Depends on: 008_reports_unique_session.sql (report_status column must exist)
-- ============================================================

-- Step 1: Add persist-tracking columns.
-- report_status already exists (default 'complete' from migration 008).
-- We add persist_attempts and last_persist_error alongside it.
ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS persist_attempts    INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_persist_error  TEXT    DEFAULT NULL;

-- Step 2: Change the default of report_status to 'generating' so that
-- a row inserted at generation start is immediately distinguishable from
-- one that successfully completed.
ALTER TABLE reports
    ALTER COLUMN report_status SET DEFAULT 'generating';

-- Step 3: Backfill — every existing row was saved successfully, so mark them complete.
UPDATE reports
    SET report_status = 'complete'
    WHERE report_status IS NULL
       OR report_status = 'complete';

-- Step 4: Index on report_status for fast status-filter queries.
CREATE INDEX IF NOT EXISTS idx_reports_status
    ON reports (report_status);

-- Verify
-- SELECT report_status, COUNT(*) FROM reports GROUP BY report_status;
