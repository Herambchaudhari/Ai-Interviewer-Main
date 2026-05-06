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
        "Communication Clarity",
        "STAR Story Craft",
        "Self-Awareness & Accountability",
        "Growth Mindset & Adaptability",
        "Leadership & Ownership",
        "Collaboration & Stakeholder Fit",
        "Resilience Under Pressure",
    ],
    "dsa": [
        "Algorithm Design", "Code Readability",
        "Time Efficiency", "Space Efficiency",
        "Edge Case Coverage", "Code Style"
    ],
    "mcq_practice": [
        "Company Alignment", "Core CS",
        "Resume Knowledge", "Role Fundamentals", "Accuracy", "Time Management"
    ],
}


def _format_qa(question_scores: list, max_questions: int = 12) -> str:
    """Format Q&A transcript for prompt injection.

    For DSA (question_type='code') entries: surfaces test results, complexity,
    and language — the signals the LLM needs for a meaningful coding assessment.
    For verbal/MCQ entries: retains concept-missed and red-flag signals.
    """
    lines = []
    for i, q in enumerate(question_scores[:max_questions], 1):
        answer = (q.get("answer_text") or "")[:400].strip()
        if not answer:
            answer = "[No answer provided]"

        entry = [
            f"Q{i} [{q.get('category', 'General')}]: {q.get('question_text', '')}",
            f"  Answer: {answer}",
            f"  Score: {q.get('score', 0)}/10 | Verdict: {q.get('verdict', '')}",
        ]

        if q.get("question_type") == "code":
            # DSA submission — give the LLM execution + complexity context
            tp = q.get("tests_passed")
            tt = q.get("tests_total")
            if tt is not None:
                pct = round((tp or 0) / max(tt, 1) * 100)
                entry.append(f"  Tests: {tp}/{tt} passed ({pct}%)")
            tc = q.get("time_complexity", "")
            sc = q.get("space_complexity", "")
            if tc:
                entry.append(f"  Complexity: Time {tc} | Space {sc or 'unknown'}")
            if q.get("language"):
                entry.append(f"  Language: {q['language']}")
        else:
            # Verbal / MCQ — surface gap-analysis signals
            entry.append(f"  Concept Missed: {q.get('key_concept_missed', '') or 'None'}")
            entry.append(f"  Red Flag: {q.get('red_flag_detected', '') or 'None'}")

        lines.append("\n".join(entry))
    return "\n\n".join(lines) if lines else "No questions answered."


# ── STAGE 1: Core Analysis Prompt ────────────────────────────────────────────
def build_core_analysis_prompt(
    session: dict,
    profile: dict,
    question_scores: list,
    overall_score: float,
    market_context: str = "",
    code_quality_metrics: dict = None,
) -> str:
    """
    Builds the prompt for the core report analysis.
    Outputs: grade, hire_recommendation, summary, radar, categories,
             strong/weak areas, per-question, hire_signal, failure_patterns.
    For DSA rounds, code_quality_metrics seeds the radar scores.
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
    if market_context and market_context.strip():
        market_block = f"\nLIVE MARKET CONTEXT (use this to colour your recommendations):\n{market_context[:600]}\n"

    # For DSA rounds, inject aggregated code execution data as additional context
    code_block = ""
    if round_type == "dsa" and code_quality_metrics:
        avg_pass = code_quality_metrics.get("test_pass_rate", 0)
        avg_time = code_quality_metrics.get("execution_time_ms", 0)
        avg_mem  = code_quality_metrics.get("memory_kb", 0)
        naming   = code_quality_metrics.get("variable_naming_score", 0)
        code_block = (
            f"\nCODE EXECUTION SUMMARY (use to inform radar scores):\n"
            f"- Avg test pass rate: {avg_pass * 100:.0f}%\n"
            f"- Avg execution time: {avg_time} ms\n"
            f"- Avg memory usage: {avg_mem} KB\n"
            f"- Variable naming score: {naming}/100\n"
        )

    # ── HR-specific extra fields ─────────────────────────────────────────────
    hr_extra_schema = ""
    hr_grading_rules = ""
    hire_signal_schema = """\
  "hire_signal": {
    "technical_depth":  { "score": <1-10>, "rationale": "<1 sentence citing specific answer>" },
    "communication":    { "score": <1-10>, "rationale": "<1 sentence>" },
    "problem_solving":  { "score": <1-10>, "rationale": "<1 sentence>" },
    "cultural_fit":     { "score": <1-10>, "rationale": "<1 sentence>" },
    "growth_potential": { "score": <1-10>, "rationale": "<1 sentence — do they learn from hints?>" }
  },"""

    if round_type == "hr":
        hire_signal_schema = """\
  "hire_signal": {
    "leadership_potential": { "score": <1-10>, "rationale": "<1 sentence — proactive ownership evidence>" },
    "communication":        { "score": <1-10>, "rationale": "<1 sentence — clarity, structure, delivery>" },
    "emotional_maturity":   { "score": <1-10>, "rationale": "<1 sentence — how they describe adversity, blame language>" },
    "culture_fit":          { "score": <1-10>, "rationale": "<1 sentence — values alignment signals>" },
    "growth_potential":     { "score": <1-10>, "rationale": "<1 sentence — evidence of learning from experience>" }
  },"""
        hr_extra_schema = """
  "star_story_matrix": [
    {
      "question_id": "<Q1|Q2|...>",
      "competency_category": "<Conflict Resolution|Leadership|Failure & Learning|Teamwork|Problem-Solving|Communication|Customer Focus|Execution>",
      "situation_present": <true|false>,
      "task_present": <true|false>,
      "action_present": <true|false>,
      "result_present": <true|false>,
      "star_score": <integer 0-10, 10=all STAR elements with concrete specifics>,
      "star_completeness_pct": <integer 0-100, formula: (elements_present / 4) * 100, then +0-25 bonus for specificity>,
      "missing_element": "<the most important missing STAR element, or 'None'>",
      "specificity_level": "<High (specific names/numbers/dates) | Medium (some specifics) | Low (generic/vague)>",
      "best_verbatim_quote": "<literal transcription from the answer, max 40 words. NEVER paraphrase. If no notable quote, write 'No notable quote.'>"
    }
  ],

  "behavioral_category_coverage": [
    {
      "category": "<Conflict Resolution|Leadership & Ownership|Failure & Learning|...>",
      "covered": <true|false>,
      "question_numbers": [<1-indexed list>],
      "performance": "<Strong|Adequate|Weak|Not Asked>"
    }
  ],

  "communication_pattern": "<Anecdote-first (strong) | Abstract-first (needs grounding) | Rambling (needs structure) | Too-brief (needs elaboration)>",

  "culture_fit_narrative": "<2-3 sentence qualitative assessment. What work environment suits this candidate? (startup vs enterprise, high-autonomy vs structured, IC vs manager-track). Base this ONLY on evidence from their stories, not on speculation.>",

  "behavioral_red_flags": [
    {
      "flag": "<short label, max 10 words, e.g. 'Individual contribution unclear across all answers'>",
      "severity": "<Critical|Moderate|Minor>",
      "evidence": "<verbatim quote or specific observation from the transcript, max 40 words. Never generic.>"
    }
  ],

  "key_signals": [
    {
      "signal": "<short decisive hiring-committee statement — e.g. 'Demonstrated clear ownership by...' — max 15 words>",
      "evidence": "<verbatim quote or specific reference: question number + what they said, max 40 words>",
      "valence": "<positive|negative|mixed>"
    }
  ],

  "competency_scorecard": [
    {
      "axis": "<exact axis name from radar_scores — one of the 7 listed>",
      "rating_1_7": <integer 1-7>,
      "anchor_label": "<Exceptional|Exceeds Bar|Meets Bar|Below Bar|Significantly Below Bar|Poor|No Evidence>",
      "verbatim_quote": "<copy exact words from transcript, max 60 words. Write 'No response provided.' if no answer.>",
      "rationale": "<1 sentence explaining this rating based on the evidence>"
    }
  ],

  "culture_fit_dimensions": [
    {
      "dimension": "<exact label from the 5 fixed dimensions>",
      "candidate_position": <integer 1-5, 1=strongly left pole, 3=center/neutral, 5=strongly right pole>,
      "pole_left": "<left pole label>",
      "pole_right": "<right pole label>",
      "rationale": "<1 sentence — cite a specific story or behavior that places them at this position>"
    }
  ],

  "eq_profile": {
    "self_awareness": <integer 0-100>,
    "self_regulation": <integer 0-100>,
    "empathy": <integer 0-100>,
    "social_skills": <integer 0-100>,
    "intrinsic_motivation": <integer 0-100>,
    "eq_summary": "<2 sentences max — what stands out most about their emotional intelligence from the interview>",
    "eq_overall_label": "<High EQ|Moderate EQ|Developing EQ>"
  },

  "coachability_index": {
    "score": <integer 0-100>,
    "label": "<Highly Coachable|Coachable|Moderately Coachable|Resistant to Feedback>",
    "positive_signals": ["<observed behavior showing openness to feedback — verbatim or brief paraphrase, max 20 words each>"],
    "negative_signals": ["<observed behavior showing defensiveness or resistance — verbatim or brief paraphrase, max 20 words each>"],
    "summary": "<2 sentences — what their interview behavior reveals about receptiveness to growth and correction>"
  },

  "leadership_ic_fit": {
    "spectrum_position": <integer 1-10, 1=pure IC, 5=balanced hybrid, 10=pure leader>,
    "label": "<Strong IC|IC-Leaning|Hybrid|Leader-Leaning|Strong Leader>",
    "recommended_track": "<Individual Contributor|Tech Lead|People Manager|Hybrid IC-Lead>",
    "evidence": "<1-2 sentences citing specific stories or answers that place them on this spectrum>",
    "reasoning": "<1-2 sentences on what this spectrum position means for team and role fit>"
  },

  "reference_check_triggers": [
    {
      "topic": "<short topic label, max 8 words, e.g. 'Conflict with direct manager'>",
      "priority": "<High|Medium|Low>",
      "suggested_question": "<specific behavioral question for a reference, max 25 words, start with 'Can you describe...' or 'How did...'>",
      "reason": "<1 sentence — what was ambiguous or concerning in this interview that warrants verification>"
    }
  ],

  "assessment_confidence": {
    "score": <integer 0-100>,
    "label": "<High Confidence|Moderate Confidence|Low Confidence>",
    "limiting_factors": ["<specific reason confidence is not higher, e.g. 'Only 3 behavioral answers — small sample size'>"],
    "what_would_change_it": "<1 sentence — what additional evidence or follow-up would most shift the hire recommendation>"
  },"""
        hr_grading_rules = """
HR-SPECIFIC GRADING:
- STAR story quality is the primary signal. Score 9-10 only if they gave concrete, specific stories.
- Penalise heavily for: generic answers, hypothetical answers ('I would...'), no Result, blame-shifting.
- Reward: specific Situations with names/dates/context, quantified Results, genuine self-reflection.
- hire_recommendation: Strong Yes = candidate tells 80%+ complete STAR stories with concrete evidence.

7-AXIS RADAR CALIBRATION (radar_scores, 0-100):
- Communication Clarity 80+ = structured, concise, jargon-free delivery; answers directly address the question.
- STAR Story Craft 80+ = full S/T/A/R present on most answers with concrete specifics (names, dates, numbers).
- Self-Awareness & Accountability 80+ = genuine failure stories, no blame-shifting, owns outcomes.
- Growth Mindset & Adaptability 80+ = explicit behavioral change after failure/feedback, adapts to new info.
- Leadership & Ownership 80+ = proactive initiative evidence, decisions made without being told, drives outcomes.
- Collaboration & Stakeholder Fit 80+ = clear individual contribution AND credit to team, cross-functional evidence.
- Resilience Under Pressure 80+ = composed under adversity, describes difficult moments without catastrophizing.

key_signals RULES:
- Exactly 3 items — the most decisive hiring-committee evidence points from the entire session.
- Each must be specific: cite the question number OR use a direct quote. NEVER be generic.
- valence must be one of: positive, negative, mixed.

competency_scorecard RULES:
- Exactly 7 entries — one per radar axis, in the same order as radar_scores.
- rating_1_7 scale: 7=Exceptional, 6=Exceeds Bar, 5=Meets Bar, 4=Below Bar, 3=Significantly Below Bar, 2=Poor, 1=No Evidence.
- anchor_label MUST match the rating: 7→Exceptional, 6→Exceeds Bar, 5→Meets Bar, 4→Below Bar, 3→Significantly Below Bar, 2→Poor, 1→No Evidence.
- rating_1_7 must be consistent with radar_scores value: 85-100→7, 70-84→6, 55-69→5, 40-54→4, 25-39→3, 10-24→2, 0-9→1.
- verbatim_quote: copy exact words from the transcript. Do NOT paraphrase. Min 10 words, max 60 words.

star_completeness_pct RULES:
- Formula: (elements_present_count / 4) * 75 + specificity_bonus (0=Low, 12=Medium, 25=High). Round to integer.
- Example: S+A+R present (3/4) with Medium specificity = (3/4)*75 + 12 = 56 + 12 = 68.
- best_verbatim_quote: must be a literal copy from the transcript — never paraphrased, never invented.

culture_fit_dimensions RULES:
- Exactly 5 entries, one per fixed dimension in this exact order:
  1. dimension="Collaborative ↔ Independent", pole_left="Collaborative", pole_right="Independent"
  2. dimension="Process-Driven ↔ Adaptive", pole_left="Process-Driven", pole_right="Adaptive/Agile"
  3. dimension="Risk-Averse ↔ Risk-Tolerant", pole_left="Risk-Averse", pole_right="Risk-Tolerant"
  4. dimension="Analytical ↔ Intuitive", pole_left="Analytical", pole_right="Intuitive"
  5. dimension="Depth-Focused ↔ Breadth-Focused", pole_left="Depth-Focused", pole_right="Breadth-Focused"
- candidate_position: 1=strongly left pole, 3=center/neutral, 5=strongly right pole. Must be 1-5.
- rationale: cite a specific answer or story — never speculate.

eq_profile RULES:
- self_awareness: infer from depth of self-disclosure and accuracy of self-critique in answers.
- self_regulation: infer from composure language during adversity stories.
- empathy: infer from how they describe others (team members, stakeholders, customers).
- social_skills: infer from collaboration and conflict resolution stories.
- intrinsic_motivation: infer from stated reasons for actions and career choices.
- All scores 0-100. Do NOT default to 50 for all — spread scores based on actual evidence.
- eq_overall_label: High EQ if average ≥70, Moderate EQ if average 45-69, Developing EQ if average <45.

behavioral_red_flags RULES:
- Max 5 items. Return [] if no genuine red flags.
- severity: Critical = patterns that signal dishonesty, blame-shifting, or entitlement; Moderate = patterns needing follow-up; Minor = style observations.
- evidence: must cite question number or exact words. Never generic ("seemed evasive").

coachability_index RULES:
- score 0-100. Highly Coachable ≥75, Coachable 55-74, Moderately Coachable 35-54, Resistant to Feedback <35.
- positive_signals: candidate mentions acting on feedback they received; uses "I learned", "my manager pointed out", "after that I changed"; pivots approach mid-answer when prompted.
- negative_signals: deflects or justifies mistakes ("but I was right because..."); never attributes growth to external input; blame-shifts to teammates or circumstances.
- positive_signals and negative_signals: 0-3 items each. Empty array [] if no evidence found.
- Do NOT default to a neutral score — differentiate clearly based on actual language used.
- summary: 2 sentences max. Reference specific answers by question number.

leadership_ic_fit RULES:
- spectrum_position 1-10. 1 = pure IC (loves deep solo work, avoids people management). 5 = balanced hybrid. 10 = pure leader.
- Leader signals: mentions managing/mentoring others, driving team decisions, influencing without authority, cross-team coordination.
- IC signals: "I built this myself", "I was the sole owner", deep technical explanations, preference for individual work, discomfort with management stories.
- label mapping: 1-2=Strong IC, 3-4=IC-Leaning, 5=Hybrid, 6-7=Leader-Leaning, 8-10=Strong Leader.
- recommended_track: derive from spectrum_position. Use Hybrid IC-Lead for 4-6 with mixed evidence.
- evidence: cite question numbers or specific story details. Never speculate beyond what was said.
- reasoning: explain what this track placement means for how a hiring manager should position this candidate.

reference_check_triggers RULES:
- 1-4 items. Return [] if no ambiguities or concerns warrant verification.
- High priority: patterns suggesting potential dishonesty, toxic behavior, or major story inconsistency.
- Medium priority: ambiguous stories where reference confirmation would meaningfully increase hiring confidence.
- Low priority: minor gaps that a reference could clarify but wouldn't change the overall recommendation.
- suggested_question: behavioral format ("Can you describe a time when..." or "How did [candidate] handle..."). Never yes/no questions.
- NEVER generate triggers for competencies the candidate demonstrated clearly and consistently.

assessment_confidence RULES:
- score 0-100. High Confidence ≥70, Moderate Confidence 40-69, Low Confidence <40.
- Start from 100 and subtract for each limiting factor present:
  - Fewer than 4 behavioral answers given: −20
  - Two or more answers were hypothetical ("I would..." / "I think I would..."): −15
  - Major behavioral competency areas not covered: −10 per gap
  - Significant inconsistencies between answers: −15
  - Very short answers (under 3 sentences each): −10
- Floor at 10. Ceiling at 95 (never claim perfect confidence).
- limiting_factors: 1-3 items. Empty array [] if score ≥85.
- what_would_change_it: must be actionable and specific — a concrete follow-up action or question type."""

    return f"""You are a senior behavioral talent evaluator with 15+ years of HR interviewing experience at top-tier companies.
Analyze the complete interview transcript below and generate a brutally honest, highly specific, actionable report.
NEVER be generic — always cite specific stories, specific behaviors, specific evidence from the answers.

CANDIDATE: {name}
TARGET COMPANY: {target_co}
SKILLS ON RESUME: {skills}
INTERVIEW TYPE: {round_type.upper()} | {difficulty.upper()} difficulty
OVERALL SCORE: {overall_score:.1f}/10
{market_block}{code_block}
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

  {hire_signal_schema}

  "failure_patterns": [
    {{
      "pattern": "<short descriptive pattern name, e.g. 'Consistent gaps on OS internals'>",
      "affected_questions": [<1-indexed question numbers that show this pattern>],
      "root_cause": "<1-2 sentences on WHY this pattern likely occurred>",
      "fix": "<1-2 specific, actionable sentences on how to fix it>"
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
      "how_to_improve": "<concrete, 3-4 sentence actionable advice with specific resources>",
      "score": <integer 0-100>
    }}
  ],

  "red_flags": [
    "<Only include if candidate showed extreme arrogance, blame-shifting, or cultural toxicity. Empty array [] if none.>"
  ],

  "interview_tips": [
    "<actionable technique tip 1 — specific to their performance patterns>",
    "<tip 2>",
    "<tip 3>"
  ],
{hr_extra_schema}
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
  ]
}}

GRADING RULES:
- 90-100 = A+, 80-89 = A, 70-79 = B+, 60-69 = B, 50-59 = C+, 40-49 = C, <40 = D
- hire_recommendation: Strong Yes ≥85, Yes 70-84, Maybe 50-69, No <50
- Minimum: 2 strong_areas, 2 weak_areas, complete per_question_analysis for ALL questions
- failure_patterns: identify at least 1 if overall score <80, empty array only if near-perfect
- hire_signal MUST always be fully populated with all 5 sub-scores and rationale strings
{hr_grading_rules}"""


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
