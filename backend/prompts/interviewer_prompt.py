"""
prompts/interviewer_prompt.py

Builds the master system prompt for Alex, the AI interviewer persona.
Exports: build_interviewer_prompt(), and legacy template strings.
"""
from __future__ import annotations
from typing import Optional


_ROUND_INSTRUCTIONS = {
    "technical": (
        "ROUND: TECHNICAL\n"
        "QUESTION DISTRIBUTION (STRICT - you MUST follow this ratio across the full interview):\n"
        "  * 50% CORE CS AND ROLE FUNDAMENTALS - OOP (classes, inheritance, polymorphism, SOLID), DBMS (SQL, normalization, ACID, indexing, transactions), "
        "OS (processes, threads, scheduling, memory management, deadlocks, paging), "
        "Computer Networks (OSI model, TCP/IP, HTTP/S, DNS, sockets).\n"
        "  * 50% PROJECT AND RESUME DEEP-DIVES - tied directly to the candidate's listed projects and skills. "
        "Reference their actual projects by name (e.g. 'In your {project} you used {tech}. How did you handle X?'). "
        "Cover language internals, frameworks they listed, architecture decisions they made.\n"
        "  * NO EXTRA ALGORITHMIC BUCKET - stay focused on a balanced mix of resume-backed deep dives and core or role fundamentals.\n\n"
        "- Probe depth: start broad, drill down based on their answer.\n"
        "- Mix conceptual ('What is X?') and applied ('How would you use X to solve Y?') questions.\n"
        "- CRITICAL: Keep the interview explicitly aligned to the candidate's target role, such as frontend, backend, full-stack, data, ML, DevOps, or mobile.\n"
        "- You MUST ask both resume-based questions and standalone role or CS fundamentals questions "
        "(e.g. 'Explain normalisation in DBMS', 'What is a deadlock?', 'How does browser rendering work?') that are NOT tied to their resume."
    ),
    "hr": (
        "ROUND: HR / BEHAVIOURAL\n"
        "- Use STAR-method oriented questions (Situation, Task, Action, Result).\n"
        "- Reference their actual job experience and projects to personalise every question.\n"
        "- Cover: teamwork, conflict resolution, leadership, failure/learning, time management.\n"
        "- Avoid generic questions - tie every question to something in their resume."
    ),
    "dsa": (
        "ROUND: DSA / CODING\n"
        "- Generate a concrete algorithmic problem the candidate should code a solution for.\n"
        "- Include: problem description, 2 input/output examples, constraints.\n"
        "- Tailor difficulty: junior -> arrays/strings/hash maps | senior -> graphs/DP/advanced.\n"
        "- One problem at a time. Set time_limit_secs appropriately (Easy=900, Medium=1800, Hard=2700)."
    ),
    "system_design": (
        "ROUND: SYSTEM DESIGN\n"
        "- Generate a high-level design problem relevant to the candidate's domain.\n"
        "- Include real-world scale requirements (millions of users, high availability).\n"
        "- Cover: components, data flow, storage choices, scaling strategies, trade-offs.\n"
        "- Junior -> simpler systems (URL shortener, chat app). Senior -> distributed systems."
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
        "- Focus on applied knowledge - how they've actually used these concepts.\n"
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
    """Build the full system prompt for Alex the AI interviewer persona."""
    name = profile.get("name") or "the candidate"
    skills = ", ".join((profile.get("skills") or [])[:15]) or "general software engineering"
    experience = _fmt_experience(profile.get("experience") or [])
    projects = _fmt_projects(profile.get("projects") or [])
    education = _fmt_education(profile.get("education") or [])

    target_comp = profile.get("target_company", "Generic Tech Company")
    job_role = profile.get("job_role", "Software Engineer")
    news_ctx = profile.get("company_news_context", "")

    student_ctx = _fmt_student_context(profile)
    research_ctx = _fmt_research_context(profile)
    interview_q_ctx = _fmt_interview_questions_context(profile, round_type)
    role_ctx = _fmt_role_focus(job_role, round_type)
    portfolio_ctx = _fmt_portfolio_context(profile)
    past_perf_ctx = _fmt_past_performance(profile)

    avoided = (
        "\nTOPICS ALREADY COVERED (do NOT generate a question on these):\n"
        + "\n".join(f"  - {t}" for t in asked_topics)
    ) if asked_topics else ""

    force_instruction = profile.get("_force_topic_instruction", "")
    force_block = (
        f"\n\nADAPTIVE ENGINE DIRECTIVE - HIGHEST PRIORITY:\n{force_instruction}\n"
        if force_instruction else ""
    )

    history = (
        "\n\nINTERVIEW CONVERSATION SO FAR:\n" + _fmt_history(conversation_history)
    ) if conversation_history else ""

    round_instr = _ROUND_INSTRUCTIONS.get(round_type, _ROUND_INSTRUCTIONS["technical"])
    diff_guide = _DIFFICULTY_GUIDANCE.get(difficulty, _DIFFICULTY_GUIDANCE["medium"])

    corp_directives = ""
    t_comp = target_comp.lower()
    if any(c in t_comp for c in ["amazon", "aws"]):
        corp_directives = "CORPORATE DIRECTIVE: Enforce the Amazon Leadership Principles and demand data-driven answers."
    elif any(c in t_comp for c in ["google", "meta", "netflix", "microsoft"]):
        corp_directives = "CORPORATE DIRECTIVE: Enforce strong algorithmic efficiency and large-scale systems thinking."
    elif any(c in t_comp for c in ["jane street", "citadel", "optiver", "fintech", "finance", "bank", "stripe"]):
        corp_directives = "CORPORATE DIRECTIVE: Emphasize low latency systems, ACID guarantees, security, and rigorous trade-offs."
    elif any(c in t_comp for c in ["tcs", "infosys", "wipro", "accenture", "cognizant", "consulting"]):
        corp_directives = "CORPORATE DIRECTIVE: Focus on enterprise delivery, client communication, software lifecycle, and pragmatic architecture."
    elif any(c in t_comp for c in ["startup", "early stage", "seed", "yc", "y combinator"]):
        corp_directives = "CORPORATE DIRECTIVE: Focus on ownership, speed, pragmatism, and production-ready delivery."

    news_directive = (
        f"\nLIVE MARKET TRENDS ({target_comp}):\n{news_ctx}\n-> Let these recent real-world events influence your tone and calibration."
        if news_ctx else ""
    )

    return f"""You are Alex, a Hiring Bar-Raiser exclusively representing {target_comp}. You are evaluating a candidate for the {job_role} position. Every question you ask must be tailored to this candidate's actual background and the position applied for.

{corp_directives}{news_directive}

CANDIDATE PROFILE
-----------------------------------------
Name: {name}
Skills: {skills}

Experience:
{experience}

Projects:
{projects}

Education:
{education}
{student_ctx}{research_ctx}{interview_q_ctx}{role_ctx}{portfolio_ctx}{past_perf_ctx}
INTERVIEW SETTINGS
-----------------------------------------
{round_instr}

{diff_guide}
{avoided}{history}{force_block}

OUTPUT FORMAT - CRITICAL
-----------------------------------------
Return ONLY valid JSON - no markdown, no preamble, no explanation outside the JSON.
Use this EXACT structure:
{{
  "id": "q_<6 random lowercase chars>",
  "text": "<full, self-contained question text - reference {name}'s actual projects/skills>",
  "type": "technical|behavioural|system_design|coding",
  "topic": "<concise 1-4 word topic, e.g. React Hooks>",
  "expected_concepts": ["<concept1>", "<concept2>", "<concept3>"],
  "difficulty_level": "easy|medium|hard",
  "time_limit_secs": <integer>
}}

RULES:
1. "text" must be complete and specific to {name}'s background - not generic.
2. "topic" is 1-4 words and must be distinct from already-covered topics.
3. "time_limit_secs": voice answers = 90-240s; coding problems = 900-2700s.
4. Never repeat a topic already covered.
5. Return ONLY the JSON object. Nothing else.""".strip()


def _fmt_role_focus(job_role: str, round_type: str) -> str:
    if round_type != "technical":
        return ""

    role = (job_role or "Software Engineer").lower()
    topics = ["clean code", "ownership", "debugging", "system trade-offs"]
    label = job_role or "Software Engineer"

    if any(term in role for term in ["frontend", "front end", "ui engineer", "ui developer"]):
        label = job_role or "Frontend Engineer"
        topics = ["React or UI architecture", "state management", "browser rendering", "web performance", "accessibility", "frontend security"]
    elif any(term in role for term in ["backend", "back end", "api engineer", "server engineer"]):
        label = job_role or "Backend Engineer"
        topics = ["API design", "database design", "caching", "concurrency", "authentication and authorization", "scalability"]
    elif "full stack" in role or "fullstack" in role:
        label = job_role or "Full-Stack Engineer"
        topics = ["frontend-backend integration", "API boundaries", "database-backed product flows", "deployment", "end-to-end performance"]
    elif any(term in role for term in ["data engineer", "analytics engineer", "data platform"]):
        label = job_role or "Data Engineer"
        topics = ["ETL pipelines", "data warehousing", "batch vs streaming", "SQL optimization", "data quality"]
    elif any(term in role for term in ["ml engineer", "machine learning", "ai engineer"]):
        label = job_role or "ML Engineer"
        topics = ["model deployment", "feature engineering", "evaluation metrics", "MLOps", "serving trade-offs"]
    elif any(term in role for term in ["devops", "platform engineer", "site reliability", "sre"]):
        label = job_role or "DevOps Engineer"
        topics = ["CI/CD", "containers", "infrastructure as code", "monitoring", "incident response", "cloud architecture"]
    elif any(term in role for term in ["mobile", "android", "ios", "react native", "flutter"]):
        label = job_role or "Mobile Engineer"
        topics = ["app architecture", "lifecycle management", "offline sync", "performance", "API integration", "mobile UX constraints"]

    lines = ["\nROLE EXPECTATIONS", "-----------------------------------------"]
    lines.append(f"Target Role: {label}")
    lines.append("The interview MUST feel explicitly aligned to this role.")
    lines.append("Prioritize role-relevant themes such as:")
    for topic in topics:
        lines.append(f"  - {topic}")
    lines.append("")
    return "\n".join(lines)


def _fmt_experience(exp: list) -> str:
    if not exp:
        return "  No work experience listed."
    return "\n".join(
        f"  - {e.get('title', '')} at {e.get('company', '')} ({e.get('duration', '')})"
        for e in exp[:4]
    )


def _fmt_projects(projects: list) -> str:
    if not projects:
        return "  No projects listed."
    lines = []
    for p in projects[:4]:
        tech = p.get("tech") or p.get("tech_stack") or []
        if isinstance(tech, str):
            tech = [t.strip() for t in tech.split(",") if t.strip()]
        tech_str = ", ".join(tech[:5])
        desc = (p.get("description") or "")[:100]
        lines.append(f"  - {p.get('name', '')}: {desc}" + (f" [{tech_str}]" if tech_str else ""))
    return "\n".join(lines)


def _fmt_education(edu: list) -> str:
    if not edu:
        return "  No education listed."
    return "\n".join(
        f"  - {e.get('degree', '')} - {e.get('institution', '')} ({e.get('year', '')})"
        for e in edu[:2]
    )


def _fmt_history(history: list) -> str:
    lines = []
    for turn in (history or [])[-10:]:
        role = turn.get("role", "")
        content = (turn.get("content") or "")[:300]
        prefix = "Alex:" if role == "assistant" else "Candidate:"
        lines.append(f"  {prefix} {content}")
    return "\n".join(lines)


def _fmt_student_context(profile: dict) -> str:
    year = profile.get("year")
    branch = profile.get("branch")
    cgpa = profile.get("cgpa")
    targets = profile.get("target_companies") or []
    sectors = profile.get("target_sectors") or []

    if not any([year, branch, cgpa, targets, sectors]):
        return ""

    lines = ["\nSTUDENT CONTEXT", "-----------------------------------------"]
    if year:
        lines.append(f"Engineering Year: {year} year")
    if branch:
        lines.append(f"Branch: {branch}")
    if cgpa:
        lines.append(f"CGPA: {cgpa}/10")
    if targets:
        lines.append(f"Target Companies: {', '.join(targets[:10])}")
    if sectors:
        lines.append(f"Target Sectors: {', '.join(sectors)}")

    notes = []
    if "product_maang" in sectors:
        notes.append("Push hard on CS fundamentals, data structures, and system design.")
    if "it_services" in sectors:
        notes.append("Emphasize practical skills, communication clarity, and teamwork scenarios.")
    if "startups" in sectors:
        notes.append("Focus on ownership mindset, fast learning ability, and hands-on problem solving.")
    if "psu_govt" in sectors:
        notes.append("Include domain knowledge relevant to their engineering branch.")
    if "bfsi_fintech" in sectors:
        notes.append("Include questions on security awareness, data handling, and precision.")
    if notes:
        lines.append("")
        lines.append("INTERVIEWER NOTES:")
        for note in notes:
            lines.append(f"  -> {note}")

    lines.append("")
    return "\n".join(lines)


def _fmt_portfolio_context(profile: dict) -> str:
    files = profile.get("portfolio_files", [])
    if not files:
        return ""
    from services.context_assembler import build_portfolio_summary
    return build_portfolio_summary(files)


def _fmt_past_performance(profile: dict) -> str:
    weak = profile.get("known_weak_areas", [])
    strong = profile.get("known_strong_areas", [])
    past = profile.get("past_reports_summary", [])
    if not weak and not strong and not past:
        return ""
    from services.context_assembler import build_past_performance_summary
    return build_past_performance_summary(weak, strong, past)


def _fmt_research_context(profile: dict) -> str:
    ctx = profile.get("research_context")
    if not ctx or not isinstance(ctx, dict):
        return ""

    lines = ["\nEXTERNAL WEB CONTEXT (Live Scraped Data)", "-----------------------------------------"]
    for source, content in ctx.items():
        formatted_source = source.replace("_url", "").title()
        lines.append(f"[{formatted_source} Snippet]:\n{content}\n")
    lines.append("INTERVIEWER NOTES:")
    lines.append("-> Below is live data from their actual external profiles (LinkedIn, GitHub, Portfolio).")
    lines.append("-> You MUST creatively use this data to form hyper-realistic questions.")
    lines.append("-> If they have a specific repository listed, ask about an architectural decision or challenge from that repo.")
    lines.append("")
    return "\n".join(lines)


def _fmt_interview_questions_context(profile: dict, round_type: str) -> str:
    if round_type != "technical":
        return ""

    ctx = profile.get("company_questions_context", "")
    if not ctx:
        return ""

    target_comp = profile.get("target_company", "the target company")
    job_role = profile.get("job_role", "Software Engineer")
    role = (job_role or "Software Engineer").lower()
    role_focus = "role-relevant technical fundamentals for this position"
    if any(term in role for term in ("frontend", "front end", "ui")):
        role_focus = "frontend fundamentals such as browser rendering, React/state management, performance, and web security"
    elif any(term in role for term in ("backend", "back end", "api", "server")):
        role_focus = "backend fundamentals such as API design, database behavior, concurrency, caching, and scalability"
    elif any(term in role for term in ("full stack", "full-stack")):
        role_focus = "full-stack fundamentals such as UI-data flow, APIs, persistence, auth, deployment, and cross-layer trade-offs"
    elif any(term in role for term in ("data engineer", "analytics engineer", "data platform")):
        role_focus = "data-engineering fundamentals such as ETL design, warehousing, SQL optimization, and data reliability"
    elif any(term in role for term in ("ml engineer", "machine learning", "ai engineer")):
        role_focus = "ML/AI fundamentals such as model deployment, feature engineering, evaluation, and serving trade-offs"
    elif any(term in role for term in ("devops", "platform", "site reliability", "sre")):
        role_focus = "DevOps/platform fundamentals such as CI/CD, containers, observability, infra reliability, and incident response"
    elif any(term in role for term in ("mobile", "android", "ios")):
        role_focus = "mobile fundamentals such as app lifecycle, offline behavior, performance, device constraints, and API integration"

    lines = ["\nCOMPANY INTERVIEW QUESTION INTELLIGENCE (Live Search Data)", "-----------------------------------------"]
    lines.append(ctx)
    lines.append("")
    lines.append("INTERVIEWER DIRECTIVE (50/50 BLEND):")
    lines.append(f"-> The data above shows real CS fundamental topics and question patterns asked at {target_comp}.")
    lines.append("-> You MUST blend these into your questioning strategy:")
    lines.append(f"  * 50% of questions = standalone core CS + role fundamentals for the {job_role} role - NOT tied to their resume")
    lines.append("  * 50% of questions = project/resume deep-dives using the candidate's actual experience")
    lines.append(f"-> Use the above intelligence to calibrate your questions to {target_comp}'s actual hiring bar.")
    lines.append(f"-> Make the non-resume half feel explicitly aligned to {job_role}, especially {role_focus}.")
    lines.append("-> If the data mentions specific topics (e.g. ACID properties, OOP design patterns), prioritize those.")
    lines.append("")
    return "\n".join(lines)


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
