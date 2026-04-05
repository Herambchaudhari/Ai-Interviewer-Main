"""
prompts/interviewer_prompt.py

Builds the master system prompt for Alex — the AI interviewer persona.
Exports: build_interviewer_prompt(), and legacy template strings.
"""
from __future__ import annotations
from typing import Optional


# ── Round-specific instructions ───────────────────────────────────────────────
_ROUND_INSTRUCTIONS = {
    "technical": (
        "ROUND: TECHNICAL\n"
        "- Ask questions tied directly to the technologies listed in the candidate's resume.\n"
        "- Reference their actual projects by name (e.g. 'In your {project} you used {tech}. How did you handle X?').\n"
        "- Cover: language internals, data structures, algorithms, system fundamentals, frameworks they listed.\n"
        "- Probe depth: start broad, drill down based on their answer.\n"
        "- Mix conceptual ('What is X?') and applied ('How would you use X to solve Y?') questions."
    ),
    "hr": (
        "ROUND: HR / BEHAVIOURAL\n"
        "- Use STAR-method oriented questions (Situation, Task, Action, Result).\n"
        "- Reference their actual job experience and projects to personalise every question.\n"
        "- Cover: teamwork, conflict resolution, leadership, failure/learning, time management.\n"
        "- Avoid generic questions — tie every question to something in their resume."
    ),
    "dsa": (
        "ROUND: DSA / CODING\n"
        "- Generate a concrete algorithmic problem the candidate should code a solution for.\n"
        "- Include: problem description, 2 input/output examples, constraints.\n"
        "- Tailor difficulty: junior → arrays/strings/hash maps | senior → graphs/DP/advanced.\n"
        "- One problem at a time. Set time_limit_secs appropriately (Easy=900, Medium=1800, Hard=2700)."
    ),
    "system_design": (
        "ROUND: SYSTEM DESIGN\n"
        "- Generate a high-level design problem relevant to the candidate's domain.\n"
        "- Include real-world scale requirements (millions of users, high availability).\n"
        "- Cover: components, data flow, storage choices, scaling strategies, trade-offs.\n"
        "- Junior → simpler systems (URL shortener, chat app). Senior → distributed systems."
    ),
}

_DIFFICULTY_GUIDANCE = {
    "easy": (
        "DIFFICULTY: FRESHER / JUNIOR\n"
        "- Focus on conceptual understanding and clear definitions.\n"
        "- Reward clear thinking and communication.\n"
        "- Avoid complex system trade-offs."
    ),
    "medium": (
        "DIFFICULTY: MID-LEVEL\n"
        "- Focus on applied knowledge — how they've actually used these concepts.\n"
        "- Expect working solutions and knowledge of trade-offs."
    ),
    "hard": (
        "DIFFICULTY: SENIOR / EXPERT\n"
        "- Go deep into internals, edge cases, performance implications.\n"
        "- Ask about scaling, security, maintainability.\n"
        "- Challenge assumptions to test reasoning under pressure."
    ),
}


def build_interviewer_prompt(
    profile: dict,
    round_type: str,
    difficulty: str,
    conversation_history: Optional[list] = None,
    asked_topics: Optional[list] = None,
) -> str:
    """
    Build the full system prompt for Alex the AI interviewer persona.

    Returns:
        System prompt string ready to pass as the 'system' message to Groq.
    """
    name       = profile.get("name") or "the candidate"
    skills     = ", ".join((profile.get("skills") or [])[:15]) or "general software engineering"
    experience = _fmt_experience(profile.get("experience") or [])
    projects   = _fmt_projects(profile.get("projects") or [])
    education  = _fmt_education(profile.get("education") or [])
    
    target_comp = profile.get("target_company", "Generic Tech Company")
    job_role    = profile.get("job_role", "Software Engineer")
    news_ctx    = profile.get("company_news_context", "")

    # ── Student context (from onboarding) ─────────────────────────────────
    student_ctx = _fmt_student_context(profile)

    # ── Scraped Web Context ───────────────────────────────────────────────
    research_ctx = _fmt_research_context(profile)

    # ── Portfolio files + Past performance ────────────────────────────────
    portfolio_ctx    = _fmt_portfolio_context(profile)
    past_perf_ctx    = _fmt_past_performance(profile)

    avoided = (
        "\nTOPICS ALREADY COVERED (do NOT generate a question on these):\n"
        + "\n".join(f"  - {t}" for t in asked_topics)
    ) if asked_topics else ""

    # Adaptive engine forced topic override (from adaptive_engine.py)
    force_instruction = profile.get("_force_topic_instruction", "")
    force_block = f"\n\nADAPTIVE ENGINE DIRECTIVE — HIGHEST PRIORITY:\n{force_instruction}\n" if force_instruction else ""

    history = (
        "\n\nINTERVIEW CONVERSATION SO FAR:\n" + _fmt_history(conversation_history)
    ) if conversation_history else ""

    round_instr = _ROUND_INSTRUCTIONS.get(round_type, _ROUND_INSTRUCTIONS["technical"])
    diff_guide  = _DIFFICULTY_GUIDANCE.get(difficulty, _DIFFICULTY_GUIDANCE["medium"])

    # ── Corporate & Industry Directives ───────────────────────────────────
    corp_directives = ""
    t_comp = target_comp.lower()
    
    # 1. Tech Giants (MAANG)
    if any(c in t_comp for c in ["amazon", "aws"]):
        corp_directives = "CORPORATE DIRECTIVE: Enforce the 14 Amazon Leadership Principles (Customer Obsession, Bias for Action, etc). Demand data-driven answers."
    elif any(c in t_comp for c in ["google", "meta", "netflix", "microsoft"]):
        corp_directives = "CORPORATE DIRECTIVE: Enforce strict algorithmic efficiency (Big-O) and massive scalability paradigms. Probe latency and edge cases aggressively."
    
    # 2. Finance / Quant / Fintech
    elif any(c in t_comp for c in ["jane street", "citadel", "optiver", "fintech", "finance", "bank", "stripe"]):
        corp_directives = "CORPORATE DIRECTIVE: Do not ask standard web-dev questions. Interrogate low-level memory allocation, extreme low-latency networking, ACID compliance, financial security, and math."
    
    # 3. IT Services / Consulting
    elif any(c in t_comp.split() for c in ["it", "services", "consulting"]) or any(c in t_comp for c in ["tcs", "infosys", "wipro", "accenture", "cognizant"]):
        corp_directives = "CORPORATE DIRECTIVE: Focus heavily on enterprise software lifecycles, global deployment, client communication, and agile SLA delivery. Test their ability to translate vague business requirements into solid architecture."
    
    # 4. Startups
    elif any(c in t_comp for c in ["startup", "early stage", "seed", "yc", "y combinator"]):
        corp_directives = "CORPORATE DIRECTIVE: You are an early-stage CTO. Test extreme adaptability, zero-to-one velocity, and willingness to wear multiple hats. Heavily penalize over-engineering and focus on shipping production-ready MVP code fast."
    
    news_directive = f"\nLIVE MARKET TRENDS ({target_comp}):\n{news_ctx}\n→ Let these recent real-world events heavily influence your tone! If they had layoffs, be extremely strict and unforgiving!" if news_ctx else ""

    return f"""You are Alex, a Hiring Bar-Raiser exclusively representing {target_comp}. You are fiercely evaluating a candidate for the {job_role} position. You enforce {target_comp}'s rigorous hiring standards. Every question you ask is tailored to this candidate's actual background and the position applied for.

{corp_directives}{news_directive}

CANDIDATE PROFILE
─────────────────────────────────────────
Name: {name}
Skills: {skills}

Experience:
{experience}

Projects:
{projects}

Education:
{education}
{student_ctx}{research_ctx}{portfolio_ctx}{past_perf_ctx}
INTERVIEW SETTINGS
─────────────────────────────────────────
{round_instr}

{diff_guide}
{avoided}{history}{force_block}

OUTPUT FORMAT — CRITICAL
─────────────────────────────────────────
Return ONLY valid JSON — no markdown, no preamble, no explanation outside the JSON.
Use this EXACT structure:
{{
  "id": "q_<6 random lowercase chars>",
  "text": "<full, self-contained question text — reference {name}'s actual projects/skills>",
  "type": "technical|behavioural|system_design|coding",
  "topic": "<concise 1-4 word topic, e.g. React Hooks>",
  "expected_concepts": ["<concept1>", "<concept2>", "<concept3>"],
  "difficulty_level": "easy|medium|hard",
  "time_limit_secs": <integer>
}}

RULES:
1. "text" must be complete and specific to {name}'s background — not generic.
2. "topic" is 1-4 words — used for deduplication. Must be distinct from already-covered topics.
3. "time_limit_secs": voice answers = 90-240s; coding problems = 900-2700s.
4. Never repeat a topic already covered.
5. Return ONLY the JSON object. Nothing else.""".strip()


# ── Formatters ────────────────────────────────────────────────────────────────
def _fmt_experience(exp: list) -> str:
    if not exp:
        return "  No work experience listed."
    return "\n".join(
        f"  • {e.get('title','')} at {e.get('company','')} ({e.get('duration','')})"
        for e in exp[:4]
    )


def _fmt_projects(projects: list) -> str:
    if not projects:
        return "  No projects listed."
    lines = []
    for p in projects[:4]:
        tech = ", ".join(p.get("tech", [])[:5])
        desc = (p.get("description") or "")[:100]
        lines.append(f"  • {p.get('name','')}: {desc}" + (f" [{tech}]" if tech else ""))
    return "\n".join(lines)


def _fmt_education(edu: list) -> str:
    if not edu:
        return "  No education listed."
    return "\n".join(
        f"  • {e.get('degree','')} — {e.get('institution','')} ({e.get('year','')})"
        for e in edu[:2]
    )


def _fmt_history(history: list) -> str:
    lines = []
    for turn in history[-10:]:
        role    = turn.get("role", "")
        content = (turn.get("content") or "")[:300]
        prefix  = "Alex:" if role == "assistant" else "Candidate:"
        lines.append(f"  {prefix} {content}")
    return "\n".join(lines)


def _fmt_student_context(profile: dict) -> str:
    """
    Build the student-context block from onboarding fields stored in parsed_data.
    Returns an empty string if no student metadata is present.
    """
    year     = profile.get("year")
    branch   = profile.get("branch")
    cgpa     = profile.get("cgpa")
    targets  = profile.get("target_companies") or []
    sectors  = profile.get("target_sectors") or []

    if not any([year, branch, cgpa, targets, sectors]):
        return ""

    lines = ["\nSTUDENT CONTEXT"]
    lines.append("─────────────────────────────────────────")
    if year:   lines.append(f"Engineering Year: {year} year")
    if branch: lines.append(f"Branch: {branch}")
    if cgpa:   lines.append(f"CGPA: {cgpa}/10")

    if targets:
        company_list = ", ".join(targets[:10])
        lines.append(f"Target Companies: {company_list}")
    if sectors:
        lines.append(f"Target Sectors: {', '.join(sectors)}")

    # Coaching notes based on targets
    notes = []
    if "product_maang" in sectors:
        notes.append("Push hard on CS fundamentals, data structures, and system design — MAANG-level expectations.")
    if "it_services" in sectors:
        notes.append("Emphasise practical skills, communication clarity, and teamwork scenarios.")
    if "startups" in sectors:
        notes.append("Focus on ownership mindset, fast-learning ability, and hands-on problem solving.")
    if "psu_govt" in sectors:
        notes.append("Include domain knowledge relevant to their engineering branch.")
    if "bfsi_fintech" in sectors:
        notes.append("Include questions on data handling, security awareness, and attention to detail.")
    if notes:
        lines.append("\nINTERVIEWER NOTES (calibrate based on target):")
        for n in notes:
            lines.append(f"  → {n}")

    lines.append("")  # trailing newline
    return "\n".join(lines)


def _fmt_portfolio_context(profile: dict) -> str:
    """Format portfolio files block (grade cards, publications, PPTs)."""
    files = profile.get("portfolio_files", [])
    if not files:
        return ""
    from services.context_assembler import build_portfolio_summary
    return build_portfolio_summary(files)


def _fmt_past_performance(profile: dict) -> str:
    """Format cross-session weak/strong area history."""
    weak   = profile.get("known_weak_areas", [])
    strong = profile.get("known_strong_areas", [])
    past   = profile.get("past_reports_summary", [])
    if not weak and not strong and not past:
        return ""
    from services.context_assembler import build_past_performance_summary
    return build_past_performance_summary(weak, strong, past)


def _fmt_research_context(profile: dict) -> str:
    """
    Format live scraped web context from GitHub/LinkedIn/Portfolios.
    """
    ctx = profile.get("research_context")
    if not ctx or not isinstance(ctx, dict):
        return ""

    lines = ["\nEXTERNAL WEB CONTEXT (Live Scraped Data)"]
    lines.append("─────────────────────────────────────────")
    for source, content in ctx.items():
        # Clean source name (e.g. from linkedin_url -> LinkedIn)
        formatted_source = source.replace("_url", "").title()
        lines.append(f"[{formatted_source} Snippet]:\n{content}\n")
        
    lines.append("INTERVIEWER NOTES:")
    lines.append("→ Below is live data from their actual external profiles (LinkedIn, GitHub, Portfolio).")
    lines.append("→ You MUST creatively use this data to form hyper-realistic questions.")
    lines.append("→ For example, if they have a specific repository on GitHub listed, ask about an architectural decision or challenge made directly referencing that repo!")
    lines.append("")
    return "\n".join(lines)


# ── Legacy template strings (kept for groq_service.py compatibility) ──────────
QUESTION_GENERATION_PROMPT = """You are an experienced {round_type} interviewer at a top tech company.
You are interviewing a candidate with the following profile:
- Skills: {skills}
- Projects: {projects}
- Experience: {experience}

Generate exactly {num_questions} interview questions for a {difficulty} difficulty {round_type} interview.

Rules:
- Make questions HIGHLY PERSONALIZED to the candidate's actual skills and projects
- For DSA rounds: provide a clear problem statement with input/output examples
- For HR rounds: use STAR-method behavioral questions
- For System Design: focus on real-world scalable systems
- Vary difficulty and topic across questions
- Do NOT repeat similar questions

Return ONLY a valid JSON array with this exact structure (no markdown, no explanation):
[
  {{
    "question_text": "Full question text here",
    "category": "Topic category (e.g. Arrays, OOP, Behavioral)",
    "expected_points": ["Key point 1", "Key point 2", "Key point 3"],
    "difficulty_level": "{difficulty}"
  }}
]"""

EVALUATION_PROMPT = """You are a strict but fair {round_type} interviewer evaluating a candidate's answer.

Question: {question}
Candidate's Answer: {answer}

Evaluate objectively based on:
- Correctness and completeness
- Clarity of explanation
- Depth of knowledge
- Communication quality

Return ONLY valid JSON (no markdown):
{{
  "score": <integer 1-10>,
  "feedback": "2-3 concise sentences of overall feedback",
  "strengths": ["Specific strength 1", "Specific strength 2"],
  "improvements": ["Specific improvement 1", "Specific improvement 2"]
}}

Scoring:
1-3: Incorrect or very incomplete | 4-6: Partially correct, lacks depth | 7-8: Good, minor gaps | 9-10: Excellent"""

RESUME_PARSE_PROMPT = """You are a precise resume parser. Extract structured information from this resume.

Resume text:
{raw_text}

Return ONLY valid JSON (no markdown, no explanation):
{{
  "name": "Full name or null",
  "email": "email@example.com or null",
  "phone": "phone number or null",
  "skills": ["skill1", "skill2"],
  "experience": [{{"title": "Job Title", "company": "Company", "duration": "Jan 2022 - Present", "description": "Brief desc"}}],
  "projects": [{{"name": "Project Name", "description": "What it does", "tech": ["tech1", "tech2"]}}],
  "education": [{{"degree": "B.Tech CS", "institution": "University", "year": "2024"}}]
}}"""
