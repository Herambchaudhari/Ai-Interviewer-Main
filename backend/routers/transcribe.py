"""
Transcription router — receives audio blobs and returns text via faster-whisper.
POST /api/v1/transcribe/
"""
import os
import tempfile
from fastapi import APIRouter, UploadFile, File, HTTPException
from services.whisper_service import transcribe_audio

router = APIRouter()


@router.post("/")
async def transcribe(audio: UploadFile = File(...)):
    """
    Accept an audio file (webm / wav / mp3) and return transcribed text.
    Uses faster-whisper running locally — no API key required.
    Returns: { success, data: { text, language, duration }, error }
    """
    contents = await audio.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty audio file.")

    suffix = os.path.splitext(audio.filename or "audio.webm")[1] or ".webm"

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(contents)
        tmp_path = tmp.name

    try:
        result = await transcribe_audio(tmp_path)   # { text, language, duration }
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

    text = (result.get("text") or "").strip()
    return {
        "success": True,
        "data": {
            "text":     text if text else "[No speech detected]",
            "language": result.get("language", "en"),
            "duration": result.get("duration", 0),
        },
        "error": None,
    }
