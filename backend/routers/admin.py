"""
Admin Panel Router — protected by a hardcoded static token.
Provides read-only views of all students, sessions, and reports.
"""
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timezone
from services.db_service import _db, get_report as _get_report
# In-memory presence store: { user_id: datetime }
_presence: dict[str, datetime] = {}

router = APIRouter()

# ── Hardcoded admin credentials ───────────────────────────────────────────────
_ADMIN_EMAIL    = "admin@interviewdeck.com"
_ADMIN_PASSWORD = "AdminPanel@2025"
_ADMIN_TOKEN    = "aidmin-panel-static-token-xK9mPqR7"


def _verify_admin(x_admin_token: str = Header(None)):
    if x_admin_token != _ADMIN_TOKEN:
        raise HTTPException(status_code=403, detail="Unauthorized")


class AdminLoginRequest(BaseModel):
    email: str
    password: str

class UpdateNameRequest(BaseModel):
    name: str

class UpdateMetaRequest(BaseModel):
    name: Optional[str] = None
    year: Optional[str] = None
    branch: Optional[str] = None
    cgpa: Optional[float] = None
    target_companies: Optional[list] = None

class HeartbeatRequest(BaseModel):
    user_id: str


# ── Heartbeat — no auth needed, user_id comes from client ────────────────────
@router.post("/heartbeat")
async def heartbeat(body: HeartbeatRequest):
    if body.user_id:
        _presence[body.user_id] = datetime.now(timezone.utc)
    return {"ok": True}


# ── Presence (admin-only: which users were seen in last 60 s) ─────────────────
@router.get("/presence", dependencies=[Depends(_verify_admin)])
async def get_presence():
    now = datetime.now(timezone.utc)
    online = [uid for uid, ts in _presence.items() if (now - ts).total_seconds() <= 60]
    return {"online": online}


# ── Login ─────────────────────────────────────────────────────────────────────
@router.post("/login")
async def admin_login(body: AdminLoginRequest):
    if body.email == _ADMIN_EMAIL and body.password == _ADMIN_PASSWORD:
        return {"token": _ADMIN_TOKEN}
    raise HTTPException(status_code=403, detail="Invalid admin credentials")


# ── All registered users ──────────────────────────────────────────────────────
@router.get("/users", dependencies=[Depends(_verify_admin)])
async def get_all_users():
    """Returns all auth users (name, email, join date)."""
    client = _db()
    response = client.auth.admin.list_users()
    users = [
        {
            "id": u.id,
            "email": u.email,
            "name": (u.user_metadata or {}).get("name", ""),
            "year": (u.user_metadata or {}).get("year", ""),
            "branch": (u.user_metadata or {}).get("branch", ""),
            "cgpa": (u.user_metadata or {}).get("cgpa"),
            "target_companies": (u.user_metadata or {}).get("target_companies", []),
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "last_sign_in_at": u.last_sign_in_at.isoformat() if u.last_sign_in_at else None,
        }
        for u in response
    ]
    return {"users": users}


# ── All sessions with basic aggregation ───────────────────────────────────────
@router.get("/sessions", dependencies=[Depends(_verify_admin)])
async def get_all_sessions():
    """Returns all sessions grouped by user with aggregated stats."""
    client = _db()
    resp = (
        client.table("sessions")
        .select("id, user_id, round_type, difficulty, status, created_at, ended_at")
        .order("created_at", desc=True)
        .execute()
    )
    sessions = resp.data or []
    if sessions:
        session_ids = [s["id"] for s in sessions]
        reports_resp = (
            client.table("reports")
            .select("session_id")
            .in_("session_id", session_ids)
            .execute()
        )
        has_report_ids = {r["session_id"] for r in (reports_resp.data or [])}
        for s in sessions:
            s["has_report"] = s["id"] in has_report_ids
    return {"sessions": sessions}


# ── All profiles (resume parses) ──────────────────────────────────────────────
@router.get("/profiles", dependencies=[Depends(_verify_admin)])
async def get_all_profiles():
    """Returns all resume profiles."""
    client = _db()
    resp = (
        client.table("profiles")
        .select("id, user_id, created_at, parsed_data")
        .order("created_at", desc=True)
        .execute()
    )
    profiles = []
    for p in (resp.data or []):
        parsed = p.get("parsed_data") or {}
        profiles.append({
            "id": p["id"],
            "user_id": p["user_id"],
            "created_at": p["created_at"],
            "candidate_name": parsed.get("name", ""),
        })
    return {"profiles": profiles}


# ── Single student detail ─────────────────────────────────────────────────────
@router.get("/student/{user_id}", dependencies=[Depends(_verify_admin)])
async def get_student_detail(user_id: str):
    """Returns full data for one student: auth info + sessions + reports."""
    client = _db()

    # Auth user
    try:
        auth_user = client.auth.admin.get_user_by_id(user_id)
        meta = auth_user.user.user_metadata or {}
        user_info = {
            "id": auth_user.user.id,
            "email": auth_user.user.email,
            "name": meta.get("name", ""),
            "created_at": auth_user.user.created_at.isoformat() if auth_user.user.created_at else None,
        }
        # student_meta always pulled from user_metadata (saved by Settings page)
        auth_student_meta = {
            "name":             meta.get("name", ""),
            "year":             meta.get("year", ""),
            "branch":           meta.get("branch", ""),
            "cgpa":             meta.get("cgpa"),
            "target_sectors":   meta.get("target_sectors", []),
            "target_companies": meta.get("target_companies", []),
        }
    except Exception:
        user_info = {"id": user_id, "email": "", "name": "", "created_at": None}
        auth_student_meta = {}

    # Sessions
    sessions_resp = (
        client.table("sessions")
        .select("id, round_type, difficulty, status, created_at, ended_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )

    # Reports
    session_ids = [s["id"] for s in (sessions_resp.data or [])]
    reports = []
    if session_ids:
        reports_resp = (
            client.table("reports")
            .select("session_id, overall_score, grade, hire_recommendation, round_type, created_at")
            .in_("session_id", session_ids)
            .execute()
        )
        reports = reports_resp.data or []

    # Profile (resume) — include raw_text for the admin resume viewer
    profile_resp = (
        client.table("profiles")
        .select("id, created_at, parsed_data, raw_text")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    profile = None
    if profile_resp.data:
        p = profile_resp.data[0]
        parsed = p.get("parsed_data") or {}
        profile = {
            "id": p["id"],
            "created_at": p["created_at"],
            "raw_text": p.get("raw_text", ""),
            "parsed_data": parsed,
            "name": parsed.get("name", ""),
            "skills": parsed.get("skills", []),
            "education": parsed.get("education", []),
            "experience": parsed.get("experience", []),
        }

    return {
        "user": user_info,
        "sessions": sessions_resp.data or [],
        "reports": reports,
        "profile": profile,
        "student_meta": auth_student_meta,
    }


# ── Update student display name ──────────────────────────────────────────────
@router.patch("/user/{user_id}/name", dependencies=[Depends(_verify_admin)])
async def update_student_name(user_id: str, body: UpdateNameRequest):
    """Updates the user's display name in Supabase auth metadata (merges, never wipes other fields)."""
    client = _db()
    try:
        # Fetch existing metadata to merge — avoids wiping year/branch/cgpa/etc.
        auth_user = client.auth.admin.get_user_by_id(user_id)
        existing = dict(auth_user.user.user_metadata or {})
        existing["name"] = body.name.strip()
        existing["full_name"] = body.name.strip()
        client.auth.admin.update_user_by_id(
            user_id,
            {"user_metadata": existing}
        )
        return {"success": True, "name": body.name.strip()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update name: {str(e)}")


# ── Update all student profile meta fields ───────────────────────────────────
@router.patch("/user/{user_id}/meta", dependencies=[Depends(_verify_admin)])
async def update_student_meta(user_id: str, body: UpdateMetaRequest):
    """Updates any subset of user_metadata fields (merges with existing)."""
    client = _db()
    try:
        auth_user = client.auth.admin.get_user_by_id(user_id)
        existing = dict(auth_user.user.user_metadata or {})
        updates = body.model_dump(exclude_none=True)
        if "name" in updates:
            existing["full_name"] = updates["name"]
        existing.update(updates)
        client.auth.admin.update_user_by_id(user_id, {"user_metadata": existing})
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Full report for a session (admin bypass) ──────────────────────────────────
@router.get("/report/{session_id}", dependencies=[Depends(_verify_admin)])
async def get_session_report(session_id: str):
    """Returns full cached report data for a session, bypassing user RLS."""
    report = _get_report(session_id)
    if not report:
        raise HTTPException(status_code=404, detail="Report not found for this session.")
    return {"report": report}
