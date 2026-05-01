"""
dsa_evaluator.py — LLM-driven evaluation of a DSA submission.

Inputs:  user code + language + problem metadata + per-test results
Output:  structured verdict with TC/SC, code-quality score, hints, edge cases.

Used by routers/dsa.py on every /submit call. Cheap (~1 Groq call, <1s).
"""
import json
import re
from typing import Optional

from services.groq_service import _achat


_SYSTEM = """You are a senior software engineer grading a candidate's coding interview submission.
Be terse, fair, and specific. Output valid JSON only — no prose, no markdown fences."""


_USER_TEMPLATE = """Problem: {title} ({difficulty})
Reference time complexity: {ref_time}
Reference space complexity: {ref_space}

Statement:
{statement}

Constraints:
{constraints}

Language: {language}
Candidate's code:
```{language}
{code}
```

Hidden test results (pass/fail per test):
{test_summary}

Pass rate: {pass_rate_pct}% ({passed_count}/{total_count})
Average runtime: {avg_runtime_ms} ms
Average memory: {avg_memory_kb} KB

Return ONLY this JSON object (no other text):
{{
  "correctness_score":     <int 0-10, 10 if all hidden tests pass>,
  "time_complexity":       "<Big-O e.g. O(n), O(n log n)>",
  "space_complexity":      "<Big-O>",
  "tc_match_expected":     <true|false — does candidate's TC match the reference?>,
  "code_quality_score":    <int 0-10>,
  "readability_score":     <int 0-10>,
  "edge_cases_handled":    <int 0-10>,
  "approach_summary":      "<one sentence describing what the candidate did>",
  "strengths":             ["<bullet>", "<bullet>"],
  "improvements":          ["<bullet>", "<bullet>"],
  "bugs_or_smells":        ["<bullet if any, else empty list>"],
  "verdict":               "<one of: excellent | strong | acceptable | needs_work | incorrect>"
}}"""


def _summarise_tests(test_results: list) -> str:
    if not test_results:
        return "(no tests were run)"
    lines = []
    for i, t in enumerate(test_results[:12]):
        mark = "PASS" if t.get("passed") else "FAIL"
        status = t.get("status", "?")
        rt = t.get("runtime_ms", 0)
        lines.append(f"  Test {i+1}: {mark} ({status}, {rt}ms)")
    if len(test_results) > 12:
        lines.append(f"  …and {len(test_results) - 12} more")
    return "\n".join(lines)


def _safe_parse_json(text: str) -> Optional[dict]:
    """Best-effort JSON extraction from LLM output."""
    if not text:
        return None
    # First try direct parse
    try:
        return json.loads(text)
    except Exception:
        pass
    # Strip code fences and try again
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            return None
    return None


def _fallback_verdict(pass_rate: float) -> str:
    if pass_rate >= 1.0:
        return "strong"
    if pass_rate >= 0.7:
        return "acceptable"
    if pass_rate > 0:
        return "needs_work"
    return "incorrect"


async def evaluate_dsa_submission(
    problem:      dict,
    language:     str,
    code:         str,
    test_results: list,
) -> dict:
    """
    Run a single Groq evaluation pass on a DSA submission.

    Returns a dict with all the fields documented in _USER_TEMPLATE, plus
    `pass_rate`, `tests_passed`, `tests_total`, `avg_runtime_ms`, `avg_memory_kb`.
    Always returns *something* — falls back to deterministic scoring on LLM errors
    so the user never sees a broken submit flow.
    """
    total      = max(len(test_results), 1)
    passed     = sum(1 for t in test_results if t.get("passed"))
    pass_rate  = passed / total
    avg_rt     = round(sum(t.get("runtime_ms", 0) for t in test_results) / total)
    avg_mem    = round(sum(t.get("memory_kb",  0) for t in test_results) / total)

    user_prompt = _USER_TEMPLATE.format(
        title         = problem.get("title", ""),
        difficulty    = problem.get("difficulty", ""),
        ref_time      = problem.get("reference_complexity_time")  or "unspecified",
        ref_space     = problem.get("reference_complexity_space") or "unspecified",
        statement     = (problem.get("statement_md") or "")[:1500],
        constraints   = (problem.get("constraints_md") or "")[:600],
        language      = language,
        code          = (code or "")[:4000],
        test_summary  = _summarise_tests(test_results),
        pass_rate_pct = int(pass_rate * 100),
        passed_count  = passed,
        total_count   = len(test_results),
        avg_runtime_ms = avg_rt,
        avg_memory_kb  = avg_mem,
    )

    parsed: Optional[dict] = None
    try:
        raw = await _achat(
            messages=[
                {"role": "system", "content": _SYSTEM},
                {"role": "user",   "content": user_prompt},
            ],
            temperature=0.2,
            max_tokens=900,
        )
        parsed = _safe_parse_json(raw)
    except Exception as e:
        parsed = None

    # ── Deterministic fallback if the LLM call failed or returned junk ────────
    if not parsed:
        parsed = {
            "correctness_score":   round(pass_rate * 10),
            "time_complexity":     "unknown",
            "space_complexity":    "unknown",
            "tc_match_expected":   False,
            "code_quality_score":  5,
            "readability_score":   5,
            "edge_cases_handled":  round(pass_rate * 10),
            "approach_summary":    "Automatic evaluation unavailable — graded on test pass rate only.",
            "strengths":           [],
            "improvements":        [],
            "bugs_or_smells":      [],
            "verdict":             _fallback_verdict(pass_rate),
        }

    # Always overwrite correctness with the actual pass-rate number — the LLM
    # sometimes inflates this. Hidden tests are ground truth.
    parsed["correctness_score"] = round(pass_rate * 10)

    parsed.update({
        "pass_rate":       round(pass_rate, 3),
        "tests_passed":    passed,
        "tests_total":     total,
        "avg_runtime_ms":  avg_rt,
        "avg_memory_kb":   avg_mem,
    })
    return parsed
