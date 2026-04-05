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
    "backend engineer":   ["REST API Design", "Database Optimization", "Caching", "Concurrency"],
    "frontend engineer":  ["React Performance", "Browser Rendering", "State Management", "Web Security"],
    "full stack":         ["API Integration", "Database Design", "React/Vue", "Deployment"],
    "ml engineer":        ["Model Deployment", "Feature Engineering", "MLOps", "Math Intuition"],
    "data engineer":      ["ETL Pipelines", "Data Warehousing", "Spark/Hadoop", "SQL Optimization"],
    "devops engineer":    ["CI/CD", "Container Orchestration", "Cloud Infrastructure", "Monitoring"],
    "software engineer":  ["OOP Principles", "Data Structures", "System Design", "Clean Code"],
}


def _get_company_critical_topics(target_company: str, job_role: str, round_type: str) -> list[str]:
    """Return ordered list of must-cover topics for this company+role combo."""
    company_key = ""
    tc_lower = (target_company or "").lower()
    for key in _COMPANY_TOPICS:
        if key in tc_lower:
            company_key = key
            break
    company_topics = _COMPANY_TOPICS.get(company_key, _COMPANY_TOPICS["default"])

    role_key = ""
    role_lower = (job_role or "").lower()
    for key in _ROLE_TOPICS:
        if key in role_lower:
            role_key = key
            break
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


async def generate_adaptive_next_question(
    session: dict,
    last_evaluation: dict,
    context_bundle: dict,
) -> dict:
    """
    Core adaptive engine. Decides and generates the next question.

    Decision tree (in priority order):
    1. Last answer score ≤ 5 and not already a follow-up → targeted follow-up
    2. Known weak area from past sessions, not yet covered → probe it
    3. Company/role critical topic not yet covered → inject it
    4. Default: generate_next_question() with full conversation context

    Returns a question dict compatible with the session.questions schema.
    """
    from services.interviewer import (
        generate_next_question,
        generate_follow_up,
        generate_coding_question,
    )

    transcript         = session.get("transcript", [])
    round_type         = session.get("round_type", "technical")
    difficulty         = session.get("difficulty", "medium")
    asked_topics       = _get_asked_topics(transcript)
    conv_history       = _build_conv_history(transcript)
    known_weak         = context_bundle.get("known_weak_areas", [])
    target_company     = context_bundle.get("target_company", "")
    job_role           = context_bundle.get("job_role", "Software Engineer")
    last_score         = float(last_evaluation.get("score") or 5)
    last_topic         = last_evaluation.get("question_topic", "")
    is_last_follow_up  = bool(last_evaluation.get("is_follow_up", False))

    # ── Decision 1: Follow-up on weak last answer ─────────────────────────
    if last_score <= 5 and not is_last_follow_up and round_type != "dsa":
        missing = last_evaluation.get("missing_concepts") or last_evaluation.get("weak_points") or []
        last_q_text = (transcript[-1].get("question") or "") if transcript else ""
        last_a_text = (transcript[-1].get("answer") or "") if transcript else ""

        try:
            next_q = await generate_follow_up(
                profile=context_bundle,
                last_question={"question_text": last_q_text, "topic": last_topic},
                last_answer=last_a_text,
                weak_points=missing,
            )
            next_q["is_follow_up"] = True
            next_q["parent_topic"] = last_topic
            next_q["decision_reason"] = "follow_up_weak_answer"
            return _finalize(next_q)
        except Exception as e:
            print(f"[adaptive_engine] follow-up generation failed: {e}")

    # ── Decision 2: Unprobed known weak area ─────────────────────────────
    if round_type not in ("dsa",):
        uncovered_weak = [w for w in known_weak if not _topic_covered(w, asked_topics)]
        if uncovered_weak:
            target_topic = uncovered_weak[0]
            # Inject as a forced topic into next_question generation
            enriched_profile = {
                **context_bundle,
                "_force_topic": target_topic,
                "_force_topic_instruction": (
                    f"MANDATORY: The next question MUST be about '{target_topic}'. "
                    f"This is a known weak area for this candidate from past sessions. "
                    f"Probe it from a fresh angle — not the same question they saw before."
                ),
            }
            try:
                next_q = await generate_next_question(
                    profile=enriched_profile,
                    round_type=round_type,
                    difficulty=difficulty,
                    conversation_history=conv_history,
                    asked_topics=asked_topics,
                )
                next_q["decision_reason"] = f"probing_known_weak:{target_topic}"
                return _finalize(next_q)
            except Exception as e:
                print(f"[adaptive_engine] known_weak probe failed: {e}")

    # ── Decision 3: Company/role critical topic injection ─────────────────
    if round_type not in ("dsa", "hr"):
        critical_topics = _get_company_critical_topics(target_company, job_role, round_type)
        uncovered_critical = [t for t in critical_topics if not _topic_covered(t, asked_topics)]
        if uncovered_critical:
            target_topic = uncovered_critical[0]
            enriched_profile = {
                **context_bundle,
                "_force_topic": target_topic,
                "_force_topic_instruction": (
                    f"MANDATORY: The next question MUST be about '{target_topic}'. "
                    f"This is a critical topic for {target_company or 'this company'} "
                    f"and the {job_role} role."
                ),
            }
            try:
                next_q = await generate_next_question(
                    profile=enriched_profile,
                    round_type=round_type,
                    difficulty=difficulty,
                    conversation_history=conv_history,
                    asked_topics=asked_topics,
                )
                next_q["decision_reason"] = f"company_critical:{target_topic}"
                return _finalize(next_q)
            except Exception as e:
                print(f"[adaptive_engine] company_critical probe failed: {e}")

    # ── Decision 4: DSA round — new coding problem ────────────────────────
    if round_type == "dsa":
        asked_titles = [
            t.get("question") or t.get("question_text", "") for t in transcript
        ]
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

    # ── Decision 5: Default adaptive next question ────────────────────────
    try:
        next_q = await generate_next_question(
            profile=context_bundle,
            round_type=round_type,
            difficulty=difficulty,
            conversation_history=conv_history,
            asked_topics=asked_topics,
        )
        next_q["decision_reason"] = "default_adaptive"
        return _finalize(next_q)
    except Exception as e:
        print(f"[adaptive_engine] default next_question failed: {e}")
        # Last-resort static fallback
        return _fallback_question(round_type, difficulty)


def _finalize(q: dict) -> dict:
    """Ensure all required fields exist on the generated question."""
    q.setdefault("id", "q_" + str(uuid.uuid4())[:6])
    q.setdefault("type", "speech")
    q.setdefault("topic", q.get("topic", "General"))
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
