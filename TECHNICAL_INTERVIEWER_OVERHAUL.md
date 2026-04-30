# Technical Interviewer: Complete Architectural Overhaul Plan

> Generated: 2026-04-21 | Status: Pending Review | Author: Architecture Analysis Session

---

## Executive Summary of Current Issues

After deep-diving the codebase, here's the **exact problem inventory**:

| Problem | Root Cause | Location |
|---|---|---|
| 2 Groq calls per every answer | `evaluate_answer()` + `generate_next_question()` called sequentially | `session.py:answer` |
| Adaptive engine isn't truly adaptive | No difficulty score tracking — just a decision tree with hardcoded topic injection | `adaptive_engine.py` |
| Difficulty doesn't actually change | LLM is told a difficulty string but nothing tracks/updates it across answers | `interviewer.py:generate_next_question()` |
| 50/50 resume-to-CS split when you want 70/30 | Hardcoded in the system prompt | `interviewer_prompt.py:build_interviewer_prompt()` |
| No company/OS/DBMS/CN tags on questions | Output JSON has `topic` only (1-4 words) | `interviewer_prompt.py` output schema |
| Follow-ups only on weak answers (score ≤ 5) | `adaptive_engine.py` Decision 1 only triggers on low scores | `adaptive_engine.py:_decide_next()` |
| Tavily result can go stale mid-session | Called once at session start, never refreshed | `context_assembler.py` |
| No seed question bank | Everything is LLM-generated from scratch each time | No `questions` table in schema |
| Report doesn't show question tags | Tags not persisted in transcript entries | `session.py:answer` transcript schema |

---

## Phase 1: True Adaptive Engine with ELO-Style Difficulty Tracking

### Current State
The engine runs after **every** answer but it's not truly adaptive. It selects questions via a priority decision tree (follow-up → weak probe → company injection → default). The `difficulty_level` string passed to the LLM is static — set once at session start based on job level (fresher=easy, mid=medium, senior=hard) and **never updated**. There is no numerical ability tracking.

### What to Build: Multi-Dimensional ELO Ability Model

Don't implement a single scalar score. Track **6 separate ability dimensions** that map directly to your 7 existing evaluation axes:

```python
# services/ability_tracker.py — NEW FILE
DIMENSIONS = [
    "technical_accuracy",   # CS core + role fundamentals
    "depth_completeness",   # How deep they go
    "communication_clarity",# How clearly they explain
    "confidence_delivery",  # Composure under pressure
    "example_quality",      # Real-world grounding
    "structure",            # Organized thought
]

@dataclass
class AbilityVector:
    scores: dict[str, float]  # {dimension: elo_rating}, initialized to 1200
    answered_count: int = 0

    def update(self, dimension_scores: dict[str, float], question_difficulty: float):
        """One ELO update step per answer."""
        for dim, raw_score in dimension_scores.items():
            if dim not in self.scores:
                continue
            # Normalize raw score (0-10) to win probability (0-1)
            performance = raw_score / 10.0
            expected = 1 / (1 + 10 ** ((question_difficulty - self.scores[dim]) / 400))
            k_factor = 32 if self.answered_count < 5 else 16  # Higher K early
            self.scores[dim] += k_factor * (performance - expected)
        self.answered_count += 1

    @property
    def weakest_dimension(self) -> str:
        return min(self.scores, key=self.scores.get)

    @property
    def overall_ability(self) -> float:
        return sum(self.scores.values()) / len(self.scores)

    def to_difficulty_label(self) -> str:
        ability = self.overall_ability
        if ability < 1100: return "easy"
        elif ability < 1300: return "medium"
        else: return "hard"
```

**Every question's `difficulty_level` maps to a numeric ELO target:**
```python
DIFFICULTY_ELO = {"easy": 1000, "medium": 1200, "hard": 1400}
```

### The "Every 2 Answers" Cadence

```python
# In adaptive_engine.py — refactored _decide_next()
async def _decide_next(session: dict, last_score: float, eval_result: dict) -> dict:
    answered_count = len(session["transcript"])
    ability: AbilityVector = AbilityVector.from_session(session)

    # Update ability vector with this answer's dimension scores
    ability.update(
        dimension_scores=eval_result.get("dimension_scores", {}),
        question_difficulty=DIFFICULTY_ELO[last_question["difficulty_level"]]
    )

    # --- EVERY ANSWER: Follow-up on weak answers (unchanged) ---
    if last_score <= 5 and not last_q_is_follow_up:
        return await generate_follow_up(...)

    # --- EVERY 2 ANSWERS: Recalibrate difficulty ---
    if answered_count % 2 == 0:
        new_difficulty = ability.to_difficulty_label()
        # Store updated ability back to session
        await _save_ability_vector(session_id, ability)

        weakest_dim = ability.weakest_dimension
        return await generate_next_question(
            profile=profile,
            difficulty=new_difficulty,           # ← UPDATED
            target_dimension=weakest_dim,         # ← Force weakest dimension
            conversation_history=conv_history,
            asked_topics=asked_topics,
        )

    # --- ODD ANSWERS: Standard adaptive next ---
    return await generate_next_question(
        profile=profile,
        difficulty=ability.to_difficulty_label(),  # Still use current ability
        conversation_history=conv_history,
        asked_topics=asked_topics,
    )
```

Store `ability_vector: JSONB` in the `sessions` table (migration needed).

---

## Phase 2: Reduce Groq API Calls — The Dual-Fetch Strategy

### Current: 2 calls per answer
`evaluate_answer()` (1 call) → `generate_next_question()` (1 call) = **2 calls**

### Option A: Pre-generate 2 questions at a time (Recommended)

At session start and at every **even** answer, pre-generate the next 2 questions and buffer them. On odd answers, serve from the buffer (0 LLM calls for question generation). Only call for question generation on even answers.

```
Answer 1: evaluate (1 call) + generate Q2+Q3 (1 call) → serve Q2
Answer 2: evaluate (1 call) → serve Q3 from buffer (0 calls for gen)
Answer 3: evaluate (1 call) + generate Q4+Q5 (1 call) → serve Q4
Answer 4: evaluate (1 call) → serve Q5 from buffer
```

**Result: 1.5 calls/answer avg** (down from 2.0) — 25% reduction.

**Tradeoff**: Pre-generated Q3 doesn't know how the candidate answered Q2. Partially stale. Acceptable because the ability vector update still applies — Q4 will be correctly calibrated based on both Q2+Q3 answers.

```python
# session.py — modified answer handler
async def submit_answer(...):
    answered_count = len(session["transcript"])

    # Always evaluate (1 call)
    eval_result = await evaluate_answer(...)

    # Check buffer first
    question_buffer = session.get("question_buffer", [])

    if question_buffer:
        next_q = question_buffer.pop(0)
        await _save_session(session_id, {"question_buffer": question_buffer})
    else:
        # Generate 2 questions at once
        next_questions = await generate_next_two_questions(
            profile=profile,
            ability=ability_vector,
            conversation_history=conv_history,
            asked_topics=asked_topics,
        )
        next_q = next_questions[0]
        buffer = next_questions[1:] if len(next_questions) > 1 else []
        await _save_session(session_id, {"question_buffer": buffer})

    return {eval_result, next_q}
```

**`generate_next_two_questions()` in interviewer.py:**
```python
async def generate_next_two_questions(profile, ability, ...):
    """Ask LLM to generate 2 questions in one call."""
    prompt = build_multi_question_prompt(profile, ability, n=2)
    response = await _achat(system=system_prompt, user=prompt)
    # Parse as JSON array: [{q1}, {q2}]
    return parse_question_array(response)
```

Output schema changes to an array:
```json
[
  {
    "id": "q_abc123",
    "text": "...",
    "type": "technical",
    "topic": "Memory Management",
    "difficulty_level": "medium",
    "tags": { "cs_pillar": "OS", "company_tags": ["Google"], "is_resume_based": false }
  },
  {
    "id": "q_def456",
    "text": "...",
    "type": "technical",
    "topic": "DBMS Indexing",
    "difficulty_level": "medium",
    "tags": { "cs_pillar": "DBMS", "company_tags": ["Amazon"], "is_resume_based": true }
  }
]
```

### Option B: Combine eval + next question in one call
Single LLM prompt that evaluates the answer AND generates the next question. Saves 1 full call but makes the prompt complex and evaluation quality may degrade.

**Not recommended** — keeping evaluation clean and fast matters for scoring accuracy.

### Option C: Cached question bank (future state)
Once you seed the DB with questions, 60-70% of questions can be served from DB without any LLM call. LLM only generates resume-specific and company-specific questions. This is the **endgame** that reduces calls by ~70%.

---

## Phase 3: Question Tagging System Overhaul

### New Tag Schema

Every question — whether LLM-generated or DB-served — gets a structured `tags` object:

```json
{
  "id": "q_abc123",
  "text": "Explain how InnoDB handles deadlock detection compared to MyISAM.",
  "type": "technical",
  "topic": "DBMS Indexing",
  "difficulty_level": "medium",
  "time_limit_secs": 180,
  "tags": {
    "cs_pillar": "DBMS",
    "subtopic": "Transaction Isolation",
    "company_tags": ["Amazon", "Microsoft"],
    "role_tags": ["Backend", "Full Stack"],
    "source": "llm_grounded",
    "authenticity_score": 0.85,
    "is_resume_based": true,
    "resume_claim_referenced": "Built e-commerce platform using MySQL"
  },
  "expected_concepts": ["MVCC", "row-level locking", "phantom reads"],
  "follow_ups": {
    "if_shallow": "What is MVCC and how does InnoDB implement it?",
    "if_wrong": "Let's revisit — what's the difference between a lock and a latch in a DBMS?",
    "if_strong": "How would your answer change for a write-heavy workload with 10K concurrent transactions?"
  }
}
```

### CS Pillar Auto-Tagging (Deterministic Validator)

```python
# services/question_tagger.py — NEW FILE

CS_PILLARS = {
    "OS": ["process", "thread", "scheduling", "memory management", "paging", "deadlock",
           "semaphore", "mutex", "context switch", "virtual memory", "kernel", "ipc",
           "system call", "fork", "exec", "zombie", "orphan", "cache coherence"],
    "DBMS": ["sql", "nosql", "acid", "transaction", "normalization", "index", "b-tree",
             "query optimization", "join", "foreign key", "sharding", "replication",
             "mvcc", "isolation level", "stored procedure", "trigger", "deadlock"],
    "CN": ["tcp", "udp", "http", "https", "dns", "ip", "osi", "socket", "tls", "ssl",
           "routing", "subnet", "nat", "load balancer", "cdn", "websocket", "rest", "grpc"],
    "OOP": ["class", "object", "inheritance", "polymorphism", "encapsulation", "abstraction",
            "solid", "design pattern", "interface", "abstract class", "overloading", "overriding"],
    "System Design": ["scalability", "availability", "consistency", "cap theorem", "microservices",
                      "message queue", "kafka", "redis", "elasticsearch", "architecture"],
}

def tag_cs_pillar(question_text: str) -> str | None:
    text_lower = question_text.lower()
    scores = {}
    for pillar, keywords in CS_PILLARS.items():
        score = sum(1 for kw in keywords if kw in text_lower)
        if score > 0:
            scores[pillar] = score
    return max(scores, key=scores.get) if scores else None
```

**Mandate in system prompt** — always tag DBMS, OS, CN when relevant. LLM generates the tag in JSON and the tagger validates/overrides it.

### Frontend Tag Display

Tags appear as colored pills below each question:

```
[DBMS] [Amazon] [Backend] [Medium] [Resume-Based]
```

And in the report: each transcript entry shows its tags, enabling filtering (e.g., "Show me all OS questions I was weak on").

---

## Phase 4: System Prompt Overhaul

### The 70/30 Resume-to-CS Split

**Current prompt (wrong):**
```
50% CORE CS AND ROLE FUNDAMENTALS
50% PROJECT AND RESUME DEEP-DIVES
```

**New prompt (correct):**
```
QUESTION DISTRIBUTION (STRICT - enforce across the full interview):
  ■ 70% RESUME & PROJECT DEEP-DIVES (7 out of every 10 questions):
    - Reference candidate's ACTUAL projects by name
    - Probe specific tech choices they made ("You used Redis — why not Memcached?")
    - Verify claims on their resume ("You say you built X — walk me through Y")
    - Expose gaps between claimed and demonstrated knowledge
    - Cover language internals of their listed languages

  ■ 30% CS FUNDAMENTALS (3 out of every 10 questions):
    - MANDATORY: Cover at least 1 DBMS question per session
    - MANDATORY: Cover at least 1 OS question per session
    - MANDATORY: Cover at least 1 CN question per session
    - These MUST be tagged with cs_pillar in the output
    - Select fundamentals relevant to their target role
```

### Updated Output Schema in Prompt

```
OUTPUT FORMAT — UPDATED (MANDATORY):
{
  "id": "q_<6 chars>",
  "text": "<full question>",
  "type": "technical|behavioural|system_design|coding",
  "topic": "<1-4 word topic>",
  "difficulty_level": "easy|medium|hard",
  "time_limit_secs": <int>,
  "expected_concepts": ["<c1>", "<c2>", "<c3>"],
  "tags": {
    "cs_pillar": "<OS|DBMS|CN|OOP|System Design|null>",
    "company_tags": ["<co1>", "<co2>"],
    "is_resume_based": <bool>,
    "resume_claim_referenced": "<claim or null>"
  },
  "follow_ups": {
    "if_shallow": "<question to use if answer is vague/incomplete>",
    "if_wrong": "<corrective probe if answer is incorrect>",
    "if_strong": "<harder escalation if answer is excellent>"
  }
}
```

### Adaptive Follow-Up Decision in Engine

```python
# adaptive_engine.py — enhanced follow-up logic
def _decide_followup_type(score: float, q_obj: dict) -> str | None:
    follow_ups = q_obj.get("follow_ups", {})
    if score < 4:
        return follow_ups.get("if_wrong")
    elif score < 7:
        return follow_ups.get("if_shallow")
    elif score >= 9 and follow_ups.get("if_strong"):
        return follow_ups.get("if_strong")  # ← NEW: Follow up on EXCELLENT answers too
    return None
```

**Key missing piece**: Following up on excellent answers to escalate difficulty is just as important as following up on weak ones. The current system only probes weakness.

---

## Phase 5: Question Bank Seeding Strategy

### Database Schema

```sql
CREATE TABLE question_bank (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    text TEXT NOT NULL,
    round_type TEXT NOT NULL,           -- 'dsa' | 'technical' | 'behavioral' | 'system_design'
    difficulty INT NOT NULL,            -- 1 (easy) to 5 (hard), IRT-compatible
    elo_difficulty FLOAT DEFAULT 1200,  -- ELO-calibrated, updated from session data
    discrimination FLOAT DEFAULT 1.0,   -- How well it differentiates ability levels
    topic TEXT NOT NULL,
    subtopic TEXT,
    cs_pillar TEXT,                     -- 'OS' | 'DBMS' | 'CN' | 'OOP' | null
    company_tags TEXT[] DEFAULT '{}',
    role_tags TEXT[] DEFAULT '{}',
    source TEXT NOT NULL,               -- 'leetcode' | 'curated' | 'glassdoor' | 'llm_generated'
    authenticity_score FLOAT DEFAULT 1.0,
    times_served INT DEFAULT 0,
    avg_score FLOAT,
    follow_up_shallow TEXT,
    follow_up_wrong TEXT,
    follow_up_strong TEXT,
    expected_concepts JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_qbank_round_type ON question_bank(round_type);
CREATE INDEX idx_qbank_cs_pillar ON question_bank(cs_pillar);
CREATE INDEX idx_qbank_company_tags ON question_bank USING GIN(company_tags);
CREATE INDEX idx_qbank_difficulty ON question_bank(elo_difficulty);
```

### What to Seed and How

#### Tier 1 — Seed Immediately From Public Sources

**DSA questions (~250 problems):**
Use GitHub mirrors of LeetCode company tags:
- `snehasishroy/leetcode-companywise-interview-questions` (updated Feb 2026)
- `liquidslr/interview-company-wise-problems` (updated June 2025)

These have JSON with: problem ID, title, difficulty, company, topic tags. Import directly via migration script.

**CS Fundamentals (~600 questions):**
Generate 50 questions per CS pillar (OS, DBMS, CN, OOP) × 3 difficulty levels. Use this batch prompt:
```
Generate 50 technical interview questions about [TOPIC] for software engineering candidates.
For each: easy/medium/hard difficulty, expected concepts, follow-up if shallow, follow-up if wrong.
Output as JSON array. Questions must be specific, not generic ("Explain normalization" is bad;
"Explain the difference between 3NF and BCNF with a concrete example of when you'd choose each" is good).
```

**Company-specific questions (~300 questions):**
Top 30 companies × 10 technical questions each. Sources: Glassdoor exports, LeetCode discuss section, Blind posts.

**Total seed target: ~1,200 questions** — achievable in a weekend.

#### Tier 2 — Hybrid Question Serving

```python
# services/question_selector.py — NEW FILE

async def select_next_question(
    round_type: str,
    ability: AbilityVector,
    asked_ids: list[str],
    company: str,
    role: str,
    must_be_resume_based: bool = False,
) -> dict:

    if must_be_resume_based:
        # 70% of questions — must come from LLM (resume-specific)
        return await generate_resume_question(profile, ability, ...)

    # 30% CS fundamentals — try DB first
    target_elo = ability.overall_ability

    db_question = await supabase.table("question_bank").select("*").filter(
        "round_type", "eq", round_type
    ).filter(
        "elo_difficulty", "gte", target_elo - 150
    ).filter(
        "elo_difficulty", "lte", target_elo + 150
    ).not_in("id", asked_ids).execute()

    # Prioritize company-tagged questions
    company_matches = [
        q for q in db_question.data
        if company.lower() in [t.lower() for t in q["company_tags"]]
    ]

    if company_matches:
        return company_matches[0]
    elif db_question.data:
        return db_question.data[0]
    else:
        # Fall through to LLM generation
        return await generate_question_llm(profile, ability, round_type, ...)
```

**Result**: Sessions serve ~70% LLM-generated (resume-based) + ~30% DB-served (CS fundamentals). As the question bank grows, LLM calls for CS fundamentals drop toward zero.

---

## Phase 6: Follow-Up Architecture Overhaul

### Current State Problems
1. Follow-ups only fire when `score ≤ 5`
2. Maximum 1 follow-up per question (hard block)
3. Follow-up text is LLM-generated on the fly (extra call)
4. Strong answers get no follow-up (missed escalation opportunity)

### New Follow-Up State Machine

| Score | Trigger | Follow-up Type |
|---|---|---|
| 0–3 | Always | `wrong_correction` (`if_wrong` text) |
| 4–6 | Always | `shallow_probe` (`if_shallow` text) |
| 7–8 | If key concept missed | `concept_gap` (target the missed concept) |
| 9–10 | 50% chance | `strong_escalation` (`if_strong` text) |

**Allow maximum 2 follow-ups per topic** (up from current 1), but never chain follow-ups on follow-ups — only chain from the original question:

```python
depth_counter = question.get("follow_up_depth", 0)
if depth_counter < 2 and should_follow_up(score, eval_result):
    next_q = create_followup_from_prebuilt(question, score)
    next_q["follow_up_depth"] = depth_counter + 1
    next_q["parent_question_id"] = question["id"]
```

### Pre-built Follow-Ups vs On-the-Fly

- **Phase 1**: Use the pre-built `follow_ups` dict embedded in every question (from updated output schema). Zero extra LLM calls for follow-ups.
- **Phase 2**: For resume-based questions where pre-built follow-ups may not fit perfectly, use a very short LLM call (max 300 tokens) with the specific answer text. This is rare.

---

## Phase 7: Report Integration for Tags

Tags must flow from questions → transcript → report:

```python
# In session.py when building transcript entry
transcript_entry = {
    "question_id": q["id"],
    "question": q["text"],
    "answer": answer_text,
    "score": eval_result["score"],
    "feedback": eval_result["feedback"],
    "tags": q.get("tags", {}),
    "follow_up_type": follow_up_type,
    "cs_pillar": q.get("tags", {}).get("cs_pillar"),
    "is_resume_based": q.get("tags", {}).get("is_resume_based", False),
    # ... existing fields
}
```

**New `topic_breakdown` section in report:**
```json
{
  "topic_breakdown": {
    "OS": { "questions_asked": 2, "avg_score": 6.5, "weak": true },
    "DBMS": { "questions_asked": 3, "avg_score": 8.2, "weak": false },
    "CN": { "questions_asked": 1, "avg_score": 4.0, "weak": true },
    "Resume-Based": {
      "questions_asked": 7,
      "avg_score": 7.1,
      "resume_grilling_coverage": "70%"
    }
  }
}
```

---

## Phase 8: Tavily Optimization

### Current State
Called once at session start. Results injected into system prompt and never updated. If session is 30 minutes long, the question intelligence context is 30 minutes stale.

### Changes

1. **Keep the session-start call** — good foundation.
2. **Add 24-hour company-level cache** (share across sessions targeting same company):

```python
# services/web_researcher.py — add this
_COMPANY_CACHE: dict[str, tuple[str, datetime]] = {}
CACHE_TTL_HOURS = 24

async def get_company_questions_cached(company: str, role: str, round_type: str) -> str:
    cache_key = f"{company}:{role}:{round_type}:{date.today()}"
    if cache_key in _COMPANY_CACHE:
        result, fetched_at = _COMPANY_CACHE[cache_key]
        if (datetime.now() - fetched_at).seconds < CACHE_TTL_HOURS * 3600:
            return result

    result = await search_company_interview_questions(company, role)
    _COMPANY_CACHE[cache_key] = (result, datetime.now())
    return result
```

3. **Mid-session refresh trigger**: After question 5 in a 10-question session, if round is `technical` or `system_design`, fire an async background Tavily refresh. Next question generation picks it up automatically.

---

## Question Authenticity Strategy

| Layer | Mechanism | Implementation |
|---|---|---|
| DB-seeded questions | Pre-verified from LeetCode/InterviewDB | Import scripts + human review pass |
| LLM-grounded questions | RAG: fetch 2 similar DB questions → inject as examples into LLM prompt | `question_selector.py` RAG lookup |
| DSA question validation | Run generated code through `code_runner.py` to verify solvability | `interviewer.py:generate_coding_question()` |
| Source tagging | Every question tagged `curated` / `llm_grounded` / `llm_pure` | `question_bank.source` field |
| User feedback loop | "Was this question realistic?" binary flag post-session | New `question_feedback` table |
| Company attribution guard | Never claim "asked at Google" unless source = curated | Enforced in prompt + deterministic validator |

---

## Competitor Research Summary

| Platform | Question Source | Adaptive? | Resume Grilling | Key Insight |
|---|---|---|---|---|
| Interviewing.io | Human engineers (live) | Manual | None | Credibility moat — can't scale |
| Pramp / Exponent | Static curated DB | None | None | Commoditized, no LLM |
| HireVue | Static (I/O psych authored) | CAT for games | None | AI is on scoring side, not generation |
| Karat | Curated library, human IVEs | Manual | None | Calibrated rubrics = consistency |
| CodeSignal | Static + discrimination params | IRT-like per question | None | Normative scoring, no conversational depth |
| Final Round AI | LLM (resume + JD) | None | Implicit | Live cheat tool, validates personalization need |
| **You** | Hybrid (DB + LLM) | ELO multi-dim | 70% resume | Biggest differentiation = resume drilling + adaptive |

### Adaptive Algorithm Research: Key Findings

**Best approach for your stage: ELO-style per-dimension tracking**
- IRT (Item Response Theory): Requires pre-calibrated difficulty/discrimination parameters from a large historical corpus. More precise but needs ~10K+ sessions first.
- ELO: Both person ability and item difficulty update simultaneously after each response. No pre-calibration needed. Mathematically equivalent to Rasch IRT at scale. **Best for cold-start platforms.**

**Duolingo's Birdbrain V2 (most relevant analog):**
- Replaced scalar ability score with a 40-dimensional vector
- Each dimension captures a sub-skill component
- Session adaptation: if performance is strong in first half, later exercises replace with harder ones
- This multi-dimensional model enables much more targeted question selection than a single score

---

## Implementation Roadmap

### Week 1 — Foundation (Blocking Everything Else)
- [ ] **Schema migration**: Add `ability_vector JSONB`, `question_buffer JSONB` to `sessions` table. Create `question_bank` table with full schema.
- [ ] **Question tagger** (`services/question_tagger.py`): Keyword-based CS pillar auto-tagging.
- [ ] **Update question output schema** in `interviewer_prompt.py`: Add `tags` and `follow_ups` fields to LLM output format.
- [ ] **Update transcript schema** in `session.py`: Persist `tags`, `cs_pillar`, `is_resume_based`, `follow_up_type`.

### Week 2 — Adaptive Engine Rebuild
- [ ] **`AbilityVector` class** (`services/ability_tracker.py`): ELO update, dimension tracking, difficulty label derivation.
- [ ] **Refactor `adaptive_engine.py`**: Replace decision tree with ability-vector-driven selection. Implement "every 2 answers" recalibration.
- [ ] **Dual-question generation** (`services/interviewer.py`): `generate_next_two_questions()` function. Question buffer logic in `session.py`.
- [ ] **Follow-up state machine**: Pre-built follow-up serving, 2-level depth, strong-answer escalation.

### Week 3 — Question Bank Seeding
- [ ] **Seed DSA**: Import 250 LeetCode company-tagged problems from GitHub mirrors via one-time migration script.
- [ ] **Seed CS fundamentals**: Generate 50 questions × 4 pillars × 3 difficulties via batch LLM generation. Human review pass.
- [ ] **Seed company questions**: Top 30 companies × 10 questions = 300 questions.
- [ ] **`question_selector.py`**: Hybrid DB-first + LLM-fallback question serving.

### Week 4 — Prompt & Follow-Up Overhaul
- [ ] **Update `build_interviewer_prompt()`**: 70/30 split, mandatory CS pillar coverage, DBMS/OS/CN always tagged, updated output schema.
- [ ] **Tavily 24-hour company cache**: Share results across sessions targeting same company.
- [ ] **Report integration**: `topic_breakdown` section, tag-based filtering in report UI.

### Week 5 — Frontend Tag Display
- [ ] Add tag pills to `InterviewRoom.jsx` question display.
- [ ] Add `topic_breakdown` section to `Report.jsx`.
- [ ] Filter/group questions by tag in report (especially CS pillar grouping).

---

## Impact Summary

| Metric | Before | After |
|---|---|---|
| Groq calls/answer | 2 | 1.5 avg (buffer saves 25%) |
| Difficulty adaptation | Static (set at session start, never updated) | Live ELO per 6 dimensions, recalibrated every 2 answers |
| Follow-up triggers | Weak answers only (score ≤ 5) | Weak + shallow + strong escalation (3 types) |
| Question tags | `topic` (1-4 words) only | CS pillar + company + role + resume-based + source |
| Resume-to-CS ratio | 50/50 | 70/30 (enforced in prompt) |
| Question authenticity | Pure LLM | DB-seeded + RAG-grounded + source-tagged |
| Report granularity | Per-question scores + radar | + Topic breakdown by CS pillar + tag-based filtering |
| Mandatory CS pillars | Soft suggestion | DBMS + OS + CN always guaranteed per session |
| Question bank | None (all LLM) | 1,200+ seeded questions, hybrid serving |

---

## Priority Order (Max Impact Per Hour of Engineering)

1. **Fix the prompt ratios + mandatory pillars** — one afternoon, immediate UX improvement
2. **Add pre-built follow-ups to output schema** — one day, removes extra LLM calls for follow-ups
3. **Seed the question bank** — one weekend, enables hybrid serving
4. **Rebuild adaptive engine with ELO** — one week, makes the interview feel genuinely intelligent
5. **Frontend tag pills + report topic breakdown** — one day, visible quality signal to users

---

*Review notes: Start from Phase 4 (prompt changes) as it has zero infrastructure dependencies and delivers the most visible improvement immediately.*
