# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI-native technical interview simulation platform with two versions:
- `AI INTERVIEWER (v1)` — original version (reference only)
- `AI Interviewer V2/` — **active version** (all development happens here)

## Development Commands

### Backend (FastAPI + Python)
```bash
cd "AI Interviewer V2/backend"
python -m venv venv
source venv/bin/activate        # Mac/Linux
venv\Scripts\activate           # Windows
pip install -r requirements.txt
uvicorn main:app --reload       # Runs on http://localhost:8000
```

### Frontend (React + Vite)
```bash
cd "AI Interviewer V2/frontend"
npm install
npm run dev      # Dev server at http://localhost:5173
npm run build    # Production build
npm run preview  # Preview production build
```

### Environment Variables
- `backend/.env`: `GROQ_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`, `FRONTEND_URL`, `SECRET_KEY`, `TAVILY_API_KEY`, `RAPIDAPI_KEY`
- `frontend/.env`: `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

The Vite dev server proxies `/api` → `http://localhost:8000` (configured in `vite.config.js`).

## Architecture

### Data Flow
```
User Auth (Supabase) → Resume/Context Upload → Interview Config
→ Session Start: Context Bundle assembled (resume + GitHub + past reports)
→ Interview Loop:
    Adaptive question generation → Audio recording → STT (faster-whisper)
    → LLM evaluation (Groq, streaming SSE) → Score → Next question
→ Report Generation (2-stage: per-question micro + holistic synthesis)
    + Proctoring integrity analysis overlay
```

### Backend (`backend/`)

**Entry point:** `main.py` registers all routers.

**Routers** (`routers/`): `session.py` (interview lifecycle: start/answer/skip/end/checkpoint/resume), `report.py`/`reports.py`, `resume.py`, `context_hub.py`, `transcribe.py`, `interview.py`, `portfolio.py`, `news.py`, `progress.py`, `share.py`, `mcq.py` (MCQ topic tree endpoint + `fetch_mcq_questions_from_db()` helper used by session.py), `tts.py`, `admin.py` (hardcoded-credential admin panel: login, all users/sessions/profiles, per-student detail; also exposes report backfill trigger + status endpoints)

**Key Services** (`services/`):
- `groq_service.py` — LLM inference with streaming (llama-3.3-70b-versatile), API key failover via `api_manager.py`
- `adaptive_engine.py` — Real-time question generation based on live performance scores
- `evaluator.py` — Scores answers across 7 dimensions: Technical Accuracy, Depth, Communication, Confidence, Relevance, Example Quality, Structure
- `context_assembler.py` — Aggregates resume + GitHub profile + past reports into a ContextBundle for each session
- `stt.py` / `whisper_service.py` — Speech-to-text via faster-whisper
- `code_runner.py` — Executes and validates DSA code submissions
- `session_history_analyzer.py` — Cross-session trend analysis for progress tracking
- `backfill_service.py` — Background batch service that pre-generates and caches reports for old sessions (completed before the caching fix); drains `_generate_report_sse` without SSE, protected by asyncio.Lock
- `supabase_service.py` / `db_service.py` — All database interactions. `reports.user_id` exists in the live DB (applied out-of-band; the `migrations/012*.sql` file is not in the repo) but `save_report()` does NOT write it — current rows are populated via DB triggers / out-of-band backfill. App code derives ownership via `sessions.user_id`, never trusting `reports.user_id` alone.

**Report System Security:** Both report routes enforce session ownership before serving cached data — `GET /api/v1/report/:sessionId` (in `routers/report.py`) and the legacy `GET /api/v1/reports/:sessionId` (in `routers/reports.py`). Share endpoints `POST/DELETE /api/v1/share/:sessionId` also verify the caller owns the session before minting/revoking tokens; `generate_share_token()` and `disable_share_token()` re-check ownership at the service layer via `sessions.user_id` (defence-in-depth). `end_session()` errors on DB failure (no silent swallow) so dashboard visibility is guaranteed. **Known pre-existing bug:** `reports.share_enabled` column is referenced by share code but does not exist in the live DB — share feature is non-functional regardless of these ownership checks.

**Prompts** (`prompts/`): `interviewer_prompt.py` (question generation with context), `report_prompt.py` (synthesis), `scoring_examples.py` (few-shot calibration), `stage3_prompt.py`, `stage4_prompt.py`

### Frontend (`frontend/src/`)

**Pages** (`pages/`): `AuthPage.jsx` (+ `ForgotPasswordPage.jsx` / `ResetPasswordPage.jsx` for Supabase password recovery flow) → `OnboardingPage.jsx`/`Upload.jsx` → `DashboardPage.jsx` → `InterviewPage.jsx` → `InterviewRoom.jsx` (main Q&A) or `CodingPage.jsx` (DSA) → `Report.jsx`/`ReportPage.jsx`

**Admin Pages** (`pages/`): `AdminLoginPage.jsx` (`/admin`) → `AdminDashboardPage.jsx` (`/admin/dashboard`) — hardcoded-credential admin panel with three tabs (Registered Students, Assessment Activity, Resume Uploads) + student detail modal + search by name/email

**Key Components** (`components/`):
- `InterviewCamera.jsx` + `WebcamFeed.jsx` — MediaPipe-based proctoring (eye tracking, phone detection, posture)
- `InterviewIntegrityPanel.jsx` — Proctoring warning display
- `DSAQuestionPanel.jsx` + `DSACodeEditor.jsx` + `CodeEditor.jsx` (Monaco) — Coding interview UI
- `MCQTestInterface.jsx` — Full-screen professional MCQ test UI (3-panel: header + sidebar navigator + main content + bottom bar); replaces MCQ path in InterviewRoom via early return; no answer reveal during test
- `MCQQuestionPanel.jsx` — Legacy MCQ component (superseded by MCQTestInterface)
- Chart components: `RadarChart.jsx`, `HireSignalRadar.jsx`, `AreaTimeline.jsx`, `ScoreBarChart.jsx`, `CVHonestyGauge.jsx`

**Custom Hooks** (`hooks/`):
- `useSSE.js` — Server-Sent Events for streaming LLM feedback
- `useProctoringMonitor.js` — Collects body language metrics from MediaPipe
- `useAudioRecorder.js` — Web Audio API recording
- `useInterviewGuard.js` — Prevents accidental session exit

**API Client:** `lib/api.js` (Axios, all backend endpoints). Auth state in `context/AuthContext.jsx`. Routes defined in `lib/routes.js`.

### Interview Round Types
Four tracks with distinct scoring radar dimensions: Technical Fundamentals, DSA/Coding, HR/Behavioral, System Design.

### Streaming Pattern
LLM feedback is delivered via SSE (`/api/v1/session/answer` streams token-by-token). Frontend `useSSE.js` hook handles the event stream; backend `groq_service.py` yields chunks.

### Proctoring
Entirely client-side using TensorFlow.js + MediaPipe (FaceLandmarker for gaze, EfficientDet-Lite0 for phone detection). Metrics are collected and sent to backend at session end for integrity verdict in the report.

## Session Start Protocol

At the beginning of every new session, ask the user:

> "Which branch are you working on? Create a new branch or use an existing one?"

Then confirm the branch name before doing any work. This keeps all development isolated from `main`.

## Git Rules

- **Never push directly to `main`.** All changes go through a feature branch → PR workflow.
- Always create or checkout a branch before making commits.
- Branch naming convention: `feature/<short-description>`, `fix/<short-description>`, `chore/<short-description>`.
- Only merge to `main` via a pull request reviewed and approved by a team member.

## Communication Style

Be concise and to the point. No filler, no padding, no restating what was just done. Match response length to task complexity — a one-line fix gets a one-line reply. Never burn tokens explaining the obvious.

## CLAUDE.md Maintenance Rule

**This file must be kept up to date.** Whenever you add a new feature, service, route, component, hook, or make any architectural change, update the relevant section(s) of this file in the same commit. Specifically:

- New backend router → add to the **Routers** list
- New backend service → add to **Key Services** with a one-line description of its role
- New frontend page → add to the **Pages** flow
- New frontend component or hook → add under the appropriate subsection
- New environment variable → add to **Environment Variables**
- Architectural or data-flow change → update **Data Flow** diagram
- New npm/pip dependency that changes the tech stack → note it where relevant

Keep descriptions concise (one line each). Do not pad with generic information — only include what a future Claude instance needs to orient quickly.

## Key Documentation
- `AI Interviewer V2/IMPLEMENTATION_PLAN.md` — 7-phase feature roadmap with detailed specs
- `AI Interviewer V2/project_handover.md` — Architecture wireframe and component status
- `AI INTERVIEWER (v1)/PROCTORING_FEATURES.md` — Proctoring system design reference
- `AI INTERVIEWER (v1)/REPORT_ARCHITECTURE.md` — Two-stage report generation design
