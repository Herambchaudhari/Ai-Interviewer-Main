# AI Interviewer V2 — Master Improvement Plan
**Date:** 2026-04-30 | **Analyst:** Claude Code (Sonnet 4.6) | **Scope:** Full-stack + cost audit

---

## Executive Summary

After a complete audit of Supabase DB, ~9,400 lines of backend, ~4,000+ lines of frontend, all LLM prompts, all cost flows, and live production data — here is the ground truth across every layer.

| Area | Status | Priority |
|---|---|---|
| Question mix (20/50/30) | Quota system exists in DB but BROKEN in latest sessions | P0 |
| CS question bank | 125 questions in DB, never served in recent sessions | P0 |
| hire_signal always empty | LLM output truncation + setdefault bug | P0 |
| category_breakdown always empty | Normalization bug | P0 |
| Groq API cost | ~$0.07/session (5Q) growing to ~$0.13/session (15Q) | P1 |
| Tavily wasted on question generation | 3-6 calls per session, delivers news not questions | P1 |
| Context window in question gen | Grows linearly with conversation, costs $0.075 by Q15 | P1 |
| Max_tokens cap on Stage 1 | 4500 cap causes JSON truncation for 15Q sessions | P1 |
| Technical Knowledge Radar missing | Computed but never rendered in JSX | P1 |
| 6 redundant report sections | SWOT, legacy study recs, skill decay, etc. | P2 |
| Adaptive difficulty not real | ELO tracked but never feeds question selection | P2 |
| HR interviewer no structure | No STAR enforcement, wrong scoring weights | P2 |
| Frontend: 8 critical bugs | SSE partial JSON, MCQ double-submit, audio cleanup | P2 |

---

## Part 1: LLM Context Window — The Real Analysis

### 1.1 Groq Model Specs (April 2026)
- **Model:** `llama-3.3-70b-versatile`
- **Context window:** 128,000 tokens input
- **Max output:** 32,768 tokens
- **Pricing:** $0.59/M input tokens · $0.79/M output tokens
- **Free tier limits:** 6,000 TPM · 30 RPM — hit by 3 concurrent users
- **Speed:** 315 tokens/second (~18,900 TPM raw throughput)

> Sources: [Groq Pricing](https://groq.com/pricing) · [Groq Rate Limits](https://console.groq.com/docs/rate-limits) · [llama-3.3-70b Docs](https://console.groq.com/docs/model/llama-3.3-70b-versatile)

### 1.2 Is the Context Window a Problem?

**For report generation: NO.** The prompts are well-bounded:

| Stage | Input tokens | Output cap | Status |
|---|---|---|---|
| Stage 1 — Core Analysis | ~2,500 (5Q) · ~7,250 (15Q) | 4,500 | **OVERFLOW risk for 15Q** |
| Stage 2 — CV Audit | ~1,800 (5Q) · ~6,500 (15Q) | 4,500 | OK |
| Stage 3 — Communication | ~1,500 | 3,500 | OK |
| Stage 4 — Playbook | ~800 | 4,000 | OK |

The 128K window is never close to being exhausted for report generation. **The actual problem is the 4,500-token OUTPUT cap on Stage 1 for long sessions.**

### 1.3 The Stage 1 Overflow Bug — Why hire_signal is Always Empty

For a **15-question session**, Stage 1 needs to output:
```
per_question_analysis × 15:   ~3,000 tokens
hire_signal (5 sub-scores):    ~350 tokens
failure_patterns × 2-3:        ~500 tokens
strong/weak areas × 3 each:    ~650 tokens
category_breakdown × 4:        ~400 tokens
radar_scores + summary + grade: ~500 tokens
interview_tips × 3:            ~150 tokens
TOTAL NEEDED:                  ~5,550 tokens
MAX ALLOWED:                   4,500 tokens
OVERFLOW:                      1,050+ tokens
```

When the LLM hits the 4,500-token output cap mid-generation, the JSON output is truncated. The truncation almost always happens after `per_question_analysis` (which comes first in the prompt schema and is the largest section). Fields like `hire_signal`, `category_breakdown`, and `failure_patterns` — which appear later in the JSON schema — get cut.

**Even for 5 questions**, there's a secondary bug:
```python
# In _gen_core():
result.setdefault("hire_signal", _EMPTY_HIRE_SIGNAL)
```
`setdefault` only adds the key if it's MISSING. If the LLM returns `"hire_signal": {}` (an empty dict due to truncation), `setdefault` silently passes it through. The normalization code also passes it through since `{}` is a valid dict. **Result: empty hire_signal in every report.**

**Fix:**
```python
hs = result.get("hire_signal") or {}
if not isinstance(hs, dict) or len(hs) < 3:
    result["hire_signal"] = _EMPTY_HIRE_SIGNAL
# Same pattern for category_breakdown
```

Also: increase Stage 1 `max_tokens` from `4,500` to `6,000`, and restructure the output schema to put `hire_signal` BEFORE `per_question_analysis` so it's never truncated first.

### 1.4 Question Generation — The Context Growth Problem

The question generation prompt in `build_interviewer_prompt()` includes the full **conversation history** (last 10 exchanges). As the session progresses, this grows:

| Question | Prompt Input Size | Cost per call |
|---|---|---|
| Q1 | ~5,500 tokens | $0.0032 |
| Q5 | ~7,500 tokens | $0.0044 |
| Q10 | ~10,000 tokens | $0.0059 |
| Q15 | ~12,500 tokens | $0.0074 |
| **15Q Total (question gen only)** | **~126,000 tokens** | **$0.074** |

For a 5-question session this is fine. For a 15-question session, question generation alone costs $0.074 — more than the entire report generation.

**Root cause:** The full conversation history, full candidate profile, full GitHub/LinkedIn scrape, full company intelligence are all repeated in every question generation call. Nothing is summarized or compressed.

**Fix:** Cap conversation history at the last **4 exchanges** (not 10), and summarize older exchanges into a compact string: `"Earlier: Q1=4/10 (OOP gap), Q2=7/10 (good DBMS)"`.

---

## Part 2: Tavily — Cost Audit

### 2.1 Current Tavily Usage
```
Per session start (with target_company set):
  1. search_company_trends()           → 1-3 Tavily queries  (news for prompt)
  2. search_company_interview_questions() → 1-3 Tavily queries  (interview patterns)
Per report generation:
  3. search_company_trends()           → 1-3 Tavily queries  (market intel section)
Total per session: 3-9 Tavily queries
```

### 2.2 Tavily Pricing (2026)
- **Free tier:** 1,000 searches/month → covers ~111-333 sessions
- **Basic search:** 1 credit each · **Advanced search:** 2 credits each
- **Paid Researcher plan:** $30/month for ~3,750 searches
- **Startup plan:** $100/month for ~15,000 searches

> Sources: [Tavily Pricing](https://www.tavily.com/pricing) · [Tavily Docs](https://docs.tavily.com/documentation/api-credits) · [AI Search API Comparison](https://www.buildmvpfast.com/api-costs/ai-search)

### 2.3 The Core Problem: Tavily Doesn't Improve Questions

`search_company_interview_questions()` fetches news article snippets like:
```
- [Amazon Interview Tips 2025]: "Candidates report being asked about leadership..."
- [FAANG Hiring Trends]: "Companies are focusing on system design..."
```

This text is injected into the interviewer prompt as "company interview intelligence." But looking at actual production sessions — questions are still 100% resume-based because the LLM doesn't use this text to pick topics, it just generates whatever it wants.

**The static fallback is actually better:**
```python
_CS_FUNDAMENTALS_STATIC_FALLBACK = """
- OOP: Explain polymorphism vs inheritance. What is SOLID?...
- DBMS: Explain ACID properties. Difference between indexes...
"""
```

This is deterministic, free, and directly relevant. The Tavily-fetched news snippets are neither.

### 2.4 Recommendation: Remove Tavily from Interview Flow

| Use Case | Keep Tavily? | Alternative |
|---|---|---|
| Dashboard news feed (fetch_personalized_news) | ✅ Yes | None — this is the only valid use |
| Session start company intelligence | ❌ No | Use static fallback + question bank |
| Report market intelligence section | ❌ No | Remove the section entirely |
| Coding OA questions | ❌ No | Use question bank for DSA |
| MCQ topic intelligence | ❌ No | Use question bank cs_pillar tags |

**Savings:** ~$24-48/month on Tavily, removes 3-9 network calls from session start (reducing latency by 1-3 seconds).

---

## Part 3: Full Cost Model Per Session (Startup POV)

### Groq pricing: $0.59/M input · $0.79/M output

### 5-Question Session

| Step | Groq Calls | Input (tokens) | Output (tokens) | Cost |
|---|---|---|---|---|
| Session start + Q1 generation | 1 | 5,500 | 500 | $0.0036 |
| Q2-Q5 evaluation | 4 | 4 × 700 | 4 × 350 | $0.0028 |
| Q2-Q5 generation | 4 | 4 × 6,500 | 4 × 450 | $0.0168 |
| Report Stage 1 | 1 | 2,500 | 3,500 | $0.0043 |
| Report Stage 2 | 1 | 1,800 | 3,500 | $0.0039 |
| Report Stage 3 | 1 | 1,800 | 3,000 | $0.0035 |
| Report Stage 4 | 1 | 900 | 3,000 | $0.0030 |
| **Groq Subtotal** | **13** | | | **$0.038** |
| Tavily (session start) | 3-6 calls | — | — | $0.024 |
| Tavily (report) | 1-3 calls | — | — | $0.010 |
| **Tavily Subtotal** | | | | **$0.034** |
| **Total Per Session** | | | | **~$0.072** |

### 15-Question Session

| Step | Cost |
|---|---|
| Question generation (growing context) | $0.074 |
| Evaluations | $0.008 |
| Report (all 4 stages) | $0.013 |
| Tavily | $0.034 |
| **Total** | **~$0.129** |

### Scale Projections

| Monthly Sessions | Avg Cost/Session | Monthly Groq Cost | Monthly Tavily | Total |
|---|---|---|---|---|
| 100 | $0.072 | $3.80 | $3.40 | **$7.20** |
| 500 | $0.072 | $19.00 | $17.00 | **$36.00** |
| 1,000 | $0.072 | $38.00 | $34.00 | **$72.00** |
| 5,000 | $0.072 | $190.00 | $170.00 | **$360.00** |
| 10,000 | $0.072 | $380.00 | $340.00 | **$720.00** |

**Conclusion:** Cost is very manageable for a startup. The bottleneck isn't absolute cost — it's the 6,000 TPM free-tier rate limit (hit by 3 concurrent users).

### With Optimizations Applied

| Optimization | Savings Per Session | Notes |
|---|---|---|
| Remove Tavily from interview flow | $0.034 | Biggest win |
| Merge eval + next question (Phase 4a) | $0.008 | Save 4 separate LLM calls |
| Cap conversation history at 4 exchanges | $0.018 | For 10-15Q sessions |
| Use DB questions for 20% CS bucket | $0.004 | 0 LLM call for CS questions |
| Merge Report Stages 3+4 | $0.002 | 1 less LLM call |
| **Total potential savings** | **$0.066/session** | **~50% cost reduction** |
| **Cost after optimization** | **~$0.035/session** | 15Q sessions ~$0.063 |

---

## Part 4: Report Architecture — What's Actually Happening

### 4.1 The Transcript Is Sent 3× Redundantly

```
Stage 1 (Core):    _format_qa(question_scores)      → answer[:350] per Q
Stage 2 (CV Audit): _format_qa(question_scores)      → answer[:350] per Q (SAME DATA)
Stage 3 (Comm):    _format_qa_short(question_scores) → answer[:250] per Q (SAME DATA)
```

For 5 questions: transcript repeated 3 times = ~5,800 redundant tokens.
For 15 questions: ~17,400 redundant tokens (costs ~$0.010 extra).

The inconsistency risk is larger than the cost: Stages 1 and 3 can generate contradictory analyses of the same answers (Stage 1 calls Q2 "Satisfactory", Stage 3 calls it "confidence collapse") because the LLM re-interprets the same text independently.

### 4.2 Groq is NOT called for evaluation during report generation

Good news: report generation reads from the **stored transcript** in the session. It does NOT re-evaluate answers. The evaluation was already done during the interview via `evaluator.py`. This is correct and cost-efficient.

### 4.3 What Each Stage Actually Generates (and whether it works)

| Stage | Output Fields | Working? | Quality |
|---|---|---|---|
| Stage 1 Core | grade, hire_rec, summary, radar_scores, strong/weak areas, per_question, failure_patterns, **hire_signal** | Mostly ✓ except hire_signal | Good for grade/summary, vague for failure_patterns |
| Stage 2 CV Audit | cv_audit (per-claim honesty), study_roadmap, study_recs, mock_ready, not_ready | ✓ | Best section — specific and honest |
| Stage 3 Communication | six_axis_radar, communication_breakdown, bs_flag, pattern_groups, blind_spots, what_went_wrong | ✓ for radar, ✗ for bs_flag/blind_spots | six_axis works; bs_flag/blind_spots rarely populated |
| Stage 4 Playbook | swot, skills_to_work_on, 30_day_plan, auto_resources, follow_up_questions, next_blueprint | ✓ | 30-day plan and follow-up questions are genuinely useful |

---

## Part 5: Report Sections — Keep, Fix, Remove

### KEEP (High Value, Working)

| Section | Why Keep |
|---|---|
| **Score Header** (grade + hire_rec + summary) | Core value prop |
| **Technical Knowledge Radar** (radar_scores) | **CRITICAL — currently missing from JSX** |
| **Hire Signal** (technical_depth, communication, etc.) | **Currently broken (empty dict) — fix and show** |
| **Per-Question Scores bar chart** | Clear visual, always works |
| **Strong & Weak Areas** | Specific, evidence-backed |
| **Per-Question Deep Dive** (expandable) | Most-read section; answer text + feedback + audio |
| **Category Breakdown** | **Currently broken (always []) — fix and show** |
| **CV Honesty Audit** | Unique, high value — "did you defend your resume?" |
| **30-Day Sprint Plan** | Actionable, specific resources |
| **Skills to Work On** | Actionable |
| **Follow-Up Questions** | Practice value |
| **Failure Patterns** | Best "what went wrong" explanation |
| **Company Fit** | Useful when target_company set |
| **Preparation Checklist** | Actionable, persistent state |
| **Interview Integrity** | Proctoring verdict |
| **6-Axis Communication Radar** | Works, populated |
| **Delivery Consistency line chart** | Works when audio exists |

### FIX (Broken but Valuable)

| Section | Bug | Fix |
|---|---|---|
| **Technical Knowledge Radar** | `legacyRadarData` computed but never rendered in JSX | Add `<RadarChart data={legacyRadarData}>` — 8 lines of JSX |
| **Hire Signal** | `setdefault` doesn't override `{}`, Stage 1 truncation | Fix `_gen_core()` to check `len(hs) < 3`; increase max_tokens to 6000; add `HireSignalRadar` to JSX |
| **category_breakdown** | Always `[]` — not populated by LLM reliably | Use deterministic bucketing from `question_scores` by category (like MCQ does) instead of LLM |
| **What Went Wrong callout** | Empty if LLM skips it | Fallback to `weak_areas[0].what_was_missed` |

### REMOVE (Low Value, Redundant, or Empty)

| Section | Why Remove |
|---|---|
| **SWOT Analysis** | Duplicates Strong/Weak Areas in corporate-jargon. "Strengths: Clear communication" is Strong Areas rephrased. Zero additive value. |
| **Study Recommendations (legacy)** | 100% duplicate of "Skills to Work On". Two sections, same data. |
| **Adaptive Study Schedule** | Duplicates 30-Day Sprint Plan as a calendar view. Pick one; keep Sprint Plan. |
| **Repeated Offenders** | Needs 5+ sessions of data. Only 5 total sessions in DB. Always empty. Defer. |
| **Skill Decay** | Needs cross-session data. Always empty. Defer. |
| **Peer Comparison** | Meaningless with 5 sessions. "You're in the 80th percentile" of 5 people is misleading. Defer until 500+ sessions. |
| **B.S. Detector (bs_flag standalone section)** | LLM almost never flags it. When it does, surface it inline in per-question cards — not as a separate section. |
| **pattern_groups section** | Duplicates `failure_patterns` from Stage 1. Two LLM calls generating the same insight. Keep `failure_patterns`, remove `pattern_groups` section. |
| **Market Intelligence** | Raw Tavily text (800 chars). Not rendered properly. Remove the whole `market_intel` payload from report. Also removes one Tavily call. |

---

## Part 6: Proposed Report Section Order

```
┌─────────────────────────────────────────────────────────────┐
│ SECTION 1: Score Header                                      │
│   Grade · Hire Recommendation · Score Ring                  │
│   Improvement Delta (vs last session)                       │
│   4-line summary                                            │
├─────────────────────────────────────────────────────────────┤
│ SECTION 2: What Went Wrong (callout banner — always shown)  │
├─────────────────────────────────────────────────────────────┤
│ SECTION 3: Failure Patterns (promoted from bottom)          │
│   "Here are the 2 patterns we found in your answers"        │
├─────────────────────────────────────────────────────────────┤
│ SECTION 4: Two-Radar Grid                                   │
│   Left: Technical Knowledge Radar (OOP/DSA/DBMS/OS/CN)  ← MISSING, ADD THIS
│   Right: Hire Signal Radar (technical depth / culture fit) ← BROKEN, FIX THIS
├─────────────────────────────────────────────────────────────┤
│ SECTION 5: Per-Question Scores (bar chart)                  │
│   + Category Breakdown (bar chart)                          │
├─────────────────────────────────────────────────────────────┤
│ SECTION 6: Strong & Weak Areas (2-column)                   │
├─────────────────────────────────────────────────────────────┤
│ SECTION 7: Per-Question Deep Dive (expandable cards)        │
│   Answer text · feedback · key insight · audio playback     │
├─────────────────────────────────────────────────────────────┤
│ SECTION 8: Communication Radar + Delivery line chart        │
├─────────────────────────────────────────────────────────────┤
│ SECTION 9: CV Honesty Audit                                 │
├─────────────────────────────────────────────────────────────┤
│ SECTION 10: Company Fit (if target_company set)             │
├─────────────────────────────────────────────────────────────┤
│ SECTION 11: 30-Day Sprint Plan                              │
│ SECTION 12: Skills to Work On                               │
│ SECTION 13: Follow-Up Questions                             │
│ SECTION 14: Preparation Checklist                           │
├─────────────────────────────────────────────────────────────┤
│ SECTION 15: Interview Integrity (proctoring, at bottom)     │
├─────────────────────────────────────────────────────────────┤
│ DEFERRED (show only when data exists):                      │
│   Peer Comparison (needs 500+ sessions)                     │
│   Repeated Offenders (needs 5+ user sessions)              │
│   Skill Decay (needs 5+ user sessions)                     │
└─────────────────────────────────────────────────────────────┘

REMOVED ENTIRELY:
  SWOT · Study Recommendations (legacy) · Adaptive Study Schedule
  bs_flag section · pattern_groups section · Market Intelligence
```

---

## Part 7: Full Implementation Sprints

### Sprint 1 (Days 1-2): Fix the Broken Core — Report Bugs

**Files:** `backend/services/groq_service.py`, `backend/routers/report.py`, `frontend/src/pages/ReportPage.jsx`

**1a. Fix hire_signal normalization** (30 min)
```python
# In _gen_core() in groq_service.py, replace:
result.setdefault("hire_signal", _EMPTY_HIRE_SIGNAL)
# With:
hs = result.get("hire_signal") or {}
if not isinstance(hs, dict) or len(hs) < 3:
    result["hire_signal"] = _EMPTY_HIRE_SIGNAL
```

**1b. Increase Stage 1 max_tokens** (5 min)
```python
# In _gen_core() in groq_service.py:
content = await _achat([{"role": "user", "content": prompt}], temperature=0.3, max_tokens=6000)
# Was: max_tokens=4500
```

**1c. Reorder Stage 1 JSON schema — hire_signal FIRST** (15 min)
In `build_core_analysis_prompt()`, move `hire_signal` block BEFORE `per_question_analysis` in the JSON schema. When the LLM hits token limits, it truncates from the END.

**1d. Fix category_breakdown** — compute deterministically (20 min)
Instead of relying on the LLM (unreliable), build it from the existing `question_scores` data the same way MCQ does:
```python
# In _generate_report_sse() in report.py:
if round_type != "mcq_practice":
    category_breakdown = _build_category_breakdown(question_scores)
    # deterministic: group question_scores by category, avg scores per group
```

**1e. Add Technical Knowledge Radar to JSX** (10 min)
```jsx
// In ReportPage.jsx, after the score header, add:
{legacyRadarData.length > 0 && (
  <SectionCard icon={<Brain size={16}/>} title="Technical Knowledge Breakdown" color="#7c3aed">
    <ResponsiveContainer width="100%" height={260}>
      <RadarChart data={legacyRadarData}>
        <PolarGrid stroke="rgba(255,255,255,0.08)" />
        <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 10 }} />
        <Radar dataKey="A" stroke="#7c3aed" fill="#7c3aed" fillOpacity={0.2} />
        <Tooltip formatter={(v) => [`${v}/100`]} />
      </RadarChart>
    </ResponsiveContainer>
  </SectionCard>
)}
```

**1f. Render HireSignalRadar** (10 min)
`HireSignalRadar` is imported but never used. Call it after fixing 1a.

**1g. Remove 6 redundant sections from JSX** (30 min)
Delete: SWOT, Study Recommendations (legacy), Adaptive Study Schedule, standalone bs_flag section, pattern_groups section, Market Intelligence rendering.

---

### Sprint 2 (Days 3-4): Fix the Question Mix

**Files:** `backend/routers/session.py`, `backend/services/db_service.py`, `backend/services/adaptive_engine.py`

**2a. Rewrite quota computation in `/start`** (3 hrs)
```python
def _compute_question_quotas(num_questions: int, round_type: str) -> dict:
    if round_type in ("hr", "system_design"):
        resume_q = max(1, round(num_questions * 0.30))
        live_q = num_questions - resume_q
        return {"db": 0, "live": live_q, "resume": resume_q}
    else:  # technical / dsa
        db_q = max(1, round(num_questions * 0.20))
        resume_q = max(1, round(num_questions * 0.30))
        live_q = num_questions - db_q - resume_q
        return {"db": db_q, "live": live_q, "resume": resume_q}
```

**2b. Add `fetch_db_question()` to `db_service.py`** (2 hrs)
Query `question_bank` by `cs_pillar`, avoiding already-served pillars, matched to candidate ELO band.

**2c. Wire adaptive_engine to quota counters** (3 hrs)
At the top of `generate_adaptive_next_question()`:
1. Check if `db_counter < db_quota` → serve from question_bank (free, no Groq)
2. Check if `resume_counter < resume_quota` → force resume-based question directive
3. Otherwise → generate live role-based question

---

### Sprint 3 (Days 5-6): Cut Groq Costs ~50%

**Files:** `backend/services/evaluator.py`, `backend/routers/session.py`, `backend/prompts/interviewer_prompt.py`

**3a. Remove Tavily from session start flow** (1 hr)
In `context_assembler.py`:
- Remove `search_company_interview_questions()` call
- Remove `search_company_coding_questions()` call
- Remove `search_company_mcq_topics()` call
- Keep `search_company_trends()` ONLY for dashboard news feed

Replace with static intelligence already in `web_researcher.py`:
```python
context["company_questions_context"] = _CS_FUNDAMENTALS_STATIC_FALLBACK
```

**3b. Cap conversation history at 4 exchanges** (30 min)
In `build_interviewer_prompt()`, change `last_n = 10` to `last_n = 4`.
Add a "history summary" block: `"Earlier performance: Q1=4/10 (OOP gap), Q2=7/10 (DBMS good)..."` computed from `question_scores`.

**3c. Merge eval + next_question into one Groq call** (4 hrs)
Create `evaluate_and_generate_next()` in `evaluator.py` that returns:
```json
{
  "evaluation": { "score": 7, "feedback": "...", ... },
  "next_question": { "question_text": "...", "topic": "...", ... }
}
```
Use when: it's NOT a DB question turn AND NOT the last question.
Skip when: next question is already pre-determined (DB pull) or session ending.

**3d. Use pre-written DB follow-ups** (2 hrs)
When answering a DB question, use `follow_up_shallow/wrong/strong` columns instead of calling Groq. Zero cost follow-up.

**3e. Remove market_intel from report** (30 min)
In `report.py`: remove `search_company_trends()` call during report generation. Remove `market_intel` from the `report_payload`. This saves 1 Tavily call + clears the ugly raw-text section from the report.

---

### Sprint 4 (Days 7-8): Fix DB Question Bank

**Files:** SQL migrations, `backend/routers/session.py` (seeding)

**4a. Spread difficulty across all 125 questions** (1 hr)
```sql
-- Assign difficulty bands by subtopic
UPDATE question_bank SET difficulty = 1, elo_difficulty = 800
  WHERE subtopic ILIKE '%Intro%' OR subtopic ILIKE '%Basics%';
UPDATE question_bank SET difficulty = 3, elo_difficulty = 1100
  WHERE subtopic ILIKE '%Sync%' OR subtopic ILIKE '%Transaction%'
     OR subtopic ILIKE '%TCP%' OR subtopic ILIKE '%Polymorphism%';
UPDATE question_bank SET difficulty = 5, elo_difficulty = 1400
  WHERE subtopic ILIKE '%Advanced%' OR subtopic ILIKE '%Design%'
     OR topic ILIKE '%Deadlock%' OR topic ILIKE '%Concurrency%';
```

**4b. Add System Design questions to question_bank** (3 hrs)
Add 25 questions with `cs_pillar = 'System Design'`, difficulty bands 3-5.

**4c. Track times_served** (30 min)
After `fetch_db_question()` selects a row, increment `times_served`:
```python
supabase.table("question_bank").update({"times_served": q["times_served"] + 1}).eq("id", q["id"]).execute()
```

---

### Sprint 5 (Days 9-10): HR Interviewer + Frontend Bugs

**5a. STAR category rotation in HR prompt** (2 hrs)
**5b. Fix HR dimension weights** (1 hr)
**5c. Fix `useSSE.js` stream incomplete sentinel** (2 hrs)
**5d. Fix MCQ double-submit race condition** (1 hr)
**5e. Fix ReportPage auto-retry race condition** (1 hr)
**5f. Fix audio recorder chunk reset on error** (1 hr)

---

## Part 8: Database Changes Needed

```sql
-- 1. Expand cs_pillar constraint for System Design
ALTER TABLE question_bank DROP CONSTRAINT IF EXISTS question_bank_cs_pillar_check;
ALTER TABLE question_bank ADD CONSTRAINT question_bank_cs_pillar_check
  CHECK (cs_pillar = ANY (ARRAY['OS','DBMS','CN','OOP','DSA','System Design']));

-- 2. Add user-level question deduplication
CREATE TABLE IF NOT EXISTS question_seen (
  user_id TEXT NOT NULL,
  question_id UUID REFERENCES question_bank(id),
  seen_at TIMESTAMPTZ DEFAULT now(),
  score_received INTEGER,
  PRIMARY KEY (user_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_question_seen_user ON question_seen(user_id);

-- 3. Add Jina scrape cache to external_links
ALTER TABLE external_links ADD COLUMN IF NOT EXISTS cached_scrape JSONB DEFAULT '{}';
ALTER TABLE external_links ADD COLUMN IF NOT EXISTS scrape_cached_at TIMESTAMPTZ;

-- 4. Difficulty spread migration (see Sprint 4a)
-- Run UPDATE statements in sequence by subtopic
```

---

## Part 9: Startup Scaling Strategy

### Now → 500 sessions/month
- Current infra is fine. Groq free tier won't work at scale — use paid API key immediately.
- After Sprint 3 (cost reduction): ~$17.50/month at 500 sessions.
- Tavily stays on free tier (1,000 searches) if only used for dashboard news.
- No infra changes needed.

### 500 → 5,000 sessions/month
- **Groq:** Move to multi-key rotation (already implemented in `api_manager.py`).
- **Tavily:** Upgrade to Researcher plan ($30/month) for dashboard news feed.
- **Supabase:** Add indexes — `sessions(user_id, status)`, `reports(session_id)`, `question_seen(user_id)`.
- **Context caching:** Persist Jina scrape results to `external_links.cached_scrape` with 24h TTL. Current in-memory cache is lost on restart.
- **Report generation:** Move to background job (Supabase Edge Function + webhook) so HTTP request returns immediately.

### 5,000 → 50,000 sessions/month
- **ELO-based IRT model:** Replace flat difficulty bands with proper Item Response Theory using the `discrimination` column already in `question_bank`.
- **LLM question bank expansion:** Use Claude/GPT-4o to generate 2,000+ questions, human-reviewed before seeding. Break down by `role_tags` and `company_tags`.
- **Collaborative filtering:** Users with similar ELO profiles see questions that challenged similar users most.
- **Redis:** Session cache + in-flight evaluation results (replace in-memory Tavily cache).
- **Load balancer:** FastAPI behind Nginx/Traefik, multiple worker processes.
- **Analytics pipeline:** Export `question_bank.times_served` and `avg_score` to identify and retire low-discrimination questions.

---

## Part 10: What NOT to Build Yet

| Feature | Why Defer |
|---|---|
| Spaced repetition full system | Needs 10+ user sessions to be meaningful. Only 5 sessions in DB. |
| LinkedIn scraping | Fragile (breaks when LinkedIn changes structure), high latency, adds 1-5s to session start. Replace with manual profile field. |
| Code runner (Judge0) | DSA round is niche. Fix the core Technical interviewer first. |
| PDF export | Nice-to-have. Browser print is sufficient. |
| Share links | `reports.share_enabled` column missing from DB — non-functional. Fix DB first. |
| Peer comparison UI | Meaningless with <500 sessions. Add when data exists. |
| Market intelligence | Tavily news snippets in a report section. No user value. Remove entirely. |

---

## Appendix: File-Level Change Map

| Change | File | Line/Function |
|---|---|---|
| Fix hire_signal setdefault | `services/groq_service.py` | `_gen_core()` ~L1395 |
| Increase Stage 1 max_tokens 4500→6000 | `services/groq_service.py` | `_gen_core()` ~L1373 |
| Reorder hire_signal before per_question in schema | `prompts/report_prompt.py` | `build_core_analysis_prompt()` |
| Fix category_breakdown (deterministic) | `routers/report.py` | `_generate_report_sse()` ~L919 |
| Add Technical Radar JSX | `frontend/src/pages/ReportPage.jsx` | After score header |
| Call HireSignalRadar (imported, unused) | `frontend/src/pages/ReportPage.jsx` | Near six_axis section |
| Remove SWOT + legacy recs + 5 other sections | `frontend/src/pages/ReportPage.jsx` | Multiple locations |
| Reorder sections | `frontend/src/pages/ReportPage.jsx` | Full JSX reorder |
| Quota computation | `routers/session.py` | `/start` endpoint |
| fetch_db_question() | `services/db_service.py` | New function |
| Wire quota counters in adaptive engine | `services/adaptive_engine.py` | `generate_adaptive_next_question()` |
| Remove Tavily from session start | `services/context_assembler.py` | Step 6 block ~L174 |
| Cap conversation history at 4 | `prompts/interviewer_prompt.py` | `_fmt_history()` |
| evaluate_and_generate_next() | `services/evaluator.py` | New function |
| Pre-written follow-ups from DB | `routers/session.py` | `/answer` endpoint |
| Remove market_intel from report | `routers/report.py` | `_generate_report_sse()` ~L859 |
| Difficulty spread SQL | New migration file | `migrations/013_question_bank_difficulty.sql` |
| Add question_seen table | New migration file | `migrations/014_question_seen.sql` |
| Add external_links scrape cache | New migration file | `migrations/015_scrape_cache.sql` |
| Fix useSSE incomplete sentinel | `frontend/src/hooks/useSSE.js` | ~L70 read loop |
| Fix MCQ double-submit | `frontend/src/pages/InterviewRoom.jsx` | `handleMCQSubmit()` |
| Fix auto-retry race condition | `frontend/src/pages/ReportPage.jsx` | ~L611 |
