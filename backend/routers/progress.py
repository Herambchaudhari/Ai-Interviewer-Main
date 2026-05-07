"""
Progress router — per-user skill progression analytics.

GET /api/v1/progress/{user_id}   → full progress dashboard data
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from auth import get_current_user
from services.db_service import get_past_reports_for_analysis
from services.progress_service import compute_all_progress

router = APIRouter()


def _ok(data, message: str = "Success") -> dict:
    return {"success": True, "data": data, "error": None, "message": message}


def _err(error: str, status: int = 400):
    return JSONResponse(
        status_code=status,
        content={"success": False, "data": None, "error": error},
    )


@router.get("/{user_id}")
async def get_progress(
    user_id: str,
    limit: int = 20,
    round_type: str | None = None,
    current_user=Depends(get_current_user),
):
    """
    Return skill progression analytics for a user.

    Query params:
      limit      — number of past sessions to analyze (default 20, max 50)
      round_type — optional filter: technical | hr | dsa | mcq_practice
    """
    # Security: users can only fetch their own progress
    if current_user["user_id"] != user_id:
        return _err("Forbidden", 403)

    limit = min(max(limit, 1), 50)

    # Fetch past reports (exclude_session_id="" so all are included)
    past_reports = get_past_reports_for_analysis(
        user_id=current_user["user_id"],
        exclude_session_id="",
        limit=limit,
    )

    # Optional round_type filter
    if round_type:
        past_reports = [r for r in past_reports if r.get("round_type") == round_type]

    if not past_reports:
        return _ok({
            "skill_velocity":      [],
            "progress_timeline":   [],
            "round_timeline":      {},
            "before_after_radar":  None,
            "readiness_projection":None,
            "achievements":        [],
            "persistent_gaps":     [],
            "strongest_skills":    [],
            "session_count":       0,
        }, message="No completed sessions found.")

    progress = compute_all_progress(past_reports)
    return _ok(progress)
