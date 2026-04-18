-- ============================================================
-- AI Interviewer — Migration 004: Sessions Missing Columns
-- Run this in your Supabase SQL Editor
-- Adds columns required by the adaptive interview engine.
-- All ALTER TABLE statements are idempotent (ADD COLUMN IF NOT EXISTS).
-- ============================================================

ALTER TABLE public.sessions
    ADD COLUMN IF NOT EXISTS context_bundle        JSONB    DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS target_company        TEXT     DEFAULT '',
    ADD COLUMN IF NOT EXISTS target_role           TEXT     DEFAULT '',
    ADD COLUMN IF NOT EXISTS conversation_history  JSONB    DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS detected_weaknesses   JSONB    DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS avoided_topics        JSONB    DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS timer_remaining_secs  INT      DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS last_checkpoint_at    TIMESTAMPTZ DEFAULT NULL;

-- ============================================================
-- VERIFY: run after applying to confirm columns exist
-- SELECT column_name FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'sessions'
-- ORDER BY column_name;
-- ============================================================
