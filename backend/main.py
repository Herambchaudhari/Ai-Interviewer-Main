"""
AI Interviewer — FastAPI Backend
Main application entry point.
"""
import os
import asyncio
import logging
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env", override=True)

from routers import resume, interview, transcribe, report, reports, session, context_hub, portfolio, news, progress, share, admin, tts

logger = logging.getLogger(__name__)

app = FastAPI(
    title="AI Interviewer API",
    description="Backend API for the AI Interviewer platform",
    version="1.0.0",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        os.getenv("FRONTEND_URL", "http://localhost:5173"),
        "https://*.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── API v1 Routers ────────────────────────────────────────────────────────────
API_PREFIX = "/api/v1"

app.include_router(resume.router,     prefix=f"{API_PREFIX}/resume",     tags=["Resume"])
app.include_router(interview.router,  prefix=f"{API_PREFIX}/interview",  tags=["Interview"])
app.include_router(session.router,    prefix=f"{API_PREFIX}/session",    tags=["Session"])
app.include_router(transcribe.router, prefix=f"{API_PREFIX}/transcribe", tags=["Transcribe"])
app.include_router(report.router,     prefix=f"{API_PREFIX}/report",     tags=["Report"])
app.include_router(reports.router,    prefix=f"{API_PREFIX}/reports",    tags=["Reports"])
app.include_router(context_hub.router, prefix=f"{API_PREFIX}/context-hub", tags=["Context Hub"])
app.include_router(portfolio.router, prefix=f"{API_PREFIX}/portfolio", tags=["Portfolio"])
app.include_router(news.router,      prefix=f"{API_PREFIX}/news",      tags=["News"])
app.include_router(progress.router,  prefix=f"{API_PREFIX}/progress",  tags=["Progress"])
app.include_router(share.router,     prefix=f"{API_PREFIX}/share",     tags=["Share"])
app.include_router(admin.router,     prefix=f"{API_PREFIX}/admin",     tags=["Admin"])
app.include_router(tts.router,       prefix=f"{API_PREFIX}/tts",       tags=["TTS"])


# ── Startup: warm whisper model + backfill old sessions ───────────────────────
@app.on_event("startup")
async def _startup_tasks():
    """
    On every cold start:
    1. Pre-warm the faster-whisper model so the first transcription isn't slow.
    2. Kick off a small backfill batch (5 sessions) for old missing reports.
    """
    async def _warmup_whisper():
        try:
            import asyncio as _asyncio
            loop = _asyncio.get_running_loop()
            from services.whisper_service import get_model
            await loop.run_in_executor(None, get_model)
            logger.info("[startup] Whisper model pre-warmed.")
        except Exception as e:
            logger.warning("[startup] Whisper warmup failed: %s", e)

    async def _run_backfill():
        from services.backfill_service import run_backfill_batch
        try:
            result = await run_backfill_batch(limit=5, delay_seconds=3.0)
            logger.info("[startup] Backfill result: %s", result)
        except Exception as e:
            logger.warning("[startup] Backfill startup task failed: %s", e)

    # Fire-and-forget — don't block server startup
    asyncio.create_task(_warmup_whisper())
    asyncio.create_task(_run_backfill())


# ── Standard Response Helpers ─────────────────────────────────────────────────
def success_response(data=None, message: str = "Success") -> dict:
    return {"success": True, "data": data, "error": None, "message": message}


def error_response(error: str, data=None) -> dict:
    return {"success": False, "data": data, "error": error}


@app.get("/", tags=["Health"])
async def root():
    return success_response({"message": "AI Interviewer API is running 🚀"})


@app.get("/health", tags=["Health"])
async def health():
    return success_response({"status": "ok", "version": "1.0.0"})
