"""
Admin router — report backfill triggers and status checks.

Endpoints:
  POST /api/v1/admin/backfill               — trigger a batch backfill run
  GET  /api/v1/admin/backfill/status        — count of all pending sessions
  GET  /api/v1/admin/backfill/status/:uid   — count for a specific user
  POST /api/v1/admin/backfill/user          — trigger backfill for the calling user (no secret needed)

Security:
  The trigger and global-status endpoints require an X-Admin-Secret header that
  must match the ADMIN_SECRET env var.  The per-user endpoint only needs a valid
  JWT so regular users can kick off their own backfill from the frontend.
"""

import os
import asyncio
import logging
from fastapi import APIRouter, Depends, BackgroundTasks, Header, HTTPException
from fastapi.responses import JSONResponse

from auth import get_current_user
from services.db_service import get_pending_report_count, get_sessions_pending_report
from services.backfill_service import run_backfill_batch, is_backfill_running

logger = logging.getLogger(__name__)
router = APIRouter()

_ADMIN_SECRET = os.getenv("ADMIN_SECRET", "")


def _require_admin(x_admin_secret: str = Header(default="")):
    if not _ADMIN_SECRET:
        raise HTTPException(status_code=503, detail="Admin secret not configured.")
    if x_admin_secret != _ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="Invalid admin secret.")


def _ok(data: dict) -> dict:
    return {"success": True, "data": data, "error": None}


def _err(msg: str, status: int = 400):
    return JSONResponse(status_code=status, content={"success": False, "data": None, "error": msg})


# ── POST /api/v1/admin/backfill ───────────────────────────────────────────────

@router.post("/backfill")
async def trigger_backfill(
    background_tasks: BackgroundTasks,
    limit: int = 10,
    delay: float = 3.0,
    _: None = Depends(_require_admin),
):
    """
    Start a background batch that generates cached reports for old sessions.
    Returns immediately; work happens in the background.
    """
    if is_backfill_running():
        return _ok({"status": "already_running", "message": "Backfill already in progress."})

    pending_count = get_pending_report_count()
    background_tasks.add_task(run_backfill_batch, user_id=None, limit=limit, delay_seconds=delay)

    return _ok({
        "status": "queued",
        "pending_sessions": pending_count,
        "batch_limit": limit,
        "message": f"Backfill started for up to {limit} sessions.",
    })


# ── GET /api/v1/admin/backfill/status ────────────────────────────────────────

@router.get("/backfill/status")
async def backfill_status(_: None = Depends(_require_admin)):
    """Global count of sessions still missing a cached report."""
    count = get_pending_report_count()
    return _ok({
        "pending_count": count,
        "is_running": is_backfill_running(),
    })


# ── GET /api/v1/admin/backfill/status/{user_id} ───────────────────────────────

@router.get("/backfill/status/{user_id}")
async def backfill_status_user(user_id: str, _: None = Depends(_require_admin)):
    """Count for a specific user (useful for debugging)."""
    count = get_pending_report_count(user_id=user_id)
    pending = get_sessions_pending_report(user_id=user_id, limit=100)
    return _ok({
        "user_id": user_id,
        "pending_count": count,
        "pending_session_ids": [r.get("session_id") or r.get("id") for r in pending],
        "is_running": is_backfill_running(),
    })


# ── POST /api/v1/admin/backfill/user ─────────────────────────────────────────

@router.post("/backfill/user")
async def trigger_user_backfill(
    background_tasks: BackgroundTasks,
    user: dict = Depends(get_current_user),
):
    """
    Trigger backfill scoped to the calling user's sessions only.
    Called from the frontend when the hub loads — no admin secret required.
    Safe to call repeatedly; the lock prevents duplicate runs.
    """
    user_id = user["user_id"]
    pending = get_sessions_pending_report(user_id=user_id, limit=50)
    pending_count = len(pending)

    if pending_count == 0:
        return _ok({"status": "nothing_to_do", "pending_count": 0})

    if is_backfill_running():
        return _ok({"status": "already_running", "pending_count": pending_count})

    background_tasks.add_task(
        run_backfill_batch,
        user_id=user_id,
        limit=50,
        delay_seconds=2.0,
    )
    return _ok({
        "status": "queued",
        "pending_count": pending_count,
        "message": f"Generating {pending_count} cached report(s) in the background.",
    })
