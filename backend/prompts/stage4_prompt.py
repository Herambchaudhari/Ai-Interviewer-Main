"""
prompts/stage4_prompt.py — Stage 4: Personalized Playbook & Resources

Uses weak_areas + pattern_groups + company_fit + overall performance to generate:
  - swot (4-quadrant)
  - what skills to work on (priority-ranked)
  - thirty_day_plan (week-by-week sprint with resources)
  - auto_resources (curated links per topic)
  - follow_up_questions (likely next-round questions)
  - next_interview_blueprint (recommended next session config)
"""
from __future__ import annotations


def _format_weak_areas(weak_areas: list, max_items: int = 6) -> str:
    if not weak_areas:
        return "None identified."
    lines = []
    for w in weak_areas[:max_items]:
        if isinstance(w, dict):
            area = w.get("area", "")
            missed = w.get("what_was_missed", "")
            score = w.get("score", "?")
            lines.append(f"  - {area} (score {score}): Missed — {missed}")
        elif isinstance(w, str):
            lines.append(f"  - {w}")
    return "\n".join(lines) if lines else "None identified."


def _format_pattern_groups(pattern_groups: list, max_items: int = 4) -> str:
    if not pattern_groups:
        return "No patterns identified."
    lines = []
    for p in pattern_groups[:max_items]:
        if isinstance(p, dict):
            lines.append(
                f"  - Pattern: {p.get('pattern', '')} | "
                f"Root cause: {p.get('core_gap', '')} | "
                f"Severity: {p.get('severity', '')}"
            )
    return "\n".join(lines) if lines else "No patterns identified."


def _format_company_context(company_fit: dict | None) -> str:
    if not company_fit:
        return ""
    lines = [
        f"  Target company: {company_fit.get('target_company', 'Unknown')}",
        f"  Pass probability: {company_fit.get('pass_probability', '?')}%",
        f"  Gap to clear: {company_fit.get('gap_to_clear', '?')} points",
    ]
    gaps = company_fit.get("gap_breakdown", [])
    if gaps:
        lines.append("  Biggest gaps:")
        for g in gaps[:3]:
            lines.append(
                f"    {g.get('dimension')}: need {g.get('required')}, yours {g.get('yours')} (delta {g.get('delta')})"
            )
    return "\n".join(lines)


def build_playbook_prompt(
    weak_areas: list,
    strong_areas: list,
    pattern_groups: list,
    company_fit: dict | None,
    round_type: str,
    overall_score: float,
    target_company: str = "",
    candidate_year: str = "",
) -> str:
    """
    Builds Stage 4 Groq prompt: SWOT + 30-day sprint + resources + follow-up Qs.
    """
    weak_block = _format_weak_areas(weak_areas)
    strong_block = "\n".join(
        f"  - {s.get('area', s) if isinstance(s, dict) else s}"
        for s in (strong_areas or [])[:4]
    ) or "None identified."
    patterns_block = _format_pattern_groups(pattern_groups)
    company_block = _format_company_context(company_fit)
    company_line = f"Target company: {target_company}" if target_company else ""
    year_line = f"Candidate year: {candidate_year}" if candidate_year else ""

    return f"""You are an elite career coach creating a personalized 30-day action plan for a candidate.
Your plan must be SPECIFIC — cite actual weak areas, not generic advice.
{company_line}
{year_line}
ROUND TYPE: {round_type.upper()} | OVERALL SCORE: {overall_score:.1f}/100

WEAK AREAS:
{weak_block}

STRONG AREAS:
{strong_block}

ROOT CAUSE PATTERNS:
{patterns_block}

{f"COMPANY FIT:{chr(10)}{company_block}" if company_block else ""}

Return ONLY valid JSON. No markdown, no text outside the JSON:
{{
  "swot": {{
    "strengths":     ["<specific strength based on performance>", "<strength 2>"],
    "weaknesses":    ["<specific weakness based on performance>", "<weakness 2>"],
    "opportunities": ["<opportunity based on strong areas — e.g. 'Can leverage Communication for HR rounds'>"],
    "threats":       ["<risk if not addressed — e.g. 'Weak System Design will block FAANG interviews'>"]
  }},

  "skills_to_work_on": [
    {{
      "skill":    "<specific skill or topic>",
      "priority": "<High|Medium|Low>",
      "reason":   "<1 sentence — exactly why this was identified, citing their performance>",
      "resources": ["<specific resource 1 e.g. 'NeetCode.io — Blind 75'>", "<resource 2>"]
    }}
  ],

  "thirty_day_plan": {{
    "week_1": [
      {{
        "topic":    "<highest priority gap topic>",
        "goal":     "<specific measurable outcome for this week>",
        "resource": "<specific named resource>",
        "hours":    <2-10>,
        "task":     "<one-line weekly summary task>",
        "daily_tasks": [
          {{ "day": "Mon", "task": "<specific 30-60 min task — e.g. 'Read CLRS Ch.4 on divide-and-conquer, take notes on master theorem'>" }},
          {{ "day": "Tue", "task": "<specific task building on Monday>" }},
          {{ "day": "Wed", "task": "<practice or application task>" }},
          {{ "day": "Thu", "task": "<deeper practice or a mini-project>" }},
          {{ "day": "Fri", "task": "<review, consolidate, and write a 5-sentence summary of what you learned this week>" }}
        ]
      }}
    ],
    "week_2": [ <same structure, next priority> ],
    "week_3": [ <same structure> ],
    "week_4": [
      {{
        "topic":    "Mock Interview Practice",
        "goal":     "Apply all learnings under timed conditions",
        "resource": "Use this platform — run 2 full mock interviews",
        "hours":    4,
        "task":     "Complete 2 full timed mock interviews on weakest topics",
        "daily_tasks": [
          {{ "day": "Mon", "task": "Revise all weak areas from weeks 1-3 using your notes" }},
          {{ "day": "Tue", "task": "Run a full timed mock interview on this platform (Attempt 1)" }},
          {{ "day": "Wed", "task": "Review feedback from Attempt 1, identify 2-3 persistent gaps" }},
          {{ "day": "Thu", "task": "Run a second full timed mock interview focusing on gap areas" }},
          {{ "day": "Fri", "task": "Write a self-assessment: what improved, what still needs work, next steps" }}
        ]
      }}
    ]
  }},

  "auto_resources": [
    {{
      "topic":       "<specific weak topic>",
      "youtube_query": "<exact search query for YouTube>",
      "article_url": "<specific site URL, not generic e.g. 'https://leetcode.com/explore/'>",
      "difficulty":  "<beginner|intermediate|advanced>",
      "estimated_hours": <1-10>
    }}
  ],

  "follow_up_questions": [
    {{
      "question":         "<specific follow-up question a human interviewer would ask based on their weak answers>",
      "why_asked":        "<1 sentence — why this question exposes the gap>",
      "model_answer_hint": "<2-3 bullet hints on what a great answer covers>"
    }}
  ],

    "next_interview_blueprint": {{
    "round_type":    "<technical|dsa|hr|mcq_practice>",
    "difficulty":    "<easy|medium|hard>",
    "focus_topics":  ["<specific topic 1>", "<specific topic 2>"],
    "reason":        "<1-2 sentences on why this config is the best next step for their growth>",
    "timer_mins":    <20|30|45|60>
  }}
}}

RULES:
- swot: Must be grounded in their actual performance — no generic motivational statements
- skills_to_work_on: 3-5 items, ordered High→Low priority
- thirty_day_plan: Each week MUST have 2-3 items. Week 1 = most critical gaps, Week 4 = mock practice
- daily_tasks: EVERY week item MUST include exactly 5 daily_tasks (Mon–Fri). Each task must be completable in 30-60 minutes. Be specific — not 'study topic X' but 'read Chapter Y, solve Z problems on LeetCode, write a summary of...'
- auto_resources: 3-5 items covering the top weak areas
- follow_up_questions: 3-5 questions based on their specific weak answers
- next_interview_blueprint: ONE recommended next session config — the best step for their specific trajectory"""
