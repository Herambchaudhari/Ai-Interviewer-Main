"""
stt.py — Speech-to-text using locally installed faster-whisper.
No API key required. Model downloaded once on first use.

Also runs voice analysis on the transcript to produce per-answer
behavioral metrics (filler words, pace, confidence, delivery consistency).
"""
import os
from typing import Any, Dict, Optional

from services.whisper_service import transcribe_audio as _transcribe, get_model  # noqa: F401
from services.voice_analyzer import analyze_question_audio


async def transcribe_audio(file_path: str) -> str:
    """
    Transcribe an audio file using faster-whisper (local, free).

    Args:
        file_path: Absolute path to the saved audio file (.webm / .wav / .mp3)

    Returns:
        Transcript string, or "[No speech detected]" if empty.

    Raises:
        RuntimeError on model / IO errors.
    """
    if not os.path.exists(file_path):
        raise RuntimeError(f"Audio file not found: {file_path}")

    try:
        result = await _transcribe(file_path)
        text = (result.get("text") or "").strip()
        return text if text else "[No speech detected]"
    except FileNotFoundError:
        raise RuntimeError("Audio file disappeared before transcription could begin.")
    except Exception as e:
        raise RuntimeError(f"faster-whisper transcription failed: {e}") from e


async def transcribe_with_voice_analysis(
    file_path: str,
    question_id: str = "Q1",
    start_sec: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Transcribe audio AND run voice analysis in one call.
    Used by the interview router when processing each answer.

    Returns:
        {
            text:            str,
            language:        str,
            duration:        float,
            segments:        [{start, end, text}],
            voice_metrics:   {confidence_score, filler_count, filler_words,
                              pace_wpm, long_pauses, worst_filler_moment_sec, ...}
        }
    """
    if not os.path.exists(file_path):
        raise RuntimeError(f"Audio file not found: {file_path}")

    try:
        result = await _transcribe(file_path)
        text     = (result.get("text") or "").strip()
        segments = result.get("segments") or []
        duration = result.get("duration")

        if not text:
            return {
                "text": "[No speech detected]",
                "language": result.get("language"),
                "duration": duration,
                "segments": [],
                "voice_metrics": None,
            }

        voice_metrics = analyze_question_audio(
            question_id=question_id,
            answer_text=text,
            duration_secs=duration,
            segments=segments,
            start_sec=start_sec,
        )

        return {
            "text":          text,
            "language":      result.get("language"),
            "duration":      duration,
            "segments":      segments,
            "voice_metrics": voice_metrics,
        }
    except Exception as e:
        raise RuntimeError(f"faster-whisper transcription failed: {e}") from e
