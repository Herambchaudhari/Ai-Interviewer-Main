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

**Routers** (`routers/`): `session.py` (interview lifecycle: start/answer/skip/end/checkpoint/resume), `report.py`/`reports.py`, `resume.py`, `context_hub.py`, `transcribe.py`, `interview.py`, `portfolio.py`, `news.py`, `progress.py`, `share.py`

**Key Services** (`services/`):
- `groq_service.py` — LLM inference with streaming (llama-3.3-70b-versatile), API key failover via `api_manager.py`
- `adaptive_engine.py` — Real-time question generation based on live performance scores
- `evaluator.py` — Scores answers across 7 dimensions: Technical Accuracy, Depth, Communication, Confidence, Relevance, Example Quality, Structure
- `context_assembler.py` — Aggregates resume + GitHub profile + past reports into a ContextBundle for each session
- `stt.py` / `whisper_service.py` — Speech-to-text via faster-whisper
- `code_runner.py` — Executes and validates DSA code submissions
- `session_history_analyzer.py` — Cross-session trend analysis for progress tracking
- `supabase_service.py` / `db_service.py` — All database interactions

**Prompts** (`prompts/`): `interviewer_prompt.py` (question generation with context), `report_prompt.py` (synthesis), `scoring_examples.py` (few-shot calibration), `stage3_prompt.py`, `stage4_prompt.py`

### Frontend (`frontend/src/`)

**Pages** (`pages/`): `AuthPage.jsx` → `OnboardingPage.jsx`/`Upload.jsx` → `DashboardPage.jsx` → `InterviewPage.jsx` → `InterviewRoom.jsx` (main Q&A) or `CodingPage.jsx` (DSA) → `Report.jsx`/`ReportPage.jsx`

**Key Components** (`components/`):
- `InterviewCamera.jsx` + `WebcamFeed.jsx` — MediaPipe-based proctoring (eye tracking, phone detection, posture)
- `InterviewIntegrityPanel.jsx` — Proctoring warning display
- `DSAQuestionPanel.jsx` + `DSACodeEditor.jsx` + `CodeEditor.jsx` (Monaco) — Coding interview UI
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

## Key Documentation
- `AI Interviewer V2/IMPLEMENTATION_PLAN.md` — 7-phase feature roadmap with detailed specs
- `AI Interviewer V2/project_handover.md` — Architecture wireframe and component status
- `AI INTERVIEWER (v1)/PROCTORING_FEATURES.md` — Proctoring system design reference
- `AI INTERVIEWER (v1)/REPORT_ARCHITECTURE.md` — Two-stage report generation design
