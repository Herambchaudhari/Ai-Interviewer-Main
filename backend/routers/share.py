"""
Share Router — public shareable report links.

Endpoints:
  POST /api/v1/share/{session_id}        — generate / refresh a share token (auth required)
  DELETE /api/v1/share/{session_id}      — revoke share link (auth required)
  GET  /api/v1/share/view/{token}        — public, NO auth required — fetch report by token
"""
import os
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse

from services.db_service import (
    generate_share_token,
    get_report_by_share_token,
    disable_share_token,
)
from routers.session import get_current_user   # reuse existing JWT dep

router = APIRouter()

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")


# ── Generate / refresh share token ────────────────────────────────────────────
@router.post("/{session_id}")
async def create_share_link(session_id: str, user_id: str = Depends(get_current_user)):
    result = generate_share_token(session_id)
    if not result:
        raise HTTPException(status_code=404, detail="Report not found for this session.")

    token     = result["share_token"]
    share_url = f"{FRONTEND_URL}/share/{token}"

    return {
        "success": True,
        "data": {
            "share_token": token,
            "share_url":   share_url,
        },
        "error": None,
    }


# ── Revoke share link ─────────────────────────────────────────────────────────
@router.delete("/{session_id}")
async def revoke_share_link(session_id: str, user_id: str = Depends(get_current_user)):
    ok = disable_share_token(session_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Could not revoke share link.")
    return {"success": True, "data": {"revoked": True}, "error": None}


# ── Public view — NO auth ─────────────────────────────────────────────────────
@router.get("/view/{token}")
async def get_shared_report(token: str):
    """
    Public endpoint — no JWT required.
    Returns the full report data identified by the share token.
    """
    report = get_report_by_share_token(token)
    if not report:
        raise HTTPException(
            status_code=404,
            detail="This share link is invalid, expired, or has been revoked.",
        )
    return {"success": True, "data": report, "error": None}
