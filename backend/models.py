"""
Pydantic request/response models for the AI Interviewer API.
"""
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from enum import Enum


# ── Scoring Context (Phase 4) ─────────────────────────────────────────────────
class ScoringMeta(BaseModel):
    """Audio and delivery signals forwarded from frontend after transcription."""
    word_count: Optional[int] = None
    duration_secs: Optional[float] = None
    time_limit_secs: Optional[int] = None
    time_used_ratio: Optional[float] = None
    filler_words: Optional[List[str]] = []
    silence_gaps_detected: Optional[bool] = False
    words_per_minute: Optional[float] = None
    question_difficulty: Optional[str] = None
    round_type: Optional[str] = None
    is_follow_up: Optional[bool] = False
    candidate_year: Optional[str] = None


# ── Context Bundle (Phase 1) ──────────────────────────────────────────────────
class ContextBundle(BaseModel):
    """Full assembled candidate intelligence used for adaptive question generation."""
    # Resume / profile
    name: Optional[str] = None
    skills: List[str] = []
    experience: List[Dict[str, Any]] = []
    projects: List[Dict[str, Any]] = []
    education: List[Dict[str, Any]] = []
    # Onboarding
    year: Optional[str] = None
    branch: Optional[str] = None
    cgpa: Optional[float] = None
    target_companies: List[str] = []
    target_sectors: List[str] = []
    # External links (scraped summaries)
    github_url: Optional[str] = None
    linkedin_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    research_context: Optional[Dict[str, str]] = {}
    # Portfolio files
    portfolio_files: List[Dict[str, Any]] = []
    # Past session performance
    known_weak_areas: List[str] = []
    known_strong_areas: List[str] = []
    past_reports_summary: List[Dict[str, Any]] = []
    # Session config
    target_company: Optional[str] = None
    job_role: Optional[str] = None
    round_type: Optional[str] = None
    difficulty: Optional[str] = None
    company_news_context: Optional[str] = None
    is_full_loop: Optional[bool] = False


class RoundType(str, Enum):
    technical = "technical"
    hr = "hr"
    dsa = "dsa"
    mcq_practice = "mcq_practice"


class Difficulty(str, Enum):
    easy = "easy"
    medium = "medium"
    hard = "hard"


# ── Resume ────────────────────────────────────────────────────────────────────
class ParsedResume(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    skills: List[str] = []
    experience: List[Dict[str, Any]] = []
    projects: List[Dict[str, Any]] = []
    education: List[Dict[str, Any]] = []
    raw_text: Optional[str] = None


class ResumeUploadResponse(BaseModel):
    resume_id: str
    parsed: ParsedResume


# ── Interview Session ─────────────────────────────────────────────────────────
class SessionCreate(BaseModel):
    resume_id: str
    round_type: RoundType
    difficulty: Difficulty
    num_questions: int = Field(default=5, ge=1, le=15)
    timer_minutes: int = Field(default=30, ge=5, le=120)


class SessionResponse(BaseModel):
    session_id: str
    round_type: RoundType
    difficulty: Difficulty
    num_questions: int
    timer_minutes: int
    questions: List[Dict[str, Any]]


class AnswerSubmit(BaseModel):
    session_id: str
    question_id: str
    answer_text: str
    time_taken_seconds: Optional[int] = None


class AnswerEvaluation(BaseModel):
    question_id: str
    score: int = Field(ge=1, le=10)
    feedback: str
    strengths: List[str] = []
    improvements: List[str] = []


# ── Transcription ─────────────────────────────────────────────────────────────
class TranscriptionResponse(BaseModel):
    text: str
    language: Optional[str] = None
    duration: Optional[float] = None


# ── Report ────────────────────────────────────────────────────────────────────
class SkillRating(BaseModel):
    skill: str
    score: float


class QuestionScore(BaseModel):
    question_id: str
    question_text: str
    answer_text: str
    score: int
    feedback: str


class ReportResponse(BaseModel):
    session_id: str
    overall_score: float
    round_type: str
    skill_ratings: List[SkillRating]
    question_scores: List[QuestionScore]
    strong_areas: List[Any]
    weak_areas: List[Any]
    recommendations: List[str]
    summary: str

    # Core analysis
    grade: Optional[str] = None
    hire_recommendation: Optional[str] = None
    compared_to_level: Optional[str] = None
    difficulty: Optional[str] = None
    radar_scores: Optional[Dict[str, Any]] = None
    category_breakdown: Optional[List[Dict[str, Any]]] = None
    hire_signal: Optional[Dict[str, Any]] = None
    failure_patterns: Optional[List[str]] = None
    red_flags: Optional[List[str]] = None
    per_question_analysis: Optional[List[Dict[str, Any]]] = None
    study_recommendations: Optional[List[Dict[str, Any]]] = None
    interview_tips: Optional[List[str]] = None
    market_intelligence: Optional[Dict[str, Any]] = None
    cv_audit: Optional[Dict[str, Any]] = None
    study_roadmap: Optional[Dict[str, Any]] = None
    mock_ready_topics: Optional[List[str]] = None
    not_ready_topics: Optional[List[str]] = None
    target_company: Optional[str] = None
    candidate_name: Optional[str] = None
    timer_mins: Optional[int] = None
    num_questions: Optional[int] = None

    # Voice & Behavioral Intelligence
    voice_metrics: Optional[List[Dict[str, Any]]] = None       # per-question voice data
    delivery_consistency: Optional[Dict[str, Any]] = None       # stamina arc analysis
    filler_heatmap: Optional[List[Dict[str, Any]]] = None       # per-question filler counts
    transcript_annotated: Optional[List[Dict[str, Any]]] = None # sentence-level annotations
    audio_clips_index: Optional[Dict[str, Any]] = None          # question_id → {start_sec, end_sec}

    # Communication & Structure (6-Axis)
    communication_breakdown: Optional[Dict[str, Any]] = None    # 6 sub-scores
    six_axis_radar: Optional[Dict[str, Any]] = None             # radar data for 6-axis chart
    bs_flag: Optional[List[Dict[str, Any]]] = None              # rambling-to-dodge detections

    # Root Cause Analysis
    pattern_groups: Optional[List[Dict[str, Any]]] = None       # grouped failure patterns
    blind_spots: Optional[List[Dict[str, Any]]] = None          # unknown unknowns

    # Company Fit Calibration
    company_fit: Optional[Dict[str, Any]] = None                # pass_probability, culture_gaps, etc.

    # Cross-Session Intelligence
    skill_decay: Optional[List[Dict[str, Any]]] = None          # skills that dropped since last session
    repeated_offenders: Optional[List[Dict[str, Any]]] = None   # issues recurring across sessions
    growth_trajectory: Optional[Dict[str, Any]] = None          # score trend + predictions
    improvement_vs_last: Optional[Dict[str, Any]] = None        # delta vs previous same round_type

    # Playbook & Resources
    swot: Optional[Dict[str, Any]] = None                       # strengths/weaknesses/opportunities/threats
    what_went_wrong: Optional[str] = None                       # plain-English failure summary
    skills_to_work_on: Optional[List[Dict[str, Any]]] = None    # priority-ranked skill gaps
    thirty_day_plan: Optional[Dict[str, Any]] = None            # week-by-week sprint plan
    auto_resources: Optional[List[Dict[str, Any]]] = None       # curated links per weak topic
    follow_up_questions: Optional[List[Dict[str, Any]]] = None  # likely interviewer follow-ups
    next_interview_blueprint: Optional[Dict[str, Any]] = None   # recommended next session config

    # Meta
    confidence_score: Optional[int] = None                      # LLM self-rating of report quality
    interview_agent: Optional[str] = None                       # human-readable round type label
