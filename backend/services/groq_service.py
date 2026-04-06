"""
Groq service — wraps the Groq Python SDK for LLM calls.
Model: llama-3.3-70b-versatile
"""
import os
import json
import asyncio
import math
from pathlib import Path
from typing import AsyncIterator
from dotenv import load_dotenv
from groq import Groq, AsyncGroq

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

_client = None
_async_client = None


def _require_env(name: str) -> str:
    value = os.getenv(name)
    if value:
        return value
    raise RuntimeError(
        f"Missing required environment variable: {name}. "
        "Make sure backend/.env exists and restart the backend."
    )


def get_client() -> Groq:
    global _client
    if _client is None:
        _client = Groq(api_key=_require_env("GROQ_API_KEY"))
    return _client


def _get_async_client() -> AsyncGroq:
    global _async_client
    if _async_client is None:
        _async_client = AsyncGroq(api_key=_require_env("GROQ_API_KEY"))
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


_CS_CATEGORY_ORDER = ["OOP", "DBMS", "OS", "CN", "Frontend", "Backend", "FullStack", "Data", "ML", "DevOps", "Mobile"]


def _role_focus_config(job_role: str) -> dict:
    role = (job_role or "").lower()

    if any(term in role for term in ["frontend", "front end", "ui engineer", "ui developer"]):
        return {
            "category": "Frontend",
            "label": "Frontend Engineering",
            "topics": ["React or UI architecture", "state management", "browser rendering", "web performance", "accessibility", "frontend security"],
            "resume_probe": "component structure, state flow, rendering trade-offs, accessibility choices, and debugging UI performance issues",
            "core_focus": "Ask role-relevant fundamentals such as browser rendering, caching, HTTP behaviour, state management, and frontend architecture alongside core CS basics.",
        }
    if any(term in role for term in ["backend", "back end", "api engineer", "server engineer"]):
        return {
            "category": "Backend",
            "label": "Backend Engineering",
            "topics": ["API design", "database design", "caching", "concurrency", "authentication and authorization", "scalability"],
            "resume_probe": "API contracts, data modeling, concurrency handling, caching decisions, and production trade-offs",
            "core_focus": "Ask role-relevant fundamentals such as APIs, transactions, concurrency, caching, and distributed service behaviour alongside core CS basics.",
        }
    if "full stack" in role or "fullstack" in role:
        return {
            "category": "FullStack",
            "label": "Full-Stack Engineering",
            "topics": ["frontend-backend integration", "state and API boundaries", "database-backed product flows", "deployment", "performance across the stack"],
            "resume_probe": "how the UI, APIs, and database fit together, and what trade-offs they made across the stack",
            "core_focus": "Ask role-relevant fundamentals such as client-server flows, API integration, persistence, and end-to-end performance alongside core CS basics.",
        }
    if any(term in role for term in ["data engineer", "analytics engineer", "data platform"]):
        return {
            "category": "Data",
            "label": "Data Engineering",
            "topics": ["ETL pipelines", "data warehousing", "batch vs streaming", "SQL optimization", "data quality"],
            "resume_probe": "pipeline design, data modeling, orchestration, reliability, and performance bottlenecks",
            "core_focus": "Ask role-relevant fundamentals such as SQL, storage design, pipeline reliability, and scaling data systems alongside core CS basics.",
        }
    if any(term in role for term in ["ml engineer", "machine learning", "ai engineer"]):
        return {
            "category": "ML",
            "label": "ML Engineering",
            "topics": ["model deployment", "feature engineering", "evaluation metrics", "MLOps", "serving trade-offs"],
            "resume_probe": "how models were trained, evaluated, deployed, monitored, and improved in production",
            "core_focus": "Ask role-relevant fundamentals such as model serving, feature pipelines, latency, and reliability alongside core CS basics.",
        }
    if any(term in role for term in ["devops", "platform engineer", "site reliability", "sre"]):
        return {
            "category": "DevOps",
            "label": "DevOps / Platform Engineering",
            "topics": ["CI/CD", "containers", "infrastructure as code", "monitoring", "incident response", "cloud architecture"],
            "resume_probe": "deployment pipelines, release safety, infra decisions, observability, and reliability trade-offs",
            "core_focus": "Ask role-relevant fundamentals such as deployment, networking, Linux/process basics, observability, and reliability alongside core CS basics.",
        }
    if any(term in role for term in ["mobile", "android", "ios", "react native", "flutter"]):
        return {
            "category": "Mobile",
            "label": "Mobile Engineering",
            "topics": ["app architecture", "lifecycle management", "offline sync", "performance", "API integration", "mobile UX constraints"],
            "resume_probe": "screen architecture, state handling, network/data sync, and mobile performance trade-offs",
            "core_focus": "Ask role-relevant fundamentals such as app lifecycle, caching, offline behaviour, networking, and performance alongside core CS basics.",
        }

    return {
        "category": "OOP",
        "label": "Software Engineering",
        "topics": ["role-specific problem solving", "system design choices", "clean code", "debugging", "ownership"],
        "resume_probe": "the technical decisions they made, what they owned, and how their work mapped to the role",
        "core_focus": "Ask core CS fundamentals through the lens of the stated job role wherever possible.",
    }


def _project_techs(project: dict) -> list[str]:
    tech = project.get("tech") or project.get("tech_stack") or []
    if isinstance(tech, str):
        tech = [t.strip() for t in tech.split(",") if t.strip()]
    return [str(t).strip() for t in tech if str(t).strip()]


def _normalized_projects(projects: list) -> list[dict]:
    normalized = []
    for project in projects or []:
        if not isinstance(project, dict):
            continue
        tech = _project_techs(project)
        normalized.append({
            **project,
            "name": (project.get("name") or "").strip(),
            "description": (project.get("description") or "").strip(),
            "points": project.get("points") or [],
            "tech": tech,
            "tech_stack": tech,
        })
    return normalized


def _project_prompt_block(projects: list[dict]) -> str:
    if not projects:
        return "none"

    lines = []
    for project in projects[:4]:
        name = project.get("name") or "Unnamed Project"
        desc = project.get("description") or "No description provided"
        tech = ", ".join(project.get("tech", [])[:6]) or "stack not specified"
        bullets = "; ".join(str(p).strip() for p in (project.get("points") or [])[:3] if str(p).strip())
        line = f"{name} [{tech}] - {desc}"
        if bullets:
            line += f" | Highlights: {bullets}"
        lines.append(line)
    return "\n- ".join([""] + lines).strip()


def _infer_question_category(question_text: str, current_category: str, project_names: list[str]) -> str:
    category = (current_category or "").strip()
    if category:
        normalized = category.lower()
        mapping = {
            "oop": "OOP",
            "dbms": "DBMS",
            "database": "DBMS",
            "sql": "DBMS",
            "os": "OS",
            "operating systems": "OS",
            "cn": "CN",
            "computer networks": "CN",
            "networking": "CN",
            "project": "Project",
            "projects": "Project",
            "hr": "HR",
            "systemdesign": "SystemDesign",
            "system design": "SystemDesign",
            "algorithms": "Algorithms",
            "algorithm": "Algorithms",
            "dsa": "DSA",
        }
        if normalized in mapping:
            return mapping[normalized]

    text = (question_text or "").lower()
    if any(name.lower() in text for name in project_names if name):
        return "Project"
    if any(phrase in text for phrase in ["your project", "you built", "you used", "in your resume", "on your resume"]):
        return "Project"
    if any(phrase in text for phrase in ["acid", "normalization", "indexing", "transaction", "join", "sql", "database"]):
        return "DBMS"
    if any(phrase in text for phrase in ["thread", "process", "deadlock", "paging", "virtual memory", "scheduler", "memory management"]):
        return "OS"
    if any(phrase in text for phrase in ["http", "https", "dns", "tcp", "udp", "socket", "websocket", "osi", "rest"]):
        return "CN"
    if any(phrase in text for phrase in ["oop", "polymorphism", "inheritance", "encapsulation", "abstraction", "solid", "design pattern"]):
        return "OOP"
    if any(phrase in text for phrase in ["react", "component", "hooks", "state management", "browser rendering", "accessibility", "css", "frontend"]):
        return "Frontend"
    if any(phrase in text for phrase in ["api", "microservice", "concurrency", "queue", "caching", "authentication", "backend", "server-side"]):
        return "Backend"
    if any(phrase in text for phrase in ["full stack", "end-to-end flow", "client-server", "frontend and backend"]):
        return "FullStack"
    if any(phrase in text for phrase in ["etl", "warehouse", "spark", "airflow", "streaming pipeline", "data quality"]):
        return "Data"
    if any(phrase in text for phrase in ["model deployment", "feature engineering", "inference", "mlops", "evaluation metric"]):
        return "ML"
    if any(phrase in text for phrase in ["ci/cd", "docker", "kubernetes", "terraform", "monitoring", "incident response", "devops"]):
        return "DevOps"
    if any(phrase in text for phrase in ["android", "ios", "react native", "flutter", "mobile app", "offline sync"]):
        return "Mobile"
    if any(phrase in text for phrase in ["complexity", "binary search", "dynamic programming", "hash map", "tree", "graph", "algorithm"]):
        return "Algorithms"
    return "Project" if project_names else "OOP"


def _normalize_generated_question(question: dict, difficulty: str, project_names: list[str]) -> dict:
    text = (question.get("question_text") or question.get("text") or "").strip()
    category = _infer_question_category(text, question.get("category") or question.get("topic") or "", project_names)
    expected_points = question.get("expected_points") or question.get("expected_concepts") or []
    if isinstance(expected_points, str):
        expected_points = [expected_points]

    cleaned_points = [str(p).strip() for p in expected_points if str(p).strip()]

    return {
        "question_text": text,
        "text": text,
        "category": category,
        "topic": category,
        "expected_points": cleaned_points,
        "expected_concepts": cleaned_points,
        "difficulty_level": question.get("difficulty_level", difficulty),
    }


def _normalize_coding_question(question: dict, difficulty: str) -> dict:
    title = (question.get("title") or question.get("question_text") or "Coding Problem").strip()
    description = (question.get("description") or question.get("text") or title).strip()
    topic = (question.get("topic") or question.get("category") or "DSA").strip()

    examples = question.get("examples") or []
    if isinstance(examples, dict):
        examples = [examples]
    cleaned_examples = []
    for ex in examples[:3]:
        if not isinstance(ex, dict):
            continue
        cleaned_examples.append({
            "input": str(ex.get("input", "")).strip(),
            "output": str(ex.get("output", "")).strip(),
            "explanation": str(ex.get("explanation", "")).strip(),
        })
    if not cleaned_examples:
        cleaned_examples = [
            {
                "input": "nums = [2, 7, 11, 15], target = 9",
                "output": "[0, 1]",
                "explanation": "",
            },
            {
                "input": "nums = [3, 2, 4], target = 6",
                "output": "[1, 2]",
                "explanation": "",
            },
        ]

    constraints = question.get("constraints") or []
    if isinstance(constraints, str):
        constraints = [constraints]
    cleaned_constraints = [str(item).strip() for item in constraints if str(item).strip()]
    if not cleaned_constraints:
        cleaned_constraints = ["Aim for an efficient solution.", "Explain time and space complexity."]

    expected_points = question.get("expected_points") or question.get("expected_concepts") or []
    if isinstance(expected_points, str):
        expected_points = [expected_points]
    cleaned_points = [str(item).strip() for item in expected_points if str(item).strip()]

    return {
        "title": title,
        "question_text": title,
        "text": description,
        "description": description,
        "category": topic,
        "topic": topic,
        "examples": cleaned_examples,
        "constraints": cleaned_constraints,
        "hint": str(question.get("hint", "")).strip(),
        "expected_points": cleaned_points,
        "expected_concepts": cleaned_points,
        "difficulty_level": question.get("difficulty_level") or question.get("difficulty") or difficulty,
        "time_limit_mins": question.get("time_limit_mins"),
    }


def _normalize_mcq_question(question: dict, difficulty: str, project_names: list[str]) -> dict:
    text = (question.get("question_text") or question.get("text") or "").strip()
    category = _infer_question_category(text, question.get("category") or question.get("topic") or "MCQ Practice", project_names)

    options = question.get("options") or []
    if isinstance(options, dict):
        options = list(options.values())
    cleaned_options = []
    seen_options = set()
    for option in options:
        cleaned = str(option).strip()
        key = cleaned.lower()
        if cleaned and key not in seen_options:
            seen_options.add(key)
            cleaned_options.append(cleaned)
        if len(cleaned_options) == 4:
            break

    correct_index = question.get("correct_option_index")
    if correct_index is None and question.get("correct_answer_index") is not None:
        correct_index = question.get("correct_answer_index")
    try:
        correct_index = int(correct_index) if correct_index is not None else None
    except Exception:
        correct_index = None

    correct_option = str(question.get("correct_option") or "").strip()
    if not correct_option and correct_index is not None and 0 <= correct_index < len(cleaned_options):
        correct_option = cleaned_options[correct_index]

    if correct_option and all(correct_option.lower() != option.lower() for option in cleaned_options):
        cleaned_options.append(correct_option)

    while len(cleaned_options) < 4:
        cleaned_options.append(f"Option {len(cleaned_options) + 1}")

    if correct_option:
        match_index = next(
            (idx for idx, option in enumerate(cleaned_options) if option.lower() == correct_option.lower()),
            None,
        )
        if match_index is not None:
            correct_index = match_index
    if correct_index is None:
        correct_index = 0
        correct_option = cleaned_options[0]
    else:
        correct_option = cleaned_options[correct_index]

    explanation = str(question.get("explanation") or question.get("rationale") or "").strip()
    if not explanation:
        explanation = f"This question tests {category} fundamentals in a company-style screening format."

    return {
        "question_text": text,
        "text": text,
        "category": category,
        "topic": category,
        "options": cleaned_options[:4],
        "correct_option_index": correct_index,
        "correct_answer_index": correct_index,
        "correct_option": correct_option,
        "explanation": explanation,
        "difficulty_level": question.get("difficulty_level", difficulty),
        "source_signal": str(question.get("source_signal") or "").strip(),
    }


def _build_mcq_fallback_questions(
    projects: list[dict],
    skills: list[str],
    difficulty: str,
    count: int,
    job_role: str,
    target_company: str,
) -> list[dict]:
    role_focus = _role_focus_config(job_role)
    project_pool = projects or [{
        "name": "your resume project",
        "description": "an engineering project from the resume",
        "tech": skills[:4],
    }]

    company_label = target_company or "the target company"
    core_bank = [
        {
            "question_text": f"{company_label} often screens on database reliability. Which property guarantees that a transaction is fully completed or fully rolled back?",
            "category": "DBMS",
            "options": ["Atomicity", "Normalization", "Sharding", "Serialization"],
            "correct_option_index": 0,
            "explanation": "Atomicity ensures all-or-nothing execution of a transaction.",
        },
        {
            "question_text": f"For a {job_role or 'software engineering'} screening at {company_label}, which HTTP behavior most directly reduces repeated network fetches in web clients?",
            "category": role_focus["category"] if role_focus["category"] != "OOP" else "CN",
            "options": ["Caching with cache-control semantics", "Increasing CSS specificity", "Using recursion in controllers", "Replacing SQL with CSV files"],
            "correct_option_index": 0,
            "explanation": "HTTP caching semantics are a core company-screening topic for performance-aware engineering roles.",
        },
        {
            "question_text": f"{company_label} interview screens often test OS fundamentals. Which issue occurs when two or more threads wait forever on one another's resources?",
            "category": "OS",
            "options": ["Deadlock", "Star topology", "Segmentation", "Normalization"],
            "correct_option_index": 0,
            "explanation": "Deadlock is the classic concurrency failure mode where progress stops permanently.",
        },
        {
            "question_text": f"In an OOP-focused screen for {company_label}, which principle is best described as exposing only essential behavior while hiding implementation details?",
            "category": "OOP",
            "options": ["Abstraction", "Duplication", "Serialization", "Replication"],
            "correct_option_index": 0,
            "explanation": "Abstraction hides internal complexity behind a simpler interface.",
        },
    ]

    role_bank = [
        {
            "question_text": f"For the {job_role or 'software engineer'} role at {company_label}, which topic is most central to {role_focus['label']} fundamentals?",
            "category": role_focus["category"],
            "options": [
                role_focus["topics"][0],
                "Printing stack traces manually",
                "Ignoring performance bottlenecks",
                "Skipping code reviews entirely",
            ],
            "correct_option_index": 0,
            "explanation": f"{role_focus['topics'][0]} is a strong role-aligned screening topic for this role.",
        },
    ]

    project_bank = []
    for project in project_pool[: max(1, min(4, count))]:
        tech = ", ".join(project.get("tech", [])[:4]) or ", ".join(skills[:4]) or "the listed stack"
        name = project.get("name") or "your project"
        project_bank.append({
            "question_text": f"Based on {name} on the resume, which discussion point would be most relevant in a {company_label} screening for {job_role or 'software engineer'}?",
            "category": "Project",
            "options": [
                f"Explaining why {tech} was chosen and what trade-offs it introduced",
                "Listing random buzzwords unrelated to the project",
                "Avoiding implementation details entirely",
                "Only describing the UI color palette",
            ],
            "correct_option_index": 0,
            "explanation": "Strong resume-based screening questions focus on real implementation choices and trade-offs.",
        })

    bank = []
    while len(bank) < count:
        bank.extend(core_bank)
        bank.extend(project_bank or core_bank[:1])
        bank.extend(role_bank)

    project_names = [p.get("name", "") for p in projects]
    return [
        _normalize_mcq_question(question, difficulty, project_names)
        for question in bank[:count]
    ]


def _build_project_fallback_questions(projects: list[dict], skills: list[str], difficulty: str, count: int, job_role: str) -> list[dict]:
    prompts = []
    role_focus = _role_focus_config(job_role)
    difficulty_probe = {
        "easy": "the core architecture and your role",
        "medium": "the trade-offs you made and how you debugged issues",
        "hard": "scaling trade-offs, failure modes, and production hardening decisions",
    }.get(difficulty, "the technical decisions you made")

    source_items = projects or [{
        "name": "your listed experience",
        "description": "",
        "tech": skills[:5],
        "points": [],
    }]

    for idx in range(count):
        project = source_items[idx % len(source_items)]
        tech = ", ".join(project.get("tech", [])[:5]) or ", ".join(skills[:5]) or "the tools you chose"
        name = project.get("name") or "your project"
        description = project.get("description") or "the problem it solved"
        text = (
            f"In {name}, you worked with {tech}. Walk me through {difficulty_probe} "
            f"while building it, including how the system worked, how it matched {job_role or 'the role'}, "
            f"and why you chose that approach for {description}. Focus especially on {role_focus['resume_probe']}."
        )
        points = [
            "Problem statement and scope",
            "Architecture or implementation flow",
            "Key trade-offs and technical decisions",
            "How the work mapped to the target role",
            "A challenge, bug, or improvement you handled personally",
        ]
        prompts.append({
            "question_text": text,
            "text": text,
            "category": "Project",
            "topic": "Project",
            "expected_points": points,
            "expected_concepts": points,
            "difficulty_level": difficulty,
        })
    return prompts


def _build_cs_fallback_questions(difficulty: str, count: int, job_role: str) -> list[dict]:
    role_focus = _role_focus_config(job_role)
    bank = [
        {
            "question_text": "Explain the difference between abstraction and encapsulation in object-oriented programming, and tell me when each matters in real code.",
            "category": "OOP",
            "expected_points": ["Definition of abstraction", "Definition of encapsulation", "Practical difference", "Real-world example"],
        },
        {
            "question_text": "What are ACID properties in DBMS, and why do they matter when multiple users update data concurrently?",
            "category": "DBMS",
            "expected_points": ["Atomicity", "Consistency", "Isolation", "Durability"],
        },
        {
            "question_text": "Explain the difference between a process and a thread, and describe one real engineering trade-off between them.",
            "category": "OS",
            "expected_points": ["Memory isolation", "Scheduling/unit of execution", "Overhead trade-off", "Use case example"],
        },
        {
            "question_text": "Walk me through what happens from the moment you enter a URL in a browser until the page starts loading.",
            "category": "CN",
            "expected_points": ["DNS lookup", "TCP/TLS connection", "HTTP request/response", "Browser rendering start"],
        },
    ]

    role_specific = {
        "Frontend": {
            "question_text": "In a frontend role, how does the browser rendering pipeline work, and what practical steps would you take to avoid unnecessary re-renders and layout thrashing?",
            "category": "Frontend",
            "expected_points": ["Critical rendering path", "Re-render triggers", "Layout thrashing", "Performance optimization techniques"],
        },
        "Backend": {
            "question_text": "For a backend role, explain how you would design and protect an API that handles concurrent writes safely while still performing well.",
            "category": "Backend",
            "expected_points": ["Concurrency control", "Transactions or idempotency", "Consistency guarantees", "Performance trade-offs"],
        },
        "FullStack": {
            "question_text": "For a full-stack role, walk me through an end-to-end user request from the browser to the backend and database, including the key failure points you would watch.",
            "category": "FullStack",
            "expected_points": ["Client-server flow", "API boundary", "Persistence layer", "Failure handling and observability"],
        },
        "Data": {
            "question_text": "For a data engineering role, explain the difference between batch and streaming pipelines and when you would choose one over the other.",
            "category": "Data",
            "expected_points": ["Batch vs streaming", "Latency vs cost", "Reliability considerations", "Practical use cases"],
        },
        "ML": {
            "question_text": "For an ML engineering role, how do you move a model from experimentation to reliable production serving without hurting latency or quality?",
            "category": "ML",
            "expected_points": ["Offline vs online validation", "Serving architecture", "Monitoring and drift", "Latency and rollback trade-offs"],
        },
        "DevOps": {
            "question_text": "For a DevOps or platform role, explain how you would design a safe CI/CD pipeline that supports fast releases without compromising rollback safety.",
            "category": "DevOps",
            "expected_points": ["Build and test gates", "Progressive delivery or rollback", "Observability", "Release safety trade-offs"],
        },
        "Mobile": {
            "question_text": "For a mobile role, explain how you would handle app lifecycle events, caching, and offline behavior so the app still feels reliable to the user.",
            "category": "Mobile",
            "expected_points": ["Lifecycle handling", "Caching strategy", "Offline sync", "User experience trade-offs"],
        },
    }

    role_item = role_specific.get(role_focus["category"])
    if role_item:
        bank = [role_item] + bank

    questions = []
    for idx in range(count):
        item = bank[idx % len(bank)]
        questions.append({
            **item,
            "topic": item["category"],
            "expected_concepts": item["expected_points"],
            "difficulty_level": difficulty,
            "text": item["question_text"],
        })
    return questions


def _enforce_technical_distribution(
    questions: list[dict],
    projects: list[dict],
    skills: list[str],
    difficulty: str,
    num_questions: int,
    job_role: str,
) -> list[dict]:
    project_names = [p.get("name", "") for p in projects]
    normalized = [_normalize_generated_question(q, difficulty, project_names) for q in questions if q]

    project_target = (num_questions // 2) if (projects or skills) else 0
    cs_target = max(0, num_questions - project_target)

    project_questions = [q for q in normalized if q["category"] == "Project"]
    cs_questions = [q for q in normalized if q["category"] in _CS_CATEGORY_ORDER]
    other_questions = [q for q in normalized if q not in project_questions and q not in cs_questions]

    if len(project_questions) < project_target:
        project_questions.extend(
            _build_project_fallback_questions(projects, skills, difficulty, project_target - len(project_questions), job_role)
        )

    if len(cs_questions) < cs_target:
        cs_questions.extend(_build_cs_fallback_questions(difficulty, cs_target - len(cs_questions), job_role))

    final_questions = []
    cs_slots = set()
    if cs_target:
        cs_slots = {
            max(0, min(num_questions - 1, round(((idx + 1) * num_questions) / (cs_target + 1)) - 1))
            for idx in range(cs_target)
        }

    project_iter = project_questions[:project_target]
    cs_iter = cs_questions[:cs_target]
    other_iter = other_questions[:]

    for idx in range(num_questions):
        if idx in cs_slots and cs_iter:
            final_questions.append(cs_iter.pop(0))
        elif project_iter:
            final_questions.append(project_iter.pop(0))
        elif cs_iter:
            final_questions.append(cs_iter.pop(0))
        elif other_iter:
            final_questions.append(other_iter.pop(0))

    seen = set()
    deduped = []
    for question in final_questions + other_iter + project_iter + cs_iter:
        key = question.get("question_text", "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(question)
        if len(deduped) >= num_questions:
            break

    return deduped


async def generate_questions(
    resume_data: dict,
    round_type: str,
    difficulty: str,
    num_questions: int,
) -> list:
    """Generate interview questions tailored to the candidate's resume."""

    skill_list   = [str(s).strip() for s in (resume_data.get("skills", []) or []) if str(s).strip()]
    skills       = ", ".join(skill_list[:12]) or "general software engineering"
    projects     = _normalized_projects(resume_data.get("projects", []))
    project_desc = _project_prompt_block(projects)
    education    = resume_data.get("education", [])
    edu_desc     = education[0].get("degree", "") if education else ""
    target_comp  = resume_data.get("target_company", "Top Tech Company")
    job_role     = resume_data.get("job_role", "Software Engineer")
    news_ctx     = resume_data.get("company_news_context", "")
    interview_q_ctx = resume_data.get("company_questions_context", "")
    role_focus   = _role_focus_config(job_role)

    # Round-specific instructions
    if round_type == "technical":
        # Calculate question distribution counts
        proj_count = max(1, num_questions // 2)             # 50% project/resume
        cs_count   = max(1, num_questions - proj_count)     # 50% core fundamentals / role fundamentals

        # Live interview intelligence block
        live_intel_block = ""
        if interview_q_ctx:
            live_intel_block = f"""
LIVE INTERVIEW INTELLIGENCE (searched from the web for {target_comp}):
{interview_q_ctx}
→ Use these real-world question patterns and topics to calibrate your questions to {target_comp}'s actual hiring bar.
→ If the data mentions specific topics (e.g. 'ACID', 'deadlocks', 'polymorphism'), generate questions covering those.
"""

        topic_guide = f"""
STRICT QUESTION DISTRIBUTION (you MUST follow this exactly):

BATCH 1 ? CS FUNDAMENTALS ({cs_count} questions):
  Generate {cs_count} standalone core-fundamentals questions that are NOT about the candidate's specific projects.
  Cover these core subjects:
  - OOP: classes, inheritance, polymorphism, SOLID principles, abstraction, encapsulation, design patterns
  - DBMS: SQL, normalization (1NF-3NF), ACID properties, indexing, transactions, joins, stored procedures
  - Operating Systems: processes vs threads, scheduling algorithms, deadlocks, memory management, paging, virtual memory
  - Computer Networks: OSI model, TCP/IP, HTTP/HTTPS, DNS, sockets, REST vs WebSocket
  These must be standalone theory or role-engineering fundamentals questions.
  For the stated role ({job_role}), explicitly include topics like: {", ".join(role_focus["topics"])}.
  These should still be independent of the candidate's specific projects.

BATCH 2 ? PROJECT & RESUME DEEP-DIVES ({proj_count} questions):
  Generate {proj_count} questions tied directly to the candidate's actual projects and skills.
  Reference their project names, implementation details, and tech stacks explicitly.
  Prefer architecture decisions, trade-offs, debugging stories, scalability, ownership, and why specific tools/frameworks were chosen.
  For the stated role ({job_role}), especially probe {role_focus["resume_probe"]}.
  Examples: "In your {{project}} you used {{tech}}. How did you handle X?" or "You listed {{skill}} ? explain how you applied it in {{project}}."

CRITICAL RULES:
- Keep the overall mix as close to 50% project/resume deep-dives and 50% core/role fundamentals as mathematically possible
- NEVER skip either half ? both resume deep-dives and core fundamentals must be present
- The questions must feel explicitly aligned to the target role: {role_focus["label"]}
- {role_focus["core_focus"]}
- Use the `Project` category for resume/project deep-dives and `OOP`, `DBMS`, `OS`, or `CN` for standalone CS questions
- Role-focused fundamentals may use categories such as `{role_focus["category"]}` when appropriate
{live_intel_block}"""
    elif round_type == "hr":
        topic_guide = """
Topics: behavioral, situational, culture fit, communication, teamwork, leadership, 
conflict resolution, career goals, strengths/weaknesses, motivation.
Use STAR-method oriented questions. Make them personalised to the candidate's background."""
    elif round_type == "dsa":
        coding_intel_block = ""
        if interview_q_ctx:
            coding_intel_block = (
                f"\nRECENT {target_comp.upper()} CODING / OA SIGNALS:\n"
                f"{interview_q_ctx}\n"
                "Use these recent patterns to bias topic selection, framing, and difficulty."
            )
        topic_guide = f"""
Generate {num_questions} complete DSA coding problems. Each must have:
- Short title
- Full OA-style problem statement
- 2 sample test cases with sample outputs
- Constraints
- Difficulty-appropriate topic (easy=arrays/strings, medium=trees/hashmaps/binary search, hard=DP/graphs/advanced)
- A subtle hint
Each problem should feel like a professional online assessment for {target_comp} and the {job_role} role.{coding_intel_block}
Return fields title, description, examples, constraints, difficulty, topic, and hint."""
    elif round_type == "mcq_practice":
        mcq_intel_block = ""
        if interview_q_ctx:
            mcq_intel_block = (
                f"\nRECENT {target_comp.upper()} SCREENING / MCQ SIGNALS:\n"
                f"{interview_q_ctx}\n"
                "Every question must feel like it belongs to this company's actual screening style."
            )
        topic_guide = f"""
Generate exactly {num_questions} professional multiple-choice questions for a company-specific practice round.

NON-NEGOTIABLE REQUIREMENTS:
- The company selected by the user is {target_comp}. Every question MUST feel explicitly calibrated to {target_comp}'s hiring bar.
- The role is {job_role}. Blend role-specific fundamentals from: {", ".join(role_focus["topics"])}.
- Across the full set, include:
  * company-style core CS fundamentals (OOP, DBMS, OS, Computer Networks, APIs, caching, debugging)
  * resume and project deep-dives tied to the candidate's listed projects and stack
  * role-specific fundamentals relevant to {job_role}
- Use 4 options per question and exactly 1 correct option.
- Questions must be concise, realistic, and suitable for a timed screening round.
- Add a short explanation for why the correct option is correct.

Return these exact fields for every question:
- question_text
- category
- options
- correct_option_index
- explanation
- difficulty_level
- source_signal
{mcq_intel_block}"""
    else:
        topic_guide = """
Topics: behavioral, situational, culture fit, communication, teamwork, leadership,
conflict resolution, career goals, strengths/weaknesses, motivation.
Use STAR-method oriented questions. Make them personalised to the candidate's background."""

    news_block = f"CURRENT MARKET TRENDS & CORPORATE PRESSURE:\n{news_ctx}\n→ Let these recent real-world events heavily influence your questions. If there were layoffs, increase rigorousness!" if news_ctx else ""

    prompt = f"""You are a Hiring Bar-Raiser exclusively representing {target_comp}. You are generating exactly {num_questions} interview questions for a {job_role} position.

Candidate Profile:
- Skills: {skills}
- Target Role: {job_role}
- Projects:
{project_desc}
- Education: {edu_desc}
- Round: {round_type.upper()}
- Difficulty: {difficulty.upper()}
- Role Focus Areas: {", ".join(role_focus["topics"])}

{news_block}

{topic_guide}

Return ONLY a valid JSON array — no markdown, no explanation:
[
  {{
    "question_text": "<the full question>",
    "category": "<OOP|DBMS|OS|CN|Frontend|Backend|FullStack|Data|ML|DevOps|Mobile|DSA|Project|HR|Algorithms|MCQ Practice>",
    "expected_points": ["point1", "point2", "point3"],
    "difficulty_level": "{difficulty}"
  }}
]

Return EXACTLY {num_questions} questions covering DIVERSE topics."""

    try:
        content = await _achat([{"role": "user", "content": prompt}], temperature=0.8, max_tokens=4000)
        questions = json.loads(_clean(content))
        if not isinstance(questions, list):
            questions = questions.get("questions", [])

        if round_type == "technical":
            enforced = _enforce_technical_distribution(
                questions=questions,
                projects=projects,
                skills=skill_list,
                difficulty=difficulty,
                num_questions=num_questions,
                job_role=job_role,
            )
            return enforced[:num_questions]

        if round_type == "dsa":
            return [
                _normalize_coding_question(question, difficulty)
                for question in questions[:num_questions]
            ]

        if round_type == "mcq_practice":
            project_names = [p.get("name", "") for p in projects]
            normalized = [
                _normalize_mcq_question(question, difficulty, project_names)
                for question in questions[:num_questions]
            ]
            if len(normalized) < num_questions:
                normalized.extend(
                    _build_mcq_fallback_questions(
                        projects=projects,
                        skills=skill_list,
                        difficulty=difficulty,
                        count=num_questions - len(normalized),
                        job_role=job_role,
                        target_company=target_comp,
                    )
                )
            return normalized[:num_questions]

        project_names = [p.get("name", "") for p in projects]
        return [
            _normalize_generated_question(question, difficulty, project_names)
            for question in questions[:num_questions]
        ]
    except Exception:
        if round_type == "technical":
            return _enforce_technical_distribution(
                questions=[],
                projects=projects,
                skills=skill_list,
                difficulty=difficulty,
                num_questions=num_questions,
                job_role=job_role,
            )
        if round_type == "dsa":
            return [
                _normalize_coding_question({
                    "title": f"{target_comp} OA Problem {i + 1}",
                    "description": "Solve the problem efficiently and explain the complexity of your approach.",
                    "examples": [
                        {"input": "nums = [2, 7, 11, 15], target = 9", "output": "[0, 1]"},
                        {"input": "nums = [3, 2, 4], target = 6", "output": "[1, 2]"},
                    ],
                    "constraints": [
                        "Aim for better than O(n^2) when possible.",
                        "Handle edge cases carefully before final submission.",
                    ],
                    "difficulty": difficulty,
                    "topic": "DSA",
                    "hint": "Start by identifying the data structure that avoids repeated scans.",
                }, difficulty)
                for i in range(num_questions)
            ]
        if round_type == "mcq_practice":
            return _build_mcq_fallback_questions(
                projects=projects,
                skills=skill_list,
                difficulty=difficulty,
                count=num_questions,
                job_role=job_role,
                target_company=target_comp,
            )
        return [
            {
                "question_text": f"Question {i+1}",
                "text": f"Question {i+1}",
                "category": round_type,
                "topic": round_type,
                "expected_points": [],
                "expected_concepts": [],
                "difficulty_level": difficulty,
            }
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
    "mcq_practice": ["Company Alignment", "Core CS", "Resume Knowledge", "Role Fundamentals", "Accuracy", "Time Management"],
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
