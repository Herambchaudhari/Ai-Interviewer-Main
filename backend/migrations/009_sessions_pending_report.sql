-- ============================================================
-- Migration 009: View + helper for sessions without cached reports
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- View: every completed session that has no corresponding report row.
-- Used by the backfill service to find work to do.
CREATE OR REPLACE VIEW sessions_pending_report AS
SELECT
    s.id            AS session_id,
    s.user_id,
    s.round_type,
    s.difficulty,
    s.num_questions,
    s.created_at,
    s.ended_at,
    s.context_bundle
FROM sessions s
LEFT JOIN reports r ON r.session_id = s.id
WHERE
    s.status = 'completed'
    AND r.id IS NULL;

-- Index to speed up the LEFT JOIN used by the view.
-- (sessions already has idx_sessions_user; this covers the join side.)
CREATE INDEX IF NOT EXISTS idx_reports_session_id
    ON reports (session_id);

-- Convenience: count of pending sessions per user (useful for status API).
CREATE OR REPLACE VIEW user_pending_report_counts AS
SELECT
    user_id,
    COUNT(*) AS pending_count
FROM sessions_pending_report
GROUP BY user_id;
