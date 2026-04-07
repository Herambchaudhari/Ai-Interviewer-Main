-- ============================================================
-- AI Interviewer — Phase 0 Migration
-- Run this in your Supabase SQL Editor AFTER the base schema.sql
-- Covers all 9 new features added in Phase 0-5 implementation
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- FEATURE 9: Interview Difficulty Calibration Quiz
-- Add calibration_result to profiles
-- ─────────────────────────────────────────────────────────────
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS calibration_result JSONB DEFAULT NULL;

-- calibration_result shape:
-- {
--   "recommended_difficulty": "medium",
--   "score": 3,
--   "total": 5,
--   "taken_at": "2026-04-07T10:00:00Z"
-- }


-- ─────────────────────────────────────────────────────────────
-- FEATURE 7: Share Report as Link
-- Add share columns to reports
-- ─────────────────────────────────────────────────────────────
ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS share_token    TEXT UNIQUE DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS share_enabled  BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS share_expires_at TIMESTAMPTZ DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_reports_share_token ON reports(share_token)
    WHERE share_token IS NOT NULL;


-- ─────────────────────────────────────────────────────────────
-- FEATURE 1: Company-Specific Question Banks
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS question_bank (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company      TEXT NOT NULL,              -- e.g. "Google", "Amazon"
    round_type   TEXT NOT NULL CHECK (round_type IN ('technical','hr','dsa','mcq_practice')),
    difficulty   TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
    question     TEXT NOT NULL,
    tags         TEXT[] DEFAULT '{}',        -- e.g. ARRAY['arrays','dp','trees']
    frequency    INT DEFAULT 1,              -- how often asked (crowd-sourced votes)
    source       TEXT DEFAULT 'curated'      CHECK (source IN ('curated','crowd')),
    verified     BOOLEAN DEFAULT FALSE,
    created_by   TEXT,                       -- user_id if crowd-sourced, NULL if curated
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE question_bank ENABLE ROW LEVEL SECURITY;

-- Anyone can read verified questions; only creator can edit crowd-sourced ones
CREATE POLICY "Public read verified questions"
    ON question_bank FOR SELECT USING (verified = TRUE OR created_by = auth.uid()::text);

CREATE POLICY "Users submit crowd questions"
    ON question_bank FOR INSERT WITH CHECK (auth.uid()::text = created_by);

CREATE POLICY "Users update own crowd questions"
    ON question_bank FOR UPDATE USING (auth.uid()::text = created_by);

CREATE INDEX IF NOT EXISTS idx_qbank_company    ON question_bank(company);
CREATE INDEX IF NOT EXISTS idx_qbank_round      ON question_bank(round_type);
CREATE INDEX IF NOT EXISTS idx_qbank_difficulty ON question_bank(difficulty);
CREATE INDEX IF NOT EXISTS idx_qbank_tags       ON question_bank USING GIN(tags);


-- Track which question_bank questions each user has already seen
CREATE TABLE IF NOT EXISTS user_question_seen (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     TEXT NOT NULL,
    question_id UUID NOT NULL REFERENCES question_bank(id) ON DELETE CASCADE,
    seen_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, question_id)
);

ALTER TABLE user_question_seen ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own seen questions"
    ON user_question_seen FOR ALL USING (auth.uid()::text = user_id);

CREATE INDEX IF NOT EXISTS idx_seen_user ON user_question_seen(user_id);


-- Add bank_question_ids column to sessions
-- Stores UUIDs of question_bank rows injected into this session
ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS bank_question_ids UUID[] DEFAULT '{}';


-- ─────────────────────────────────────────────────────────────
-- FEATURE 6: Interview Question Flashcards (SM-2 spaced repetition)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS flashcards (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         TEXT NOT NULL,
    session_id      UUID REFERENCES sessions(id) ON DELETE SET NULL,
    question        TEXT NOT NULL,
    answer          TEXT NOT NULL,
    topic           TEXT,
    difficulty      TEXT CHECK (difficulty IN ('easy','medium','hard')),
    -- SM-2 algorithm fields
    repetitions     INT DEFAULT 0,
    easiness_factor FLOAT DEFAULT 2.5,
    interval_days   INT DEFAULT 1,
    next_review_at  TIMESTAMPTZ DEFAULT NOW(),
    last_reviewed_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE flashcards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own flashcards"
    ON flashcards FOR ALL USING (auth.uid()::text = user_id);

CREATE INDEX IF NOT EXISTS idx_flashcards_user        ON flashcards(user_id);
CREATE INDEX IF NOT EXISTS idx_flashcards_next_review ON flashcards(user_id, next_review_at);


-- ─────────────────────────────────────────────────────────────
-- FEATURE 2: Mock Interview Scheduling & Calendar Integration
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scheduled_sessions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             TEXT NOT NULL,
    title               TEXT NOT NULL DEFAULT 'Mock Interview',
    round_type          TEXT NOT NULL CHECK (round_type IN ('technical','hr','dsa','mcq_practice')),
    difficulty          TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
    scheduled_at        TIMESTAMPTZ NOT NULL,
    duration_minutes    INT DEFAULT 30,
    -- Google Calendar integration
    gcal_event_id       TEXT,
    gcal_sync_enabled   BOOLEAN DEFAULT FALSE,
    -- Reminder preferences
    reminder_email      BOOLEAN DEFAULT TRUE,
    reminder_push       BOOLEAN DEFAULT TRUE,
    reminder_sent_at    TIMESTAMPTZ,
    -- Status
    status              TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled','started','completed','cancelled')),
    linked_session_id   UUID REFERENCES sessions(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE scheduled_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own scheduled sessions"
    ON scheduled_sessions FOR ALL USING (auth.uid()::text = user_id);

CREATE INDEX IF NOT EXISTS idx_scheduled_user   ON scheduled_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_time   ON scheduled_sessions(scheduled_at)
    WHERE status = 'scheduled';


-- Push notification subscriptions (Web Push API / VAPID)
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     TEXT NOT NULL,
    endpoint    TEXT NOT NULL UNIQUE,
    p256dh      TEXT NOT NULL,   -- public key
    auth_key    TEXT NOT NULL,   -- auth secret
    user_agent  TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own push subscriptions"
    ON push_subscriptions FOR ALL USING (auth.uid()::text = user_id);

CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);


-- ─────────────────────────────────────────────────────────────
-- FEATURE 3: Placement Cell / Recruiter Dashboard
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS placement_cells (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name         TEXT NOT NULL,              -- "IIT Bombay Placement Cell"
    institution  TEXT,
    created_by   TEXT NOT NULL,             -- TPO user_id
    invite_code  TEXT UNIQUE NOT NULL,       -- short code students use to join
    settings     JSONB DEFAULT '{}',
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE placement_cells ENABLE ROW LEVEL SECURITY;
CREATE POLICY "TPO manages own placement cell"
    ON placement_cells FOR ALL USING (auth.uid()::text = created_by);


-- Students enrolled in a placement cell
CREATE TABLE IF NOT EXISTS cell_students (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cell_id     UUID NOT NULL REFERENCES placement_cells(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL,
    name        TEXT,
    email       TEXT,
    joined_at   TIMESTAMPTZ DEFAULT NOW(),
    shortlisted BOOLEAN DEFAULT FALSE,
    notes       TEXT,
    UNIQUE(cell_id, user_id)
);

ALTER TABLE cell_students ENABLE ROW LEVEL SECURITY;
-- TPO can see/manage; student can see own row
CREATE POLICY "TPO manages cell students"
    ON cell_students FOR ALL
    USING (
        cell_id IN (SELECT id FROM placement_cells WHERE created_by = auth.uid()::text)
    );
CREATE POLICY "Student views own enrollment"
    ON cell_students FOR SELECT USING (auth.uid()::text = user_id);

CREATE INDEX IF NOT EXISTS idx_cell_students_cell ON cell_students(cell_id);
CREATE INDEX IF NOT EXISTS idx_cell_students_user ON cell_students(user_id);


-- Pending invitations to join a cell (by email, before user registers)
CREATE TABLE IF NOT EXISTS cell_invites (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cell_id     UUID NOT NULL REFERENCES placement_cells(id) ON DELETE CASCADE,
    email       TEXT NOT NULL,
    invited_by  TEXT NOT NULL,
    token       TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
    accepted    BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    expires_at  TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
    UNIQUE(cell_id, email)
);

ALTER TABLE cell_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "TPO manages cell invites"
    ON cell_invites FOR ALL
    USING (
        cell_id IN (SELECT id FROM placement_cells WHERE created_by = auth.uid()::text)
    );

CREATE INDEX IF NOT EXISTS idx_invites_cell  ON cell_invites(cell_id);
CREATE INDEX IF NOT EXISTS idx_invites_token ON cell_invites(token) WHERE accepted = FALSE;


-- ─────────────────────────────────────────────────────────────
-- ADDITIONAL: user role column on profiles for TPO access
-- ─────────────────────────────────────────────────────────────
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'student'
        CHECK (role IN ('student','tpo','admin'));


-- ─────────────────────────────────────────────────────────────
-- ADDITIONAL: Google Calendar OAuth token storage on profiles
-- (encrypted at rest via Supabase Vault in production)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS gcal_refresh_token TEXT DEFAULT NULL;


-- ─────────────────────────────────────────────────────────────
-- Final indexes for share_token lookups
-- ─────────────────────────────────────────────────────────────
-- (already added above after reports ALTER TABLE)


-- ============================================================
-- VERIFY: Run this SELECT to confirm all tables exist
-- ============================================================
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
-- ORDER BY table_name;
