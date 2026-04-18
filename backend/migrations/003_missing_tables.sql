-- ============================================================
-- AI Interviewer — Migration 003: Missing Tables
-- Run this in your Supabase SQL Editor
-- Creates: benchmarks, study_resources, preparation_checklists
-- Also applies: share_token columns on reports (idempotent)
-- ============================================================

-- ── Benchmarks (anonymised aggregate — no user_id) ────────────────────────────
-- Used by save_benchmark(), get_benchmarks() in db_service.py
-- Feeds compute_peer_comparison() in benchmarking_service.py
CREATE TABLE IF NOT EXISTS public.benchmarks (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    round_type          TEXT NOT NULL CHECK (round_type IN ('technical','hr','dsa','mcq_practice')),
    difficulty          TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
    overall_score       FLOAT NOT NULL,
    radar_scores        JSONB DEFAULT '{}',
    grade               TEXT,
    hire_recommendation TEXT,
    target_company      TEXT,
    job_role            TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- No RLS — benchmarks are fully anonymous aggregate data
CREATE INDEX IF NOT EXISTS idx_benchmarks_round_diff
    ON public.benchmarks (round_type, difficulty);
CREATE INDEX IF NOT EXISTS idx_benchmarks_company
    ON public.benchmarks (target_company)
    WHERE target_company IS NOT NULL;


-- ── Study Resources (shared, global pool) ─────────────────────────────────────
-- Used by get_study_resources(), save_study_resources() in db_service.py
-- Feeds build_study_schedule() in spaced_repetition_service.py
CREATE TABLE IF NOT EXISTS public.study_resources (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    topic            TEXT NOT NULL,
    round_type       TEXT,
    difficulty       TEXT,
    resource_type    TEXT DEFAULT 'article'
                         CHECK (resource_type IN ('article','video','book','course','practice','other')),
    title            TEXT NOT NULL,
    url              TEXT NOT NULL UNIQUE,
    estimated_hours  FLOAT DEFAULT 1.0,
    tags             TEXT[] DEFAULT '{}',
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- No RLS — study resources are shared / curated globally
CREATE INDEX IF NOT EXISTS idx_study_resources_topic
    ON public.study_resources (topic);
CREATE INDEX IF NOT EXISTS idx_study_resources_round
    ON public.study_resources (round_type)
    WHERE round_type IS NOT NULL;


-- ── Preparation Checklists (per-user, per-session) ────────────────────────────
-- Used by save_checklist(), get_user_checklists(), update_checklist_item()
-- items shape: [{id, label, checked, priority, topic, resource_url}]
CREATE TABLE IF NOT EXISTS public.preparation_checklists (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     TEXT NOT NULL,
    session_id  UUID REFERENCES public.sessions(id) ON DELETE SET NULL,
    items       JSONB NOT NULL DEFAULT '[]',
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.preparation_checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own checklists"
    ON public.preparation_checklists FOR ALL
    USING (auth.uid()::text = user_id);

CREATE INDEX IF NOT EXISTS idx_checklists_user
    ON public.preparation_checklists (user_id);
CREATE INDEX IF NOT EXISTS idx_checklists_session
    ON public.preparation_checklists (session_id)
    WHERE session_id IS NOT NULL;


-- ── Share Token columns on reports (idempotent — safe to run again) ───────────
-- Used by generate_share_token(), get_report_by_share_token(), disable_share_token()
ALTER TABLE public.reports
    ADD COLUMN IF NOT EXISTS share_token      TEXT UNIQUE DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS share_enabled    BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS share_expires_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_reports_share_token
    ON public.reports (share_token)
    WHERE share_token IS NOT NULL;


-- ============================================================
-- VERIFY: run after applying to confirm all tables exist
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
-- AND table_name IN ('benchmarks','study_resources','preparation_checklists')
-- ORDER BY table_name;
-- ============================================================
