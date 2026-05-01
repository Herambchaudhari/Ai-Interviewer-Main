"""
routers/mcq.py — MCQ Practice question bank endpoints.

GET  /api/v1/mcq/topics   → category/topic tree with question counts
POST /api/v1/mcq/questions → fetch a random set for a session (internal helper used by session router)

Question type split (research-backed, matches AMCAT / HackerRank / Codility standards):
  Difficulty by experience level:
    fresher   → 50% easy  / 40% medium / 10% hard
    mid-level → 25% easy  / 55% medium / 20% hard
    senior    → 10% easy  / 40% medium / 50% hard

  Topic distribution for "mixed" round:
    DSA 35%  | Core CS 45%  | Role-specific 20%

  Within DSA:    Arrays/Strings/Two-Pointers 35% · Trees/Graphs 30% · DP/Sorting 25% · Others 10%
  Within CoreCS: OOPs 35% · DBMS 30% · OS 25% · CN 10%
"""
import random
from fastapi import APIRouter, Depends
from auth import get_current_user

router = APIRouter()

# ── Topic taxonomy ─────────────────────────────────────────────────────────────
CATEGORY_DISPLAY = {
    "dsa":          "DSA / Algorithms",
    "core_cs":      "Core CS Subjects",
    "frontend":     "Frontend",
    "backend":      "Backend & System Design",
    "ml":           "Machine Learning",
}

CATEGORY_TOPICS = {
    "dsa":      ["Arrays", "Strings", "Two Pointers", "Linked List", "Stack", "Queue",
                 "Trees", "Graphs", "Dynamic Programming", "Sorting", "Greedy",
                 "Backtracking", "Recursion"],
    "core_cs":  ["OOPs", "DBMS", "OS", "Computer Networks"],
    "frontend": ["JavaScript", "React", "CSS"],
    "backend":  ["REST API", "System Design"],
    "ml":       ["Machine Learning"],
}

# Research-backed difficulty splits per experience level
_DIFF_SPLITS = {
    "easy":   {"easy": 0.50, "medium": 0.40, "hard": 0.10},
    "medium": {"easy": 0.25, "medium": 0.55, "hard": 0.20},
    "hard":   {"easy": 0.10, "medium": 0.40, "hard": 0.50},
}

# Mixed-round category weights (sums to 1.0)
_MIXED_CAT_WEIGHTS = {
    "dsa":      0.35,
    "core_cs":  0.45,
    "frontend": 0.08,
    "backend":  0.08,
    "ml":       0.04,
}

# DSA topic weights (proportional sampling)
_DSA_TOPIC_WEIGHTS = {
    "Arrays": 4, "Trees": 4, "Dynamic Programming": 4, "Graphs": 4,
    "Strings": 3, "Sorting": 3, "Two Pointers": 3,
    "Linked List": 2, "Stack": 2,
    "Queue": 1, "Greedy": 1, "Backtracking": 1, "Recursion": 1,
}

# Core CS topic weights
_CORE_TOPIC_WEIGHTS = {
    "OOPs": 4, "DBMS": 3, "OS": 3, "Computer Networks": 2,
}


# ── DB helper ─────────────────────────────────────────────────────────────────
def fetch_mcq_questions_from_db(
    num_questions: int,
    difficulty: str,         # 'easy' | 'medium' | 'hard'
    category: str = "mixed", # category key or 'mixed'
    topics: list = None,     # specific topic list (optional)
) -> list[dict]:
    """
    Pull a randomised, professionally-split set of questions from mcq_question_bank.
    Returns question dicts with all fields needed by the session.
    """
    from services.db_service import _db

    diff_split = _DIFF_SPLITS.get(difficulty, _DIFF_SPLITS["medium"])
    easy_n   = max(0, round(num_questions * diff_split["easy"]))
    medium_n = max(0, round(num_questions * diff_split["medium"]))
    hard_n   = max(0, num_questions - easy_n - medium_n)

    diff_counts = {"easy": easy_n, "medium": medium_n, "hard": hard_n}

    result: list[dict] = []
    already_ids: set   = set()

    def _fetch_diff_pool(diff: str, cat_filter: str | None, topic_filter: list | None) -> list[dict]:
        q = _db().table("mcq_question_bank").select("*").eq("difficulty", diff)
        if cat_filter and cat_filter != "mixed":
            q = q.eq("category", cat_filter)
        if topic_filter:
            q = q.in_("topic", topic_filter)
        return q.execute().data or []

    def _sample(pool: list[dict], n: int) -> list[dict]:
        available = [r for r in pool if r["id"] not in already_ids]
        chosen = random.sample(available, min(n, len(available)))
        for c in chosen:
            already_ids.add(c["id"])
        return chosen

    # ── Specific category ─────────────────────────────────────────────────────
    if category and category != "mixed":
        for diff, n in diff_counts.items():
            if n <= 0:
                continue
            pool = _fetch_diff_pool(diff, category, topics or None)
            result.extend(_sample(pool, n))

    # ── Mixed round — proportional sampling across categories ─────────────────
    else:
        for diff, total_diff in diff_counts.items():
            if total_diff <= 0:
                continue
            remaining = total_diff
            cats = list(_MIXED_CAT_WEIGHTS.items())
            random.shuffle(cats)
            for i, (cat, weight) in enumerate(cats):
                if i == len(cats) - 1:
                    n = remaining
                else:
                    n = max(0, round(total_diff * weight))
                    remaining -= n
                if n <= 0:
                    continue
                pool = _fetch_diff_pool(diff, cat, None)
                result.extend(_sample(pool, n))

    # ── Backfill if we came up short ──────────────────────────────────────────
    shortfall = num_questions - len(result)
    if shortfall > 0:
        for diff in ("medium", "easy", "hard"):
            if shortfall <= 0:
                break
            pool = _fetch_diff_pool(diff, category if category != "mixed" else None, None)
            extras = _sample(pool, shortfall)
            result.extend(extras)
            shortfall -= len(extras)

    random.shuffle(result)
    return result[:num_questions]


# ── Endpoints ─────────────────────────────────────────────────────────────────
@router.get("/topics")
async def get_topics(user: dict = Depends(get_current_user)):
    """Return available categories and topics with per-difficulty question counts."""
    from services.db_service import _db

    rows = _db().table("mcq_question_bank").select("category,topic,difficulty").execute().data or []

    counts: dict = {}
    for row in rows:
        cat  = row["category"]
        top  = row["topic"]
        diff = row["difficulty"]
        counts.setdefault(cat, {}).setdefault(top, {"easy": 0, "medium": 0, "hard": 0, "total": 0})
        counts[cat][top][diff] = counts[cat][top].get(diff, 0) + 1
        counts[cat][top]["total"] += 1

    formatted = {}
    for cat, topics in counts.items():
        formatted[cat] = {
            "label":  CATEGORY_DISPLAY.get(cat, cat),
            "topics": topics,
            "total":  sum(t["total"] for t in topics.values()),
        }

    return {"success": True, "data": formatted}
