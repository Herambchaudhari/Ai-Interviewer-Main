"""
code_runner.py — Execute code via Judge0 public API (free tier).
No account required for the public endpoint; rate limits apply.
"""
import os
import asyncio
import httpx
import base64
from typing import Optional

# Judge0 CE public endpoint (no key required, rate limited)
_BASE_URL = "https://judge0-ce.p.rapidapi.com"
_RAPIDAPI_KEY = os.getenv("RAPIDAPI_KEY", "")   # Optional — set for higher limits

# Language IDs (Judge0 CE)
_LANG_IDS = {
    "python":     71,
    "javascript": 63,
    "java":       62,
    "cpp":        54,
    "c++":        54,
    "go":         60,
    "rust":       73,
    "typescript": 74,
}

_HEADERS_BASE = {
    "Content-Type":  "application/json",
    "Accept":        "application/json",
}


def _headers() -> dict:
    h = dict(_HEADERS_BASE)
    if _RAPIDAPI_KEY:
        h["X-RapidAPI-Key"]  = _RAPIDAPI_KEY
        h["X-RapidAPI-Host"] = "judge0-ce.p.rapidapi.com"
    return h


def _encode(s: str) -> str:
    return base64.b64encode(s.encode()).decode()


def _decode(s: Optional[str]) -> str:
    if not s:
        return ""
    try:
        return base64.b64decode(s).decode("utf-8", errors="replace")
    except Exception:
        return s


async def run_code(
    code: str,
    language: str,
    stdin: str = "",
    timeout_sec: float = 10.0,
) -> dict:
    """
    Submit code to Judge0, poll for result, and return cleaned output.

    Returns:
        {
          stdout, stderr, compile_output, status, time_ms, memory_kb,
          success (bool)
        }
    """
    lang_id = _LANG_IDS.get(language.lower())
    if not lang_id:
        return {
            "stdout": "", "stderr": f"Unsupported language: {language}",
            "compile_output": "", "status": "error",
            "time_ms": 0, "memory_kb": 0, "success": False,
        }

    payload = {
        "source_code":       _encode(code),
        "language_id":       lang_id,
        "stdin":             _encode(stdin) if stdin else "",
        "base64_encoded":    True,
        "wait":              False,
    }

    async with httpx.AsyncClient(timeout=timeout_sec) as client:
        # ── Submit ────────────────────────────────────────────────────────
        try:
            submit_res = await client.post(
                f"{_BASE_URL}/submissions",
                json=payload,
                headers=_headers(),
                params={"base64_encoded": "true"},
            )
            submit_res.raise_for_status()
            token = submit_res.json().get("token")
            if not token:
                raise ValueError("No token returned from Judge0")
        except Exception as e:
            return {
                "stdout": "", "stderr": f"Submission failed: {e}",
                "compile_output": "", "status": "error",
                "time_ms": 0, "memory_kb": 0, "success": False,
            }

        # ── Poll for result (max 8 seconds) ───────────────────────────────
        for _ in range(16):
            await asyncio.sleep(0.5)
            try:
                poll_res = await client.get(
                    f"{_BASE_URL}/submissions/{token}",
                    headers=_headers(),
                    params={"base64_encoded": "true"},
                )
                poll_res.raise_for_status()
                data = poll_res.json()
                status_id = data.get("status", {}).get("id", 0)

                if status_id in (1, 2):
                    continue   # In queue / processing

                stdout   = _decode(data.get("stdout"))
                stderr   = _decode(data.get("stderr"))
                compile_ = _decode(data.get("compile_output"))
                status   = data.get("status", {}).get("description", "Unknown")
                time_ms  = int(float(data.get("time") or 0) * 1000)
                memory   = data.get("memory") or 0

                return {
                    "stdout":         stdout,
                    "stderr":         stderr or compile_,
                    "compile_output": compile_,
                    "status":         status,
                    "time_ms":        time_ms,
                    "memory_kb":      memory,
                    "success":        status_id == 3,   # 3 = Accepted
                }
            except Exception as e:
                return {
                    "stdout": "", "stderr": f"Polling error: {e}",
                    "compile_output": "", "status": "error",
                    "time_ms": 0, "memory_kb": 0, "success": False,
                }

    return {
        "stdout": "", "stderr": "Timed out waiting for code execution result.",
        "compile_output": "", "status": "time_limit_exceeded",
        "time_ms": 0, "memory_kb": 0, "success": False,
    }
