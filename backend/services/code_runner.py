"""
code_runner.py — Execute code via Piston API (free, no account required).
https://github.com/engineer-man/piston
Public instance: https://emkc.org/api/v2/piston
"""
import asyncio
import httpx

# Piston public API — no key required
_PISTON_URL = "https://emkc.org/api/v2/piston/execute"

# Maps our language names to Piston (language, version) pairs
_LANG_MAP = {
    "python":     ("python",     "3.10.0"),
    "javascript": ("javascript", "18.15.0"),
    "typescript": ("typescript", "5.0.3"),
    "java":       ("java",       "15.0.2"),
    "cpp":        ("c++",        "10.2.0"),
    "c++":        ("c++",        "10.2.0"),
    "c":          ("c",          "10.2.0"),
    "go":         ("go",         "1.16.2"),
    "rust":       ("rust",       "1.50.0"),
}


async def run_code(
    code: str,
    language: str,
    stdin: str = "",
    timeout_sec: float = 12.0,
) -> dict:
    """
    Execute code via the Piston API and return a cleaned result dict.

    Returns:
        {
          stdout, stderr, compile_output, status, time_ms, memory_kb,
          success (bool)
        }
    """
    lang_entry = _LANG_MAP.get(language.lower())
    if not lang_entry:
        return {
            "stdout": "", "stderr": f"Unsupported language: {language}",
            "compile_output": "", "status": "error",
            "time_ms": 0, "memory_kb": 0, "success": False,
        }

    lang_name, lang_version = lang_entry
    payload = {
        "language": lang_name,
        "version":  lang_version,
        "files":    [{"content": code}],
        "stdin":    stdin or "",
    }

    try:
        async with httpx.AsyncClient(timeout=timeout_sec) as client:
            resp = await client.post(_PISTON_URL, json=payload)
            resp.raise_for_status()
            data = resp.json()

        run    = data.get("run", {})
        stdout = (run.get("stdout") or "").strip()
        stderr = (run.get("stderr") or "").strip()
        code_  = run.get("code")           # exit code
        signal = run.get("signal") or ""   # e.g. SIGKILL on TLE

        compile_out = ""
        compile_block = data.get("compile", {})
        if compile_block:
            compile_out = (compile_block.get("stderr") or compile_block.get("stdout") or "").strip()

        success = (code_ == 0 and not signal)

        if signal == "SIGKILL":
            status = "time_limit_exceeded"
        elif compile_out and not success:
            status = "compilation_error"
        elif not success:
            status = "runtime_error"
        else:
            status = "accepted"

        return {
            "stdout":         stdout,
            "stderr":         stderr or compile_out,
            "compile_output": compile_out,
            "status":         status,
            "time_ms":        0,    # Piston free tier doesn't expose timing
            "memory_kb":      0,
            "success":        success,
        }

    except httpx.TimeoutException:
        return {
            "stdout": "", "stderr": "Code execution timed out.",
            "compile_output": "", "status": "time_limit_exceeded",
            "time_ms": 0, "memory_kb": 0, "success": False,
        }
    except Exception as e:
        return {
            "stdout": "", "stderr": f"Execution failed: {e}",
            "compile_output": "", "status": "error",
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
