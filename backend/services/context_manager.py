"""
context_manager.py — manages interview conversation context for adaptive Q generation.

Functions:
  build_conversation_context(session) → list of {role, content} turns
  summarize_old_turns(turns)          → condensed summary string (via Groq)
  get_asked_topics(session)           → deduplicated list of covered topics
"""
from __future__ import annotations
import asyncio
import os
from typing import Optional


# Groq client (lazy)
_client = None

def _get_client():
    global _client
    if _client is None:
        from groq import Groq
        _client = Groq(api_key=os.getenv("GROQ_API_KEY"))
    return _client


async def _achat(messages: list, max_tokens: int = 400) -> str:
    loop = asyncio.get_event_loop()
    def _call():
        return _get_client().chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=messages,
            temperature=0.3,
            max_tokens=max_tokens,
        ).choices[0].message.content
    return await loop.run_in_executor(None, _call)


# ── Context builder ───────────────────────────────────────────────────────────
async def build_conversation_context(session: dict) -> list:
    """
    Convert the session transcript into a structured conversation history list.
    If > 8 turns exist, older turns are summarised to save token budget.

    Returns:
        List of {"role": "assistant"|"user", "content": str}
    """
    transcript: list = session.get("transcript") or []
    if not transcript:
        return []

    turns = []
    for entry in transcript:
        q_text = entry.get("question") or entry.get("question_text") or ""
        a_text = entry.get("answer")   or entry.get("transcript")    or ""
        if q_text:
            turns.append({"role": "assistant", "content": q_text})
        if a_text:
            turns.append({"role": "user",      "content": a_text})

    # If too many turns, summarise the old ones to save tokens
    if len(turns) > 16:
        old_turns  = turns[:-8]
        recent     = turns[-8:]
        summary    = await summarize_old_turns(old_turns)
        condensed  = [{"role": "system", "content": f"[Earlier conversation summary] {summary}"}]
        return condensed + recent

    return turns


# ── Summariser ────────────────────────────────────────────────────────────────
async def summarize_old_turns(turns: list) -> str:
    """
    Summarise a list of old Q/A turns into a concise 3-4 line paragraph
    capturing topics covered and candidate performance level.
    """
    if not turns:
        return ""

    # Format the turns as a simple text block
    text = "\n".join(
        f"{'Interviewer' if t['role'] == 'assistant' else 'Candidate'}: {t['content']}"
        for t in turns
    )

    try:
        summary = await _achat([
            {
                "role": "system",
                "content": (
                    "You are a concise interview note-taker. "
                    "Summarise the given interview excerpt in 3-4 lines. "
                    "Capture: topics covered, candidate strengths, weak areas. "
                    "Be brief and factual."
                ),
            },
            {"role": "user", "content": f"Summarise this interview segment:\n\n{text[:2500]}"},
        ])
        return summary.strip()
    except Exception:
        # Fallback: just return the last few lines of the text
        return text[-300:]


# ── Topic extractor ───────────────────────────────────────────────────────────
def get_asked_topics(session: dict) -> list:
    """
    Extract and deduplicate the 'topic' field from all questions in the session transcript.

    Returns:
        Ordered, deduped list of topics already covered (e.g. ["React Hooks", "BFS", "Teamwork"])
    """
    transcript: list = session.get("transcript") or []
    questions:  list = session.get("questions")  or []

    seen   = set()
    topics = []

    # From questions list (has 'topic' or 'category')
    for q in questions:
        t = q.get("topic") or q.get("category") or ""
        if t and t.lower() not in seen:
            seen.add(t.lower())
            topics.append(t)

    # From transcript entries (questions answered)
    for entry in transcript:
        t = entry.get("topic") or entry.get("category") or ""
        if t and t.lower() not in seen:
            seen.add(t.lower())
            topics.append(t)

    return topics
