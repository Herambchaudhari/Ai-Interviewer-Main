"""
routers/context_hub.py — Context Hub API

GET  /api/v1/context-hub/reports                     — spreadsheet of all reports
GET  /api/v1/context-hub/analytics                   — aggregated performance stats
GET  /api/v1/context-hub/topics-mastery              — topics + proficiency + AI recs
GET  /api/v1/context-hub/notes/{session_id}          — fetch note for a session
POST /api/v1/context-hub/notes/{session_id}          — create/update note
GET  /api/v1/context-hub/applications                — list company applications
POST /api/v1/context-hub/applications                — create application
PATCH /api/v1/context-hub/applications/{app_id}     — update application
DELETE /api/v1/context-hub/applications/{app_id}    — delete application
GET  /api/v1/context-hub/resumes                     — list resume versions
PATCH /api/v1/context-hub/resumes/{profile_id}/activate — set active resume
"""
from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, List

from auth import get_current_user
from services.db_service import (
    get_hub_reports,
    get_hub_reports_paginated,
    get_reports_summary,
    get_analytics,
    get_topics_mastery,
    get_session_note,
    upsert_session_note,
    get_applications,
    create_application,
    update_application,
    delete_application,
    get_resume_versions,
    activate_resume,
)

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────
def _ok(data, message: str = "Success") -> dict:
    return {"success": True, "data": data, "error": None, "message": message}


def _err(error: str, status: int = 400):
    return JSONResponse(
        status_code=status,
        content={"success": False, "data": None, "error": error},
    )


# ── Reports spreadsheet ───────────────────────────────────────────────────────
@router.get("/reports")
async def hub_reports(
    round_type:  Optional[str] = Query(None),
    difficulty:  Optional[str] = Query(None),
    sort_by:     str           = Query("date"),
    sort_order:  str           = Query("desc"),
    user: dict = Depends(get_current_user),
):
    try:
        reports = get_hub_reports(
            user["user_id"],
            round_type=round_type,
            difficulty=difficulty,
            sort_order=sort_order,
        )
        return _ok({"reports": reports, "total": len(reports)})
    except RuntimeError:
        return _ok({"reports": [], "total": 0})
    except Exception as e:
        return _err(str(e), status=500)


# ── Enhanced Reports Spreadsheet (paginated + filtered) ───────────────────────
@router.get("/reports/paginated")
async def hub_reports_paginated(
    round_type:  Optional[str]   = Query(None),
    difficulty:  Optional[str]   = Query(None),
    sort_by:     str             = Query("date"),
    sort_dir:    str             = Query("desc"),
    page:        int             = Query(1, ge=1),
    limit:       int             = Query(20, ge=1, le=100),
    date_from:   Optional[str]   = Query(None),
    date_to:     Optional[str]   = Query(None),
    min_score:   Optional[float] = Query(None),
    max_score:   Optional[float] = Query(None),
    user: dict = Depends(get_current_user),
):
    """
    Paginated, filtered, sorted report rows for the Context Hub spreadsheet.
    Includes all new fields: company_fit, delivery_consistency, skill_decay,
    repeated_offenders, six_axis_radar, swot_preview, etc.
    """
    try:
        result = get_hub_reports_paginated(
            user_id=user["user_id"],
            round_type=round_type,
            difficulty=difficulty,
            sort_by=sort_by,
            sort_dir=sort_dir,
            page=page,
            limit=limit,
            date_from=date_from,
            date_to=date_to,
            min_score=min_score,
            max_score=max_score,
        )
        return _ok(result)
    except RuntimeError:
        return _ok({"rows": [], "total": 0, "page": page, "limit": limit})
    except Exception as e:
        return _err(str(e), status=500)


# ── Reports Summary Banner ─────────────────────────────────────────────────────
@router.get("/reports/summary")
async def hub_reports_summary(user: dict = Depends(get_current_user)):
    """
    Aggregate banner-level stats: score trend, skill decay alerts,
    repeated offenders, growth trajectory. Used for the Context Hub header.
    """
    try:
        data = get_reports_summary(user["user_id"])
        return _ok(data)
    except RuntimeError:
        return _ok({
            "total_sessions": 0, "avg_score": 0, "best_score": 0,
            "most_recent_grade": None, "score_trend": [],
            "skill_decay_alerts": [], "repeated_offenders": [],
            "growth_trajectory": None,
        })
    except Exception as e:
        return _err(str(e), status=500)


# ── Analytics ─────────────────────────────────────────────────────────────────
@router.get("/analytics")
async def hub_analytics(user: dict = Depends(get_current_user)):
    try:
        data = get_analytics(user["user_id"])
        return _ok(data)
    except RuntimeError:
        return _ok({"total_interviews": 0, "average_score": 0,
                    "score_trend": [], "by_round_type": {}, "by_difficulty": {}})
    except Exception as e:
        return _err(str(e), status=500)


# ── Topics mastery ────────────────────────────────────────────────────────────
@router.get("/topics-mastery")
async def hub_topics(user: dict = Depends(get_current_user)):
    try:
        data = get_topics_mastery(user["user_id"])
        return _ok(data)
    except RuntimeError:
        return _ok({"topics": [], "ai_recommendations": []})
    except Exception as e:
        return _err(str(e), status=500)


# ── Session notes ─────────────────────────────────────────────────────────────
class NoteBody(BaseModel):
    content: str = ""
    tags: List[str] = []


@router.get("/notes/{session_id}")
async def get_note(session_id: str, user: dict = Depends(get_current_user)):
    try:
        note = get_session_note(session_id, user["user_id"])
        if not note:
            return _ok({"note_id": None, "content": "", "tags": []})
        return _ok({
            "note_id":    note["id"],
            "content":    note["content"],
            "tags":       note.get("tags") or [],
            "updated_at": note.get("updated_at"),
        })
    except RuntimeError:
        return _ok({"note_id": None, "content": "", "tags": []})
    except Exception as e:
        return _err(str(e), status=500)


@router.post("/notes/{session_id}")
async def save_note(
    session_id: str,
    body: NoteBody,
    user: dict = Depends(get_current_user),
):
    try:
        note_id = upsert_session_note(
            session_id, user["user_id"], body.content, body.tags
        )
        return _ok({"note_id": note_id})
    except RuntimeError:
        return _ok({"note_id": None})
    except Exception as e:
        return _err(str(e), status=500)


# ── Company applications ──────────────────────────────────────────────────────
class ApplicationBody(BaseModel):
    company_name:    str
    role:            str
    date_applied:    Optional[str] = None
    status:          str = "applied"
    outcome:         Optional[str] = None
    notes:           Optional[str] = ""
    linked_sessions: List[str] = []


class ApplicationUpdate(BaseModel):
    company_name:    Optional[str] = None
    role:            Optional[str] = None
    date_applied:    Optional[str] = None
    status:          Optional[str] = None
    outcome:         Optional[str] = None
    notes:           Optional[str] = None
    linked_sessions: Optional[List[str]] = None


@router.get("/applications")
async def list_applications(
    status: Optional[str] = Query(None),
    user: dict = Depends(get_current_user),
):
    try:
        apps = get_applications(user["user_id"], status=status)
        return _ok({"applications": apps})
    except RuntimeError:
        return _ok({"applications": []})
    except Exception as e:
        return _err(str(e), status=500)


@router.post("/applications")
async def add_application(
    body: ApplicationBody,
    user: dict = Depends(get_current_user),
):
    try:
        app_id = create_application(user["user_id"], body.dict())
        return _ok({"id": app_id})
    except RuntimeError:
        return _err("Database unavailable", status=503)
    except Exception as e:
        return _err(str(e), status=500)


@router.patch("/applications/{app_id}")
async def patch_application(
    app_id: str,
    body: ApplicationUpdate,
    user: dict = Depends(get_current_user),
):
    try:
        updates = {k: v for k, v in body.dict().items() if v is not None}
        ok = update_application(app_id, user["user_id"], updates)
        if not ok:
            return _err("Application not found or access denied.", status=404)
        return _ok({"id": app_id})
    except RuntimeError:
        return _err("Database unavailable", status=503)
    except Exception as e:
        return _err(str(e), status=500)


@router.delete("/applications/{app_id}")
async def remove_application(
    app_id: str,
    user: dict = Depends(get_current_user),
):
    try:
        ok = delete_application(app_id, user["user_id"])
        if not ok:
            return _err("Application not found or access denied.", status=404)
        return _ok({"id": app_id})
    except RuntimeError:
        return _err("Database unavailable", status=503)
    except Exception as e:
        return _err(str(e), status=500)


# ── Resume versions ───────────────────────────────────────────────────────────
@router.get("/resumes")
async def list_resumes(user: dict = Depends(get_current_user)):
    try:
        resumes = get_resume_versions(user["user_id"])
        return _ok({"resumes": resumes})
    except RuntimeError:
        return _ok({"resumes": []})
    except Exception as e:
        return _err(str(e), status=500)


@router.patch("/resumes/{profile_id}/activate")
async def activate_resume_endpoint(
    profile_id: str,
    user: dict = Depends(get_current_user),
):
    try:
        ok = activate_resume(profile_id, user["user_id"])
        if not ok:
            return _err("Profile not found or access denied.", status=404)
        return _ok({"profile_id": profile_id, "is_active": True})
    except RuntimeError:
        return _err("Database unavailable", status=503)
    except Exception as e:
        return _err(str(e), status=500)
