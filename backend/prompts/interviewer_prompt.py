"""
prompts/interviewer_prompt.py

Builds the master system prompt for Alex, the AI interviewer persona.
Exports: build_interviewer_prompt(), and legacy template strings.
"""
from __future__ import annotations
from typing import Optional


# Map session difficulty strings → canonical form used in guidance lookups
_DIFF_NORMALIZE: dict[str, str] = {
    "fresher":   "easy",
    "fresh":     "easy",
    "junior":    "easy",
    "easy":      "easy",
    "mid-level": "medium",
    "midlevel":  "medium",
    "mid":       "medium",
    "medium":    "medium",
    "senior":    "hard",
    "hard":      "hard",
    "expert":    "hard",
}


_ROUND_INSTRUCTIONS = {
    "technical": (
        "ROUND: TECHNICAL\n"
        "QUESTION DISTRIBUTION (STRICT — enforce this across the full session):\n"
        "  * 20% CORE CS — pulled from the question bank and provided to you as context. "
        "Treat DB-supplied questions as given; do not modify them.\n"
        "  * 50% ROLE-BASED FUNDAMENTALS — standalone CS theory and applied engineering "
        "questions NOT tied to the candidate's specific projects. Cover: "
        "OOP (inheritance, polymorphism, SOLID, design patterns), "
        "DBMS (SQL, normalization, ACID, indexing, transactions, query optimisation), "
        "OS (processes vs threads, scheduling, deadlocks, paging, virtual memory), "
        "Computer Networks (TCP/IP, HTTP/S, DNS, REST, WebSockets, CDN). "
        "Calibrate topics and depth to the stated difficulty level.\n"
        "  * 30% RESUME DEEP-DIVES — questions tied directly to the candidate's listed "
        "projects, tech stack, and work experience. Reference their actual project names "
        "and tools: 'In your {project} you used {tech} — explain how you handled X.' "
        "Probe architecture decisions, trade-offs, debugging, and ownership.\n\n"
        "FOLLOW-UP RULE: After a shallow or partial answer, ask one targeted follow-up "
        "on the same concept ('Can you explain how X works internally?' or "
        "'What would break if Y failed?') before moving to a new topic.\n"
        "PROBE DEPTH: start broad, drill down — avoid surface-level questions for "
        "mid-level and senior candidates.\n"
        "TOPIC DIVERSITY: never ask two consecutive questions on the same topic."
    ),
    "hr": (
        "ROUND: HR / BEHAVIOURAL\n"
        "QUESTION DISTRIBUTION (STRICT — follow this across the full interview):\n"
        "  * 30% GENERIC BEHAVIORAL — cover STAR categories: Leadership, Conflict Resolution, "
        "Failure & Learning, Teamwork, Initiative, Time Management, Adaptability, Communication. "
        "Each category at most once. Do NOT repeat a category already covered.\n"
        "  * 70% RESUME GRILLING — tie directly to the candidate's stated experience, projects, "
        "and skills. Ask them to reflect on a specific situation from THEIR resume using STAR. "
        "E.g. 'In your NurseConnect project you led the geo-location feature — tell me about a "
        "time that feature hit a problem and how you resolved it.'\n\n"
        "STAR ENFORCEMENT: Every behavioral question must be answerable with a STAR story. "
        "Do NOT ask 'how would you...' (hypothetical) — ask 'tell me about a time you...' (real). "
        "Follow up on vague answers: 'What was the specific outcome?' or 'What did YOU do vs the team?'\n\n"
        "CATEGORY TRACKER: Before generating a question, check the conversation history. "
        "If Leadership has been covered, pick a different category next. "
        "Rotate through categories systematically — do not repeat.\n\n"
        "TONE: Professional but warm. Probe for specifics. Never accept 'we did X' — always "
        "redirect to 'what did YOU specifically do?'"
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
        "DIFFICULTY: FRESHER / JUNIOR (0–1 year of experience)\n"
        "TARGET: Final-year students or fresh graduates entering their first role.\n\n"
        "CALIBRATION RULES:\n"
        "- Ask for clear definitions with one concrete example: 'What is X? Give a real scenario.'\n"
        "- Appropriate topics: what is a class vs object, what is inheritance, "
        "simple SQL SELECT/JOIN/WHERE, what is a process vs thread, what does HTTP do, "
        "basic sorting algorithms (bubble/merge), what is an index, what is recursion.\n"
        "- Accept textbook-level answers with one real-world analogy or example.\n"
        "- Reward clear communication and logical thinking even without deep internals.\n"
        "- DO NOT ask system design, distributed systems, production trade-offs, "
        "concurrency edge cases, or advanced query optimisation.\n"
        "- For resume questions: focus on what they built, what tech they used, and "
        "WHY they chose it — not on scaling or production hardening.\n"
        "- Keep follow-up questions one level deeper: if they define OOP, ask for "
        "a real example from their code, not for SOLID principles."
    ),
    "medium": (
        "DIFFICULTY: MID-LEVEL (1–3 years of experience)\n"
        "TARGET: Candidates who have shipped real features or maintained production code.\n\n"
        "CALIBRATION RULES:\n"
        "- Ask applied questions: 'Explain X — how have you actually used it?' or "
        "'What trade-off would you make between X and Y?'\n"
        "- Appropriate topics: SQL indexing and query performance, ACID vs BASE, "
        "deadlock prevention strategies, REST API design best practices, "
        "SOLID principles with code examples, caching strategies (LRU, write-through), "
        "concurrency basics (mutex, race conditions), basic system design "
        "(simple URL shortener, task queue, REST service with a DB).\n"
        "- Expect working solutions, error handling, and at least one explicit trade-off mentioned.\n"
        "- For resume questions: probe architecture decisions — 'Why did you choose X over Y?', "
        "'How did you test this?', 'What would you do differently?'\n"
        "- Push back gently on vague answers: 'Can you be more specific about how that works?'\n"
        "- One system-design-lite question is appropriate (e.g. design a simple cache, "
        "a rate limiter, a file upload service)."
    ),
    "hard": (
        "DIFFICULTY: SENIOR / EXPERT (3+ years of experience)\n"
        "TARGET: Engineers expected to own systems, make architectural decisions, "
        "and mentor others.\n\n"
        "CALIBRATION RULES:\n"
        "- Go deep into internals: 'How does X work under the hood?', "
        "'What breaks at 1M requests/day?', 'How would you debug this in prod?'\n"
        "- Appropriate topics: database internals (B-tree indexing, MVCC, query planner), "
        "distributed systems (CAP theorem, eventual consistency, consensus, sharding), "
        "concurrency at scale (lock-free data structures, CAS, async I/O), "
        "system design at scale (multi-region, CDN, rate limiting, circuit breakers), "
        "security (SQL injection, CSRF, auth token lifecycle, secrets management), "
        "observability (metrics, tracing, alerting strategy).\n"
        "- Expect production-hardened answers: failure modes, SLA constraints, "
        "monitoring hooks, rollback strategy, real numbers (latency, throughput).\n"
        "- Challenge assumptions proactively: 'What if that cache node goes down?', "
        "'How does this hold up under concurrent writes?'\n"
        "- For resume questions: probe ownership and impact — 'What was the hardest "
        "production incident you handled?', 'What would you redesign knowing what "
        "you know now?', 'How did you make this system observable?'"
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
    diff_key    = _DIFF_NORMALIZE.get((difficulty or "medium").lower(), "medium")
    diff_guide  = _DIFFICULTY_GUIDANCE[diff_key]

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

    return f"""You are a senior technical interviewer and Hiring Bar-Raiser exclusively representing {target_comp}. You are evaluating a candidate for the {job_role} position. Every question you ask must be tailored to this candidate's actual background and the position applied for.

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
    # Cap at last 4 exchanges (8 turns) to keep prompt size bounded.
    # Earlier exchanges are summarised in the score annotations on each answer.
    lines = []
    for turn in (history or [])[-8:]:
        role = turn.get("role", "")
        content = (turn.get("content") or "")[:300]
        prefix = "Interviewer:" if role == "assistant" else "Candidate:"
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
