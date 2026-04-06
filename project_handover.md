# AI Interviewer Platform - Handover Document

## 1. Project Overview
We are building an **AI-native technical interviewing platform** designed to simulate realistic, professional tech interviews. The platform deeply analyzes candidate responses (voice and code), provides adaptive technical follow-ups, and generates granular analytical reports reflecting soft skills and technical depth.

---

## 2. Technical Stack
### Frontend
* **Framework:** React + Vite
* **Styling:** Tailwind CSS + Vanilla CSS (`Plus Jakarta Sans`)
* **Libraries:** Recharts (visualization), Monaco Editor (code editor), React Router, Axios, Supabase JS, React Dropzone.

### Backend
* **Framework:** Python / FastAPI
* **AI & Inference:** Groq Cloud (`llama-3.3-70b-versatile`) via `groq` SDK
* **Speech-to-Text:** `faster-whisper`
* **Web Search/Scraping:** DuckDuckGo Search (`ddgs`)
* **Document Processing:** `pdfplumber` (for resume and grade card parsing)
* **Auth & JWT:** `PyJWT`, `python-jose`

### Database & Auth
* **Provider:** Supabase (PostgreSQL + Auth ecosystem)

---

## 3. Architecture & Data Flow (Connections)
1. **Frontend <-> Backend:** Communication happens via REST API endpoints (`/api/v1/...`). Features include standard request/response endpoints as well as **Streaming Server-Sent Events (SSE)** for real-time LLM feedback and report generation to reduce perceived latency.
2. **Backend <-> Supabase:** Supabase acts as the primary datastore for User Profiles, Session metadata, Context Hub documents (e.g., resumes, DB tables), Transcripts, and Reports. 
3. **Backend <-> Groq API:** The backend constructs highly contextual prompts (using candidate history, GitHub data, resume, past strong/weak areas) and sends them to Groq for generating adaptive questions and evaluation scoring.
4. **Backend <-> Search Engine:** Integration with DuckDuckGo for live lookup of target companies and trends (Phase 1 context assembly).

---

## 4. Current Implementation Status

### ✅ Frontend Status
* **Auth & Routing:** Standard authentication (`AuthPage.jsx`) routing user to `DashboardPage.jsx`.
* **Context Hub (`ContextHubPage.jsx`):** Interface for candidates to add portfolios, links (GitHub/LinkedIn), grade cards, and config to feed candidate intelligence to the backend.
* **Onboarding & Setup (`OnboardingPage.jsx`, `Upload.jsx`):** Initial setup catching resume and basic metadata.
* **Interview Experience (`InterviewRoom.jsx`, `CodingPage.jsx`):** Full-duplex room supporting both conversational (speech) interviews and coding (DSA) interviews. Hooked up with Web Audio API for recording and Monaco editor for code.
* **Reports (`ReportPage.jsx`, `Report.jsx`):** Advanced, multi-dimensional rendering of interview performance utilizing `recharts` for radar charts and progress maps.

### ✅ Backend Status
Implemented under `backend/routers/` and `backend/services/`:
* **Context Assembly (`context_assembler.py`):** Aggregates candidate data from Supabase (resumes, past sessions, GitHub links, portfolio) into a single `ContextBundle` used for priming the LLM.
* **Adaptive Question Engine (`adaptive_engine.py`):** Real-time question generation that adjusts dynamically based on the user's previous answer scores, targeting known weaknesses or specific company requirements.
* **Evaluator (`evaluator.py`, `interviewer.py`):** Scores transcripts utilizing a 7-dimension paradigm (Technical Accuracy, Depth, Communication, Delivery, Relevance, Example Quality) normalized across experience level and question difficulty.
* **Speech-to-Text & Code Running (`stt.py`, `code_runner.py`):** Handles audio ingestion (`/transcribe`) extracting filler words, silence gaps, and pace, feeding into the evaluator's "Scoring Calibration."

### ✅ Database Status
* Supabase integrated with standard tables managed via API endpoints (Profiles, Sessions, Transcripts, Reports, Context Links/Files). Models mapped in Python using Pydantic.

---

## 5. System Wireframe / Flow
1. **Entry:** User logs in -> Completes Onboarding (Resume parse).
2. **Dashboard:** Central hub showing past sessions and overall stats.
3. **Preparation (Context Hub):** User adds LinkedIn/GitHub links, portfolio PDFs, sets target company (e.g., Amazon backend engineer).
4. **Interview Config:** User starts a session choosing Round Type (HR, DSA, System Design, Fundamentals) and Difficulty.
5. **Interview Execution:**
   * Backend pre-assembles the `ContextBundle` and generates **Question #1**.
   * User provides answer (Voice or Code).
   * Backend generates transcript + metadata (hesitation, speed), evaluates the answer (SSE stream), and adaptively generates the next question via LLM decision tree.
6. **Completion:** System aggregates all evaluations, normalizes scores, and generates a final post-interview report reflecting the candidate's exact strengths and actionable weaknesses.
