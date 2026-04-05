"""
prompts/stage3_prompt.py — Stage 3: Communication & Behavioral Analysis

Analyzes HOW the candidate spoke (not just what they said).
Uses transcript + voice_metrics to produce:
  - communication_breakdown (6-axis)
  - six_axis_radar
  - bs_flag (rambling to dodge)
  - pattern_groups (root cause groupings)
  - blind_spots
  - what_went_wrong (plain-English summary)
"""
from __future__ import annotations

_SIX_AXES = [
    "Communication Clarity",
    "Confidence",
    "Answer Structure",
    "Pacing",
    "Relevance",
    "Example Quality",
]


def _format_voice_summary(voice_metrics: list | None) -> str:
    if not voice_metrics:
        return "Voice analysis not available for this session."
    lines = []
    for m in voice_metrics[:10]:
        qid = m.get("question_id", "?")
        conf = m.get("confidence_score", "?")
        fillers = m.get("filler_count", 0)
        pace = m.get("pace_wpm", "?")
        pauses = m.get("pause_count", 0)
        lines.append(
            f"  {qid}: Confidence {conf}/100 | Fillers: {fillers} "
            f"| Pace: {pace} wpm | Long pauses: {pauses}"
        )
    return "\n".join(lines) if lines else "No per-question voice data."


def _format_qa_short(question_scores: list, max_q: int = 10) -> str:
    lines = []
    for i, q in enumerate(question_scores[:max_q], 1):
        answer = (q.get("answer_text") or "")[:250].strip()
        lines.append(
            f"Q{i} [{q.get('category', 'General')}]: {q.get('question_text', '')}\n"
            f"  Answer (truncated): {answer or '[No answer]'}\n"
            f"  Score: {q.get('score', '?')}/10"
        )
    return "\n\n".join(lines) if lines else "No transcript."


def build_communication_analysis_prompt(
    question_scores: list,
    voice_metrics: list | None,
    delivery_consistency: dict | None,
    round_type: str,
    overall_score: float,
) -> str:
    """
    Builds Stage 3 Groq prompt: communication analysis + root cause.
    """
    delivery_block = ""
    if delivery_consistency:
        delivery_block = (
            f"\nDELIVERY CONSISTENCY:\n"
            f"  Arc: {delivery_consistency.get('arc_plot', [])}\n"
            f"  Start avg confidence: {delivery_consistency.get('start_avg')} | "
            f"End avg: {delivery_consistency.get('end_avg')} | "
            f"Drop: {delivery_consistency.get('drop')}\n"
            f"  Verdict: {delivery_consistency.get('verdict', 'Unknown')}\n"
        )

    voice_block = f"\nPER-QUESTION VOICE METRICS:\n{_format_voice_summary(voice_metrics)}\n"
    qa_block = _format_qa_short(question_scores)

    axes_schema = "\n    ".join(f'"{ax}": <integer 0-100>' for ax in _SIX_AXES)

    return f"""You are a professional communication coach and behavioral interview analyst.
Analyze the candidate's transcript and voice delivery data to evaluate HOW they communicated, not just WHAT they said.
Be specific — reference exact question numbers and patterns you observe.

ROUND TYPE: {round_type.upper()} | OVERALL SCORE: {overall_score:.1f}/10
{delivery_block}
{voice_block}
TRANSCRIPT:
{qa_block}

Return ONLY valid JSON. No markdown, no text outside the JSON:
{{
  "communication_breakdown": {{
    {axes_schema}
  }},

  "six_axis_radar": {{
    {axes_schema}
  }},

  "bs_flag": [
    {{
      "question_id": "<Q1|Q2|...>",
      "flag_reason": "<1-2 sentences describing how they rambled or deflected without actually answering>",
      "confidence": <integer 0-100 — how confident you are this was avoidance behaviour>
    }}
  ],

  "pattern_groups": [
    {{
      "pattern": "<short descriptive name e.g. 'Confidence Collapse Under Pressure'>",
      "questions_affected": ["Q2", "Q5"],
      "core_gap": "<the underlying root cause — e.g. 'Fundamental misunderstanding of ACID compliance'>",
      "severity": "<critical|high|medium>",
      "evidence": "<direct quote or specific moment from transcript>"
    }}
  ],

  "blind_spots": [
    {{
      "area": "<topic or skill>",
      "what_they_think": "<what the candidate appears to believe about their own ability>",
      "what_we_see": "<what the transcript actually reveals>",
      "severity": "<critical|high|medium>"
    }}
  ],

  "what_went_wrong": "<2-3 sentence plain-English summary of the biggest failure points. Be direct and specific. This is the first thing the candidate will read.>"
}}

RULES:
- bs_flag: ONLY include genuine avoidance — rambling without structure, topic-switching, excessive hedging.
  Empty array [] if none detected.
- pattern_groups: Group failures by root cause (not by question). Minimum 1 if overall score < 80.
- blind_spots: Instances where candidate seemed unaware of their weakness. E.g., overconfident about Redis but couldn't explain eviction.
- communication_breakdown & six_axis_radar: score 0-100. Be calibrated — 50 = average, 80 = strong.
- what_went_wrong: Write for the candidate to read first. No sugar-coating, no generic statements."""


def build_communication_analysis_prompt_text_only(
    question_scores: list,
    round_type: str,
    overall_score: float,
) -> str:
    """Fallback version when no voice metrics are available (coding sessions)."""
    return build_communication_analysis_prompt(
        question_scores=question_scores,
        voice_metrics=None,
        delivery_consistency=None,
        round_type=round_type,
        overall_score=overall_score,
    )
