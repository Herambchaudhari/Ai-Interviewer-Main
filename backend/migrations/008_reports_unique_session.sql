-- Migration 008: Enforce one report per session + add status tracking
-- Run in Supabase SQL Editor before deploying the view-report-bug fix.

-- Step 1: Remove duplicate report rows — keep only the most recent one per session.
-- This must run BEFORE adding the unique constraint.
DELETE FROM reports
WHERE id NOT IN (
    SELECT DISTINCT ON (session_id) id
    FROM reports
    ORDER BY session_id, created_at DESC
);

-- Step 2: Add a unique constraint so save_report() upserts work correctly
-- and no two rows can exist for the same session.
ALTER TABLE reports
    ADD CONSTRAINT reports_session_id_unique UNIQUE (session_id);

-- Step 3: Add a status column so the UI can distinguish a report that is
-- still being generated from one that is fully persisted.
ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS report_status TEXT DEFAULT 'complete';

-- Verify
-- SELECT session_id, count(*) FROM reports GROUP BY session_id HAVING count(*) > 1;
