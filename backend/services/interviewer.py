"""
services/interviewer.py

AI-powered interview question generator using Alex persona.
Functions:
  generate_first_question(profile, round_type, difficulty)            → dict
  generate_next_question(profile, round_type, difficulty,
                         conversation_history, asked_topics)          → dict
  generate_follow_up(profile, last_question, last_answer, weak_pts)  → dict
  generate_coding_question(profile, difficulty, asked_questions)      → dict
"""
from __future__ import annotations
import json
import uuid
import asyncio
import string
import random
import os
from typing import Optional

from prompts.interviewer_prompt import build_interviewer_prompt

_client = None

def _get_client():
    global _client
    if _client is None:
        from groq import Groq
        _client = Groq(api_key=os.getenv("GROQ_API_KEY"))
    return _client


async def _achat(system: str, user: str, temperature=0.85, max_tokens=900) -> str:
    loop = asyncio.get_event_loop()
    def _call():
        return _get_client().chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": user},
            ],
            temperature=temperature,
            max_tokens=max_tokens,
        ).choices[0].message.content
    return await loop.run_in_executor(None, _call)


def _rand_id() -> str:
    return "q_" + "".join(random.choices(string.ascii_lowercase + string.digits, k=6))


def _parse_question(raw: str, fallback_text: str = "Question could not be generated.") -> dict:
    """Parse JSON from LLM output; return a safe fallback dict on failure."""
    try:
        cleaned = raw.strip().strip("```json").strip("```").strip()
        # If the model wrapped it in an array, unwrap
        if cleaned.startswith("["):
            cleaned = json.loads(cleaned)[0]
        else:
            cleaned = json.loads(cleaned)
        # Ensure required fields exist
        cleaned.setdefault("id",              _rand_id())
        cleaned.setdefault("text",            cleaned.get("question_text", fallback_text))
        cleaned.setdefault("question_text",   cleaned["text"])
        cleaned.setdefault("type",            "technical")
        cleaned.setdefault("topic",           "General")
        cleaned.setdefault("category",        cleaned["topic"])
        cleaned.setdefault("expected_concepts", [])
        cleaned.setdefault("difficulty_level", "medium")
        cleaned.setdefault("time_limit_secs", 180)
        return cleaned
    except Exception:
        return {
            "id":               _rand_id(),
            "text":             fallback_text,
            "question_text":    fallback_text,
            "type":            "technical",
            "topic":           "General",
            "category":        "General",
            "expected_concepts": [],
            "difficulty_level": "medium",
            "time_limit_secs":  180,
        }


# ── First question ────────────────────────────────────────────────────────────
async def generate_first_question(
    profile:    dict,
    round_type: str,
    difficulty: str,
) -> dict:
    """
    Generate the opening question for an interview.
    - Technical / DSA: warm-up on a topic the candidate clearly knows.
    - HR: personalised 'Tell me about yourself'.
    - System Design: context-setting open question.
    """
    system = build_interviewer_prompt(
        profile=profile,
        round_type=round_type,
        difficulty=difficulty,
    )

    if round_type == "hr":
        user_msg = (
            "Start the interview. Generate the opening question. "
            "For this HR round, begin with a personalised 'Tell me about yourself' question "
            "that references specific aspects of the candidate's background and asks them to "
            "connect their experience to the role they're interviewing for."
        )
    elif round_type in ("technical", "system_design"):
        user_msg = (
            "Start the interview. Generate the first warm-up question. "
            "Choose a topic the candidate clearly has experience with (based on their skills/projects). "
            "Make it approachable but insightful — a question that lets them shine first."
        )
    else:  # dsa
        user_msg = (
            "Start the DSA interview. Generate the first coding problem. "
            "Choose an appropriate difficulty based on the candidate's level. "
            "Include the full problem statement, 2 examples with i/o, and constraints. "
            "Make the problem text field complete and self-contained."
        )

    raw = await _achat(system, user_msg)
    return _parse_question(raw, "Could you start by telling me about yourself?")


# ── Next question ─────────────────────────────────────────────────────────────
async def generate_next_question(
    profile:              dict,
    round_type:           str,
    difficulty:           str,
    conversation_history: list,
    asked_topics:         list,
) -> dict:
    """
    Generate the next adaptive question based on interview progress.
    Identifies gaps, weak areas, or new topics to probe.
    """
    system = build_interviewer_prompt(
        profile=profile,
        round_type=round_type,
        difficulty=difficulty,
        conversation_history=conversation_history,
        asked_topics=asked_topics,
    )

    user_msg = (
        "Based on the interview so far, generate the next question. "
        "Review the conversation history and:\n"
        "1. Identify topics NOT yet covered.\n"
        "2. If the candidate struggled with something, probe from a different angle — "
        "   but do not repeat the same topic directly.\n"
        "3. Keep the difficulty appropriate and progress naturally.\n"
        "4. The question must be on a DIFFERENT topic from the ones already covered.\n"
        "Generate the next question now."
    )
    if round_type == "technical":
        user_msg += (
            "\n5. Prefer a resume/project deep-dive grounded in the candidate's actual projects and skills "
            "unless the adaptive directive explicitly forces a standalone CS fundamentals question."
        )

    if conversation_history and len(conversation_history) >= 4 and random.random() < 0.3:
        user_msg = (
            "Based on the interview so far, you must throw a PSYCHOLOGICAL CURVEBALL or SEVERE CONSTRAINT. "
            "If they answered superficially, use 'The 5 Whys' and aggressively interrogate their last answer. "
            "If they solved the last topic easily, do NOT move to a new topic! Instead, inject a massive architectural or business constraint. "
            "(Example: 'Your scaling solution works, but suddenly East-Coast AWS goes completely offline. How does your system recover?' or "
            "'Your code is functionally correct but now imagine you only have 50MB of RAM.') "
            "Force them to re-architect or defend their solution under extreme pressure."
        )

    raw = await _achat(system, user_msg)
    return _parse_question(raw)


# ── Follow-up question ────────────────────────────────────────────────────────
async def generate_follow_up(
    profile:       dict,
    last_question: dict,
    last_answer:   str,
    weak_points:   list,
) -> dict:
    """
    Generate a targeted follow-up question probing the weak points in the last answer.
    Does NOT reveal the answer — only probes for deeper understanding.
    """
    round_type = "technical"   # Follow-ups are always technical probes
    system = build_interviewer_prompt(
        profile=profile,
        round_type=round_type,
        difficulty="medium",
    )

    weak_str = "\n".join(f"- {w}" for w in (weak_points or ["depth of understanding"]))
    prev_q   = last_question.get("text") or last_question.get("question_text", "previous question")

    user_msg = (
        f"The candidate answered this question:\n\"{prev_q}\"\n\n"
        f"Their answer: \"{(last_answer or '')[:400]}\"\n\n"
        f"They missed or were weak on these concepts:\n{weak_str}\n\n"
        "Generate a targeted follow-up question that probes their understanding of these gaps. "
        "Do NOT give away the answer. Ask from a different angle that lets them demonstrate "
        "knowledge if they have it. Keep it concise and direct."
    )

    raw = await _achat(system, user_msg, temperature=0.7)
    result = _parse_question(raw)
    result["is_follow_up"] = True
    result["parent_topic"] = last_question.get("topic", "")
    return result


# ── Coding question (DSA-specific) ────────────────────────────────────────────
_DIFFICULTY_LABELS = {"easy": "Easy", "medium": "Medium", "hard": "Hard"}
_LANG_MAP          = {"easy": "arrays/strings", "medium": "trees/BinarySearch/hashing", "hard": "DP/graphs/advanced"}
_TIME_MAP          = {"easy": 900, "medium": 1800, "hard": 2700}


async def generate_coding_question(
    profile:          dict,
    difficulty:       str,
    asked_questions:  Optional[list] = None,
) -> dict:
    """
    Generate a standalone DSA problem (full problem, examples, constraints).
    Used by session/start for DSA rounds.
    """
    skills        = ", ".join((profile.get("skills") or [])[:10]) or "general programming"
    asked_str     = ", ".join(asked_questions or []) or "none"
    diff_label    = _DIFFICULTY_LABELS.get(difficulty, "Medium")
    topic_hint    = _LANG_MAP.get(difficulty, "arrays/hashing")
    time_limit    = _TIME_MAP.get(difficulty, 1800)
    target_company = profile.get("target_company", "the target company")
    job_role = profile.get("job_role", "Software Engineer")
    coding_ctx = profile.get("company_questions_context", "")

    system = (
        "You are a senior interviewer at a top tech company. "
        "Generate a complete DSA coding problem that feels like a professional online assessment. "
        "Return ONLY valid JSON - no markdown."
    )
    user_msg = (
        f"Candidate skills: {skills}\n"
        f"Target company: {target_company}\n"
        f"Target role: {job_role}\n"
        f"Difficulty: {diff_label}\n"
        f"Focus area: {topic_hint}\n"
        f"Already asked (DO NOT repeat): {asked_str}\n\n"
        f"Recent company coding intelligence:\n{coding_ctx or 'No live company coding context available.'}\n\n"
        "Make the problem feel aligned to the role and to recent company OA patterns when context is available.\n"
        "Return ONLY valid JSON:\n"
        "{\n"
        '  "title": "<short problem title>",\n'
        '  "description": "<full OA-style problem statement, 2-4 paragraphs>",\n'
        '  "examples": [\n'
        '    { "input": "<ex input>", "output": "<ex output>", "explanation": "<brief>" },\n'
        '    { "input": "<ex input>", "output": "<ex output>", "explanation": "<brief>" }\n'
        "  ],\n"
        '  "constraints": ["<constraint 1>", "<constraint 2>"],\n'
        f'  "difficulty": "{diff_label}",\n'
        '  "topic": "<Arrays|Trees|DP|...>",\n'
        '  "hint": "<subtle hint, no solution>",\n'
        f'  "time_limit_mins": {time_limit // 60}\n'
        "}"
    )

    raw = await _achat(system, user_msg, max_tokens=1400)

    try:
        cleaned = raw.strip().strip("```json").strip("```").strip()
        result  = json.loads(cleaned)
    except Exception:
        result = {
            "title": "Two Sum",
            "description": (
                "Given an array of integers nums and an integer target, "
                "return indices of the two numbers such that they add up to target."
            ),
            "examples": [{"input": "nums=[2,7,11,15], target=9", "output": "[0,1]", "explanation": "2+7=9"}],
            "constraints": ["2 <= nums.length <= 10^4", "Each input has exactly one solution."],
            "difficulty": diff_label,
            "topic": "Arrays",
            "hint": "Consider a hash map to store seen values and their indices.",
            "time_limit_mins": time_limit // 60,
        }

    result["id"]             = str(uuid.uuid4())
    result["question_text"]  = result.get("title", "")
    result["text"]           = result.get("description", result.get("title", ""))
    result["time_limit_secs"] = time_limit
    result["type"]           = "coding"
    result["category"]       = result.get("topic", "DSA")
    return result
