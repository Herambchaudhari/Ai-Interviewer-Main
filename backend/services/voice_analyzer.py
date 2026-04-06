"""
voice_analyzer.py — Analyzes transcripts and Whisper segment data to produce
behavioral and delivery intelligence for the report.

Works in two modes:
  1. Segment-aware: uses Whisper word-level segments for pause detection,
     exact pace, and audio clip indexing.
  2. Transcript-only: falls back to heuristic analysis when no segments available.
"""
import re
from typing import Any, Optional

# Filler words to detect (ordered: longest first to avoid substring issues)
FILLER_WORDS = [
    "you know what i mean", "i mean", "kind of", "sort of",
    "basically", "literally", "honestly", "actually", "obviously",
    "right so", "so yeah", "i guess", "i think", "you know",
    "um", "uh", "ah", "hmm", "like",
]

# Heuristic weights for confidence score computation
_FILLER_PENALTY_PER_WORD = 3.0   # deduct per filler per 100 words of answer
_PACE_IDEAL_WPM = 140             # ideal speaking pace
_PACE_PENALTY_ABOVE = 0.08        # per wpm above ideal
_PAUSE_PENALTY = 4.0              # per detected long pause (> 2s)
_BASE_CONFIDENCE = 82             # starting confidence before penalties


def _count_fillers(text: str) -> tuple[int, list[str]]:
    """Return (total_count, list_of_found_filler_words) for the given text."""
    lower = text.lower()
    found = []
    for filler in FILLER_WORDS:
        pattern = r'\b' + re.escape(filler) + r'\b'
        matches = re.findall(pattern, lower)
        if matches:
            found.extend(matches)
    return len(found), found


def _estimate_wpm(text: str, duration_secs: Optional[float]) -> float:
    """Estimate words per minute from word count and duration."""
    words = len(text.split())
    if duration_secs and duration_secs > 0:
        return round(words / (duration_secs / 60), 1)
    # Fallback: assume ~130 wpm if no duration
    return 130.0


def _confidence_score(
    filler_count: int,
    word_count: int,
    wpm: float,
    long_pauses: int,
) -> int:
    """
    Heuristic confidence score (0-100).
    Penalizes: high filler density, too-fast pace, and long pauses.
    """
    score = _BASE_CONFIDENCE

    # Filler penalty: normalise per 100 words
    if word_count > 0:
        filler_density = (filler_count / word_count) * 100
        score -= filler_density * _FILLER_PENALTY_PER_WORD

    # Pace penalty for extremely fast speech
    if wpm > _PACE_IDEAL_WPM:
        score -= (wpm - _PACE_IDEAL_WPM) * _PACE_PENALTY_ABOVE

    # Pause penalty
    score -= long_pauses * _PAUSE_PENALTY

    return max(0, min(100, round(score)))


def _annotate_transcript(text: str) -> list[dict[str, Any]]:
    """
    Split transcript into sentences and tag each with:
      - confidence_tag: high / medium / low
      - filler_flag: True if sentence contains fillers
      - off_topic: heuristic — very short sentences after long ones signal drift
    """
    # Simple sentence split on . ! ?
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    annotated = []
    for sent in sentences:
        if not sent.strip():
            continue
        filler_count, _ = _count_fillers(sent)
        word_count = len(sent.split())
        filler_density = (filler_count / max(word_count, 1)) * 100

        if filler_density > 15:
            tag = "low"
        elif filler_density > 5:
            tag = "medium"
        else:
            tag = "high"

        annotated.append({
            "sentence":       sent.strip(),
            "confidence_tag": tag,
            "filler_flag":    filler_count > 0,
            "filler_count":   filler_count,
            "word_count":     word_count,
        })
    return annotated


def analyze_question_audio(
    question_id: str,
    answer_text: str,
    duration_secs: Optional[float] = None,
    segments: Optional[list] = None,   # Whisper segment dicts with start/end/text
    start_sec: Optional[float] = None, # global offset in full recording
) -> dict[str, Any]:
    """
    Analyze a single question-answer for voice intelligence.

    Args:
        question_id:  e.g. "Q3"
        answer_text:  raw transcript text for this answer
        duration_secs: how long the candidate spoke (seconds)
        segments:     Whisper segment list [{start, end, text}] for this answer window
        start_sec:    offset in the full recording where this answer begins

    Returns full per-question voice metrics dict.
    """
    filler_count, filler_words_found = _count_fillers(answer_text)
    word_count = len(answer_text.split())
    wpm = _estimate_wpm(answer_text, duration_secs)

    # Detect long pauses from Whisper segments
    long_pauses = []
    if segments and len(segments) > 1:
        for i in range(1, len(segments)):
            gap = segments[i]["start"] - segments[i - 1]["end"]
            if gap >= 2.0:
                abs_start = (start_sec or 0) + segments[i - 1]["end"]
                long_pauses.append({
                    "at_sec":      round(abs_start, 1),
                    "duration_sec": round(gap, 1),
                })

    # Find the moment with most fillers for "Review the Tape" highlight
    worst_moment_sec = None
    if segments:
        max_fillers = 0
        for seg in segments:
            fc, _ = _count_fillers(seg.get("text", ""))
            if fc > max_fillers:
                max_fillers = fc
                worst_moment_sec = round((start_sec or 0) + seg["start"], 1)
    elif start_sec is not None:
        worst_moment_sec = start_sec

    confidence = _confidence_score(filler_count, word_count, wpm, len(long_pauses))

    return {
        "question_id":          question_id,
        "confidence_score":     confidence,
        "filler_count":         filler_count,
        "filler_words":         list(set(filler_words_found))[:10],
        "worst_filler_moment_sec": worst_moment_sec,
        "pace_wpm":             wpm,
        "word_count":           word_count,
        "duration_secs":        duration_secs,
        "long_pauses":          long_pauses,
        "pause_count":          len(long_pauses),
    }


def compute_delivery_consistency(per_question_metrics: list[dict]) -> dict[str, Any]:
    """
    Compute the stamina/consistency arc across all questions.

    Args:
        per_question_metrics: list of dicts from analyze_question_audio()

    Returns delivery_consistency dict with arc_plot, verdict, peak/worst question.
    """
    if not per_question_metrics:
        return {}

    arc_plot = [m["confidence_score"] for m in per_question_metrics]
    n = len(arc_plot)

    # Compare first third vs last third
    third = max(1, n // 3)
    start_avg = round(sum(arc_plot[:third]) / third, 1)
    end_avg   = round(sum(arc_plot[-third:]) / third, 1)
    drop      = round(start_avg - end_avg, 1)
    overall_avg = round(sum(arc_plot) / n, 1)

    if drop >= 15:
        verdict = "Significant stamina drop"
    elif drop >= 8:
        verdict = "Moderate fatigue detected"
    elif drop <= -8:
        verdict = "Warmed up — improved as session progressed"
    else:
        verdict = "Consistent delivery throughout"

    peak_idx  = arc_plot.index(max(arc_plot))
    worst_idx = arc_plot.index(min(arc_plot))

    return {
        "arc_plot":       arc_plot,
        "start_avg":      start_avg,
        "end_avg":        end_avg,
        "drop":           drop,
        "overall_avg":    overall_avg,
        "verdict":        verdict,
        "peak_question":  per_question_metrics[peak_idx].get("question_id", f"Q{peak_idx + 1}"),
        "worst_question": per_question_metrics[worst_idx].get("question_id", f"Q{worst_idx + 1}"),
    }


def build_filler_heatmap(per_question_metrics: list[dict]) -> list[dict[str, Any]]:
    """Build the bar-chart data for the filler heatmap."""
    return [
        {
            "question_id":     m["question_id"],
            "filler_count":    m["filler_count"],
            "filler_words":    m["filler_words"],
            "worst_moment_sec": m.get("worst_filler_moment_sec"),
            "confidence_score": m["confidence_score"],
        }
        for m in per_question_metrics
    ]


def analyze_session_voice(
    transcript_entries: list[dict],
    duration_per_question: Optional[dict] = None,
) -> dict[str, Any]:
    """
    Top-level function: analyze all questions in a session.

    Args:
        transcript_entries: list of {question_id, answer, ...} from session transcript
        duration_per_question: optional {question_id: duration_secs} map

    Returns:
        {
          voice_metrics: [...],          # per-question metrics
          delivery_consistency: {...},   # stamina arc
          filler_heatmap: [...],         # bar chart data
          transcript_annotated: [...],   # sentence-level annotations for full session
        }
    """
    per_q_metrics = []
    full_text_parts = []

    for entry in transcript_entries:
        qid = entry.get("question_id", f"Q{len(per_q_metrics) + 1}")
        answer_text = entry.get("answer") or entry.get("answer_text") or ""
        if not answer_text or answer_text == "[No speech detected]":
            continue

        duration = None
        if duration_per_question:
            duration = duration_per_question.get(qid)

        metrics = analyze_question_audio(
            question_id=qid,
            answer_text=answer_text,
            duration_secs=duration,
        )
        per_q_metrics.append(metrics)
        full_text_parts.append(answer_text)

    if not per_q_metrics:
        return {}

    delivery = compute_delivery_consistency(per_q_metrics)
    heatmap  = build_filler_heatmap(per_q_metrics)

    # Annotated transcript for the full session
    full_text = " ".join(full_text_parts)
    annotated = _annotate_transcript(full_text)

    return {
        "voice_metrics":         per_q_metrics,
        "delivery_consistency":  delivery,
        "filler_heatmap":        heatmap,
        "transcript_annotated":  annotated,
    }
