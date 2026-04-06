-- ============================================================
-- Migration 002: Report Enhancement Features
-- Adds: benchmarks, study_resources, preparation_checklists tables
--       + new columns on reports and sessions
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- ── 1. Benchmarks table (anonymised aggregate — NO user_id / session_id) ─────
CREATE TABLE IF NOT EXISTS benchmarks (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    round_type          TEXT NOT NULL,
    difficulty          TEXT NOT NULL,
    target_company      TEXT,
    job_role            TEXT,
    overall_score       FLOAT,
    radar_scores        JSONB DEFAULT '{}',
    grade               TEXT,
    hire_recommendation TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_benchmarks_round
    ON benchmarks(round_type, difficulty);
CREATE INDEX IF NOT EXISTS idx_benchmarks_company
    ON benchmarks(target_company);

-- RLS: benchmarks are public-read (aggregates only, no PII)
ALTER TABLE benchmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read benchmarks"
    ON benchmarks FOR SELECT USING (true);
CREATE POLICY "Service role can insert benchmarks"
    ON benchmarks FOR INSERT WITH CHECK (true);

-- ── 2. Study resources table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS study_resources (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    topic            TEXT NOT NULL,
    round_type       TEXT,
    difficulty       TEXT,
    resource_type    TEXT CHECK (resource_type IN ('video','article','problem','book','course')),
    title            TEXT,
    url              TEXT,
    estimated_hours  FLOAT,
    tags             TEXT[] DEFAULT '{}',
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resources_topic
    ON study_resources(topic);
CREATE INDEX IF NOT EXISTS idx_resources_round_type
    ON study_resources(round_type);

ALTER TABLE study_resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read study resources"
    ON study_resources FOR SELECT USING (true);
CREATE POLICY "Service role can insert study resources"
    ON study_resources FOR INSERT WITH CHECK (true);

-- ── 3. Preparation checklists table ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS preparation_checklists (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     TEXT NOT NULL,
    session_id  UUID REFERENCES sessions(id) ON DELETE SET NULL,
    items       JSONB DEFAULT '[]',
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checklists_user
    ON preparation_checklists(user_id);
CREATE INDEX IF NOT EXISTS idx_checklists_session
    ON preparation_checklists(session_id);

ALTER TABLE preparation_checklists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own checklists"
    ON preparation_checklists FOR ALL USING (auth.uid()::text = user_id);

-- ── 4. New columns on reports ─────────────────────────────────────────────────
ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS code_quality_metrics  JSONB DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS peer_percentile        JSONB DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS spaced_repetition_plan JSONB DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS preparation_checklist  JSONB DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS skill_velocity         JSONB DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS benchmark_context      JSONB DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS persistent_gaps        JSONB DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS progress_timeline      JSONB DEFAULT NULL;

-- ── 5. New column on sessions ─────────────────────────────────────────────────
ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS code_execution_results JSONB DEFAULT NULL;

-- ── 6. Performance indexes ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_reports_round_type
    ON reports(round_type);
CREATE INDEX IF NOT EXISTS idx_sessions_user_status
    ON sessions(user_id, status);

-- ============================================================
-- Verify (run separately to confirm):
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name IN ('reports', 'sessions', 'benchmarks',
--                      'study_resources', 'preparation_checklists')
-- ORDER BY table_name, ordinal_position;
-- ============================================================
