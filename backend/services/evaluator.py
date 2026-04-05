"""
evaluator.py — AI-powered answer and code evaluation via Groq.
Used by session router /answer endpoint.
"""
import json
import asyncio
from groq import Groq
import os

_client = None


def _get_client() -> Groq:
    global _client
    if _client is None:
        _client = Groq(api_key=os.getenv("GROQ_API_KEY"))
    return _client


async def _achat(messages: list, temperature: float = 0.2, max_tokens: int = 1200) -> str:
    loop = asyncio.get_event_loop()
    def _call():
        return _get_client().chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=messages,
            temperature=temperature,
            max_tokens=max_tokens,
        ).choices[0].message.content
    return await loop.run_in_executor(None, _call)


def _parse_json(raw: str, fallback: dict) -> dict:
    try:
        cleaned = raw.strip().strip("```json").strip("```").strip()
        return json.loads(cleaned)
    except Exception:
        return fallback


# ── Code Evaluation ───────────────────────────────────────────────────────────
async def evaluate_code(
    question: dict,
    code: str,
    language: str,
) -> dict:
    """
    Evaluate submitted code for a DSA/coding question via Groq.

    Returns:
        {
          verdict, score, time_complexity, space_complexity,
          correctness_analysis, code_quality: {score, issues, positives},
          edge_cases_missed, optimization_hints, follow_up_question
        }
    """
    if not code or not code.strip():
        return {
            "verdict": "incorrect",
            "score": 0,
            "time_complexity": "N/A",
            "space_complexity": "N/A",
            "correctness_analysis": "No code was submitted.",
            "code_quality": {"score": 0, "issues": ["No code submitted."], "positives": []},
            "edge_cases_missed": [],
            "optimization_hints": ["Write a solution and submit."],
            "follow_up_question": "Can you walk me through your thought process?",
        }

    q_title    = question.get("title") or question.get("question_text", "")
    q_desc     = question.get("description") or question.get("question_text", "")
    constraints= "\n".join(f"- {c}" for c in question.get("constraints", []))
    examples   = json.dumps(question.get("examples", []), indent=2)

    system_msg = (
        "You are a senior software engineer conducting a technical interview. "
        "Evaluate the submitted code strictly and constructively. "
        "Return ONLY valid JSON — no markdown, no explanation outside JSON."
    )

    user_msg = f"""Question: {q_title}
Description: {q_desc}
Constraints:
{constraints}
Examples:
{examples}

Candidate's Code ({language}):
```{language}
{code}
```

Return ONLY valid JSON with this exact structure:
{{
  "verdict": "correct" | "partially_correct" | "incorrect",
  "score": <integer 0-10>,
  "time_complexity": "<Big-O>",
  "space_complexity": "<Big-O>",
  "correctness_analysis": "<2-3 sentences>",
  "code_quality": {{
    "score": <integer 0-10>,
    "issues": ["<issue1>", "<issue2>"],
    "positives": ["<positive1>"]
  }},
  "edge_cases_missed": ["<edge case>"],
  "optimization_hints": ["<hint, do NOT give solution>"],
  "follow_up_question": "<probing follow-up about approach>"
}}"""

    raw = await _achat([
        {"role": "system", "content": system_msg},
        {"role": "user",   "content": user_msg},
    ], temperature=0.2, max_tokens=1400)

    return _parse_json(raw, {
        "verdict": "partially_correct", "score": 5,
        "time_complexity": "Unknown", "space_complexity": "Unknown",
        "correctness_analysis": "Evaluation incomplete.",
        "code_quality": {"score": 5, "issues": [], "positives": []},
        "edge_cases_missed": [], "optimization_hints": [],
        "follow_up_question": "Walk me through your approach.",
    })


# ── Prompt builders (also used by streaming endpoint) ────────────────────────
def _build_eval_system_prompt(round_type: str = "technical") -> str:
    round_label = round_type.upper().replace("_", " ")
    return (
        f"You are an experienced {round_label} interviewer. Evaluate the candidate's answer "
        "honestly and specifically across all dimensions. "
        "Return ONLY valid JSON — no markdown outside the JSON block."
    )


def _build_eval_user_prompt(
    q_text: str,
    transcript: str,
    round_type: str = "technical",
    scoring_context: dict = None,
) -> str:
    sc_block = ""
    if scoring_context:
        sc = scoring_context
        filler_str = ", ".join(sc.get("filler_words", [])) or "none"
        wpm = sc.get("words_per_minute")
        dur = sc.get("duration_secs")
        limit = sc.get("time_limit_secs")
        sc_block = f"""
DELIVERY SIGNALS (from audio — use to calibrate scores):
- Duration: {dur}s of {limit}s allowed | WPM: {wpm}
- Filler words: {filler_str}
- Silence gaps: {"Yes" if sc.get("silence_gaps_detected") else "No"}
- Candidate year: {sc.get("candidate_year", "unknown")}
CALIBRATION: Deduct 1pt if >5 fillers; add 0.5pt if time_used_ratio 0.5-0.8 (concise+complete).
"""

    weight_note = ""
    if round_type == "hr":
        weight_note = "HR WEIGHTS: communication=35%, relevance=25%, technical=10%, rest split."
    elif round_type == "dsa":
        weight_note = "DSA WEIGHTS: technical_accuracy=60%, depth=30%, communication=10%."
    else:
        weight_note = "TECH WEIGHTS: technical_accuracy=40%, depth=20%, communication=15%, confidence=10%, relevance=10%, example=5%."

    from prompts.scoring_examples import inject_few_shot_examples
    calibration_block = inject_few_shot_examples(round_type, max_examples=2)

    return f"""Question: {q_text}
Round Type: {round_type.upper()}
{sc_block}
{calibration_block}
{weight_note}

Candidate's Answer: {transcript[:1500]}

Return ONLY valid JSON:
{{
  "score": <integer 1-10, weighted composite>,
  "dimension_scores": {{
    "technical_accuracy": <1-10>,
    "depth_completeness": <1-10>,
    "communication_clarity": <1-10>,
    "confidence_delivery": <1-10>,
    "relevance": <1-10>,
    "example_quality": <1-10>
  }},
  "feedback": "<2-3 sentences citing specific parts of their answer>",
  "strong_points": ["<specific strength>"],
  "weak_points": ["<specific weakness>"],
  "missing_concepts": ["<concept they should have mentioned>"],
  "communication_score": <1-10>,
  "confidence_score": <1-10>,
  "answer_structure": "<excellent|good|rambling|too_brief|off_topic>",
  "follow_up_needed": <true|false>,
  "follow_up_question": "<targeted follow-up or null>",
  "key_concept_missed": "<single most important missed concept or empty string>",
  "red_flag_detected": "<arrogance/blame-shifting or empty string>",
  "verdict": "<Excellent|Good|Satisfactory|Needs Improvement|Poor>",
  "answer_summary": "<1 sentence summary of what they said>"
}}
Scoring: 1-3 incorrect/incomplete, 4-6 partial, 7-8 good with minor gaps, 9-10 excellent."""


# ── Verbal Answer Evaluation ──────────────────────────────────────────────────
async def evaluate_answer(
    question: dict,
    transcript: str,
    round_type: str = "technical",
    scoring_context: dict = None,
) -> dict:
    """
    Evaluate a verbal/text answer for non-coding interview rounds.
    Uses 7-dimension scoring rubric. Accepts optional scoring_context
    (audio delivery signals) for holistic calibration.

    Returns:
        {
          score, dimension_scores, strong_points, weak_points,
          missing_concepts, communication_score, confidence_score,
          answer_structure, follow_up_needed, follow_up_question,
          key_concept_missed, verdict, answer_summary
        }
    """
    if not transcript or transcript.strip() in ("", "[No speech detected]", "[SKIPPED]"):
        return {
            "score": 1, "communication_score": 1, "confidence_score": 1,
            "strong_points": [], "weak_points": ["No answer was provided."],
            "missing_concepts": [], "dimension_scores": {},
            "answer_structure": "too_brief", "follow_up_needed": False,
            "follow_up_question": None, "key_concept_missed": "",
            "verdict": "Poor", "answer_summary": "No answer provided.",
            "red_flag_detected": "",
        }

    q_text = question.get("question_text") or question.get("title", "")

    system_msg = _build_eval_system_prompt(round_type)
    user_msg   = _build_eval_user_prompt(q_text, transcript, round_type, scoring_context)

    raw = await _achat([
        {"role": "system", "content": system_msg},
        {"role": "user",   "content": user_msg},
    ], temperature=0.3, max_tokens=1200)

    return _parse_json(raw, {
        "score": 5, "communication_score": 6, "confidence_score": 5,
        "strong_points": [], "weak_points": [], "missing_concepts": [],
        "dimension_scores": {}, "answer_structure": "good",
        "follow_up_needed": False, "follow_up_question": None,
        "key_concept_missed": "", "verdict": "Satisfactory",
        "answer_summary": "", "red_flag_detected": "",
    })
