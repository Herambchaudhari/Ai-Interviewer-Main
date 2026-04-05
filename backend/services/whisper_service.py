"""
Whisper service — local STT using faster-whisper (no API key required).
"""
import asyncio
from typing import Dict, Any

_model = None
_model_size = "base"  # Options: tiny, base, small, medium, large-v3


def get_model():
    """Lazy-load faster-whisper model. Downloads on first use (~140MB for base)."""
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        _model = WhisperModel(_model_size, device="cpu", compute_type="int8")
    return _model


async def transcribe_audio(file_path: str) -> Dict[str, Any]:
    """
    Transcribe an audio file using faster-whisper locally.
    Returns: { text, language, duration, segments }

    segments is a list of dicts: [{start, end, text}] — used for
    pause detection, pace analysis, and "Review the Tape" timestamps.
    """
    loop = asyncio.get_event_loop()

    def _run():
        model = get_model()
        segments_iter, info = model.transcribe(file_path, beam_size=5)
        segments_list = []
        texts = []
        for seg in segments_iter:
            text = seg.text.strip()
            if text:
                texts.append(text)
                segments_list.append({
                    "start": round(seg.start, 2),
                    "end":   round(seg.end, 2),
                    "text":  text,
                })
        return {
            "text":     " ".join(texts),
            "language": info.language,
            "duration": info.duration,
            "segments": segments_list,
        }

    return await loop.run_in_executor(None, _run)
