"""
code_runner.py — Execute code via the JDoodle Compiler API.

Endpoint:  https://api.jdoodle.com/v1/execute
Auth:      JDOODLE_CLIENT_ID + JDOODLE_CLIENT_SECRET (free tier = 20 credits/day)
Docs:      https://www.jdoodle.com/docs/compiler-apis/

JDoodle is simpler than Judge0 — no base64 encoding, no separate status table.
We map its (output, statusCode, cpuTime, memory) response onto the same dict
shape callers expect, so dsa_evaluator and the report pipeline stay unchanged.
"""
import os
import re
import asyncio
import httpx

_JDOODLE_URL = "https://api.jdoodle.com/v1/execute"

# JDoodle language + versionIndex pairs. versionIndex selects the toolchain
# version among JDoodle's published list — "0" is the oldest, higher = newer.
# Values below pick the latest stable version available on the Compiler API
# at the time of writing (Apr 2026); JDoodle accepts string indexes.
_JDOODLE_LANGS = {
    "python":     ("python3", "5"),    # Python 3.11.x
    "python3":    ("python3", "5"),
    "javascript": ("nodejs",  "5"),    # Node.js 18.x
    "node":       ("nodejs",  "5"),
    "java":       ("java",    "5"),    # OpenJDK 17
    "cpp":        ("cpp17",   "1"),    # GCC 11 + C++17
    "c++":        ("cpp17",   "1"),
    "c":          ("c",       "5"),    # GCC 11
    "go":         ("go",      "4"),    # Go 1.21
    "rust":       ("rust",    "4"),    # Rust 1.71
    "csharp":     ("csharp",  "4"),
    "kotlin":     ("kotlin",  "3"),
    "typescript": ("typescript", "4"),
}


def _classify_jdoodle_output(output: str, status_code: int) -> str:
    """
    JDoodle returns a single `output` blob containing stdout + stderr + tool
    diagnostics, plus a numeric `statusCode` (200 = code ran). We pattern-match
    on the blob to derive the status strings the rest of the codebase uses.

    Precedence (highest first): compile error → runtime error → TLE → accepted.
    Compile/runtime markers MUST win over a stray "accepted" string in the blob,
    since JDoodle leaks tool messages (e.g. "Compiled successfully" but then
    fatal include error) into stdout.
    """
    if status_code != 200:
        return "judge0_error"
    if not output:
        return "accepted"
    low = output.lower()

    # ── 1) Compile error — must check first, takes precedence over everything ──
    compile_markers = (
        "fatal error:",
        "compilation terminated",
        "compilation error",
        "no such file or directory",      # missing header in C/C++
        "cannot find symbol",             # Java
        "package does not exist",         # Java import miss
        "error: expected",
        "syntaxerror",                     # Python
        "indentationerror",                # Python
    )
    if any(m in low for m in compile_markers):
        return "compilation_error"
    # File:line:col:error pattern — gcc/clang/javac/rustc/go all emit this
    if re.search(r"^\s*\S+\.(c|cpp|cc|cxx|java|go|rs|kt):\d+:\d+:\s*(fatal\s+)?error",
                 output, re.M):
        return "compilation_error"

    # ── 2) Runtime error ──
    runtime_markers = (
        "traceback (most recent call last)",
        "exception in thread",
        "runtime error",
        "segmentation fault",
        "stack overflow",
        "abort()",
        "killed",
        "nzec",
    )
    if any(m in low for m in runtime_markers):
        return "runtime_error"
    if re.search(r"\bAt line \d+\b", output):
        return "runtime_error"

    # ── 3) TLE ──
    tle_markers = (
        "time limit", "timed out", "execution timed", "jdoodle - timeout",
    )
    if any(m in low for m in tle_markers):
        return "time_limit_exceeded"

    # ── 4) OOM ──
    if "out of memory" in low or "memoryerror" in low:
        return "runtime_error"

    return "accepted"


# ── Pre-flight validation ────────────────────────────────────────────────────
# JDoodle's free tier is 20 credits/day. Every API call burns a credit even when
# the submission is broken at the lexer level (stray bullet character, unclosed
# brace, missing class declaration). We catch those locally first so the user
# gets immediate feedback and we don't waste a daily credit on garbage input.

def _strip_strings_and_comments(code: str, language: str) -> str:
    """
    Best-effort stripper that replaces string literals and comments with spaces
    so subsequent regex/balance checks don't false-positive on legit content.
    Preserves line breaks so reported line numbers stay correct.
    """
    lang = language.lower()
    is_c_family = lang in ("javascript", "js", "node", "typescript", "ts",
                           "java", "cpp", "c++", "c", "go", "rust", "csharp",
                           "kotlin")
    is_python   = lang in ("python", "python3")

    out = []
    i, n = 0, len(code)
    while i < n:
        ch = code[i]
        nxt = code[i + 1] if i + 1 < n else ""

        # ── line comments ──
        if is_c_family and ch == "/" and nxt == "/":
            while i < n and code[i] != "\n":
                out.append(" ")
                i += 1
            continue
        if is_python and ch == "#":
            while i < n and code[i] != "\n":
                out.append(" ")
                i += 1
            continue

        # ── /* … */ block comments ──
        if is_c_family and ch == "/" and nxt == "*":
            out.append("  ")
            i += 2
            while i < n and not (code[i] == "*" and i + 1 < n and code[i + 1] == "/"):
                out.append(" " if code[i] != "\n" else "\n")
                i += 1
            i = min(n, i + 2)
            out.append("  ")
            continue

        # ── triple-quoted Python strings ──
        if is_python and ch in ("'", '"') and code[i:i + 3] in ("'''", '"""'):
            quote3 = code[i:i + 3]
            out.append("   ")
            i += 3
            while i < n and code[i:i + 3] != quote3:
                out.append(" " if code[i] != "\n" else "\n")
                i += 1
            i = min(n, i + 3)
            out.append("   ")
            continue

        # ── single/double-quoted strings ──
        if ch in ("'", '"'):
            quote = ch
            out.append(" ")
            i += 1
            while i < n and code[i] != quote:
                if code[i] == "\\" and i + 1 < n:
                    out.append("  ")
                    i += 2
                    continue
                if code[i] == "\n":          # unterminated string — bail
                    out.append("\n")
                    break
                out.append(" ")
                i += 1
            if i < n and code[i] == quote:
                out.append(" ")
                i += 1
            continue

        out.append(ch)
        i += 1
    return "".join(out)


def _find_suspicious_char(stripped: str) -> tuple[str, int] | None:
    """
    Look for non-ASCII characters in code outside strings/comments.
    These are almost always paste artefacts (Word/Notion bullets like ● • ▪,
    smart-quotes, NBSP) and the language tokenizer will reject them anyway.
    """
    line_no = 1
    for ch in stripped:
        if ch == "\n":
            line_no += 1
            continue
        if ord(ch) > 127:
            return ch, line_no
    return None


_BRACKET_PAIRS = {")": "(", "]": "[", "}": "{"}


def _check_balance(stripped: str) -> str | None:
    """Return an error message if (), [], {} are unbalanced. Strings & comments
    are already stripped, so quote/comment confusion doesn't apply here."""
    stack: list[tuple[str, int, int]] = []   # (char, line, col)
    line, col = 1, 1
    for ch in stripped:
        if ch == "\n":
            line += 1; col = 1; continue
        if ch in "([{":
            stack.append((ch, line, col))
        elif ch in ")]}":
            if not stack:
                return f"Unmatched '{ch}' on line {line}, col {col}."
            opener, _, _ = stack.pop()
            if opener != _BRACKET_PAIRS[ch]:
                return f"Mismatched bracket: '{opener}' opened, but '{ch}' closes on line {line}."
        col += 1
    if stack:
        opener, oln, ocol = stack[-1]
        return f"Unclosed '{opener}' opened on line {oln}, col {ocol}."
    return None


def precheck_code(code: str, language: str) -> tuple[bool, str]:
    """
    Cheap local validation BEFORE we call JDoodle and burn a daily credit.
    Returns (ok, error_message). If ok=False, the caller should short-circuit
    with a compilation_error result instead of calling the runner.
    """
    if not code or not code.strip():
        return False, "Empty submission — write a solution before running."

    if len(code) > 200_000:
        return False, "Submission is too large (>200 KB). Please trim it down."

    lang = language.lower()
    stripped = _strip_strings_and_comments(code, lang)

    # 1) Stray non-ASCII paste artefacts (e.g. ● U+25CF from rich-text editors)
    susp = _find_suspicious_char(stripped)
    if susp is not None:
        ch, line_no = susp
        return False, (
            f"Invalid character {ch!r} (U+{ord(ch):04X}) found on line {line_no}. "
            f"This looks like a paste artefact from a rich-text editor (e.g. a "
            f"bullet point or smart-quote). Delete it and re-submit."
        )

    # 2) Bracket / brace / paren balance — same check works for every C-family
    #    language plus Python (Python also uses {} for dicts/sets, [] for lists).
    bal_err = _check_balance(stripped)
    if bal_err:
        return False, bal_err

    # 3) Language-specific checks
    if lang in ("python", "python3"):
        try:
            compile(code, "<submission>", "exec")
        except SyntaxError as e:
            line = e.lineno if e.lineno is not None else "?"
            col  = e.offset if e.offset is not None else "?"
            msg  = (e.msg or "syntax error").strip()
            return False, f"Python {type(e).__name__} on line {line}, col {col}: {msg}"
        except Exception as e:
            return False, f"Python parse failed: {e}"

    elif lang == "java":
        if not re.search(r"\bclass\s+[A-Za-z_]\w*\b", code):
            return False, ("Java submissions must declare a class "
                           "(e.g. `class Solution { ... }`).")

    elif lang in ("cpp", "c++"):
        # A standalone solution file should at minimum reference some std
        # symbol or define a function; a totally empty translation unit will
        # always be flagged by the driver wrapper anyway, so we keep this loose.
        if "(" not in stripped:
            return False, "C++ submission has no function definitions or calls."

    elif lang == "c":
        if "(" not in stripped:
            return False, "C submission has no function definitions."

    elif lang in ("javascript", "js", "node", "typescript", "ts"):
        # Heuristic: must contain at least one of function/=>/class/var/let/const
        if not re.search(r"\b(function|class|let|var|const)\b|=>", code):
            return False, ("JavaScript/TypeScript submission has no recognisable "
                           "declaration (function / class / let / const / =>).")

    return True, ""


def _precheck_failure_result(message: str) -> dict:
    """Shape a precheck failure as a normal runner result so callers don't
    branch — same fields as a real JDoodle compile_error response."""
    return {
        "stdout": "",
        "stderr": message,
        "compile_output": message,
        "status": "compilation_error",
        "time_ms": 0,
        "memory_kb": 0,
        "success": False,
        "precheck": True,         # marker so callers can distinguish if useful
    }


async def run_code(
    code:        str,
    language:    str,
    stdin:       str = "",
    timeout_sec: float = 15.0,
    cpu_time_limit_sec: float = 5.0,   # accepted for API compat; JDoodle enforces its own
    memory_limit_kb:    int   = 256_000,  # accepted for API compat
    skip_precheck: bool = False,
) -> dict:
    """
    Submit `code` + stdin to JDoodle and synchronously wait for the result.

    Returns the same dict shape the previous Judge0/Piston runners did:
        { stdout, stderr, compile_output, status, time_ms, memory_kb, success }
    """
    # ── Local pre-flight (saves a JDoodle credit on broken input) ──
    if not skip_precheck:
        ok, msg = precheck_code(code, language)
        if not ok:
            return _precheck_failure_result(msg)

    client_id     = os.getenv("JDOODLE_CLIENT_ID",     "").strip()
    client_secret = os.getenv("JDOODLE_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        return {
            "stdout": "",
            "stderr": "JDoodle credentials missing — set JDOODLE_CLIENT_ID and JDOODLE_CLIENT_SECRET in backend/.env",
            "compile_output": "", "status": "config_error",
            "time_ms": 0, "memory_kb": 0, "success": False,
        }

    lang_pair = _JDOODLE_LANGS.get(language.lower())
    if not lang_pair:
        return {
            "stdout": "", "stderr": f"Unsupported language: {language}",
            "compile_output": "", "status": "error",
            "time_ms": 0, "memory_kb": 0, "success": False,
        }
    jd_lang, jd_version = lang_pair

    payload = {
        "clientId":     client_id,
        "clientSecret": client_secret,
        "script":       code,
        "stdin":        stdin or "",
        "language":     jd_lang,
        "versionIndex": jd_version,
        # `compileOnly` is omitted — we always want execution + stdout
    }

    try:
        async with httpx.AsyncClient(timeout=timeout_sec) as client:
            resp = await client.post(_JDOODLE_URL, json=payload)
            if resp.status_code >= 400:
                err_body = resp.text[:500]
                # 401 = bad creds, 429 = quota exceeded, 400 = bad request
                hint = ""
                if resp.status_code == 401:
                    hint = " (check JDOODLE_CLIENT_ID / JDOODLE_CLIENT_SECRET)"
                elif resp.status_code == 429:
                    hint = " (free tier daily credit limit hit — resets at 00:00 UTC)"
                return {
                    "stdout": "",
                    "stderr": f"JDoodle HTTP {resp.status_code}: {err_body}{hint}",
                    "compile_output": "", "status": "judge0_error",
                    "time_ms": 0, "memory_kb": 0, "success": False,
                }
            data = resp.json()

        # JDoodle response shape:
        #   { output: str, statusCode: int, memory: str, cpuTime: str }
        # `memory` is in KB as a string ("9248"); `cpuTime` in seconds as string ("0.04").
        output      = data.get("output") or ""
        status_code = int(data.get("statusCode") or 200)

        try:
            cpu_time_sec = float(data.get("cpuTime") or 0)
        except (TypeError, ValueError):
            cpu_time_sec = 0.0
        try:
            memory_kb = int(float(data.get("memory") or 0))
        except (TypeError, ValueError):
            memory_kb = 0

        status_str = _classify_jdoodle_output(output, status_code)
        success    = status_str == "accepted"

        # Split into stdout vs stderr for callers that care. JDoodle merges them,
        # so we put the full blob in stdout when the run succeeded, stderr otherwise.
        if success:
            stdout, stderr, compile_output = output, "", ""
        elif status_str == "compilation_error":
            stdout, stderr, compile_output = "", output, output
        else:
            stdout, stderr, compile_output = "", output, ""

        return {
            "stdout":         stdout.rstrip("\n"),
            "stderr":         stderr.rstrip("\n"),
            "compile_output": compile_output.rstrip("\n"),
            "status":         status_str,
            "time_ms":        int(cpu_time_sec * 1000),
            "memory_kb":      memory_kb,
            "success":        success,
        }

    except httpx.TimeoutException:
        return {
            "stdout": "", "stderr": "JDoodle request timed out.",
            "compile_output": "", "status": "time_limit_exceeded",
            "time_ms": 0, "memory_kb": 0, "success": False,
        }
    except Exception as e:
        return {
            "stdout": "", "stderr": f"Execution failed: {e}",
            "compile_output": "", "status": "error",
            "time_ms": 0, "memory_kb": 0, "success": False,
        }


# ── Multi-test helper used by the DSA router ─────────────────────────────────
async def run_against_tests(
    user_code:      str,
    language:       str,
    driver_code:    str,
    tests:          list,
    cpu_limit_sec:  float = 4.0,
    max_concurrency: int  = 3,
) -> list:
    """
    Inject `user_code` into the language's `driver_code` template, then run it
    against each test (parallel, capped concurrency to respect free-tier limits).

    Each test must look like {"input": <jsonable>, "expected": <jsonable>}.
    Returns a list of per-test result dicts:
        {
          index, passed, status, runtime_ms, memory_kb,
          stdout, expected, error?
        }
    """
    import json as _json

    if "__USER_CODE__" not in (driver_code or ""):
        # Driver missing for this language — surface a clear error per test
        return [{
            "index": i, "passed": False, "status": "config_error",
            "runtime_ms": 0, "memory_kb": 0,
            "stdout": "", "expected": _json.dumps(t.get("expected")),
            "error": f"No driver template available for language '{language}'.",
        } for i, t in enumerate(tests)]

    # ── Pre-flight: validate the user's code ONCE before fanning out to N tests.
    # On failure, return the same compile_error verdict for every test so the UI
    # rendering stays uniform — and we burn 0 JDoodle credits.
    ok, precheck_msg = precheck_code(user_code, language)
    if not ok:
        return [{
            "index": i, "passed": False, "status": "compilation_error",
            "runtime_ms": 0, "memory_kb": 0,
            "stdout": "", "expected": _json.dumps(t.get("expected")),
            "error": precheck_msg,
        } for i, t in enumerate(tests)]

    full_source = driver_code.replace("__USER_CODE__", user_code)
    sem = asyncio.Semaphore(max_concurrency)

    async def _run_one(idx: int, t: dict) -> dict:
        stdin_payload = _json.dumps(t.get("input"))
        expected_json = _json.dumps(t.get("expected"))
        async with sem:
            res = await run_code(
                code=full_source,
                language=language,
                stdin=stdin_payload,
                cpu_time_limit_sec=cpu_limit_sec,
                # User code already passed precheck above; the spliced driver
                # source contains language-specific helpers (J{} parser, etc.)
                # that may trip our heuristics, so skip the per-test re-check.
                skip_precheck=True,
            )
        # Compare as JSON (order-independent for objects, exact for arrays).
        got = (res.get("stdout") or "").strip()
        passed = False
        try:
            passed = _json.loads(got) == _json.loads(expected_json)
        except Exception:
            passed = got == expected_json.strip()
        return {
            "index":      idx,
            "passed":     bool(passed and res.get("success", False)),
            "status":     res.get("status", "unknown"),
            "runtime_ms": res.get("time_ms", 0),
            "memory_kb":  res.get("memory_kb", 0),
            "stdout":     got[:400],
            "expected":   expected_json[:400],
            "error":      (res.get("stderr") or "")[:400] or None,
        }

    return await asyncio.gather(*(_run_one(i, t) for i, t in enumerate(tests)))


# ── Code Quality Static Analysis (unchanged) ─────────────────────────────────

def _count_branches(code: str, language: str) -> int:
    keywords = ["if ", "elif ", "else:", "for ", "while ", "case ", "catch ", "except "]
    lower = code.lower()
    return sum(lower.count(kw) for kw in keywords)


def _score_variable_naming(code: str) -> int:
    import re
    identifiers = re.findall(r'\b([a-zA-Z_][a-zA-Z0-9_]*)\b', code)
    if not identifiers:
        return 50
    allowed_short = {"i", "j", "k", "n", "x", "y", "l", "r", "s", "t"}
    short = [v for v in identifiers if len(v) == 1 and v.lower() not in allowed_short]
    ratio = len(short) / max(len(identifiers), 1)
    return max(0, int(100 - ratio * 200))


def analyze_code_quality(code: str, language: str, execution_result: dict) -> dict:
    lines = [l for l in code.splitlines() if l.strip()]
    loc   = len(lines)
    comment_markers = {
        "python": "#", "javascript": "//", "typescript": "//",
        "java": "//", "cpp": "//", "c++": "//", "go": "//", "rust": "//",
    }
    marker = comment_markers.get(language.lower(), "#")
    has_comments = any(marker in line for line in lines)
    return {
        "lines_of_code":         loc,
        "cyclomatic_complexity": _count_branches(code, language),
        "has_comments":          has_comments,
        "variable_naming_score": _score_variable_naming(code),
        "execution_time_ms":     execution_result.get("time_ms", 0),
        "memory_kb":             execution_result.get("memory_kb", 0),
        "test_pass_rate":        1.0 if execution_result.get("success") else 0.0,
        "status":                execution_result.get("status", "Unknown"),
    }


def aggregate_code_quality(per_question_metrics: list) -> dict:
    if not per_question_metrics:
        return {}
    numeric_keys = [
        "lines_of_code", "cyclomatic_complexity", "variable_naming_score",
        "execution_time_ms", "memory_kb", "test_pass_rate",
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
