"""
prompts/report_prompt.py — Two-stage Ultra-Report prompt builders.

Stage 1 (Core):   grade, hire_recommendation, radar, categories, strong/weak,
                  per-question, interview_tips, hire_signal, failure_patterns
Stage 2 (CV Audit): cv_audit, study_roadmap, study_recommendations,
                    mock_ready_topics, not_ready_topics
"""
from __future__ import annotations

# ── Round-specific radar axes ────────────────────────────────────────────────
_RADAR_AXES = {
    "technical": [
        "OOP & Design Patterns", "Data Structures & Algorithms",
        "DBMS & SQL", "OS & CN Concepts", "Project Knowledge", "Communication"
    ],
    "hr": [
        "Communication", "Problem Solving", "Teamwork",
        "Leadership", "Culture Fit", "Situational Judgment"
    ],
    "dsa": [
        "Problem Understanding", "Algorithm Design", "Code Quality",
        "Time Complexity", "Edge Cases", "Optimization"
    ],
    "mcq_practice": [
        "Company Alignment", "Core CS",
        "Resume Knowledge", "Role Fundamentals", "Accuracy", "Time Management"
    ],
}


def _format_qa(question_scores: list, max_questions: int = 12) -> str:
    """Format Q&A transcript for prompt injection."""
    lines = []
    for i, q in enumerate(question_scores[:max_questions], 1):
        answer = (q.get("answer_text") or "")[:350].strip()
        if not answer:
            answer = "[No answer provided]"
        lines.append(
            f"Q{i} [{q.get('category', 'General')}]: {q.get('question_text', '')}\n"
            f"  Answer: {answer}\n"
            f"  Score: {q.get('score', 0)}/10 | Verdict: {q.get('verdict', '')}\n"
            f"  Concept Missed: {q.get('key_concept_missed', '') or 'None'}\n"
            f"  Red Flag: {q.get('red_flag_detected', '') or 'None'}"
        )
    return "\n\n".join(lines) if lines else "No questions answered."


# ── STAGE 1: Core Analysis Prompt ────────────────────────────────────────────
def build_core_analysis_prompt(
    session: dict,
    profile: dict,
    question_scores: list,
    overall_score: float,
    market_context: str = "",
) -> str:
    """
    Builds the prompt for the core report analysis.
    Outputs: grade, hire_recommendation, summary, radar, categories,
             strong/weak areas, per-question, hire_signal, failure_patterns.
    """
    round_type = session.get("round_type", "technical")
    difficulty = session.get("difficulty", "medium")
    name       = profile.get("name") or "Candidate"
    skills     = ", ".join((profile.get("skills") or [])[:10]) or "General software engineering"
    target_co  = profile.get("target_company") or session.get("target_company") or "a top tech company"

    radar_axes = _RADAR_AXES.get(round_type, _RADAR_AXES["technical"])
    radar_schema = "\n    ".join(f'"{axis}": <integer 0-100>' for axis in radar_axes)

    qa_block = _format_qa(question_scores)

    market_block = ""
    if market_context.strip():
        market_block = f"\nLIVE MARKET CONTEXT (use this to colour your recommendations):\n{market_context[:600]}\n"

    return f"""You are a senior talent evaluation expert with 15+ years of technical recruiting experience at top-tier companies.
Analyze the complete interview transcript below and generate a brutally honest, highly specific, actionable report.
NEVER be generic — always cite specific answers, specific concepts missed, specific evidence.

CANDIDATE: {name}
TARGET COMPANY: {target_co}
SKILLS ON RESUME: {skills}
INTERVIEW TYPE: {round_type.upper()} | {difficulty.upper()} difficulty
OVERALL SCORE: {overall_score:.1f}/10
{market_block}
FULL TRANSCRIPT:
{qa_block}

Return ONLY valid JSON. No markdown, no text outside the JSON object:
{{
  "grade": "<A+|A|B+|B|C+|C|D>",
  "hire_recommendation": "<Strong Yes|Yes|Maybe|No>",
  "summary": "<4-5 sentence detailed assessment — reference specific questions answered and missed>",
  "compared_to_level": "<e.g. 'Performing at Junior Engineer level for {round_type} interviews at {target_co}'>",

  "radar_scores": {{
    {radar_schema}
  }},

  "category_breakdown": [
    {{
      "category": "<e.g. OOP>",
      "score": <integer 0-100>,
      "verdict": "<Strong|Good|Average|Weak>",
      "comment": "<1 specific sentence citing actual answer evidence>"
    }}
  ],

  "strong_areas": [
    {{
      "area": "<name>",
      "evidence": "<quote or specific moment from their answer>",
      "score": <integer 0-100>
    }}
  ],

  "weak_areas": [
    {{
      "area": "<name>",
      "what_was_missed": "<specific concept, formula, or pattern they couldn't articulate>",
      "how_to_improve": "<concrete, actionable 1-2 sentence advice>",
      "score": <integer 0-100>
    }}
  ],

  "red_flags": [
    "<Only include if candidate showed extreme arrogance, blame-shifting, or cultural toxicity. Empty array [] if none.>"
  ],

  "per_question_analysis": [
    {{
      "question_id": "<Q1|Q2|...>",
      "question_text": "<full question text>",
      "score": <integer 0-10>,
      "verdict": "<Excellent|Good|Satisfactory|Needs Improvement|Poor>",
      "answer_summary": "<2-3 sentence summary of what they actually said>",
      "key_insight": "<1 sharp, specific actionable insight — what they must learn from this question>",
      "category": "<category>"
    }}
  ],

  "interview_tips": [
    "<actionable technique tip 1 — specific to their performance patterns>",
    "<tip 2>",
    "<tip 3>"
  ],

  "hire_signal": {{
    "technical_depth":  {{ "score": <1-10>, "rationale": "<1 sentence citing specific answer>" }},
    "communication":    {{ "score": <1-10>, "rationale": "<1 sentence>" }},
    "problem_solving":  {{ "score": <1-10>, "rationale": "<1 sentence>" }},
    "cultural_fit":     {{ "score": <1-10>, "rationale": "<1 sentence>" }},
    "growth_potential": {{ "score": <1-10>, "rationale": "<1 sentence — do they learn from hints?>" }}
  }},

  "failure_patterns": [
    {{
      "pattern": "<short descriptive pattern name, e.g. 'Consistent gaps on OS internals'>",
      "affected_questions": [<1-indexed question numbers that show this pattern>],
      "root_cause": "<1-2 sentences on WHY this pattern likely occurred>",
      "fix": "<1-2 specific, actionable sentences on how to fix it>"
    }}
  ]
}}

GRADING RULES:
- 90-100 = A+, 80-89 = A, 70-79 = B+, 60-69 = B, 50-59 = C+, 40-49 = C, <40 = D
- hire_recommendation: Strong Yes ≥85, Yes 70-84, Maybe 50-69, No <50
- Minimum: 2 strong_areas, 2 weak_areas, complete per_question_analysis for ALL questions
- failure_patterns: identify at least 1 if overall score <80, empty array only if near-perfect"""


# ── STAGE 2: CV Audit Prompt ─────────────────────────────────────────────────
def build_cv_audit_prompt(
    profile: dict,
    question_scores: list,
) -> str:
    """
    Builds the prompt for the CV realism audit and 4-week study roadmap.
    Outputs: cv_audit (with per-claim analysis), study_roadmap, study_recommendations,
             mock_ready_topics, not_ready_topics.
    """
    # Build CV claims list from profile
    skills   = profile.get("skills") or []
    projects = profile.get("projects") or []
    exp      = profile.get("experience") or []

    cv_claims_lines = []
    for s in skills[:15]:
        cv_claims_lines.append(f"  Skill: {s}")
    for p in projects[:5]:
        tech = p.get("tech") or p.get("tech_stack") or []
        if isinstance(tech, str):
            tech = [t.strip() for t in tech.split(",") if t.strip()]
        tech = ", ".join(tech[:5])
        cv_claims_lines.append(f"  Project: {p.get('name', '')} [Stack: {tech}]")
    for e in exp[:3]:
        cv_claims_lines.append(f"  Experience: {e.get('title', '')} at {e.get('company', '')}")

    if not cv_claims_lines:
        # No CV data — return a prompt that produces empty-but-valid output
        return """Return ONLY this valid JSON, exactly: {"cv_audit":{"overall_cv_honesty_score":0,"note":"No resume data available for this analysis.","items":[]},"study_roadmap":{"week_1":[],"week_2":[],"week_3":[],"week_4":[]},"study_recommendations":[],"mock_ready_topics":[],"not_ready_topics":[]}"""

    cv_block  = "\n".join(cv_claims_lines)
    qa_block  = _format_qa(question_scores)

    return f"""You are a CV verification expert and career coach. Cross-reference the candidate's resume claims against their actual interview performance to expose gaps between what they claim and what they can actually explain under pressure.

RESUME CLAIMS (what the candidate put on their CV):
{cv_block}

ACTUAL INTERVIEW PERFORMANCE (what they were asked and how they answered):
{qa_block}

For each resume claim, check if it was tested in the interview, and if tested, whether they answered well.

Return ONLY valid JSON. No markdown, no text outside the JSON:
{{
  "cv_audit": {{
    "overall_cv_honesty_score": <integer 0-100, formula: (claims_defended / claims_asked) * 100, rounded. If 0 claims were asked, score = 50.>,
    "note": "<1 brutally honest sentence summarizing CV credibility — e.g. 'Candidate defended 4 of 7 tested claims; Redis and Docker were listed but completely unknown'>",
    "items": [
      {{
        "claim": "<exact skill or project name from CV>",
        "type": "<Skill|Project|Experience>",
        "asked": <true if a question tested this claim, false otherwise>,
        "answered_well": <true|false|null — null only if not asked>,
        "demonstrated_level": "<Expert|Intermediate|Beginner|Not Demonstrated|Not Tested>",
        "gap": "<specific concept they could NOT explain — empty string if not asked or defended well>",
        "what_to_study": "<concrete study resource/topic — empty string if not asked or no gap>"
      }}
    ]
  }},

  "study_roadmap": {{
    "week_1": [
      {{
        "topic": "<highest priority gap topic>",
        "goal": "<specific measurable learning goal for this week>",
        "resource": "<specific book/site/course name e.g. 'CLRS Chapter 6', 'NeetCode Blind 75', 'ByteByteGo System Design'>",
        "hours": <estimated hours 2-10>
      }}
    ],
    "week_2": [ <same structure, next priority topics> ],
    "week_3": [ <same structure> ],
    "week_4": [ <same structure — consolidation and mock interviews> ]
  }},

  "study_recommendations": [
    {{
      "topic": "<topic>",
      "priority": "<High|Medium|Low>",
      "resources": ["<specific resource 1>", "<specific resource 2>"],
      "reason": "<1 sentence explaining exactly why this was identified from their interview>"
    }}
  ],

  "mock_ready_topics": [
    "<topic the candidate can confidently discuss in their next interview — only include 7+/10 consistent topics>"
  ],
  "not_ready_topics": [
    "<topic that needs significant prep before next interview>"
  ]
}}

RULES:
- Include ALL resume claims in items[], even those not tested (mark as Not Tested)
- Week 1 = the most critical gaps that cost them the most points
- Week 4 = consolidation, mock interviews, revision  
- Be SPECIFIC with resources: "Redis University free course" not just "Redis docs"
- mock_ready_topics: CONSERVATIVE — only topics with strong performance (7+/10 across questions)
- not_ready_topics: any topic where they scored <6/10 or couldn't explain when directly asked"""


# ── Legacy Compat: used by reports.py router ─────────────────────────────────
def build_report_prompt(session: dict, profile: dict) -> str:
    """Original single-prompt builder — kept for backward compatibility with reports.py."""
    name       = profile.get("name") or "Candidate"
    round_type = session.get("round_type", "technical")
    difficulty = session.get("difficulty", "medium")
    transcript = session.get("transcript") or []

    qa_text = ""
    for i, entry in enumerate(transcript, 1):
        q       = entry.get("question") or entry.get("question_text") or "Unknown question"
        a       = entry.get("answer") or entry.get("transcript") or "[No answer]"
        s       = entry.get("score")
        skipped = entry.get("skipped", False)
        qa_text += f"\nQ{i}: {q}\n"
        qa_text += f"Answer: {'[SKIPPED]' if skipped else a[:500]}\n"
        if s is not None:
            qa_text += f"Score: {s}/10\n"

    if not qa_text:
        qa_text = "No answers were recorded for this session."

    skills   = ", ".join((profile.get("skills") or [])[:12]) or "General software engineering"
    exp_list = profile.get("experience") or []
    exp_text = "; ".join(
        f"{e.get('title', '')} at {e.get('company', '')}" for e in exp_list[:3]
    ) or "No prior experience listed"

    return f"""You are a senior talent evaluation expert with 15+ years of technical recruiting experience.
Analyze this complete mock interview transcript and produce a rigorous, honest, and actionable report.

CANDIDATE
Name: {name}  |  Skills: {skills}  |  Experience: {exp_text}

INTERVIEW: {round_type.upper()} round, {difficulty.upper()} difficulty

FULL TRANSCRIPT
{qa_text}

Return ONLY valid JSON — no markdown, no text outside JSON. Be specific; cite actual answers as evidence.

{{
  "overall_score": <integer 0-100>,
  "grade": "<A+|A|B+|B|C+|C|D>",
  "summary": "<3-4 sentence summary — mention actual topics covered>",
  "hire_recommendation": "<Strong Yes|Yes|Maybe|No>",
  "radar_scores": {{
    "technical_knowledge": <0-100>,
    "problem_solving":     <0-100>,
    "communication":       <0-100>,
    "confidence":          <0-100>,
    "depth_of_knowledge":  <0-100>
  }},
  "strong_areas": [
    {{ "area": "<name>", "evidence": "<specific moment or answer>", "score": <0-100> }}
  ],
  "weak_areas": [
    {{ "area": "<name>", "what_was_missed": "<missing concepts>", "how_to_improve": "<concrete advice>", "score": <0-100> }}
  ],
  "per_question_analysis": [
    {{
      "question_id":    "<Q1/Q2/...>",
      "question_text":  "<question>",
      "answer_summary": "<2-line summary>",
      "score":          <0-10>,
      "verdict":        "<Excellent|Good|Satisfactory|Needs Improvement|Poor>",
      "key_insight":    "<one actionable insight>"
    }}
  ],
  "study_recommendations": [
    {{ "topic": "<topic>", "priority": "<High|Medium|Low>", "resources": ["<resource1>", "<resource2>"], "reason": "<why>" }}
  ],
  "compared_to_level": "Performs at <Fresher|Junior|Mid|Senior> level for {round_type} interviews"
}}

RULES:
- overall_score 90-100=A+, 80-89=A, 70-79=B+, 60-69=B, 50-59=C+, 40-49=C, <40=D
- hire_recommendation: Strong Yes>85, Yes 70-84, Maybe 50-69, No<50
- At least 2 strong_areas, 2 weak_areas, 3 study_recommendations with real resources."""
