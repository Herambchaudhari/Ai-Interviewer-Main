"""
routers/tts.py — ElevenLabs TTS proxy endpoint.

Keeps the API key server-side and avoids browser CORS restrictions.
POST /api/v1/tts  →  streams mp3 audio back to the client.
"""
import os
import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter()

# Matilda — knowledgeable, professional American female voice (available on free tier)
_VOICE_ID = "XrExE9yKIg1WjnnlVkGX"
_MODEL    = "eleven_flash_v2_5"
_EL_URL   = f"https://api.elevenlabs.io/v1/text-to-speech/{_VOICE_ID}/stream"


class TTSRequest(BaseModel):
    text: str


@router.post("/")
async def synthesize(body: TTSRequest):
    """
    Proxy a TTS request to ElevenLabs and stream the mp3 back.
    The API key never leaves the server.
    """
    api_key = os.getenv("ELEVEN_LABS_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="TTS service not configured.")

    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required.")

    payload = {
        "text":       text,
        "model_id":   _MODEL,
        "voice_settings": {
            "stability":         0.5,
            "similarity_boost":  0.75,
            "style":             0,
            "use_speaker_boost": False,
        },
    }

    params = {"output_format": "mp3_44100_128", "optimize_streaming_latency": "3"}

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                _EL_URL,
                json=payload,
                params=params,
                headers={
                    "xi-api-key":   api_key,
                    "Content-Type": "application/json",
                },
            )

        if response.status_code != 200:
            raise HTTPException(
                status_code=502,
                detail=f"ElevenLabs error {response.status_code}: {response.text[:200]}",
            )

        return StreamingResponse(
            iter([response.content]),
            media_type="audio/mpeg",
            headers={"Cache-Control": "no-store"},
        )

    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="ElevenLabs request timed out.")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"ElevenLabs unreachable: {e}")
