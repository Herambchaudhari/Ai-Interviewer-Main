"""
services/adaptive_engine.py

Adaptive question engine — decides WHAT to ask next based on:
  1. Last answer score → follow-up if weak (≤5)
  2. Known weak areas from past sessions → probe unvisited ones first
  3. Company-critical topics for target company/role → inject if uncovered
  4. Default → generate_next_question() with full context

Every decision is logged via detected_weaknesses and avoided_topics
which are persisted back to the session record after each answer.
"""
from __future__ import annotations
import uuid
import re
from typing import Optional


# ── Company / Role Critical Topics ────────────────────────────────────────────
_COMPANY_TOPICS: dict[str, list[str]] = {
    "amazon":          ["Leadership Principles", "Distributed Systems", "Fault Tolerance", "Customer Obsession"],
    "aws":             ["Cloud Architecture", "Distributed Systems", "Fault Tolerance", "Scalability"],
    "google":          ["Algorithm Complexity", "System Design at Scale", "Data Structures", "Coding Efficiency"],
    "meta":            ["System Design", "React Architecture", "Data Pipelines", "Scalability"],
    "microsoft":       ["OOP Design Patterns", "Cloud Azure", "Collaborative Design", "API Design"],
    "netflix":         ["Streaming Architecture", "CDN & Caching", "Microservices", "Chaos Engineering"],
    "goldman sachs":   ["Financial Data Pipelines", "Low Latency Systems", "Risk Modeling", "ACID Compliance"],
    "jp morgan":       ["Regulatory Compliance", "ACID Databases", "Security Awareness", "Transaction Integrity"],
    "stripe":          ["Payment Systems", "API Design", "Idempotency", "Financial Security"],
    "tcs":             ["Software Lifecycle", "Agile Delivery", "Client Communication", "Enterprise Architecture"],
    "infosys":         ["Agile Methodology", "Database Design", "Enterprise Integration", "Code Quality"],
    "wipro":           ["Enterprise Software", "Testing Practices", "SDLC", "Client Communication"],
    "startup":         ["Full Stack Ownership", "MVP Shipping", "Pragmatic Architecture", "Product Sense"],
    "default":         ["OOP Principles", "Database Design", "API Design", "System Design Basics"],
}

_ROLE_TOPICS: dict[str, list[str]] = {
    "backend":           ["REST API Design", "Database Optimization", "Caching", "Concurrency"],
    "frontend":          ["React Performance", "Browser Rendering", "State Management", "Web Security"],
    "full stack":        ["API Integration", "Database Design", "React/Vue", "Deployment"],
    "ml":                ["Model Deployment", "Feature Engineering", "MLOps", "Math Intuition"],
    "data":              ["ETL Pipelines", "Data Warehousing", "Spark/Hadoop", "SQL Optimization"],
    "devops":            ["CI/CD", "Container Orchestration", "Cloud Infrastructure", "Monitoring"],
    "mobile":            ["App Architecture", "Performance", "Offline Sync", "Device Constraints"],
    "software engineer": ["OOP Principles", "Data Structures", "System Design", "Clean Code"],
}


def _normalize_role_key(job_role: str) -> str:
    role_lower = (job_role or "").lower()

    if any(term in role_lower for term in ("frontend", "front end", "ui engineer", "ui developer", "web developer", "web engineer")):
        return "frontend"
    if any(term in role_lower for term in ("backend", "back end", "api engineer", "api developer", "server engineer", "server developer")):
        return "backend"
    if any(term in role_lower for term in ("full stack", "full-stack")):
        return "full stack"
    if any(term in role_lower for term in ("ml engineer", "machine learning", "ai engineer", "ai developer")):
        return "ml"
    if any(term in role_lower for term in ("data engineer", "analytics engineer", "data platform", "data developer")):
        return "data"
    if any(term in role_lower for term in ("devops", "platform engineer", "site reliability", "sre", "cloud engineer")):
        return "devops"
    if any(term in role_lower for term in ("mobile", "android", "ios", "flutter", "react native")):
        return "mobile"
    if "software engineer" in role_lower or "software developer" in role_lower:
        return "software engineer"
    return ""


def _get_company_critical_topics(target_company: str, job_role: str, round_type: str) -> list[str]:
    """Return ordered list of must-cover topics for this company+role combo."""
    company_key = ""
    tc_lower = (target_company or "").lower()
    for key in _COMPANY_TOPICS:
        if key in tc_lower:
            company_key = key
            break
    company_topics = _COMPANY_TOPICS.get(company_key, _COMPANY_TOPICS["default"])

    role_key = _normalize_role_key(job_role)
    role_topics = _ROLE_TOPICS.get(role_key, [])

    # DSA/HR rounds don't need the full company topic injection
    if round_type in ("dsa", "hr"):
        return []

    # Merge: role topics first (more specific), then company topics
    seen = set()
    merged = []
    for t in role_topics + company_topics:
        if t.lower() not in seen:
            seen.add(t.lower())
            merged.append(t)
    return merged[:6]


def _topic_covered(topic: str, asked_topics: list[str]) -> bool:
    """Fuzzy match — checks if a topic or close variant was already asked."""
    t_lower = topic.lower()
    for asked in asked_topics:
        a_lower = (asked or "").lower()
        # exact or substring match (e.g. "OOP Principles" matches "OOP")
        if t_lower in a_lower or a_lower in t_lower:
            return True
        # word-level overlap ≥ 1 significant word (length > 3)
        t_words = set(w for w in re.split(r"[\s&/,]+", t_lower) if len(w) > 3)
        a_words = set(w for w in re.split(r"[\s&/,]+", a_lower) if len(w) > 3)
        if t_words & a_words:
            return True
    return False


def _build_conv_history(transcript: list) -> list[dict]:
    """Convert session transcript entries to conversation history format."""
    history = []
    for entry in transcript[-10:]:  # last 10 exchanges to keep prompt lean
        q = entry.get("question") or entry.get("question_text", "")
        a = entry.get("answer", "")
        score = entry.get("score")
        if q:
            history.append({"role": "assistant", "content": q})
        if a and a != "[SKIPPED]":
            content = a[:300]
            if score is not None:
                content += f" [Score: {score}/10]"
            history.append({"role": "user", "content": content})
    return history


def _get_asked_topics(transcript: list) -> list[str]:
    """Extract all asked topics/categories from the transcript."""
    topics = []
    for entry in transcript:
        topic = entry.get("category") or entry.get("topic") or ""
        if topic and topic not in topics:
            topics.append(topic)
    return topics


def _update_detected_weaknesses(
    detected_weaknesses: dict,
    topic: str,
    score: float,
) -> dict:
    """Increment weakness counter for a topic if score is low."""
    if not topic:
        return detected_weaknesses
    updated = dict(detected_weaknesses)
    if score <= 5:
        updated[topic] = updated.get(topic, 0) + 1
    return updated


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


def _normalize_difficulty(d: str) -> str:
    return _DIFF_NORMALIZE.get((d or "medium").lower(), "medium")


def _candidate_elo_to_difficulty(ability_vector: dict, base_difficulty: str) -> str:
    """
    When the candidate is struggling (low ELO), lower the effective difficulty.
    Only downgrades — never upgrades beyond the session's configured difficulty.
    Works with both session-stored forms ("fresher", "mid-level", "senior")
    and canonical forms ("easy", "medium", "hard").
    """
    norm = _normalize_difficulty(base_difficulty)

    if not ability_vector or not ability_vector.get("scores"):
        return norm
    answered = ability_vector.get("answered_count", 0)
    if answered < 2:
        return norm  # not enough signal yet

    avg_elo = sum(ability_vector["scores"].values()) / len(ability_vector["scores"])
    if avg_elo < 1050 and norm in ("medium", "hard"):
        return "easy"
    if avg_elo < 1100 and norm == "hard":
        return "medium"
    return norm


_HR_CATEGORIES_ORDERED = [
    # Priority order — ensures well-rounded STAR competency coverage per session
    "Conflict Resolution",
    "Leadership & Ownership",
    "Failure & Learning",
    "Teamwork & Collaboration",
    "Problem-Solving Under Pressure",
    "Communication & Influence",
    "Execution & Delivery",
    "Customer/User Focus",
    "Initiative & Innovation",
    "Values & Ethics",
    # Legacy categories from original question bank (migration 013)
    "Communication",
    "Adaptability",
    "Time Management",
]


def _get_used_pillars(transcript: list, round_type: str) -> list[str]:
    """
    Return cs_pillar / hr_category values already served from the DB this session.
    Transcript entries store the category in multiple keys depending on how the
    question was created:
      - DB technical questions: cs_pillar = "OS"/"DBMS"/"CN"/"OOP"/"DSA"
      - DB HR questions: hr_category = "Leadership & Ownership" etc. (mapped from topic)
      - All questions: topic / category = the full topic name
    Read all possible keys so both DB and LLM-generated questions are accounted for.
    """
    pillars = []
    for entry in transcript:
        p = (entry.get("cs_pillar")
             or entry.get("hr_category")
             or entry.get("topic")
             or entry.get("category")
             or "")
        if p and p not in pillars:
            pillars.append(p)
    return pillars


def _get_cs_pillar_priority(job_role: str, covered: set) -> list[str]:
    """
    Return CS pillars in priority order for live questions, excluding already-covered pillars.
    Role-aware: frontend roles get Frontend/CN first; backend gets DBMS/OS first, etc.
    """
    role = (job_role or "").lower()
    if any(t in role for t in ("frontend", "ui", "front end")):
        order = ["OOP", "CN", "DBMS", "OS", "DSA", "Frontend"]
    elif any(t in role for t in ("backend", "api", "server", "back end")):
        order = ["DBMS", "OS", "CN", "OOP", "DSA", "Backend"]
    elif "full" in role:
        order = ["OOP", "DBMS", "CN", "OS", "DSA", "FullStack"]
    elif any(t in role for t in ("data", "ml", "ai", "machine")):
        order = ["DSA", "DBMS", "OS", "OOP", "CN", "Algorithms"]
    elif any(t in role for t in ("devops", "sre", "platform", "cloud")):
        order = ["OS", "CN", "DBMS", "DSA", "OOP", "DevOps"]
    else:
        order = ["OOP", "DBMS", "OS", "CN", "DSA", "Algorithms"]
    return [p for p in order if p not in covered] or order


def _get_priority_hr_category(used_categories: list[str]) -> str | None:
    """Return the highest-priority HR category not yet covered this session."""
    for cat in _HR_CATEGORIES_ORDERED:
        if cat not in used_categories:
            return cat
    return None


def _get_prewritten_follow_up(current_q: dict, score: float) -> str | None:
    """Return a pre-written follow-up from the question_bank row (zero Groq cost)."""
    if not current_q or current_q.get("source") != "db":
        return None
    if score <= 4:
        return current_q.get("follow_up_wrong")
    if score <= 7:
        return current_q.get("follow_up_shallow")
    return current_q.get("follow_up_strong")


async def generate_adaptive_next_question(
    session: dict,
    last_evaluation: dict,
    context_bundle: dict,
) -> dict:
    """
    Core adaptive engine. Decision tree (in priority order):

    0. DB quota: if db_counter < db_quota → serve from question_bank (no Groq cost)
    1. Pre-written follow-up: if last Q was from DB and score is definitive → free follow-up
    2. Weak follow-up: last score ≤ 5 and not already a follow-up → targeted follow-up (Groq)
    3. Known weak area from past sessions, not yet covered → probe it (Groq)
    4. Company/role critical topic not covered → inject it (Groq)
    5. DSA: new coding problem
    6. Default: generate_next_question() — resume-based or role-based per quota
    """
    from services.interviewer import (
        generate_next_question,
        generate_follow_up,
        generate_coding_question,
    )
    from services.db_service import (
        fetch_db_question,
        db_question_to_question_dict,
        update_session,
    )

    transcript        = session.get("transcript", [])
    round_type        = session.get("round_type", "technical")
    base_difficulty   = session.get("difficulty", "medium")
    ability_vector    = session.get("ability_vector") or {}
    quotas            = session.get("question_quotas") or {}
    counters          = dict(session.get("question_counters") or {})
    user_id           = session.get("user_id")
    session_id        = session.get("id")

    # Effective difficulty adjusted by ability
    difficulty = _candidate_elo_to_difficulty(ability_vector, base_difficulty)

    asked_topics      = _get_asked_topics(transcript)
    used_pillars      = _get_used_pillars(transcript, round_type)
    conv_history      = _build_conv_history(transcript)
    known_weak        = context_bundle.get("known_weak_areas", [])
    target_company    = context_bundle.get("target_company", "")
    job_role          = context_bundle.get("job_role", "Software Engineer")
    last_score        = float(last_evaluation.get("score") or 5)
    last_topic        = last_evaluation.get("question_topic", "")
    is_last_follow_up = bool(last_evaluation.get("is_follow_up", False))
    last_q_obj        = transcript[-1] if transcript else {}

    def _persist_counters(updated: dict):
        if session_id:
            try:
                update_session(session_id, {"question_counters": updated})
            except Exception as e:
                print(f"[adaptive_engine] counter persist failed: {e}")

    # ── Decision 0: DB quota — serve from question_bank ──────────────────
    db_used  = counters.get("db", 0)
    db_quota = quotas.get("db", 0)

    if db_used < db_quota and round_type in ("technical", "hr") and not is_last_follow_up:
        row = fetch_db_question(
            round_type=round_type,
            difficulty=difficulty,
            used_pillars=used_pillars,
            user_id=user_id,
        )
        if row:
            counters["db"] = db_used + 1
            _persist_counters(counters)
            q = db_question_to_question_dict(row, difficulty, round_type)
            q["decision_reason"] = "db_quota"
            return _finalize(q)

    # ── Decision 1: Pre-written follow-up from DB question (zero Groq cost) ─
    if not is_last_follow_up and round_type not in ("dsa",):
        follow_up_text = _get_prewritten_follow_up(last_q_obj, last_score)
        if follow_up_text:
            q = {
                "question_text":    follow_up_text,
                "text":             follow_up_text,
                "type":             "speech",
                "topic":            last_q_obj.get("cs_pillar") or last_q_obj.get("hr_category") or last_topic,
                "category":         last_q_obj.get("cs_pillar") or last_q_obj.get("hr_category") or last_topic,
                "expected_concepts": [],
                "difficulty_level": difficulty,
                "time_limit_secs":  180,
                "is_follow_up":     True,
                "source":           "db_follow_up",
                "parent_topic":     last_topic,
                "decision_reason":  "db_prewritten_follow_up",
            }
            return _finalize(q)

    # ── Decision 2: Follow-up on weak last answer (Groq) ─────────────────
    if last_score <= 5 and not is_last_follow_up and round_type != "dsa":
        missing   = last_evaluation.get("missing_concepts") or last_evaluation.get("weak_points") or []
        last_q_text = last_q_obj.get("question", "")
        last_a_text = last_q_obj.get("answer", "")
        try:
            next_q = await generate_follow_up(
                profile=context_bundle,
                last_question={"question_text": last_q_text, "topic": last_topic},
                last_answer=last_a_text,
                weak_points=missing,
            )
            next_q["is_follow_up"]    = True
            next_q["parent_topic"]    = last_topic
            next_q["decision_reason"] = "follow_up_weak_answer"
            return _finalize(next_q)
        except Exception as e:
            print(f"[adaptive_engine] follow-up generation failed: {e}")

    # ── Decision 3: Unprobed known weak area ─────────────────────────────
    if round_type not in ("dsa",):
        uncovered_weak = [w for w in known_weak if not _topic_covered(w, asked_topics)]
        if uncovered_weak:
            target_topic = uncovered_weak[0]
            enriched = {
                **context_bundle,
                "_force_topic": target_topic,
                "_force_topic_instruction": (
                    f"MANDATORY: The next question MUST be about '{target_topic}'. "
                    f"This is a known weak area from past sessions. Probe it from a fresh angle."
                ),
            }
            try:
                next_q = await generate_next_question(
                    profile=enriched,
                    round_type=round_type,
                    difficulty=difficulty,
                    conversation_history=conv_history,
                    asked_topics=asked_topics,
                )
                next_q["decision_reason"] = f"probing_known_weak:{target_topic}"
                return _finalize(next_q)
            except Exception as e:
                print(f"[adaptive_engine] known_weak probe failed: {e}")

    # ── Decision 4: Company/role critical topic (technical only) ─────────
    if round_type not in ("dsa", "hr"):
        critical_topics  = _get_company_critical_topics(target_company, job_role, round_type)
        uncovered_critical = [t for t in critical_topics if not _topic_covered(t, asked_topics)]
        if uncovered_critical:
            target_topic = uncovered_critical[0]
            enriched = {
                **context_bundle,
                "_force_topic": target_topic,
                "_force_topic_instruction": (
                    f"MANDATORY: The next question MUST be about '{target_topic}'. "
                    f"This is a critical topic for {target_company or 'this company'} and the {job_role} role."
                ),
            }
            try:
                next_q = await generate_next_question(
                    profile=enriched,
                    round_type=round_type,
                    difficulty=difficulty,
                    conversation_history=conv_history,
                    asked_topics=asked_topics,
                )
                next_q["decision_reason"] = f"company_critical:{target_topic}"
                return _finalize(next_q)
            except Exception as e:
                print(f"[adaptive_engine] company_critical probe failed: {e}")

    # ── Decision 5: DSA — new coding problem ─────────────────────────────
    if round_type == "dsa":
        asked_titles = [t.get("question") or t.get("question_text", "") for t in transcript]
        try:
            next_q = await generate_coding_question(
                profile=context_bundle,
                difficulty=difficulty,
                asked_questions=asked_titles,
            )
            next_q["decision_reason"] = "dsa_adaptive"
            return _finalize(next_q)
        except Exception as e:
            print(f"[adaptive_engine] DSA question generation failed: {e}")

    # ── Decision 6: Default — quota-driven question type ────────────────
    resume_used  = counters.get("resume", 0)
    resume_quota = quotas.get("resume", 0)
    live_used    = counters.get("live", 0)
    directive    = ""

    if resume_used < resume_quota:
        # Force a resume-based deep-dive question
        counters["resume"] = resume_used + 1
        _persist_counters(counters)
        directive = (
            "MANDATORY RESUME DEEP-DIVE: Generate a question that directly references a specific "
            "project, technology, or experience listed on the candidate's resume. "
            "Name the project explicitly (e.g. 'In your NurseConnect project, you used X — '). "
            "Probe the architecture decision, trade-off, or implementation challenge. "
            "Do NOT ask a generic technical question unrelated to their actual work."
        )
    elif round_type == "hr":
        # HR: resume-grilling with competency category rotation
        next_hr_cat = _get_priority_hr_category(used_pillars)
        if next_hr_cat:
            directive = (
                f"MANDATORY: Generate a behavioral question in the '{next_hr_cat}' competency category. "
                "Tie it directly to the candidate's resume — reference a specific project, role, or claim "
                "they listed and ask them to describe a real situation using STAR "
                "(Situation, Task, Action, Result). "
                f"The question MUST test the '{next_hr_cat}' behavioral competency."
            )
        else:
            directive = (
                "MANDATORY: Generate a resume-grilling behavioral question. "
                "Reference a specific project, role, or claim the candidate listed "
                "and ask them to describe a real situation using STAR (Situation, Task, Action, Result)."
            )
    else:
        # Technical: MANDATORY CS fundamentals or role-specific question (NOT resume-based)
        counters["live"] = live_used + 1
        _persist_counters(counters)

        # Rotate through CS pillars not yet covered this session
        covered_cs = set(p for p in used_pillars if p in ("OS", "DBMS", "CN", "OOP", "DSA",
                          "System Design", "Algorithms", "Frontend", "Backend", "FullStack",
                          "Data", "ML", "DevOps", "Mobile"))
        pillar_order = _get_cs_pillar_priority(job_role, covered_cs)
        target_cs = pillar_order[0] if pillar_order else "OOP"

        role_note = f" for a {job_role} role" if job_role else ""
        directive = (
            f"MANDATORY CS FUNDAMENTALS: Generate a STANDALONE {target_cs} question. "
            f"This question must NOT reference the candidate's specific projects or resume. "
            f"Ask a conceptual or applied {target_cs} question{role_note}. "
            f"Good formats: 'Explain X and when you would use it', "
            f"'What is the difference between X and Y?', 'How does X work internally?'. "
            f"This is a core technical knowledge check, not a project discussion."
        )

    enriched = dict(context_bundle)
    if directive:
        enriched["_force_topic_instruction"] = directive

    try:
        next_q = await generate_next_question(
            profile=enriched,
            round_type=round_type,
            difficulty=difficulty,
            conversation_history=conv_history,
            asked_topics=asked_topics,
        )
        next_q["decision_reason"] = "resume_quota" if directive else "default_adaptive"
        return _finalize(next_q)
    except Exception as e:
        print(f"[adaptive_engine] default next_question failed: {e}")
        return _fallback_question(round_type, difficulty)


def _finalize(q: dict) -> dict:
    """Ensure all required fields exist on the generated question."""
    q.setdefault("id", "q_" + str(uuid.uuid4())[:6])
    q.setdefault("type", "speech")
    q.setdefault("topic", q.get("topic", "General"))
    q.setdefault("category", q.get("topic", "General"))
    q.setdefault("question_text", q.get("text", ""))
    q.setdefault("text", q.get("question_text", ""))
    q.setdefault("expected_concepts", [])
    q.setdefault("difficulty_level", "medium")
    q.setdefault("time_limit_secs", 180)
    q.setdefault("is_follow_up", False)
    q.setdefault("decision_reason", "default_adaptive")
    return q


def _fallback_question(round_type: str, difficulty: str) -> dict:
    fallbacks = {
        "technical":     "Explain the difference between process and thread, and when you'd use each.",
        "hr":            "Tell me about a challenging situation you faced in a team project and how you resolved it.",
        "system_design": "Design a URL shortener service. Walk me through your architecture choices.",
        "dsa":           "Given an array of integers, find two numbers that sum to a target. Return their indices.",
    }
    text = fallbacks.get(round_type, "Tell me about your most significant technical project.")
    return {
        "id":              "q_fallback",
        "text":            text,
        "question_text":   text,
        "type":            "speech",
        "topic":           "General",
        "expected_concepts": [],
        "difficulty_level": difficulty,
        "time_limit_secs": 180,
        "is_follow_up":    False,
        "decision_reason": "fallback",
    }
