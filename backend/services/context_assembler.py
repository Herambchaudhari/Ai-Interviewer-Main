"""
services/context_assembler.py

Assembles the full candidate intelligence ContextBundle at session start.
Pulls from every available source:
  1. Resume parsed_data + student_meta (from profile + onboarding)
  2. Portfolio files (grade cards, publications, project reports)
  3. External links → scraped summaries (GitHub, LinkedIn, Portfolio)
  4. Past AI Interviewer reports → known weak/strong areas
  5. Target company + job role from session request
  6. Live company news (Tavily / DuckDuckGo)

All errors are non-fatal — missing sources degrade gracefully to empty values.
"""
from __future__ import annotations
import asyncio
from typing import Optional


async def assemble_context(
    user_id: str,
    profile_id: str,
    student_meta: Optional[dict],
    target_company: Optional[str],
    job_role: Optional[str],
    round_type: str,
    difficulty: str,
    is_full_loop: bool = False,
) -> dict:
    """
    Builds and returns a flat context dict ready for:
      - build_interviewer_prompt()
      - adaptive_engine question generation
      - report generation

    Returns a dict matching the ContextBundle shape (but as plain dict
    so it serialises cleanly to Supabase JSONB).
    """
    from services.db_service import (
        get_profile,
        get_portfolio_files,
        get_external_links,
        get_past_reports_for_context,
    )
    from services.web_researcher import scrape_links, search_company_trends

    context: dict = {
        # --- resume / profile
        "name": None,
        "skills": [],
        "experience": [],
        "projects": [],
        "education": [],
        # --- onboarding
        "year": None,
        "branch": None,
        "cgpa": None,
        "target_companies": [],
        "target_sectors": [],
        # --- external
        "github_url": None,
        "linkedin_url": None,
        "portfolio_url": None,
        "research_context": {},
        # --- portfolio files
        "portfolio_files": [],
        # --- past performance
        "known_weak_areas": [],
        "known_strong_areas": [],
        "past_reports_summary": [],
        # --- session config
        "target_company": target_company or "",
        "job_role": job_role or "Software Engineer",
        "round_type": round_type,
        "difficulty": difficulty,
        "company_news_context": "",
        "company_questions_context": "",
        "is_full_loop": is_full_loop,
    }

    # ── 1. Resume / profile ───────────────────────────────────────────────────
    try:
        profile = get_profile(profile_id)
        if profile:
            pd = profile.get("parsed_data") or {}
            if isinstance(pd, str):
                import json as _j
                try:
                    pd = _j.loads(pd)
                except Exception:
                    pd = {}
            context.update({
                "name":       pd.get("name"),
                "skills":     pd.get("skills", []),
                "experience": pd.get("experience", []),
                "projects":   pd.get("projects", []),
                "education":  pd.get("education", []),
            })
    except Exception as e:
        print(f"[context_assembler] profile fetch failed: {e}")

    # ── 2. Student meta (onboarding — takes precedence over DB profile) ───────
    if student_meta:
        for field in ("name", "year", "branch", "cgpa", "target_companies", "target_sectors"):
            val = student_meta.get(field)
            if val is not None:
                context[field] = val

    # ── 3. Portfolio files ────────────────────────────────────────────────────
    try:
        files = get_portfolio_files(user_id)
        if files:
            context["portfolio_files"] = [
                {
                    "title":         f.get("title", ""),
                    "file_category": f.get("file_category", "other"),
                    "semester_year": f.get("semester_year"),
                    "file_url":      f.get("file_url", ""),
                }
                for f in files
            ]
    except Exception as e:
        print(f"[context_assembler] portfolio_files fetch failed: {e}")

    # ── 4. External links + scrape ────────────────────────────────────────────
    try:
        links = get_external_links(user_id)
        if links:
            context["github_url"]    = links.get("github_url")
            context["linkedin_url"]  = links.get("linkedin_url")
            context["portfolio_url"] = links.get("portfolio_url")

            scrape_targets = {
                k: v
                for k, v in {
                    "github_url":    links.get("github_url"),
                    "linkedin_url":  links.get("linkedin_url"),
                    "portfolio_url": links.get("portfolio_url"),
                }.items()
                if v
            }
            if scrape_targets:
                scraped = await scrape_links(scrape_targets)
                context["research_context"] = scraped or {}
    except Exception as e:
        print(f"[context_assembler] external links/scrape failed: {e}")

    # ── 5. Past interview reports → weak / strong areas ───────────────────────
    try:
        past = get_past_reports_for_context(user_id, limit=5)
        if past:
            context["past_reports_summary"] = past

            # Aggregate: count occurrences of each weak/strong area
            weak_counts: dict[str, int] = {}
            strong_counts: dict[str, int] = {}
            for rep in past:
                for area in rep.get("weak_areas", []):
                    weak_counts[area] = weak_counts.get(area, 0) + 1
                for area in rep.get("strong_areas", []):
                    strong_counts[area] = strong_counts.get(area, 0) + 1

            # Sort by frequency; keep top 8
            context["known_weak_areas"] = [
                a for a, _ in sorted(weak_counts.items(), key=lambda x: -x[1])[:8]
            ]
            context["known_strong_areas"] = [
                a for a, _ in sorted(strong_counts.items(), key=lambda x: -x[1])[:8]
            ]
    except Exception as e:
        print(f"[context_assembler] past reports fetch failed: {e}")

    # ── 6. Live company news + interview question intelligence ──────────────
    if target_company:
        from services.web_researcher import (
            search_company_coding_questions,
            search_company_interview_questions,
            search_company_mcq_topics,
        )

        # Build tasks — always fetch news, fetch interview questions for technical round
        news_task = search_company_trends(target_company)

        async def _noop_str():
            return ""

        questions_task = (
            search_company_interview_questions(target_company, job_role or "Software Engineer")
            if round_type == "technical"
            else search_company_coding_questions(target_company, job_role or "Software Engineer")
            if round_type == "dsa"
            else search_company_mcq_topics(target_company, job_role or "Software Engineer")
            if round_type == "mcq_practice"
            else _noop_str()
        )

        try:
            news, questions_ctx = await asyncio.gather(
                news_task, questions_task, return_exceptions=True
            )
            context["company_news_context"] = news if isinstance(news, str) else ""
            context["company_questions_context"] = questions_ctx if isinstance(questions_ctx, str) else ""
        except Exception as e:
            print(f"[context_assembler] company intelligence fetch failed: {e}")

    return context


def build_portfolio_summary(portfolio_files: list) -> str:
    """
    Returns a human-readable summary of portfolio files for prompt injection.
    Groups by category.
    """
    if not portfolio_files:
        return ""

    by_cat: dict[str, list] = {}
    for f in portfolio_files:
        cat = f.get("file_category", "other")
        by_cat.setdefault(cat, []).append(f)

    lines = ["\nPORTFOLIO & CREDENTIALS"]
    lines.append("─────────────────────────────────────────")

    cat_labels = {
        "grade_card":      "Grade Cards",
        "publication":     "Publications",
        "project_report":  "Project Reports",
        "other":           "Other Files",
    }
    for cat, files in by_cat.items():
        label = cat_labels.get(cat, cat.replace("_", " ").title())
        for f in files:
            sem = f.get("semester_year", "")
            title = f.get("title", "")
            entry = f"  • [{label}] {title}"
            if sem:
                entry += f" ({sem})"
            lines.append(entry)

    lines.append("")
    return "\n".join(lines)


def build_past_performance_summary(
    known_weak_areas: list,
    known_strong_areas: list,
    past_reports: list,
) -> str:
    """
    Returns a formatted past-performance block for the interviewer prompt.
    Tells Alex what the candidate historically struggles with and excels at.
    """
    if not known_weak_areas and not known_strong_areas and not past_reports:
        return ""

    lines = ["\nCROSS-SESSION PERFORMANCE HISTORY"]
    lines.append("─────────────────────────────────────────")
    lines.append(f"Total past sessions analysed: {len(past_reports)}")

    if known_weak_areas:
        lines.append(
            "Recurring Weak Areas (probe these deliberately — candidate needs to improve here):"
        )
        for area in known_weak_areas:
            lines.append(f"  ⚠ {area}")

    if known_strong_areas:
        lines.append(
            "Recurring Strong Areas (use as setup for harder follow-ups):"
        )
        for area in known_strong_areas:
            lines.append(f"  ✓ {area}")

    if past_reports:
        lines.append("\nRecent session scores:")
        for rep in past_reports[-3:]:
            score_str = f"{rep['overall_score']}/10" if rep.get("overall_score") else "N/A"
            lines.append(
                f"  • {rep['round_type'].upper()} ({rep['difficulty']}) — {score_str} — {rep['date']}"
            )

    lines.append(
        "\n→ INTERVIEWER NOTE: Do NOT avoid weak areas. Probe them from a fresh angle."
    )
    lines.append("")
    return "\n".join(lines)
