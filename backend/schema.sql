-- ============================================================
-- AI Interviewer — Supabase SQL Schema (v2)
-- Run this in your Supabase SQL Editor
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Profiles (parsed resumes) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id       TEXT NOT NULL,
    raw_text      TEXT,
    parsed_data   JSONB DEFAULT '{}',
    created_at    TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own profiles"
    ON profiles FOR ALL USING (auth.uid()::text = user_id);

-- ── Legacy resumes table (kept for backward compat) ───────────────────────
CREATE TABLE IF NOT EXISTS resumes (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    file_url    TEXT,
    parsed_json JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE resumes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own resumes"
    ON resumes FOR ALL USING (auth.uid() = user_id);

-- ── Sessions ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
    id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                TEXT NOT NULL,
    profile_id             UUID REFERENCES profiles(id),
    round_type             TEXT NOT NULL CHECK (round_type IN ('technical','hr','dsa','mcq_practice')),
    difficulty             TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
    num_questions          INT DEFAULT 5,
    timer_minutes          INT DEFAULT 30,
    status                 TEXT DEFAULT 'active' CHECK (status IN ('active','completed','abandoned')),
    questions              JSONB DEFAULT '[]',
    transcript             JSONB DEFAULT '[]',
    scores                 JSONB DEFAULT '[]',
    current_question_index INT DEFAULT 0,
    ended_at               TIMESTAMPTZ,
    end_reason             TEXT,
    created_at             TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own sessions"
    ON sessions FOR ALL USING (auth.uid()::text = user_id);

-- ── Answers (per-question records) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS answers (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id           UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    question_id          TEXT NOT NULL,
    answer_text          TEXT NOT NULL,
    score                INT CHECK (score BETWEEN 0 AND 10),
    feedback             TEXT,
    strengths            JSONB DEFAULT '[]',
    improvements         JSONB DEFAULT '[]',
    time_taken_seconds   INT,
    skipped              BOOLEAN DEFAULT FALSE,
    created_at           TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own answers"
    ON answers FOR ALL
    USING (
        session_id IN (
            SELECT id FROM sessions WHERE user_id = auth.uid()::text
        )
    );

-- ── Reports (AI-generated evaluation) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS reports (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id          UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    overall_score       FLOAT,
    grade               TEXT,
    summary             TEXT,
    hire_recommendation TEXT,
    radar_scores        JSONB DEFAULT '{}',
    strong_areas        JSONB DEFAULT '[]',
    weak_areas          JSONB DEFAULT '[]',
    per_question_analysis JSONB DEFAULT '[]',
    study_recommendations JSONB DEFAULT '[]',
    compared_to_level   TEXT,
    skill_ratings       JSONB DEFAULT '[]',
    recommendations     JSONB DEFAULT '[]',
    round_type          TEXT,
    report_data         JSONB DEFAULT '{}',
    created_at          TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own reports"
    ON reports FOR ALL
    USING (
        session_id IN (
            SELECT id FROM sessions WHERE user_id = auth.uid()::text
        )
    );

-- ── Phase 1-5 Additions: New session columns ─────────────────────────────
-- Run these ALTER TABLE statements if sessions table already exists:
-- ALTER TABLE sessions ADD COLUMN IF NOT EXISTS context_bundle JSONB DEFAULT '{}';
-- ALTER TABLE sessions ADD COLUMN IF NOT EXISTS target_company TEXT;
-- ALTER TABLE sessions ADD COLUMN IF NOT EXISTS target_role TEXT;
-- ALTER TABLE sessions ADD COLUMN IF NOT EXISTS timer_remaining_secs INT;
-- ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_checkpoint_at TIMESTAMPTZ;
-- ALTER TABLE sessions ADD COLUMN IF NOT EXISTS conversation_history JSONB DEFAULT '[]';
-- ALTER TABLE sessions ADD COLUMN IF NOT EXISTS detected_weaknesses JSONB DEFAULT '{}';
-- ALTER TABLE sessions ADD COLUMN IF NOT EXISTS avoided_topics TEXT[] DEFAULT '{}';

-- ── Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_profiles_user   ON profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user   ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_answers_session ON answers(session_id);
CREATE INDEX IF NOT EXISTS idx_reports_session ON reports(session_id);

-- ── Portfolio & Credentials ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portfolio_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    file_category TEXT NOT NULL CHECK (file_category IN ('grade_card', 'project_report', 'publication', 'other')),
    semester_year TEXT,
    file_url TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE portfolio_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own portfolio files"
    ON portfolio_files FOR ALL USING (auth.uid()::text = user_id);

CREATE TABLE IF NOT EXISTS external_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id TEXT NOT NULL UNIQUE,
    linkedin_url TEXT,
    github_url TEXT,
    portfolio_url TEXT,
    other_links JSONB DEFAULT '[]',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE external_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own external links"
    ON external_links FOR ALL USING (auth.uid()::text = user_id);
