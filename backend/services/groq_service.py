"""
Groq service — wraps the Groq Python SDK for LLM calls.
Model: llama-3.3-70b-versatile
"""
import os
import json
import asyncio
from typing import AsyncIterator
from groq import Groq, AsyncGroq

_client = None
_async_client = None


def get_client() -> Groq:
    global _client
    if _client is None:
        _client = Groq(api_key=os.getenv("GROQ_API_KEY"))
    return _client


def _get_async_client() -> AsyncGroq:
    global _async_client
    if _async_client is None:
        _async_client = AsyncGroq(api_key=os.getenv("GROQ_API_KEY"))
    return _async_client


def _chat(messages: list, temperature: float = 0.7, max_tokens: int = 2048) -> str:
    """Synchronous Groq chat call."""
    client = get_client()
    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return response.choices[0].message.content


async def _achat(messages: list, temperature: float = 0.7, max_tokens: int = 2048) -> str:
    """Run synchronous Groq call in a thread pool to avoid blocking."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: _chat(messages, temperature, max_tokens))


async def stream_chat(
    system: str,
    user: str,
    temperature: float = 0.3,
    max_tokens: int = 1200,
) -> AsyncIterator[str]:
    """
    Async generator — yields token chunks as they arrive from Groq.
    Usage:
        async for chunk in stream_chat(system_prompt, user_prompt):
            yield chunk
    """
    client = _get_async_client()
    stream = await client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
        temperature=temperature,
        max_tokens=max_tokens,
        stream=True,
    )
    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta


def _clean(raw: str) -> str:
    """Strip markdown fences from LLM output."""
    return raw.strip().strip("```json").strip("```").strip()


# ── Resume Parsing ─────────────────────────────────────────────────────────────
async def parse_resume_text(raw_text: str) -> dict:
    """Extract structured info from raw resume text."""
    prompt = f"""You are a precise resume parser. Given the following resume text, extract structured information.

Return ONLY valid JSON with this exact structure:
{{
  "name": "string or null",
  "email": "string or null",
  "skills": ["skill1", "skill2", ...],
  "experience": [{{"title": "...", "company": "...", "duration": "..."}}],
  "projects": [{{"name": "...", "description": "...", "tech": [...]}}],
  "education": [{{"degree": "...", "institution": "...", "year": "..."}}]
}}

Resume text:
{raw_text[:4000]}

Return ONLY the JSON object, no markdown, no explanation."""

    try:
        content = await _achat([{"role": "user", "content": prompt}], temperature=0.1)
        return json.loads(_clean(content))
    except Exception:
        return {"name": None, "email": None, "skills": [], "experience": [], "projects": [], "education": []}


# ── Question Generation ────────────────────────────────────────────────────────
_TECHNICAL_TOPICS = [
    "Object-Oriented Programming (OOP) — classes, inheritance, polymorphism, encapsulation, abstraction",
    "Computer Networks — OSI model, TCP/IP, HTTP/HTTPS, DNS, sockets, REST",
    "Operating Systems — processes, threads, scheduling, memory management, deadlocks, paging",
    "Database Management (DBMS) — SQL, normalization, ACID, indexing, transactions, joins",
    "Data Structures — arrays, linked lists, trees, graphs, heaps, hash maps",
    "Algorithms — sorting, searching, dynamic programming, greedy, recursion, complexity analysis",
    "System Design basics — scalability, load balancing, caching, CAP theorem",
    "Programming concepts — error handling, design patterns, SOLID principles",
    "Projects & experience — specific technologies used, architecture decisions",
]

async def generate_questions(
    resume_data: dict,
    round_type: str,
    difficulty: str,
    num_questions: int,
) -> list:
    """Generate interview questions tailored to the candidate's resume."""

    skills       = ", ".join(resume_data.get("skills", [])[:12]) or "general software engineering"
    projects     = resume_data.get("projects", [])
    project_desc = "; ".join(f"{p.get('name','')} ({', '.join(p.get('tech',[])[:4])})" for p in projects[:3]) or "none"
    education    = resume_data.get("education", [])
    edu_desc     = education[0].get("degree", "") if education else ""
    target_comp  = resume_data.get("target_company", "Top Tech Company")
    job_role     = resume_data.get("job_role", "Software Engineer")
    news_ctx     = resume_data.get("company_news_context", "")

    # Round-specific instructions
    if round_type == "technical":
        topic_guide = f"""
Topics to cover (spread across {num_questions} questions — cover AS MANY as possible):
{chr(10).join(f'- {t}' for t in _TECHNICAL_TOPICS)}

Critical rule for technical round:
- Mix PROJECT-based questions (2-3 questions about the candidate's actual projects/skills)
- CS FUNDAMENTALS questions (remaining questions covering OOP, DBMS, OS, CN, DSA, algorithms)
- NEVER generate all questions on the same topic
- For a fresher: 40% project/skills, 60% CS fundamentals
- For mid/senior: 30% project, 30% CS fundamentals, 40% advanced concepts
"""
    elif round_type == "hr":
        topic_guide = """
Topics: behavioral, situational, culture fit, communication, teamwork, leadership, 
conflict resolution, career goals, strengths/weaknesses, motivation.
Use STAR-method oriented questions. Make them personalised to the candidate's background."""
    elif round_type == "dsa":
        topic_guide = f"""
Generate {num_questions} complete DSA coding problems. Each must have:
- Full problem statement
- 2 examples with input/output
- Constraints
- Difficulty-appropriate topic (easy=arrays/strings, medium=trees/hashmaps/binary search, hard=DP/graphs/advanced)
Include problem title in question_text."""
    else:  # system_design
        topic_guide = """
Topics: distributed systems, scalability, load balancing, caching (Redis), message queues,
databases (SQL vs NoSQL), microservices, API design, CDN, consistent hashing, CAP theorem.
Ask about designing real systems (URL shortener, chat app, news feed, ride-sharing etc.)"""

    prompt = f"""You are a Hiring Bar-Raiser exclusively representing {target_comp}. You are generating exactly {num_questions} interview questions for a {job_role} position.

Candidate Profile:
- Skills: {skills}
- Projects: {project_desc}
- Education: {edu_desc}
- Round: {round_type.upper()}
- Difficulty: {difficulty.upper()}

{f"CURRENT MARKET TRENDS & CORPORATE PRESSURE:\n{news_ctx}\n→ Let these recent real-world events heavily influence your questions. If there were layoffs, increase rigorousness!" if news_ctx else ""}

{topic_guide}

Return ONLY a valid JSON array — no markdown, no explanation:
[
  {{
    "question_text": "<the full question>",
    "category": "<OOP|DBMS|OS|CN|DSA|Project|HR|SystemDesign|Algorithms>",
    "expected_points": ["point1", "point2", "point3"],
    "difficulty_level": "{difficulty}"
  }}
]

Return EXACTLY {num_questions} questions covering DIVERSE topics."""

    try:
        content = await _achat([{"role": "user", "content": prompt}], temperature=0.8, max_tokens=4000)
        questions = json.loads(_clean(content))
        if isinstance(questions, list):
            return questions[:num_questions]
        return questions.get("questions", [])[:num_questions]
    except Exception:
        return [
            {"question_text": f"Question {i+1}", "category": round_type, "expected_points": [], "difficulty_level": difficulty}
            for i in range(num_questions)
        ]


# ── Answer Evaluation ──────────────────────────────────────────────────────────
async def evaluate_answer(question: str, answer: str, round_type: str, evaluate_context: dict = None) -> dict:
    """Evaluate a candidate's answer and return a score + feedback."""
    if evaluate_context is None:
        evaluate_context = {}
    target_comp = evaluate_context.get("target_company", "Top Tech Company")
    
    if not answer.strip() or answer.strip() == "[No answer]":
        return {
            "score": 1,
            "feedback": "No answer was provided.",
            "strengths": [],
            "improvements": ["Please provide a detailed answer next time."],
            "verdict": "Poor",
        }

    prompt = f"""You are a strict but fair Hiring Bar-Raiser at {target_comp}. You are evaluating a candidate's answer to see if they meet {target_comp}'s specific high standards.

Round Type: {round_type.upper()}
Question: {question}
Candidate's Answer: {answer[:1500]}

Evaluate and return ONLY valid JSON:
{{
  "score": <integer 1-10>,
  "verdict": "<Excellent|Good|Satisfactory|Needs Improvement|Poor>",
  "feedback": "2-3 sentence overall feedback",
  "strengths": ["strength1", "strength2"],
  "improvements": ["area to improve 1", "area to improve 2"],
  "key_concept_missed": "<most important concept they missed, or empty string>",
  "answer_summary": "<1 sentence summary of what they said>",
  "red_flag_detected": "<if they show extreme toxicity, arrogance, or blame others, describe it. Else empty string>"
}}

Scoring guide:
- 1-3: Incorrect, very incomplete, or shows no understanding
- 4-6: Partially correct, lacks depth or key concepts
- 7-8: Good answer with minor gaps
- 9-10: Excellent, comprehensive, shows deep understanding

Verdict mapping: 9-10=Excellent, 7-8=Good, 5-6=Satisfactory, 3-4=Needs Improvement, 1-2=Poor

Return ONLY the JSON object."""

    try:
        content = await _achat([{"role": "user", "content": prompt}], temperature=0.3, max_tokens=900)
        return json.loads(_clean(content))
    except Exception:
        return {
            "score": 5,
            "verdict": "Satisfactory",
            "feedback": "Could not evaluate this answer.",
            "strengths": [],
            "improvements": [],
            "key_concept_missed": "",
            "answer_summary": "",
            "red_flag_detected": "",
        }


# ── Report Generation ──────────────────────────────────────────────────────────
_RADAR_SKILLS_BY_ROUND = {
    "technical": ["OOP & Design Patterns", "Data Structures & Algorithms", "DBMS & SQL", "OS & CN Concepts", "Project Knowledge", "Communication"],
    "hr":        ["Communication", "Problem Solving", "Teamwork", "Leadership", "Culture Fit", "Situational Judgment"],
    "dsa":       ["Problem Understanding", "Algorithm Design", "Code Quality", "Time Complexity", "Edge Cases", "Optimization"],
    "system_design": ["Scalability", "Database Design", "Caching & CDN", "API Design", "Trade-off Analysis", "Communication"],
}

_EMPTY_HIRE_SIGNAL = {
    "technical_depth":  {"score": 5, "rationale": "Insufficient data."},
    "communication":    {"score": 5, "rationale": "Insufficient data."},
    "problem_solving":  {"score": 5, "rationale": "Insufficient data."},
    "cultural_fit":     {"score": 5, "rationale": "Insufficient data."},
    "growth_potential": {"score": 5, "rationale": "Insufficient data."},
}

_EMPTY_CV_AUDIT = {
    "overall_cv_honesty_score": 0,
    "note": "No resume data available for CV audit.",
    "items": [],
}

_EMPTY_ROADMAP = {"week_1": [], "week_2": [], "week_3": [], "week_4": []}


async def _gen_core(
    round_type: str,
    question_scores: list,
    overall_score: float,
    session: dict,
    profile: dict,
    market_context: str,
) -> dict:
    """Stage 1 Groq call — core analysis with hire signal + failure patterns."""
    from prompts.report_prompt import build_core_analysis_prompt

    prompt = build_core_analysis_prompt(
        session=session or {},
        profile=profile or {},
        question_scores=question_scores,
        overall_score=overall_score,
        market_context=market_context,
    )
    radar_skills = _RADAR_SKILLS_BY_ROUND.get(round_type, _RADAR_SKILLS_BY_ROUND["technical"])

    try:
        content = await _achat(
            [{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=4500,
        )
        result = json.loads(_clean(content))

        # Ensure per_question_analysis is populated
        if not result.get("per_question_analysis"):
            result["per_question_analysis"] = [
                {
                    "question_text": q["question_text"],
                    "score": q["score"],
                    "verdict": q.get("verdict", "Satisfactory"),
                    "answer_summary": q.get("answer_summary", ""),
                    "key_insight": q.get("feedback", ""),
                    "category": q.get("category", round_type),
                    "question_id": f"Q{i+1}",
                }
                for i, q in enumerate(question_scores)
            ]

        # Fill defaults for new fields if LLM skipped them
        result.setdefault("hire_signal", _EMPTY_HIRE_SIGNAL)
        result.setdefault("failure_patterns", [])
        result.setdefault("radar_scores", {s: int(overall_score * 10) for s in radar_skills})
        return result

    except Exception as e:
        print(f"[groq_service] Core report generation failed: {e}")
        s = round(overall_score * 10)
        return {
            "grade": "B" if s >= 60 else "C",
            "hire_recommendation": "Yes" if s >= 65 else "Maybe",
            "summary": f"Overall score: {overall_score}/10 across {len(question_scores)} questions.",
            "compared_to_level": "Mid-level Engineer",
            "radar_scores": {skill: s for skill in radar_skills},
            "category_breakdown": [],
            "strong_areas": [],
            "weak_areas": [],
            "red_flags": [],
            "per_question_analysis": [
                {
                    "question_text": q["question_text"],
                    "score": q["score"],
                    "verdict": q.get("verdict", "Satisfactory"),
                    "answer_summary": q.get("answer_summary", ""),
                    "key_insight": q.get("feedback", ""),
                    "category": q.get("category", round_type),
                    "question_id": f"Q{i+1}",
                }
                for i, q in enumerate(question_scores)
            ],
            "interview_tips": ["Structure your answers using the STAR method."],
            "hire_signal": _EMPTY_HIRE_SIGNAL,
            "failure_patterns": [],
        }


async def _gen_cv_audit(
    profile: dict,
    question_scores: list,
) -> dict:
    """Stage 2 Groq call — CV audit + 4-week study roadmap."""
    from prompts.report_prompt import build_cv_audit_prompt

    # Skip if no meaningful CV data
    has_cv = bool(
        (profile.get("skills") or []) or
        (profile.get("projects") or []) or
        (profile.get("experience") or [])
    )
    if not has_cv:
        return {
            "cv_audit": _EMPTY_CV_AUDIT,
            "study_roadmap": _EMPTY_ROADMAP,
            "study_recommendations": [
                {"topic": "Core CS Fundamentals", "priority": "High", "resources": ["GeeksForGeeks", "CS50"], "reason": "Foundation for all technical roles"},
            ],
            "mock_ready_topics": [],
            "not_ready_topics": [],
        }

    prompt = build_cv_audit_prompt(profile=profile, question_scores=question_scores)
    try:
        content = await _achat(
            [{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=4500,
        )
        result = json.loads(_clean(content))
        result.setdefault("cv_audit", _EMPTY_CV_AUDIT)
        result.setdefault("study_roadmap", _EMPTY_ROADMAP)
        result.setdefault("study_recommendations", [])
        result.setdefault("mock_ready_topics", [])
        result.setdefault("not_ready_topics", [])
        return result

    except Exception as e:
        print(f"[groq_service] CV audit generation failed: {e}")
        return {
            "cv_audit": _EMPTY_CV_AUDIT,
            "study_roadmap": _EMPTY_ROADMAP,
            "study_recommendations": [
                {"topic": "Core CS Fundamentals", "priority": "High", "resources": ["CS50", "GeeksForGeeks"], "reason": "Foundation for all technical roles"},
            ],
            "mock_ready_topics": [],
            "not_ready_topics": [],
        }


async def generate_report(
    round_type: str,
    question_scores: list,
    overall_score: float,
    profile: dict = None,
    market_context: str = "",
    session: dict = None,
) -> dict:
    """
    Ultra-Report: Two parallel Groq calls merged into one rich payload.
    Stage 1: Core analysis — grade, radar, strong/weak, per-question, hire signal, failure patterns
    Stage 2: CV audit — per-claim honesty check, 4-week study roadmap
    """
    profile = profile or {}
    session = session or {"round_type": round_type}

    # Fire both calls concurrently for speed
    core_task  = _gen_core(round_type, question_scores, overall_score, session, profile, market_context)
    audit_task = _gen_cv_audit(profile, question_scores)

    core_result, audit_result = await asyncio.gather(core_task, audit_task)

    # Merge: core fields + audit fields into one payload
    return {
        **core_result,
        "cv_audit":              audit_result.get("cv_audit", _EMPTY_CV_AUDIT),
        "study_roadmap":         audit_result.get("study_roadmap", _EMPTY_ROADMAP),
        "study_recommendations": audit_result.get("study_recommendations", []),
        "mock_ready_topics":     audit_result.get("mock_ready_topics", []),
        "not_ready_topics":      audit_result.get("not_ready_topics", []),
    }


# ── Market Intelligence Synthesizer ──────────────────────────────────────────

async def synthesize_market_trends(target_companies: list, raw_news: list) -> dict:
    """Filters noise and generates a synthetic brief using Groq."""
    if not raw_news:
        return {
            "insight": "No significant market movements detected for your target companies today.",
            "trend_label": "Calm Market",
            "trend_type": "neutral",
            "articles": []
        }
    
    companies_str = ", ".join(target_companies) if target_companies else "tech engineering"
    news_json = json.dumps([{"title": n.get("title"), "url": n.get("url"), "source": n.get("source")} for n in raw_news], indent=2)

    prompt = f"""You are an elite Career Strategist. Read these live news snippets regarding {companies_str}.

Raw News:
{news_json}

INSTRUCTIONS:
1. Discard any generic PR, stock dividends, or consumer product releases.
2. Keep ONLY up to 3 articles that impact software engineering hiring, culture, or strategy (e.g. layoffs, AI pushes, RTO, stack changes).
3. Generate a brutally honest 2-sentence 'Insight' explaining how this news impacts an engineer applying there today.
4. Assign a concise 2-3 word 'Trend Label' (e.g., "Aggressive AI Hiring", "Hiring Freeze", "Culture Shift").
5. Assign a 'Trend Type': "positive", "negative", or "warning".

Return ONLY valid JSON (no markdown):
{{
  "insight": "<2-sentence insight>",
  "trend_label": "<short label>",
  "trend_type": "<positive|negative|warning>",
  "articles": [
    {{"title": "<article title>", "url": "<click url>", "source": "<publisher>"}}
  ]
}}"""

    fallback = {
        "insight": "Corporate trends are shifting; adjust your system design prep accordingly.",
        "trend_label": "Market Evolving",
        "trend_type": "warning",
        "articles": [n for n in raw_news[:3] if "title" in n and "url" in n]
    }

    try:
        content = await _achat([{"role": "user", "content": prompt}], temperature=0.3, max_tokens=1000)
        parsed = json.loads(_clean(content))
        if not parsed.get("articles"):
            parsed["articles"] = fallback["articles"]
        return parsed
    except Exception as e:
        print(f"[synthesize_market_trends] Failed: {e}")
        return fallback
