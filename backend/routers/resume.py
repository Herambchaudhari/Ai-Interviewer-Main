"""
Resume router — upload, validate, parse, and store resume.
All responses follow: { "success": bool, "data": {}, "error": str|null }
"""
import os
import uuid
import tempfile
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, List

from auth import get_current_user
from services.parser import extract_text_from_pdf, parse_resume_with_groq
from services.db_service import save_profile, get_profile, init_supabase

router = APIRouter()

MAX_FILE_SIZE = 5 * 1024 * 1024  # 5 MB


def _ok(data: dict, message: str = "Success") -> dict:
    return {"success": True, "data": data, "error": None, "message": message}


def _err(error: str, status: int = 400):
    return JSONResponse(
        status_code=status,
        content={"success": False, "data": None, "error": error},
    )


# ── POST /api/v1/resume/upload ────────────────────────────────────────────────
@router.post("/upload")
async def upload_resume(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    """
    1. Validate file (PDF only, ≤ 5 MB)
    2. Save to /tmp/ with UUID filename
    3. Extract text with pdfplumber
    4. Parse with Groq → structured profile dict
    5. Store in Supabase 'profiles' table
    6. Clean up temp file
    7. Return { profile_id, parsed }
    """

    # ── Validation ────────────────────────────────────────────────────────
    filename = file.filename or ""
    if not filename.lower().endswith(".pdf"):
        return _err("Only PDF files are accepted. Please upload a .pdf file.")

    content_type = file.content_type or ""
    if content_type and content_type not in ("application/pdf", "application/octet-stream"):
        return _err(f"Invalid content type '{content_type}'. Expected application/pdf.")

    # Read the file into memory to check size before writing
    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        return _err(
            f"File is too large ({len(contents) / 1_048_576:.1f} MB). Maximum allowed size is 5 MB."
        )
    if len(contents) == 0:
        return _err("The uploaded file is empty.")

    # ── Save to /tmp/ ─────────────────────────────────────────────────────
    tmp_path = os.path.join(tempfile.gettempdir(), f"{uuid.uuid4()}.pdf")
    try:
        with open(tmp_path, "wb") as f:
            f.write(contents)

        # ── Extract text ──────────────────────────────────────────────────
        try:
            raw_text = extract_text_from_pdf(tmp_path)
        except ValueError as e:
            return _err(str(e))
        except Exception as e:
            return _err(f"Failed to read PDF: {str(e)}")

        # ── Parse with Groq ───────────────────────────────────────────────
        try:
            parsed = parse_resume_with_groq(raw_text)
        except RuntimeError as e:
            return _err(f"Resume parsing failed: {str(e)}")
        except Exception as e:
            return _err(f"Unexpected parsing error: {str(e)}", status=500)

        # ── Store in Supabase ─────────────────────────────────────────────
        try:
            profile_id = save_profile(
                user_id=user["user_id"],
                raw_text=raw_text,
                parsed_data=parsed,
            )
        except RuntimeError:
            # Supabase not configured — still return parsed data with a temp ID
            profile_id = str(uuid.uuid4())
        except Exception as e:
            return _err(f"Database error: {str(e)}", status=500)

    finally:
        # ── Cleanup temp file ─────────────────────────────────────────────
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

    return _ok(
        data={
            "profile_id": profile_id,
            "parsed": parsed,
        },
        message="Resume parsed successfully",
    )


# ── GET /api/v1/resume/{profile_id} ──────────────────────────────────────────
@router.get("/{profile_id}")
async def fetch_resume(
    profile_id: str,
    user: dict = Depends(get_current_user),
):
    """Retrieve a previously parsed profile by ID."""
    try:
        profile = get_profile(profile_id)
    except RuntimeError:
        return _err("Database not configured.", status=503)
    except Exception as e:
        return _err(str(e), status=500)

    if not profile:
        return _err("Profile not found.", status=404)

    # Ensure the requesting user owns this profile
    if profile.get("user_id") != user["user_id"]:
        return _err("Access denied.", status=403)

    return _ok(data={"profile_id": profile_id, "parsed": profile.get("parsed_data", {})})


# ── GET /api/v1/resume/profile/:profile_id ────────────────────────────────────
@router.get("/profile/{profile_id}")
async def fetch_profile(
    profile_id: str,
    user: dict = Depends(get_current_user),
):
    """
    Fetch a parsed profile by ID.
    Used by Dashboard to display the candidate's stored profile.
    """
    try:
        profile = get_profile(profile_id)
    except RuntimeError:
        # DB not configured — try localStorage fallback via client
        return _err("Database not configured. Use locally cached profile.", status=503)
    except Exception as e:
        return _err(str(e), status=500)

    if not profile:
        return _err("Profile not found.", status=404)
    if profile.get("user_id") != user["user_id"]:
        return _err("Access denied.", status=403)

    return _ok(data={
        "profile_id": profile_id,
        "parsed":     profile.get("parsed_data", {}),
        "created_at": profile.get("created_at"),
    })


# ── PATCH /api/v1/resume/profile/:profile_id ─────────────────────────────────
class StudentMeta(BaseModel):
    name:             Optional[str]       = None
    year:             Optional[str]       = None   # "1st" | "2nd" | "3rd" | "4th"
    branch:           Optional[str]       = None
    cgpa:             Optional[float]     = None
    target_sectors:   Optional[List[str]] = None
    target_companies: Optional[List[str]] = None


class ProfileUpdateRequest(BaseModel):
    student_meta: StudentMeta


@router.patch("/profile/{profile_id}")
async def update_profile(
    profile_id: str,
    body: ProfileUpdateRequest,
    user: dict = Depends(get_current_user),
):
    """
    Merge student_meta (year, branch, CGPA, target companies) into the profile's
    parsed_data JSONB column so it's available server-side during question generation.
    """
    try:
        db = init_supabase()

        # Fetch current parsed_data first
        profile = get_profile(profile_id)
        if not profile:
            return _err("Profile not found.", status=404)
        if profile.get("user_id") != user["user_id"]:
            return _err("Access denied.", status=403)

        current_parsed = profile.get("parsed_data") or {}

        # Merge student_meta fields into parsed_data
        meta = body.student_meta.model_dump(exclude_none=True)
        updated_parsed = {**current_parsed, **meta}

        db.table("profiles").update({
            "parsed_data": updated_parsed
        }).eq("id", profile_id).execute()

    except RuntimeError:
        # DB not configured — silently succeed (localStorage is source of truth)
        return _ok(data={"profile_id": profile_id, "status": "local_only"})
    except Exception as e:
        return _err(str(e), status=500)

    return _ok(
        data={"profile_id": profile_id, "parsed": updated_parsed},
        message="Profile updated successfully",
    )


# ── GET /api/v1/reports/user/:user_id ────────────────────────────────────────
# NOTE: mounted on the resume router for simplicity; prefix = /api/v1/resume
# Full path: GET /api/v1/resume/reports/user/{user_id}
@router.get("/reports/user/{user_id}")
async def get_user_reports(
    user_id: str,
    user: dict = Depends(get_current_user),
):
    """
    Return past sessions + reports for a given user.
    Validates that the requesting user matches the path param.
    """
    if user["user_id"] != user_id:
        return _err("Access denied.", status=403)

    try:
        db = init_supabase()
        # Fetch sessions for this user, ordered by most recent
        sessions_res = (
            db.table("sessions")
            .select("id, round_type, difficulty, num_questions, status, created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(20)
            .execute()
        )
        sessions = sessions_res.data or []

        # For each completed session, attach its overall_score from reports table
        if sessions:
            session_ids = [s["id"] for s in sessions]
            reports_res = (
                db.table("reports")
                .select("session_id, overall_score")
                .in_("session_id", session_ids)
                .execute()
            )
            score_map = {r["session_id"]: r["overall_score"] for r in (reports_res.data or [])}
            for s in sessions:
                s["overall_score"] = score_map.get(s["id"])

    except RuntimeError:
        return _err("Database not configured.", status=503)
    except Exception as e:
        return _err(str(e), status=500)

    return _ok(data={"reports": sessions, "total": len(sessions)})
