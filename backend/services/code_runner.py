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


# ── Code Quality Static Analysis ──────────────────────────────────────────────

def _count_branches(code: str, language: str) -> int:
    """Count branching keywords as a rough cyclomatic complexity proxy."""
    keywords = ["if ", "elif ", "else:", "for ", "while ", "case ", "catch ", "except "]
    lower = code.lower()
    return sum(lower.count(kw) for kw in keywords)


def _score_variable_naming(code: str) -> int:
    """
    Heuristic variable naming score (0-100).
    Penalises single-char names (except i,j,k,n,x,y); rewards descriptive names.
    """
    import re
    identifiers = re.findall(r'\b([a-zA-Z_][a-zA-Z0-9_]*)\b', code)
    if not identifiers:
        return 50
    allowed_short = {"i", "j", "k", "n", "x", "y", "l", "r", "s", "t"}
    short = [v for v in identifiers if len(v) == 1 and v.lower() not in allowed_short]
    ratio = len(short) / max(len(identifiers), 1)
    return max(0, int(100 - ratio * 200))


def analyze_code_quality(
    code: str,
    language: str,
    execution_result: dict,
) -> dict:
    """
    Static analysis of submitted code.  No LLM call — pure heuristics.

    Returns:
        {
          lines_of_code, cyclomatic_complexity, has_comments,
          variable_naming_score, execution_time_ms, memory_kb,
          test_pass_rate, status
        }
    """
    lines = [l for l in code.splitlines() if l.strip()]
    loc   = len(lines)

    comment_markers = {
        "python": "#", "javascript": "//", "typescript": "//",
        "java": "//", "cpp": "//", "c++": "//", "go": "//", "rust": "//",
    }
    marker = comment_markers.get(language.lower(), "#")
    has_comments = any(marker in line for line in lines)

    complexity   = _count_branches(code, language)
    naming_score = _score_variable_naming(code)
    success      = execution_result.get("success", False)

    return {
        "lines_of_code":         loc,
        "cyclomatic_complexity": complexity,
        "has_comments":          has_comments,
        "variable_naming_score": naming_score,
        "execution_time_ms":     execution_result.get("time_ms", 0),
        "memory_kb":             execution_result.get("memory_kb", 0),
        "test_pass_rate":        1.0 if success else 0.0,
        "status":                execution_result.get("status", "Unknown"),
    }


def aggregate_code_quality(per_question_metrics: list) -> dict:
    """
    Average code quality metrics across all DSA questions.

    Returns a single dict with averaged numeric fields
    plus a list of per-question raw metrics.
    """
    if not per_question_metrics:
        return {}

    numeric_keys = [
        "lines_of_code", "cyclomatic_complexity",
        "variable_naming_score", "execution_time_ms",
        "memory_kb", "test_pass_rate",
    ]
    totals = {k: 0.0 for k in numeric_keys}
    count  = len(per_question_metrics)

    for m in per_question_metrics:
        for k in numeric_keys:
            totals[k] += m.get(k, 0)

    averages = {k: round(totals[k] / count, 2) for k in numeric_keys}
    averages["questions_analyzed"] = count
    averages["per_question"]       = per_question_metrics
    return averages
