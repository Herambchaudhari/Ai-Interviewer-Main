"""
Parser service — PDF text extraction + Groq-powered resume parsing.
"""
import json
import os
import re
from typing import Optional
import pdfplumber
from groq import Groq

_client = None


def _get_client() -> Groq:
    global _client
    if _client is None:
        _client = Groq(api_key=os.environ["GROQ_API_KEY"])
    return _client


# ── System prompt (exact as specified) ────────────────────────────────────────
_SYSTEM_PROMPT = (
    "You are a professional resume parser. Extract information from the resume text "
    "and return ONLY a valid JSON object with no extra text, no markdown, no code blocks. "
    "Return exactly this structure:\n"
    '{\n'
    '  "name": "full name",\n'
    '  "email": "email address",\n'
    '  "phone": "phone number",\n'
    '  "summary": "professional summary in 2-3 sentences",\n'
    '  "skills": ["skill1", "skill2"],\n'
    '  "technical_skills": { "languages": [], "frameworks": [], "tools": [], "databases": [] },\n'
    '  "experience": [ { "company": "", "role": "", "duration": "", "points": [] } ],\n'
    '  "education": [ { "degree": "", "institution": "", "year": "", "cgpa": "" } ],\n'
    '  "projects": [ { "name": "", "description": "", "tech_stack": [], "points": [] } ],\n'
    '  "certifications": [],\n'
    '  "total_experience_years": 0\n'
    '}\n'
    "If a field is missing, use null or empty array. Never fabricate information."
)

_STRICT_SYSTEM_PROMPT = (
    "You are a JSON extractor. The user will give you resume text. "
    "You MUST respond with ONLY a raw JSON object — absolutely no markdown, "
    "no ```json, no explanation, no preamble. Just the JSON object starting with { and ending with }."
)

_STRICT_USER_TEMPLATE = (
    "Extract resume data from the following text and return a JSON object with keys: "
    "name, email, phone, summary, skills (array), technical_skills (object with languages/frameworks/tools/databases), "
    "experience (array of objects with company/role/duration/points), "
    "education (array with degree/institution/year/cgpa), "
    "projects (array with name/description/tech_stack/points), "
    "certifications (array), total_experience_years (number).\n\n"
    "Resume:\n{raw_text}"
)


# ── Step 1: Extract raw text from PDF ────────────────────────────────────────
def extract_text_from_pdf(file_path: str) -> str:
    """
    Open the PDF at file_path with pdfplumber and concatenate all page text.
    Returns the full raw text string.
    Raises ValueError if the PDF is empty or unreadable.
    """
    pages_text = []
    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                pages_text.append(text.strip())

    if not pages_text:
        raise ValueError("Could not extract any text from the PDF. It may be scanned or image-based.")

    return "\n\n".join(pages_text)


# ── Step 2: Parse via Groq ─────────────────────────────────────────────────
def _safe_parse_json(content: str) -> Optional[dict]:
    """
    Attempt to parse raw JSON from Groq's response.
    Strips markdown code fences if present before parsing.
    """
    content = content.strip()
    # Strip ```json ... ``` or ``` ... ``` wrappers
    content = re.sub(r"^```(?:json)?\s*", "", content)
    content = re.sub(r"\s*```$", "", content)
    content = content.strip()
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        # Try to extract a JSON object using a brace-match heuristic
        match = re.search(r"\{.*\}", content, re.DOTALL)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                return None
        return None


def parse_resume_with_groq(raw_text: str) -> dict:
    """
    Send raw resume text to Groq (llama-3.3-70b-versatile) and parse the response
    into a structured dict. Retries once with a stricter prompt if JSON parsing fails.

    Raises RuntimeError if parsing fails after retry.
    """
    client = _get_client()

    def _call(system: str, user: str) -> str:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=0.1,       # very deterministic for parsing
            max_tokens=3000,
        )
        return response.choices[0].message.content

    # ── First attempt ──────────────────────────────────────────────────────
    user_msg = f"Parse the following resume:\n\n{raw_text[:6000]}"
    raw_response = _call(_SYSTEM_PROMPT, user_msg)
    parsed = _safe_parse_json(raw_response)

    if parsed is not None:
        return _normalise(parsed)

    # ── Retry with stricter prompt ─────────────────────────────────────────
    strict_user = _STRICT_USER_TEMPLATE.format(raw_text=raw_text[:5000])
    raw_response = _call(_STRICT_SYSTEM_PROMPT, strict_user)
    parsed = _safe_parse_json(raw_response)

    if parsed is not None:
        return _normalise(parsed)

    raise RuntimeError(
        "Groq returned a response that could not be parsed as JSON even after retry. "
        f"Raw response (first 300 chars): {raw_response[:300]}"
    )


def _normalise(data: dict) -> dict:
    """
    Ensure every expected key is present with a sensible default.
    This prevents KeyErrors downstream.
    """
    defaults = {
        "name": None,
        "email": None,
        "phone": None,
        "summary": None,
        "skills": [],
        "technical_skills": {"languages": [], "frameworks": [], "tools": [], "databases": []},
        "experience": [],
        "education": [],
        "projects": [],
        "certifications": [],
        "total_experience_years": 0,
    }
    for key, default in defaults.items():
        if key not in data or data[key] is None:
            data[key] = default
    # Ensure technical_skills sub-keys exist
    ts = data.get("technical_skills", {}) or {}
    for sub in ("languages", "frameworks", "tools", "databases"):
        ts.setdefault(sub, [])
    data["technical_skills"] = ts
    return data
