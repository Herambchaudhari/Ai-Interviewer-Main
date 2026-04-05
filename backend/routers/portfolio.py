"""
Portfolio router — manages portfolio files (grade cards, project reports, publications) and external links.
"""
import uuid
import mimetypes
from typing import Optional, List
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from auth import get_current_user
from services.db_service import (
    get_portfolio_files,
    add_portfolio_file,
    delete_portfolio_file,
    get_external_links,
    upsert_external_links,
    _db
)

router = APIRouter()

def _ok(data: dict, message: str = "Success") -> dict:
    return {"success": True, "data": data, "error": None, "message": message}

def _err(error: str, status: int = 400):
    return JSONResponse(
        status_code=status,
        content={"success": False, "data": None, "error": error},
    )

class ExternalLinksPayload(BaseModel):
    linkedin_url: Optional[str] = ""
    github_url: Optional[str] = ""
    portfolio_url: Optional[str] = ""
    other_links: Optional[list] = []

# ── Portfolio Files ──────────────────────────────────────────────────────────

@router.get("/files")
async def fetch_portfolio_files(user: dict = Depends(get_current_user)):
    files = get_portfolio_files(user["user_id"])
    return _ok(data=files)

@router.post("/upload")
async def upload_portfolio_file(
    file: UploadFile = File(...),
    title: str = Form(...),
    file_category: str = Form(...),
    semester_year: Optional[str] = Form(""),
    user: dict = Depends(get_current_user)
):
    valid_categories = ["grade_card", "project_report", "publication", "other"]
    if file_category not in valid_categories:
        return _err(f"Invalid category. Must be one of: {valid_categories}")

    # Read file content
    contents = await file.read()
    if not contents:
        return _err("Empty file received.")

    # Generate unique filename for storage
    content_type = file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream"
    ext = mimetypes.guess_extension(content_type) or ""
    if not ext and file.filename and "." in file.filename:
        ext = "." + file.filename.split(".")[-1]
    
    unique_filename = f"{user['user_id']}/{uuid.uuid4()}{ext}"

    bucket_name = "portfolio_files"
    db_client = _db()

    try:
        # Check if bucket exists, if not maybe Supabase auto-handles or it's created externally.
        # Uploading to Supabase Storage
        res = db_client.storage.from_(bucket_name).upload(
            path=unique_filename,
            file=contents,
            file_options={"content-type": content_type}
        )
        
        # Get public URL
        url_res = db_client.storage.from_(bucket_name).get_public_url(unique_filename)
        # Sometime supabase-py returns string directly
        public_url = url_res if isinstance(url_res, str) else url_res.get("publicURL", "")
        # fallback parsing of url_res if it doesn't give a string directly
        if not public_url:
            public_url = db_client.storage.from_(bucket_name).get_public_url(unique_filename)

    except Exception as e:
        # If storage upload fails, maybe bucket is missing or unconfigured. 
        # For now, fallback to returning an error
        return _err(f"Supabase Storage Upload Failed: {str(e)}", status=500)

    # Save to db
    payload = {
        "title": title,
        "file_category": file_category,
        "semester_year": semester_year,
        "file_url": public_url
    }
    
    try:
        file_id = add_portfolio_file(user["user_id"], payload)
    except Exception as e:
        return _err(f"Database Error: {str(e)}", status=500)

    payload["id"] = file_id
    payload["created_at"] = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
    return _ok(data=payload, message="File uploaded successfully")

@router.delete("/files/{file_id}")
async def remove_portfolio_file(file_id: str, user: dict = Depends(get_current_user)):
    # Verify file ownership
    files = get_portfolio_files(user["user_id"])
    target = next((f for f in files if f["id"] == file_id), None)
    if not target:
        return _err("File not found or access denied.", status=404)

    # Optional: Delete from storage bucket first
    try:
        if target.get("file_url"):
            # Extract path from URL (naive approach based on typical Supabase URL structure)
            file_url = target["file_url"]
            bucket_marker = "portfolio_files/"
            if bucket_marker in file_url:
                storage_path = file_url.split(bucket_marker)[-1]
                _db().storage.from_("portfolio_files").remove([storage_path])
    except Exception as e:
        print(f"Failed to delete from storage: {e}")

    # Delete from DB
    success = delete_portfolio_file(file_id, user["user_id"])
    if success:
        return _ok(data=None, message="File deleted successfully")
    return _err("Failed to delete file from DB.", status=500)

# ── External Links ───────────────────────────────────────────────────────────

@router.get("/links")
async def fetch_external_links(user: dict = Depends(get_current_user)):
    links = get_external_links(user["user_id"])
    # Return empty format if missing
    if not links:
        links = {
            "linkedin_url": "",
            "github_url": "",
            "portfolio_url": "",
            "other_links": []
        }
    return _ok(data=links)

@router.post("/links")
async def save_external_links(payload: ExternalLinksPayload, user: dict = Depends(get_current_user)):
    success = upsert_external_links(user["user_id"], payload.model_dump())
    if success:
        return _ok(data=payload.model_dump(), message="Links updated successfully")
    return _err("Failed to update external links", status=500)
