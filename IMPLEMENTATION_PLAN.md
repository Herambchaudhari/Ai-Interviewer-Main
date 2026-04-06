# AI Interviewer — Multi-Phase Implementation Plan

> **Scope:** Four major upgrades — Adaptive Question Engine, LLM Streaming, Scoring Calibration with Soft Skills, and Session Persistence.
> **Principle:** Every change connects forward (affects report) and backward (uses full candidate context). No orphaned features.

---

## Overview of Phases

| Phase | Name | Estimated Effort |
|---|---|---|
| 1 | Context Assembly — Full Candidate Intelligence | 2–3 days |
| 2 | Adaptive Question Engine | 2–3 days |
| 3 | LLM Response Streaming (SSE) | 2 days |
| 4 | Scoring Calibration + Soft Skills Analysis | 3 days |
| 5 | Session Persistence & Recovery | 2 days |
| 6 | Report Integration — Reflecting All New Signals | 2 days |
| 7 | Testing & Verification | 2–3 days |

---

## Phase 1 — Context Assembly: Full Candidate Intelligence

**Goal:** Before any interview starts, assemble the richest possible candidate intelligence from every available source — resume, grade cards, portfolio, GitHub, LinkedIn, publications, past AI Interviewer reports, and the target company/role. This context powers everything downstream.

### 1.1 — New: `ContextBundle` Model

**File:** `backend/models.py`

Add a new Pydantic model:

```python
class ContextBundle(BaseModel):
    # From resume/profile
    name: str
    skills: list[str]
    experience: list[dict]
    projects: list[dict]
    education: list[dict]

    # From onboarding
    year: Optional[str]
    branch: Optional[str]
    cgpa: Optional[float]

    # From context hub — portfolio files (grade cards, ppts, publications)
    portfolio_files: list[dict]      # [{file_name, file_type, extracted_summary}]

    # From context hub — external links
    github_url: Optional[str]
    linkedin_url: Optional[str]
    portfolio_url: Optional[str]
    github_summary: Optional[str]    # scraped: top repos, languages, commit activity
    linkedin_summary: Optional[str]  # scraped: headline, recent activity
    portfolio_summary: Optional[str] # scraped: key projects/about

    # From context hub — past AI Interviewer reports
    past_reports: list[dict]         # [{round_type, overall_score, weak_areas, date}]
    known_weak_areas: list[str]      # aggregated from past_reports
    known_strong_areas: list[str]

    # Session-specific
    target_company: Optional[str]
    job_role: Optional[str]
    target_sectors: list[str]
    company_news_context: Optional[str]

    # Session config
    round_type: str
    difficulty: str
```

### 1.2 — New: `context_assembler.py` Service

**File:** `backend/services/context_assembler.py`

Create a new service responsible for assembling the full `ContextBundle` at session start:

```python
async def assemble_context(
    user_id: str,
    profile_id: str,
    session_request: SessionStartRequest,
) -> dict:
    """
    Assembles all available candidate intelligence into a single context dict.
    Called once at session start. Result is stored in the session record.

    Sources (in priority order):
    1. Supabase profile (parsed_data from resume)
    2. student_meta from frontend localStorage (onboarding fields)
    3. portfolio_files from Supabase (grade cards, publications, PPTs)
    4. external_links from Supabase → scraped summaries
    5. past interview reports from Supabase (known weak/strong areas)
    6. target_company + job_role from session request
    7. live company news (Tavily/DuckDuckGo)
    """
```

**What it does, step by step:**

1. **Resume/Profile** — fetch `parsed_data` from `profiles` table
2. **Student meta** — merge onboarding fields from request (name, year, branch, CGPA, target_companies, target_sectors)
3. **Portfolio files** — fetch from `portfolio_files` table. For PDFs (grade cards, publications), extract text summary using existing `pdfplumber`. For PPTs, extract title/slide text. Store as `[{file_name, file_type, summary}]`
4. **External links** — fetch from `external_links` table → call existing `scrape_links()` → extract GitHub (repos, languages, stars, recent activity), LinkedIn (headline, recent posts), portfolio (key projects)
5. **Past reports** — query `reports` table for this user, last 5 sessions. Extract: round_type, overall_score, weak_areas[], strong_areas[], date. Aggregate `known_weak_areas` (areas that scored <60 across sessions)
6. **Company context** — if `target_company` provided, call `search_company_trends()` for live news
7. Return assembled `dict` matching `ContextBundle` shape

### 1.3 — Update `session.py` `/start` endpoint

**File:** `backend/routers/session.py`

Replace the current ad-hoc data assembly in `start_session()` with:

```python
from services.context_assembler import assemble_context

context = await assemble_context(
    user_id=user["user_id"],
    profile_id=body.profile_id,
    session_request=body,
)

# Store full context in session record (new field: context_bundle)
session_data["context_bundle"] = context
```

This replaces the current patchwork of: `resume_data`, `meta_dict`, `scraped_data`, `company_news_context`.

### 1.4 — Update `interviewer_prompt.py`

**File:** `backend/prompts/interviewer_prompt.py`

Extend `build_interviewer_prompt()` to consume the full context bundle:

- Add `_fmt_portfolio_context()` — formats grade card summary, publications, PPT summaries
- Add `_fmt_past_performance()` — formats known weak/strong areas from past sessions
- Add `_fmt_github_deep()` — detailed GitHub: lists top repos with languages, star count, last push date
- Extend `_fmt_student_context()` — include CGPA weight context (e.g. low CGPA → flag, high CGPA → note academic rigor)

The system prompt gains new sections:

```
PAST INTERVIEW PERFORMANCE (from AI Interviewer history)
─────────────────────────────────────────
Known Weak Areas (across last 3 sessions): OS Internals, Database Indexing, System Design
Known Strong Areas: Python, React, Problem Solving approach
→ Do NOT avoid these weak areas. Probe them deliberately but fairly.
→ Use strong areas as setup for harder follow-ups.

PORTFOLIO & ACADEMIC CONTEXT
─────────────────────────────────────────
Grade Card: 7.8 CGPA (B.Tech CSE, 6th Semester)
Publications: "Optimizing BERT Inference on Edge Devices" (IEEE 2024)
→ Ask about the publication's methodology if round_type is technical.

GITHUB ACTIVITY (Live)
─────────────────────────────────────────
Top Repos: ai-chatbot (Python, 142 stars), react-dashboard (TS, 23 stars)
Recent Activity: 47 commits in last 30 days — active contributor
→ Reference specific repos in questions.
```

---

## Phase 2 — Adaptive Question Engine

**Goal:** Completely replace the linear pre-generated question list with a real-time adaptive engine. Each question is generated dynamically based on conversation history, detected weaknesses, known weak areas from past sessions, and the full context bundle. No more batch generation at start.

### 2.1 — Remove Batch Pre-generation

**File:** `backend/routers/session.py`

Currently `start_session()` calls `generate_questions()` (batch, all N questions upfront) and stores all in `session_data["questions"]`.

**Change:** Remove the `generate_questions()` call. Instead:
- Generate ONLY the first question at session start using `generate_first_question()`
- Store `questions: [first_question]` in session record
- Store `context_bundle` in session record for use in subsequent question generation

```python
# Replace batch generation:
# questions = await generate_questions(...)  ← REMOVE THIS

# With single first question:
first_question = await generate_first_question(
    profile=context,
    round_type=round_type,
    difficulty=difficulty,
)
first_question["id"] = str(uuid.uuid4())
first_question["order_index"] = 0
first_question["type"] = "code" if round_type == "dsa" else "speech"
first_question["time_limit_secs"] = _TIME_LIMITS[difficulty]

session_data["questions"] = [first_question]
session_data["num_questions"] = body.num_questions   # target count
```

### 2.2 — Upgrade `/answer` to Generate Next Question Adaptively

**File:** `backend/routers/session.py` → `submit_answer()`

After evaluating the answer, instead of looking up `questions[next_index]` from the pre-generated list, call the adaptive engine:

```python
# After evaluation is complete and persisted:

# Check if we've reached target question count
answered_count = len(session.get("transcript", []))
target_count = session.get("num_questions", 8)

if answered_count >= target_count or body.is_last_question:
    return _ok(data={"evaluation": evaluation, "session_complete": True, "next_question": None})

# Adaptive next question generation
from services.adaptive_engine import generate_adaptive_next_question

next_q = await generate_adaptive_next_question(
    session=session,
    last_evaluation=evaluation,
    context_bundle=session.get("context_bundle", {}),
)
next_q["order_index"] = answered_count
next_q["id"] = str(uuid.uuid4())
next_q["time_limit_secs"] = _TIME_LIMITS[session.get("difficulty", "medium")]

# Append to session's questions list in DB
current_questions = session.get("questions", [])
current_questions.append(next_q)
update_session(body.session_id, {"questions": current_questions})

return _ok(data={"evaluation": evaluation, "session_complete": False, "next_question": next_q})
```

### 2.3 — New: `adaptive_engine.py` Service

**File:** `backend/services/adaptive_engine.py`

This is the core of the adaptive system:

```python
async def generate_adaptive_next_question(
    session: dict,
    last_evaluation: dict,
    context_bundle: dict,
) -> dict:
    """
    Generates the next interview question using full adaptive intelligence.

    Decision logic (in order):
    1. If last answer scored ≤5/10 → generate targeted FOLLOW-UP on same topic (different angle)
    2. If a known_weak_area (from past sessions) hasn't been covered yet → probe it
    3. If a critical topic for target_company/job_role hasn't been covered → probe it
    4. Otherwise → generate a fresh question on an uncovered topic from the context bundle

    Never repeats a topic already in asked_topics.
    """
```

**Decision tree in detail:**

```python
# 1. Determine conversation state
transcript = session.get("transcript", [])
asked_topics = [t.get("category", "") or t.get("topic", "") for t in transcript]
round_type = session.get("round_type", "technical")
difficulty = session.get("difficulty", "medium")

# Build conversation history for the prompt
conv_history = _build_conv_history(transcript)

# 2. Decision: Follow-up on weak last answer?
last_score = last_evaluation.get("score", 5)
if last_score <= 5 and not last_evaluation.get("is_follow_up"):
    # Generate a targeted follow-up — probe the weak point deeper
    return await generate_follow_up(
        profile=context_bundle,
        last_question=transcript[-1],
        last_answer=transcript[-1].get("answer", ""),
        weak_points=last_evaluation.get("missing_concepts", []),
    )

# 3. Decision: Unprobed known weak area?
known_weak = context_bundle.get("known_weak_areas", [])
uncovered_weak = [w for w in known_weak if not _topic_covered(w, asked_topics)]
if uncovered_weak:
    # Inject a question on the first uncovered known weakness
    return await generate_targeted_weakness_question(
        topic=uncovered_weak[0],
        profile=context_bundle,
        round_type=round_type,
        difficulty=difficulty,
        conv_history=conv_history,
    )

# 4. Decision: Company-critical topic not yet covered?
company_critical = _get_company_critical_topics(
    target_company=context_bundle.get("target_company", ""),
    job_role=context_bundle.get("job_role", ""),
    round_type=round_type,
)
uncovered_critical = [t for t in company_critical if not _topic_covered(t, asked_topics)]
if uncovered_critical:
    # Target a company-critical topic
    return await generate_next_question(
        profile={**context_bundle, "_force_topic": uncovered_critical[0]},
        round_type=round_type,
        difficulty=difficulty,
        conversation_history=conv_history,
        asked_topics=asked_topics,
    )

# 5. Default: Adaptive next question (existing logic, now fully powered)
return await generate_next_question(
    profile=context_bundle,
    round_type=round_type,
    difficulty=difficulty,
    conversation_history=conv_history,
    asked_topics=asked_topics,
)
```

**`_get_company_critical_topics()` mapping:**

```python
COMPANY_CRITICAL_TOPICS = {
    "amazon": ["Leadership Principles", "Distributed Systems", "Customer Obsession", "Operational Excellence"],
    "google": ["Algorithms & Big-O", "System Design at Scale", "Coding Efficiency"],
    "microsoft": ["OOP Design Patterns", "Cloud Architecture", "Azure services"],
    "goldman sachs": ["Financial Data Pipelines", "Low Latency Systems", "Risk Modeling"],
    "jp morgan": ["Regulatory Compliance", "ACID Databases", "Security"],
    # ... extended by role
}

ROLE_CRITICAL_TOPICS = {
    "backend engineer": ["REST API Design", "Database Optimization", "Caching"],
    "ml engineer": ["Model Deployment", "Feature Engineering", "MLOps"],
    "frontend engineer": ["React Performance", "Browser Rendering", "State Management"],
    # ... etc.
}
```

### 2.4 — Update Frontend: Remove Pre-generated Queue

**File:** `frontend/src/pages/InterviewRoom.jsx`

Currently the frontend stores all questions in `sessionStorage` and serves them from there. With adaptive generation, the next question always comes from the API response.

**Changes:**
- Remove `sessionStorage.setItem('questions', ...)` after session start
- Remove the logic that reads next question from the stored array (`questions[currentIndex + 1]`)
- Always use `response.data.next_question` from the `/answer` API response as the single source of truth
- Keep a local `questionsAnswered` counter for progress bar display (total = `session.num_questions`)

```jsx
// After submitting answer:
const { evaluation, next_question, session_complete } = response.data.data;

if (session_complete) {
  handleSessionComplete();
} else {
  setCurrentQuestion(next_question);  // always from API, never from local array
  setQuestionsAnswered(prev => prev + 1);
}
```

### 2.5 — Update `/skip` to Use Adaptive Engine

**File:** `backend/routers/session.py` → `skip_question()`

Replace the current fallback logic with `generate_adaptive_next_question()` (same as `/answer`), marking the skipped entry in transcript with score=0.

---

## Phase 3 — LLM Response Streaming (SSE)

**Goal:** Eliminate perceived waiting time. Stream evaluation feedback token-by-token to the UI immediately as the LLM generates it. Critical for: answer evaluation feedback, report generation, and question text delivery.

### 3.1 — Add Streaming to Groq Service

**File:** `backend/services/groq_service.py`

Add a new streaming wrapper:

```python
from groq import AsyncGroq

_async_client = None

def _get_async_client():
    global _async_client
    if _async_client is None:
        _async_client = AsyncGroq(api_key=os.getenv("GROQ_API_KEY"))
    return _async_client

async def stream_chat(system: str, user: str, temperature=0.3, max_tokens=1200):
    """
    Async generator that yields token chunks as they arrive from Groq.
    Usage: async for chunk in stream_chat(system, user): yield chunk
    """
    stream = await _get_async_client().chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta
```

### 3.2 — New Streaming Endpoint: `/session/answer/stream`

**File:** `backend/routers/session.py`

```python
from fastapi.responses import StreamingResponse
import json

@router.post("/answer/stream")
async def submit_answer_stream(
    body: AnswerRequest,
    user: dict = Depends(get_current_user),
):
    """
    Streaming version of /answer.
    Returns Server-Sent Events (SSE) with evaluation feedback chunks,
    then a final 'data: [DONE]' event containing the full structured result.

    SSE event types:
    - data: {"type": "feedback_chunk", "text": "<token>"}
    - data: {"type": "evaluation_complete", "payload": {full evaluation JSON}}
    - data: {"type": "next_question", "payload": {next question JSON}}
    - data: [DONE]
    """
    async def event_generator():
        # 1. Load session and find current question (same as /answer)
        session = _load_session_safe(body.session_id)
        current_q = _find_question(session, body.question_id, body.current_question)
        round_type = session.get("round_type", "technical")

        # 2. Build evaluation prompt
        eval_prompt = _build_eval_prompt(current_q, body.transcript, round_type)

        # 3. Stream feedback text chunk by chunk
        full_text = ""
        from services.groq_service import stream_chat
        async for chunk in stream_chat(eval_prompt["system"], eval_prompt["user"]):
            full_text += chunk
            yield f"data: {json.dumps({'type': 'feedback_chunk', 'text': chunk})}\n\n"

        # 4. Parse full_text → structured evaluation JSON
        evaluation = _parse_evaluation(full_text, round_type, current_q, body.transcript)

        # 5. Persist to Supabase
        _persist_answer(body.session_id, session, current_q, evaluation, body.transcript)

        # 6. Generate next question adaptively
        answered_count = len(session.get("transcript", [])) + 1
        target_count = session.get("num_questions", 8)

        if answered_count >= target_count or body.is_last_question:
            yield f"data: {json.dumps({'type': 'evaluation_complete', 'payload': evaluation})}\n\n"
            yield f"data: {json.dumps({'type': 'session_complete'})}\n\n"
        else:
            context_bundle = session.get("context_bundle", {})
            next_q = await generate_adaptive_next_question(session, evaluation, context_bundle)
            next_q["order_index"] = answered_count
            next_q["id"] = str(uuid.uuid4())

            yield f"data: {json.dumps({'type': 'evaluation_complete', 'payload': evaluation})}\n\n"
            yield f"data: {json.dumps({'type': 'next_question', 'payload': next_q})}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
```

### 3.3 — New Streaming Endpoint: `/report/{session_id}/stream`

**File:** `backend/routers/report.py`

Add a streaming report endpoint that generates the two-stage report and sends sections as they complete:

```python
@router.get("/{session_id}/stream")
async def stream_report(session_id: str, user: dict = Depends(get_current_user)):
    async def report_generator():
        # Stage 1: Core analysis (streams tokens, then yields completed section)
        yield f"data: {json.dumps({'type': 'stage', 'stage': 'core_analysis', 'status': 'started'})}\n\n"
        # ... stream core analysis
        yield f"data: {json.dumps({'type': 'section_complete', 'section': 'core', 'payload': core_data})}\n\n"

        # Stage 2: CV audit
        yield f"data: {json.dumps({'type': 'stage', 'stage': 'cv_audit', 'status': 'started'})}\n\n"
        # ... stream CV audit
        yield f"data: {json.dumps({'type': 'section_complete', 'section': 'cv_audit', 'payload': audit_data})}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(report_generator(), media_type="text/event-stream")
```

### 3.4 — Frontend: SSE Client Hook

**File:** `frontend/src/hooks/useSSE.js` (new file)

```javascript
export function useSSE() {
  const submitAnswerStreaming = async (payload, { onFeedbackChunk, onEvalComplete, onNextQuestion, onSessionComplete }) => {
    const response = await fetch(`${import.meta.env.VITE_API_URL}/api/v1/session/answer/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify(payload),
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = decoder.decode(value).split("\n\n");
      for (const line of lines) {
        if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
        const event = JSON.parse(line.slice(6));

        if (event.type === "feedback_chunk") onFeedbackChunk?.(event.text);
        if (event.type === "evaluation_complete") onEvalComplete?.(event.payload);
        if (event.type === "next_question") onNextQuestion?.(event.payload);
        if (event.type === "session_complete") onSessionComplete?.();
      }
    }
  };

  return { submitAnswerStreaming };
}
```

### 3.5 — Frontend: Update InterviewRoom to Use SSE

**File:** `frontend/src/pages/InterviewRoom.jsx`

Replace the blocking `api.submitAnswer(...)` call with `submitAnswerStreaming()`:

```jsx
// New state for streaming feedback display
const [streamingFeedback, setStreamingFeedback] = useState("");
const [isStreaming, setIsStreaming] = useState(false);

const handleSubmit = async () => {
  setIsStreaming(true);
  setStreamingFeedback("");

  await submitAnswerStreaming(payload, {
    onFeedbackChunk: (chunk) => setStreamingFeedback(prev => prev + chunk),
    onEvalComplete: (evaluation) => {
      setLastEvaluation(evaluation);
      setIsStreaming(false);
    },
    onNextQuestion: (question) => setCurrentQuestion(question),
    onSessionComplete: () => navigate(`/report/${sessionId}`),
  });
};
```

**New UI element:** A `<StreamingFeedbackPanel>` component that displays the feedback text as it streams in, with a blinking cursor effect — similar to ChatGPT's streaming output. This appears immediately after the candidate submits, while the question transitions are happening.

---

## Phase 4 — Scoring Calibration + Soft Skills Analysis

**Goal:** Make scoring reflect what a real interviewer truly evaluates — not just factual correctness, but voice confidence, communication clarity, answer structure, body language signals, and consistency with resume claims. All of this feeds into the report.

### 4.1 — New: `ScoringContext` — What a Real Interviewer Considers

**File:** `backend/services/evaluator.py`

**Current problem:** `evaluate_answer()` only evaluates factual content from the transcript text. It ignores: how the answer was delivered, how long it took, whether the candidate hesitated excessively, communication structure, confidence markers in speech, etc.

**New approach:** Add a `ScoringContext` that is passed to the evaluator with metadata about the delivery:

```python
class ScoringContext(BaseModel):
    # Audio-derived signals (from whisper + audio metadata)
    answer_duration_secs: int           # How long they took
    time_limit_secs: int                # What the limit was
    time_used_ratio: float              # answer_duration / time_limit
    silence_gaps_detected: bool         # Long pauses in audio (>3s)
    audio_confidence_estimate: str      # "high" | "medium" | "low" — from whisper word probabilities
    word_count: int                     # Transcript word count
    filler_words_detected: list[str]    # ["um", "uh", "like", "you know"] detected in transcript

    # Answer structure signals (derived from transcript analysis)
    used_structure: bool                # Did they use STAR / numbered points / clear structure?
    answered_directly: bool             # Did they directly address the question or ramble?
    gave_example: bool                  # Did they give a concrete example?

    # Context
    question_difficulty: str            # easy | medium | hard
    round_type: str
    is_follow_up: bool                  # Follow-up questions get slightly different weight
    candidate_year: Optional[str]       # Fresher vs Senior affects expectation
```

### 4.2 — Update `transcribe` Endpoint to Return Rich Metadata

**File:** `backend/routers/session.py` → `/transcribe`

Currently returns only `{"transcript": "..."}`. Update to also return:

```python
# After transcription:
transcript_text = await transcribe_audio(tmp_path)

# Derive soft-skill signals from transcript text:
word_count = len(transcript_text.split())
filler_words = [w for w in ["um", "uh", "like", "you know", "basically", "actually"] 
                if f" {w} " in transcript_text.lower()]
silence_gaps = _detect_silence_gaps(audio_duration, word_count)  # if word_count/duration < threshold

return _ok(data={
    "transcript": transcript_text,
    "question_id": question_id,
    "meta": {
        "word_count": word_count,
        "duration_secs": audio_duration,
        "filler_words": filler_words,
        "silence_gaps_detected": silence_gaps,
        "words_per_minute": round(word_count / max(audio_duration / 60, 0.1)),
    }
})
```

**Note on audio confidence:** `faster-whisper` returns per-segment confidence scores. Extract average confidence and map to "high"/"medium"/"low".

### 4.3 — Upgrade `evaluate_answer()` with Multi-Dimensional Scoring

**File:** `backend/services/evaluator.py`

```python
async def evaluate_answer(
    question: dict,
    transcript: str,
    round_type: str = "technical",
    scoring_context: dict = None,   # NEW PARAMETER
) -> dict:
```

**New evaluation prompt — 7 dimensions:**

```python
scoring_ctx_block = ""
if scoring_context:
    sc = scoring_context
    time_efficiency = "used time well" if 0.4 < sc.get("time_used_ratio", 0.5) < 1.0 else \
                      "answered very briefly" if sc.get("time_used_ratio", 0.5) < 0.3 else "ran over time or was very long"
    filler_str = ", ".join(sc.get("filler_words", [])) or "none detected"
    scoring_ctx_block = f"""
DELIVERY SIGNALS (from audio analysis — use these to calibrate scores):
- Answer duration: {sc.get("answer_duration_secs")}s of {sc.get("time_limit_secs")}s allowed ({time_efficiency})
- Word count: {sc.get("word_count")} words
- Filler words detected: {filler_str}
- Silence gaps: {"Yes — candidate paused significantly" if sc.get("silence_gaps_detected") else "No — fluent delivery"}
- Audio confidence: {sc.get("audio_confidence_estimate", "unknown")}
- Candidate level: {sc.get("candidate_year", "unknown")} year student

CALIBRATION RULES:
- Deduct 1 point if >5 filler words (shows low confidence/preparation)
- Deduct 1 point if silence_gaps=True and score would be >6 (hesitation under pressure)
- Add 0.5 points if time_used_ratio is 0.5-0.8 (concise and complete — real interviewer signal)
- Score for a fresher (1st/2nd year) should be more lenient than for a final-year student
"""

user_msg = f"""Question: {q_text}
Round Type: {round_type}
{scoring_ctx_block}
Candidate's Verbatim Answer: {transcript}

Evaluate across ALL 7 DIMENSIONS. A real interviewer considers ALL of these:

1. TECHNICAL ACCURACY (weight: 40%) — Is the answer factually correct? Are concepts named and explained accurately?
2. DEPTH & COMPLETENESS (weight: 20%) — Did they go beyond surface-level? Did they cover edge cases, trade-offs?
3. COMMUNICATION CLARITY (weight: 15%) — Was the answer structured? Did they explain their thought process?
4. CONFIDENCE & DELIVERY (weight: 10%) — Based on delivery signals above. Did they sound sure of themselves?
5. RELEVANCE (weight: 10%) — Did they directly answer the question asked? Or did they ramble?
6. EXAMPLE QUALITY (weight: 5%) — Did they give a concrete example from their experience or knowledge?

For HR rounds, swap weights: Communication=35%, Relevance=25%, Technical Accuracy=10%, rest same.
For DSA rounds, Technical Accuracy=60%, Depth=30%, Communication=10%.

Return ONLY valid JSON:
{{
  "score": <integer 1-10, weighted composite>,
  "dimension_scores": {{
    "technical_accuracy": <1-10>,
    "depth_completeness": <1-10>,
    "communication_clarity": <1-10>,
    "confidence_delivery": <1-10>,
    "relevance": <1-10>,
    "example_quality": <1-10>
  }},
  "feedback": "<2-3 sentences — cite specific parts of their answer>",
  "strong_points": ["<what they did well — specific>"],
  "weak_points": ["<what they did poorly — specific>"],
  "missing_concepts": ["<concepts they should have mentioned>"],
  "communication_score": <1-10>,
  "confidence_score": <1-10>,
  "answer_structure": "<excellent|good|rambling|too_brief|off_topic>",
  "follow_up_needed": <true|false>,
  "follow_up_question": "<targeted follow-up or null>",
  "key_concept_missed": "<single most important missed concept>",
  "red_flag_detected": "<arrogance/blame-shifting/toxic behavior or empty string>",
  "verdict": "<Excellent|Good|Satisfactory|Needs Improvement|Poor>",
  "answer_summary": "<1 sentence summary of what they said>"
}}
"""
```

### 4.4 — Few-Shot Examples for Scoring Calibration

**File:** `backend/prompts/scoring_examples.py` (new file)

Create a library of golden answer examples for consistent scoring:

```python
FEW_SHOT_EXAMPLES = {
    "technical": [
        {
            "question": "What is the difference between a process and a thread?",
            "answer": "A process is an independent program in execution with its own memory space. A thread is a lightweight unit within a process that shares the process's memory. Context switching between threads is faster than between processes. Threads are used for parallelism within a program, like handling multiple requests in a server.",
            "expected_score": 8,
            "reasoning": "Correct core definitions, mentioned memory isolation, mentioned context switching overhead, gave practical example. Missing: didn't mention synchronization complexity, race conditions."
        },
        {
            "question": "What is the difference between a process and a thread?",
            "answer": "Process is big and thread is small. Process has more memory.",
            "expected_score": 3,
            "reasoning": "Vague, no technical depth, no examples, didn't explain why or how."
        },
        # ... 5-8 examples per round type
    ],
    "hr": [
        {
            "question": "Tell me about a time you had a conflict with a teammate.",
            "answer": "During my final year project, I disagreed with my teammate about using MongoDB vs PostgreSQL. I scheduled a focused discussion where we listed requirements and evaluated both options objectively. We ended up choosing PostgreSQL for its ACID compliance. The project shipped on time and my teammate later said the structured discussion helped him think more clearly about data modeling decisions.",
            "expected_score": 9,
            "reasoning": "Clear STAR structure, specific conflict described, action taken was mature and technical, measured outcome, shows growth mindset."
        },
    ]
}

def inject_few_shot_examples(round_type: str) -> str:
    """Returns formatted few-shot examples for the evaluation prompt."""
    examples = FEW_SHOT_EXAMPLES.get(round_type, [])
    if not examples:
        return ""
    lines = ["FEW-SHOT CALIBRATION EXAMPLES (use these to calibrate your scoring):"]
    for ex in examples[:3]:
        lines.append(f"\nExample Answer (score={ex['expected_score']}/10):\nQ: {ex['question']}\nA: {ex['answer']}\nWhy {ex['expected_score']}: {ex['reasoning']}")
    return "\n".join(lines)
```

### 4.5 — Score Normalization by Difficulty

**File:** `backend/services/evaluator.py`

Add post-processing normalization:

```python
def normalize_score(raw_score: int, difficulty: str, candidate_year: str) -> int:
    """
    Apply difficulty and experience curve to raw LLM score.
    A score of 7/10 means something different for a fresher vs a senior candidate.
    """
    # Base adjustment by difficulty
    difficulty_bonus = {"easy": 0, "medium": 0, "hard": 1}  # hard qs → partial credit buffer
    year_leniency = {"1st": 1.5, "2nd": 1.0, "3rd": 0.5, "4th": 0, "Final": 0}

    bonus = difficulty_bonus.get(difficulty, 0)
    leniency = year_leniency.get(candidate_year, 0)

    adjusted = round(min(10, raw_score + bonus * 0.3 + leniency * 0.2))
    return max(1, adjusted)
```

### 4.6 — Frontend: Pass Scoring Metadata with Answer Submission

**File:** `frontend/src/pages/InterviewRoom.jsx`

After transcription, store the metadata returned by `/transcribe`, then include it in the `/answer` payload:

```jsx
// After transcription:
const { transcript, meta } = transcribeResponse.data.data;
setScoringMeta(meta);  // {word_count, duration_secs, filler_words, ...}

// In answer submission:
const payload = {
  session_id: sessionId,
  question_id: currentQuestion.id,
  transcript,
  time_taken_secs: timeTaken,
  scoring_context: {
    ...scoringMeta,
    time_limit_secs: currentQuestion.time_limit_secs,
    time_used_ratio: timeTaken / currentQuestion.time_limit_secs,
    question_difficulty: difficulty,
    round_type: roundType,
    is_follow_up: currentQuestion.is_follow_up || false,
    candidate_year: studentMeta?.year,
  },
};
```

**File:** `backend/models.py` — Add `scoring_context: Optional[dict]` to `AnswerRequest`.

---

## Phase 5 — Session Persistence & Recovery

**Goal:** If the browser closes, crashes, or the user accidentally navigates away during an interview, they can return to exactly where they left off — same question, same timer state, same transcript history.

### 5.1 — Backend: Session Checkpoint Endpoint

**File:** `backend/routers/session.py`

```python
class CheckpointRequest(BaseModel):
    session_id: str
    current_question_id: str
    current_question_index: int
    timer_remaining_secs: int
    local_transcript: list    # transcript entries answered so far (from frontend state)

@router.post("/checkpoint")
async def save_checkpoint(body: CheckpointRequest, user: dict = Depends(get_current_user)):
    """
    Lightweight checkpoint save — called every 30 seconds during interview
    and on window beforeunload.
    Updates: current_question_index, timer_remaining_secs, and any transcript entries
    not yet saved to DB (in case /answer DB write failed).
    """
    try:
        update_session(body.session_id, {
            "current_question_index":  body.current_question_index,
            "timer_remaining_secs":    body.timer_remaining_secs,
            "last_checkpoint_at":      datetime.utcnow().isoformat(),
            # Merge transcript — only append entries not already in DB
            # (deduplicate by question_id)
        })
    except Exception:
        pass
    return _ok(data={"checkpointed": True})
```

### 5.2 — Backend: Resume Session Endpoint

**File:** `backend/routers/session.py`

```python
@router.get("/{session_id}/resume")
async def resume_session(session_id: str, user: dict = Depends(get_current_user)):
    """
    Returns full session state for recovery:
    - current question (from current_question_index)
    - all questions answered so far (transcript)
    - timer_remaining_secs (last saved checkpoint)
    - context_bundle
    - session config (round_type, difficulty, num_questions)
    """
    session = get_session(session_id)
    if not session or session.get("user_id") != user["user_id"]:
        return _err("Session not found or access denied.", status=404)

    if session.get("status") == "completed":
        return _ok(data={"status": "completed", "report_url": f"/report/{session_id}"})

    current_index = session.get("current_question_index", 0)
    questions = session.get("questions", [])
    current_q = questions[current_index] if current_index < len(questions) else None

    return _ok(data={
        "session_id": session_id,
        "status": "active",
        "current_question": current_q,
        "current_question_index": current_index,
        "timer_remaining_secs": session.get("timer_remaining_secs"),
        "transcript": session.get("transcript", []),
        "round_type": session.get("round_type"),
        "difficulty": session.get("difficulty"),
        "num_questions": session.get("num_questions"),
        "questions_answered": len(session.get("transcript", [])),
    })
```

### 5.3 — Backend: Update DB Schema

**File:** `backend/schema.sql`

Add columns to `sessions` table:

```sql
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS current_question_index INTEGER DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS timer_remaining_secs INTEGER;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_checkpoint_at TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS context_bundle JSONB;
```

### 5.4 — Frontend: Checkpoint Manager Hook

**File:** `frontend/src/hooks/useSessionCheckpoint.js` (new file)

```javascript
export function useSessionCheckpoint(sessionId, getCurrentState) {
  // Auto-checkpoint every 30 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      const state = getCurrentState();
      await api.checkpointSession({
        session_id: sessionId,
        current_question_id: state.currentQuestion?.id,
        current_question_index: state.questionIndex,
        timer_remaining_secs: state.timerRemaining,
        local_transcript: state.transcript,
      });
    }, 30_000);

    return () => clearInterval(interval);
  }, [sessionId]);

  // Save on tab close / navigation away
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      const state = getCurrentState();
      // Synchronous navigator.sendBeacon for beforeunload (fetch won't work)
      navigator.sendBeacon(
        `${import.meta.env.VITE_API_URL}/api/v1/session/checkpoint`,
        JSON.stringify({
          session_id: sessionId,
          current_question_index: state.questionIndex,
          timer_remaining_secs: state.timerRemaining,
          local_transcript: state.transcript,
        })
      );
      e.preventDefault();
      e.returnValue = "Interview in progress. Your progress is being saved.";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [sessionId]);
}
```

### 5.5 — Frontend: Session Recovery Flow

**File:** `frontend/src/pages/InterviewRoom.jsx`

On component mount, before starting fresh:

```jsx
useEffect(() => {
  const initSession = async () => {
    // Check if there's an active session being resumed
    const resumeSessionId = searchParams.get("resume") || sessionId;

    const resumeData = await api.resumeSession(resumeSessionId);
    if (resumeData?.status === "active") {
      // Show recovery modal
      setShowRecoveryModal(true);
      setRecoveryData(resumeData);
    } else {
      // Fresh start
      startNewSession();
    }
  };
  initSession();
}, []);
```

**New component:** `SessionRecoveryModal.jsx`

```jsx
// Shows when an interrupted session is detected:
<Modal>
  <h2>Resume Your Interview?</h2>
  <p>You were on Question {recoveryData.questions_answered + 1} of {recoveryData.num_questions}</p>
  <p>Round: {recoveryData.round_type} | Time remaining (approx): {formatTime(recoveryData.timer_remaining_secs)}</p>
  <Button onClick={resumeSession}>Continue Where I Left Off</Button>
  <Button variant="ghost" onClick={startFresh}>Start New Session</Button>
</Modal>
```

### 5.6 — Dashboard: Show "Resume" Button on Active Sessions

**File:** `frontend/src/pages/DashboardPage.jsx`

In the past sessions table, if a session has `status === "active"`:
- Show a "Resume Interview" button (amber color) instead of "View Report"
- Link to `/interview/{session_id}?resume=true`

---

## Phase 6 — Report Integration: Reflecting All New Signals

**Goal:** Every new signal collected in Phases 1-5 must surface in the Ultra-Report with specific, evidence-backed insights. The report becomes dramatically richer because it now has soft-skill scores, adaptive question data, company-specific analysis, and cross-session trend data.

### 6.1 — Enrich the Report Prompt with All New Data

**File:** `backend/prompts/report_prompt.py`

Update `build_core_analysis_prompt()` to include:

**New sections in prompt context:**

```python
# Soft skill signals per question:
soft_skills_block = ""
for i, q in enumerate(question_scores, 1):
    sm = q.get("scoring_meta", {})
    ds = q.get("dimension_scores", {})
    soft_skills_block += f"""
Q{i} Delivery Signals:
  - Communication Clarity: {ds.get('communication_clarity', 'N/A')}/10
  - Confidence: {ds.get('confidence_delivery', 'N/A')}/10
  - Answer Structure: {q.get('answer_structure', 'N/A')}
  - Filler words: {', '.join(sm.get('filler_words', [])) or 'none'}
  - Time used: {sm.get('duration_secs', 0)}s of {sm.get('time_limit_secs', 180)}s allowed
"""

# Cross-session trend context:
trend_block = ""
if context_bundle.get("past_reports"):
    past = context_bundle["past_reports"][-3:]  # last 3 sessions
    trend_block = "CROSS-SESSION TRENDS (compare this session against history):\n"
    for p in past:
        trend_block += f"  - {p['round_type']} ({p['date']}): {p['overall_score']}/10 — Weak: {', '.join(p.get('weak_areas', [])[:3])}\n"
    trend_block += "→ Identify if weak areas are improving, regressing, or stagnant.\n"

# Company-specific hiring bar block:
company_bar_block = ""
if context_bundle.get("target_company"):
    company_bar_block = f"\nHIRING BAR FOR {context_bundle['target_company'].upper()}:\n"
    company_bar_block += _get_company_hiring_bar(context_bundle["target_company"])
```

### 6.2 — New Report Sections

**File:** `backend/prompts/report_prompt.py`

Add to the core analysis JSON output:

```json
"soft_skills_analysis": {
    "overall_communication": <1-100>,
    "overall_confidence": <1-100>,
    "delivery_consistency": "<Consistent|Variable|Declined under pressure|Improved throughout>",
    "best_delivery_moment": "<Q{n}: specific observation>",
    "worst_delivery_moment": "<Q{n}: specific observation>",
    "filler_word_analysis": "<observation about filler words pattern>",
    "pacing_analysis": "<observation about time management across answers>"
},

"cross_session_trend": {
    "trend": "<Improving|Declining|Stagnant|First session>",
    "areas_improved": ["<topic>"],
    "areas_regressed": ["<topic>"],
    "areas_stagnant": ["<topic — same weak area appearing repeatedly>"],
    "recommended_focus": "<the single most important focus for next session>"
},

"company_fit_analysis": {
    "company": "<target company>",
    "hiring_bar_met": <true|false>,
    "bar_score": <1-100>,
    "strengths_for_company": ["<specific strength relevant to this company's culture/stack>"],
    "gaps_for_company": ["<specific gap for this company>"],
    "interview_specific_tips": ["<tip specific to this company's interview style>"]
}
```

### 6.3 — Update Report.jsx with New Sections

**File:** `frontend/src/pages/Report.jsx`

Add three new sections to the Ultra-Report:

1. **Soft Skills Breakdown Card** — shows 6-axis soft skill radar (Communication, Confidence, Structure, Pacing, Relevance, Depth). Uses existing `RadarChart.jsx` component.

2. **Cross-Session Progress Chart** — if past reports exist, shows a line chart of overall scores over time with trend annotation. Uses existing `AreaTimeline.jsx`.

3. **Company Fit Card** — shows target company's hiring bar score, a pass/fail indicator, company-specific strengths/gaps, and 3 interview tips specific to that company.

**File:** `frontend/src/components/SoftSkillsRadar.jsx` (new component) — 6-axis radar using Recharts, axes: Communication, Confidence, Structure, Pacing, Relevance, Example Quality.

**File:** `frontend/src/components/CompanyFitCard.jsx` (new component) — shows company logo area, bar score ring, strengths list, gaps list, tips.

---

## Phase 7 — Testing & Verification

**Goal:** Ensure every feature works end-to-end, edge cases are handled, and the system produces realistic, consistent results across different candidate profiles and round types.

### 7.1 — Backend Unit Tests

**File:** `backend/test_adaptive_engine.py`

Test the adaptive engine decision logic:

```python
def test_follow_up_triggered_on_low_score():
    """Verify that a score ≤5 triggers a follow-up, not a new topic."""

def test_known_weak_area_probed():
    """Verify that known_weak_areas from past sessions get probed when uncovered."""

def test_company_critical_topics_injected():
    """Verify that Amazon sessions probe Leadership Principles, Google probes Big-O."""

def test_topic_deduplication():
    """Verify that no topic appears twice in a session's question list."""

def test_adaptive_engine_fallback():
    """Verify that engine falls back gracefully when Groq is unavailable."""
```

**File:** `backend/test_scoring.py`

Test scoring calibration:

```python
def test_score_normalization_fresher_vs_senior():
    """A 7/10 raw score for a 1st-year student should normalize higher than for a 4th-year."""

def test_filler_word_penalty():
    """Scoring context with >5 filler words should reduce score by 1."""

def test_dimension_scores_sum_to_composite():
    """Weighted composite of dimension scores should match the overall score."""

def test_hr_round_communication_weighted_higher():
    """For HR rounds, communication_clarity should have higher weight in composite."""

def test_few_shot_examples_produce_consistent_scores():
    """Run few-shot golden examples through evaluate_answer() and verify ±1 tolerance."""
```

**File:** `backend/test_streaming.py`

Test SSE endpoint:

```python
def test_sse_endpoint_returns_event_stream():
    """Content-Type should be text/event-stream."""

def test_sse_sequence():
    """Events should arrive in order: feedback_chunk → evaluation_complete → next_question."""

def test_sse_session_complete_event():
    """Final question should emit session_complete instead of next_question."""
```

**File:** `backend/test_session_persistence.py`

Test checkpoint and recovery:

```python
def test_checkpoint_saves_question_index():
    """Checkpoint should persist current_question_index to DB."""

def test_resume_returns_correct_question():
    """Resume endpoint should return the question at saved index."""

def test_resume_completed_session_redirects():
    """Resuming a completed session should return report_url."""

def test_context_bundle_stored_in_session():
    """Session record should contain context_bundle after start."""
```

### 7.2 — Frontend Integration Tests

**File:** `frontend/src/tests/InterviewRoom.test.jsx`

```javascript
test("SSE feedback chunks render progressively", async () => {
  // Mock SSE stream, verify feedback text appears token by token
});

test("Session recovery modal shows on resume", async () => {
  // Mock active session in DB, verify modal appears with correct question number
});

test("Checkpoint sent on beforeunload", async () => {
  // Spy on navigator.sendBeacon, trigger beforeunload, verify payload
});

test("Next question from API replaces local state", async () => {
  // Verify no reference to sessionStorage questions array post-answer
});
```

### 7.3 — End-to-End Scenario Tests

Run complete interview sessions manually across all 4 combinations: round type × difficulty.

**Scenario A — Fresher, Technical (Easy)**
- Upload a 1st-year student resume with basic Python/HTML skills
- Start technical easy session, target company: TCS
- Answer 5 questions (mix of strong and weak answers)
- Verify: adaptive engine avoids repeating topics, follow-ups trigger on weak answers
- Verify: scoring is lenient (fresher curve applied)
- Verify: report shows "IT Services" company fit analysis

**Scenario B — Final Year, DSA (Hard)**
- Resume with 3 internships, competitive programming experience
- Target company: Google
- Complete DSA hard session
- Verify: questions progressively escalate difficulty
- Verify: coding evaluation includes time/space complexity
- Verify: company fit section mentions algorithmic efficiency expectations

**Scenario C — Mid-Level, HR (Medium)**
- Resume with 2 years of experience
- HR round, answer using poor STAR structure
- Verify: communication_clarity scores low (3-4/10)
- Verify: report soft skills section flags rambling
- Verify: study roadmap includes "Structured Communication" as Week 1 priority

**Scenario D — Session Interruption Recovery**
- Start any session, answer 3 questions
- Force close browser tab
- Reopen dashboard → see "Resume Interview" button
- Click resume → verify lands on Question 4 with correct timer

### 7.4 — Scoring Consistency Audit

Run the same question + answer pair through `evaluate_answer()` 5 times (LLM is non-deterministic). Verify:
- Score variance ≤ ±1 point across 5 runs (temperature=0.2 ensures consistency)
- Dimension scores correlate with composite (no contradictions)
- Filler word penalty applies consistently

### 7.5 — Streaming Latency Benchmark

Measure time-to-first-token for `/answer/stream`:
- Acceptable: < 800ms from request to first feedback chunk
- Measure end-to-end for next_question event: < 5s total (including adaptive question generation)
- Compare vs blocking `/answer`: should feel 60-70% faster to user even if total time is similar

### 7.6 — Cross-Session Trend Verification

Create a user with 3 past sessions (insert test data to Supabase). Verify:
- 4th session report shows cross-session trend section
- Known weak areas from past sessions appear in the adaptive engine's question selection
- Report correctly identifies "Stagnant" vs "Improving" trends

### 7.7 — Pre-Production Checklist

- [ ] All new DB columns exist in Supabase (run migration SQL)
- [ ] `context_bundle` JSONB column exists in `sessions` table
- [ ] `scoring_meta` and `dimension_scores` are stored in transcript entries
- [ ] SSE endpoint has correct CORS headers for cross-origin streaming
- [ ] `navigator.sendBeacon` checkpoint works (test in Chrome DevTools Network > WS tab)
- [ ] Adaptive engine never generates a question on an already-asked topic (run 10-question session, inspect transcript)
- [ ] Report.jsx renders gracefully when new sections have no data (null guards on all new fields)
- [ ] Streaming fallback: if SSE fails, InterviewRoom.jsx falls back to blocking `/answer` endpoint
- [ ] `.env` has all required keys: GROQ_API_KEY, SUPABASE_URL, SUPABASE_KEY, TAVILY_API_KEY

---

## File Change Summary

| File | Change Type | Phase |
|---|---|---|
| `backend/models.py` | Add ContextBundle, ScoringContext, CheckpointRequest | 1, 4, 5 |
| `backend/services/context_assembler.py` | NEW — full context assembly | 1 |
| `backend/services/adaptive_engine.py` | NEW — adaptive question decision tree | 2 |
| `backend/services/evaluator.py` | Major upgrade — 7-dimension scoring, ScoringContext | 4 |
| `backend/services/groq_service.py` | Add AsyncGroq, stream_chat() generator | 3 |
| `backend/prompts/interviewer_prompt.py` | Add portfolio, past performance, GitHub deep formatters | 1 |
| `backend/prompts/report_prompt.py` | Add soft skills, cross-session trend, company fit sections | 6 |
| `backend/prompts/scoring_examples.py` | NEW — few-shot calibration examples | 4 |
| `backend/routers/session.py` | Remove batch gen, adaptive /answer, /answer/stream, /checkpoint, /resume | 2, 3, 5 |
| `backend/routers/report.py` | Add /stream endpoint, enrich with new signals | 3, 6 |
| `backend/schema.sql` | Add 4 new columns to sessions | 5 |
| `frontend/src/hooks/useSSE.js` | NEW — SSE client hook | 3 |
| `frontend/src/hooks/useSessionCheckpoint.js` | NEW — auto-checkpoint + beforeunload | 5 |
| `frontend/src/pages/InterviewRoom.jsx` | Remove sessionStorage queue, SSE submission, scoring meta, recovery modal | 2, 3, 4, 5 |
| `frontend/src/pages/DashboardPage.jsx` | Show "Resume Interview" button on active sessions | 5 |
| `frontend/src/pages/Report.jsx` | Add 3 new sections: soft skills, trends, company fit | 6 |
| `frontend/src/components/SoftSkillsRadar.jsx` | NEW — 6-axis soft skills chart | 6 |
| `frontend/src/components/CompanyFitCard.jsx` | NEW — company hiring bar analysis | 6 |
| `frontend/src/components/SessionRecoveryModal.jsx` | NEW — recovery dialog | 5 |
| `frontend/src/lib/api.js` | Add checkpointSession(), resumeSession() | 5 |
| `backend/test_adaptive_engine.py` | NEW — unit tests | 7 |
| `backend/test_scoring.py` | NEW — scoring calibration tests | 7 |
| `backend/test_streaming.py` | NEW — SSE tests | 7 |
| `backend/test_session_persistence.py` | NEW — checkpoint/resume tests | 7 |
