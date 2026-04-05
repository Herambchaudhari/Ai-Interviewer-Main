"""
AI Interviewer — FastAPI Backend
Main application entry point.
"""
import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

from routers import resume, interview, transcribe, report, reports, session, context_hub, portfolio, news

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
app.include_router(news.router, prefix=f"{API_PREFIX}/news", tags=["News"])
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
