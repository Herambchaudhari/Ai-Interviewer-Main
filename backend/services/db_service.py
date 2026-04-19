"""
DB service — all Supabase CRUD operations for the AI Interviewer app.
Single global Supabase client initialised lazily.
"""
import os
import uuid
import json
from datetime import datetime, timezone
from typing import Optional
from supabase import create_client, Client

_client: Optional[Client] = None
_VALID_ROUND_TYPES = {"technical", "hr", "dsa", "mcq_practice"}
_LEGACY_SESSION_OPTIONAL_COLUMNS = {
    "timer_remaining_secs",
    "last_checkpoint_at",
    "conversation_history",
    "detected_weaknesses",
    "avoided_topics",
}


def _extract_effective_round_type(row: dict) -> str:
    context_bundle = row.get("context_bundle") or {}
    if isinstance(context_bundle, str):
        try:
            context_bundle = json.loads(context_bundle)
        except Exception:
            context_bundle = {}

    questions = row.get("questions") or []
    if isinstance(questions, str):
        try:
            questions = json.loads(questions)
        except Exception:
            questions = []

    effective = (
        context_bundle.get("effective_round_type")
        or context_bundle.get("round_type")
        or row.get("round_type")
        or "technical"
    )
    if effective == "technical" and isinstance(questions, list):
        question_types = {str(q.get("type", "")).lower() for q in questions if isinstance(q, dict)}
        if "mcq" in question_types:
            effective = "mcq_practice"
        elif "code" in question_types:
            effective = "dsa"
    return effective if effective in _VALID_ROUND_TYPES else (row.get("round_type") or "technical")


def _normalize_session_row(row: Optional[dict]) -> Optional[dict]:
    if not row:
        return row

    normalized = dict(row)
    effective_round_type = _extract_effective_round_type(normalized)
    normalized["effective_round_type"] = effective_round_type
    normalized["round_type"] = effective_round_type
    return normalized


def _mcq_compat_payload(payload: dict, include_context_bundle: bool = True) -> dict:
    compatible = dict(payload)
    if include_context_bundle:
        context_bundle = dict(compatible.get("context_bundle") or {})
        context_bundle["effective_round_type"] = "mcq_practice"
        context_bundle.setdefault("round_type", "mcq_practice")
        compatible["context_bundle"] = context_bundle
    else:
        compatible.pop("context_bundle", None)
    compatible["round_type"] = "technical"
    return compatible


def _build_session_payload_candidates(payload: dict) -> list[dict]:
    candidates: list[dict] = []
    seen: set[str] = set()

    def add(candidate: dict):
        try:
            key = json.dumps(candidate, sort_keys=True, default=str)
        except Exception:
            key = str(candidate)
        if key not in seen:
            seen.add(key)
            candidates.append(candidate)

    add(dict(payload))

    if payload.get("round_type") == "mcq_practice":
        add(_mcq_compat_payload(payload))

    trimmed = {
        k: v for k, v in payload.items()
        if k not in _LEGACY_SESSION_OPTIONAL_COLUMNS
    }
    add(trimmed)

    if trimmed.get("round_type") == "mcq_practice":
        add(_mcq_compat_payload(trimmed))

    no_context = {
        k: v for k, v in trimmed.items()
        if k != "context_bundle"
    }
    add(no_context)

    if no_context.get("round_type") == "mcq_practice":
        add(_mcq_compat_payload(no_context, include_context_bundle=False))

    minimal = {
        k: v for k, v in no_context.items()
        if k not in {"target_company", "target_role"}
    }
    add(minimal)

    if minimal.get("round_type") == "mcq_practice":
        add(_mcq_compat_payload(minimal, include_context_bundle=False))

    return candidates


# ── Init ──────────────────────────────────────────────────────────────────────
def init_supabase() -> Client:
    """
    Initialise (or return cached) Supabase client using env vars:
        SUPABASE_URL, SUPABASE_KEY (service-role key for server-side ops)
    """
    global _client
    if _client is None:
        url = os.environ.get("SUPABASE_URL", "")
        key = os.environ.get("SUPABASE_KEY", os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""))
        if not url or not key:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_KEY must be set in the environment."
            )
        _client = create_client(url, key)
    return _client


def _db() -> Client:
    """Shorthand — returns initialised client."""
    return init_supabase()


# ── Profiles ──────────────────────────────────────────────────────────────────
def save_profile(user_id: str, raw_text: str, parsed_data: dict) -> str:
    """
    Insert a new row into the 'profiles' table.
    Returns the generated profile_id (UUID string).
    """
    profile_id = str(uuid.uuid4())
    _db().table("profiles").insert({
        "id": profile_id,
        "user_id": user_id,
        "raw_text": raw_text,
        "parsed_data": parsed_data,          # supabase-py serialises dict → jsonb
        "created_at": datetime.now(timezone.utc).isoformat(),
    }).execute()
    return profile_id


def get_profile(profile_id: str) -> Optional[dict]:
    """
    Fetch a profile row by its UUID.
    Returns the row dict or None if not found.
    """
    res = _db().table("profiles").select("*").eq("id", profile_id).limit(1).execute()
    if res.data:
        return res.data[0]
    return None


# ── Sessions ──────────────────────────────────────────────────────────────────
def save_session(session_data: dict) -> str:
    """
    Insert a new interview session row.
    Expects session_data to include: user_id, profile_id, round_type, difficulty,
    num_questions, timer_minutes, questions (list).
    Returns the generated session_id.
    """
    session_id = str(uuid.uuid4())
    
    # Map timer_mins => timer_minutes correctly for DB schema
    if "timer_mins" in session_data and "timer_minutes" not in session_data:
        session_data["timer_minutes"] = session_data.pop("timer_mins")

    allowed_columns = {
        "id", "user_id", "profile_id", "round_type", "difficulty", "num_questions",
        "timer_minutes", "status", "questions", "transcript", "scores",
        "current_question_index", "ended_at", "end_reason", "created_at",
        "context_bundle", "target_company", "target_role", "timer_remaining_secs",
        "last_checkpoint_at", "conversation_history", "detected_weaknesses",
        "avoided_topics",
    }
    
    payload = {
        "id": session_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "status": "active",
    }
    for k, v in session_data.items():
        if k in allowed_columns:
            payload[k] = v

    # Serialise lists/dicts that need to go in jsonb columns
    for key in ("questions", "answers", "transcript", "scores", "context_bundle", "conversation_history", "detected_weaknesses"):
        if key in payload and not isinstance(payload[key], str):
            payload[key] = payload[key]   # supabase-py handles dicts natively
    last_error = None
    for candidate in _build_session_payload_candidates(payload):
        try:
            _db().table("sessions").insert(candidate).execute()
            return session_id
        except Exception as exc:
            last_error = exc

    if last_error is not None:
        print(f"Failed to save session to Supabase: {last_error}")
        raise last_error
    return session_id


def get_session(session_id: str) -> Optional[dict]:
    """Fetch a session by UUID."""
    res = _db().table("sessions").select("*").eq("id", session_id).limit(1).execute()
    if res.data:
        return _normalize_session_row(res.data[0])
    return None


def update_session(session_id: str, updates: dict) -> bool:
    """
    Partially update a session row.
    Returns True if at least one row was updated.
    """
    allowed_columns = {
        "user_id", "profile_id", "round_type", "difficulty", "num_questions",
        "timer_minutes", "status", "questions", "transcript", "scores",
        "current_question_index", "ended_at", "end_reason", "created_at",
        "context_bundle", "target_company", "target_role", "timer_remaining_secs",
        "last_checkpoint_at", "conversation_history", "detected_weaknesses",
        "avoided_topics",
    }
    payload = {k: v for k, v in updates.items() if k in allowed_columns}
    if not payload:
        return False

    for candidate in _build_session_payload_candidates(payload):
        if not candidate:
            continue
        try:
            res = _db().table("sessions").update(candidate).eq("id", session_id).execute()
            return bool(res.data)
        except Exception:
            continue
    return False


# ── Checkpoint / Resume ───────────────────────────────────────────────────────
def save_checkpoint(session_id: str, user_id: str, state: dict) -> bool:
    """
    Persist a mid-session snapshot.
    Accepts any subset of: current_question_index, conversation_history,
    scores, transcript, detected_weaknesses, avoided_topics, timer_remaining_secs.
    Always stamps last_checkpoint_at.
    Returns True on success.
    """
    allowed = {
        "current_question_index", "conversation_history", "scores",
        "transcript", "detected_weaknesses", "avoided_topics", "timer_remaining_secs",
    }
    updates = {k: v for k, v in state.items() if k in allowed}
    updates["last_checkpoint_at"] = datetime.now(timezone.utc).isoformat()

    # Verify ownership before writing
    session = get_session_with_auth(session_id, user_id)
    if not session:
        return False

    return update_session(session_id, updates)


def get_session_with_auth(session_id: str, user_id: str) -> Optional[dict]:
    """Fetch a session only if it belongs to user_id. Returns None on mismatch."""
    res = (
        _db()
        .table("sessions")
        .select("*")
        .eq("id", session_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if res.data:
        return _normalize_session_row(res.data[0])
    return None


def get_active_sessions(user_id: str) -> list:
    """
    Return all sessions with status='active' for a user, newest first.
    Only returns the fields needed for the resume prompt (no full transcript).
    """
    try:
        res = (
            _db()
            .table("sessions")
            .select(
                "id, round_type, difficulty, target_company, target_role, "
                "current_question_index, last_checkpoint_at, created_at, context_bundle"
            )
            .eq("user_id", user_id)
            .eq("status", "active")
            .order("created_at", desc=True)
            .limit(10)
            .execute()
        )
        return res.data or []
    except Exception as e:
        print(f"[get_active_sessions] error: {e}")
        return []


# ── Reports ───────────────────────────────────────────────────────────────────

# Base schema columns guaranteed to exist in every environment (schema.sql)
_REPORT_BASE_COLUMNS = (
    "overall_score", "grade", "summary", "hire_recommendation", "radar_scores",
    "strong_areas", "weak_areas", "per_question_analysis", "study_recommendations",
    "compared_to_level", "skill_ratings", "recommendations", "round_type",
)

# Columns added by migration 001
_REPORT_MIGRATION_001_COLUMNS = (
    "voice_metrics", "delivery_consistency", "filler_heatmap", "transcript_annotated",
    "audio_clips_index", "communication_breakdown", "six_axis_radar", "bs_flag",
    "pattern_groups", "blind_spots", "company_fit", "skill_decay", "repeated_offenders",
    "growth_trajectory", "improvement_vs_last", "swot", "what_went_wrong",
    "skills_to_work_on", "thirty_day_plan", "auto_resources", "follow_up_questions",
    "next_interview_blueprint", "confidence_score",
)

# Columns added by migration 007
_REPORT_MIGRATION_007_COLUMNS = ("checklist", "study_schedule", "peer_comparison")


def _report_flat_cols(report_data: dict, *column_sets) -> dict:
    """Return a dict of only the specified columns that exist in report_data."""
    result = {}
    for col_set in column_sets:
        for key in col_set:
            if key in report_data:
                result[key] = report_data[key]
    return result


def save_report(session_id: str, report_data: dict) -> str:
    """
    Upsert a report row. Tries progressively simpler payloads until one succeeds
    so the report is always persisted regardless of which DB migrations have been applied.

    The full report is always stored in the report_data JSONB blob as a guaranteed
    fallback; get_report() merges it back on read.

    Returns the report_id (new or existing).
    """
    created_at = datetime.now(timezone.utc).isoformat()

    # Guard: if a row already exists, update it — never create duplicate rows.
    try:
        existing = _db().table("reports").select("id").eq("session_id", session_id).limit(1).execute()
        if existing.data:
            existing_id = existing.data[0]["id"]
            _update_report(session_id, existing_id, report_data)
            return existing_id
    except Exception as chk_err:
        print(f"[save_report] existence check failed (will insert): {chk_err}")

    report_id = str(uuid.uuid4())
    _insert_report(session_id, report_id, created_at, report_data)
    return report_id


def _insert_report(session_id: str, report_id: str, created_at: str, report_data: dict) -> None:
    """
    Try to insert a report row using progressively simpler payloads.
    Tier 1 → all migration columns; Tier 2 → migration 001 only; Tier 3 → base schema only.
    The full report is always in report_data so get_report() can merge it back regardless of tier.
    """
    base = {
        "id": report_id,
        "session_id": session_id,
        "created_at": created_at,
        "report_data": report_data,  # full report always in JSONB blob
        **_report_flat_cols(report_data, _REPORT_BASE_COLUMNS),
    }

    # Tier 1: base + migration 001 + migration 007 (all migrations applied)
    try:
        _db().table("reports").insert({
            **base,
            **_report_flat_cols(report_data, _REPORT_MIGRATION_001_COLUMNS, _REPORT_MIGRATION_007_COLUMNS),
        }).execute()
        return
    except Exception as e1:
        print(f"[save_report] Tier-1 insert failed: {e1}")

    # Tier 2: base + migration 001 only (migration 007 not applied)
    try:
        _db().table("reports").insert({
            **base,
            **_report_flat_cols(report_data, _REPORT_MIGRATION_001_COLUMNS),
        }).execute()
        return
    except Exception as e2:
        print(f"[save_report] Tier-2 insert failed: {e2}")

    # Tier 3: pure base schema — guaranteed columns only.
    # Everything is already in report_data blob; get_report() will merge it back.
    _db().table("reports").insert(base).execute()


def _update_report(session_id: str, report_id: str, report_data: dict) -> None:
    """Update an existing report row using the same tier strategy."""
    base_update = {
        "report_data": report_data,
        **_report_flat_cols(report_data, _REPORT_BASE_COLUMNS),
    }

    try:
        _db().table("reports").update({
            **base_update,
            **_report_flat_cols(report_data, _REPORT_MIGRATION_001_COLUMNS, _REPORT_MIGRATION_007_COLUMNS),
        }).eq("id", report_id).execute()
        return
    except Exception as e1:
        print(f"[save_report] Tier-1 update failed: {e1}")

    try:
        _db().table("reports").update({
            **base_update,
            **_report_flat_cols(report_data, _REPORT_MIGRATION_001_COLUMNS),
        }).eq("id", report_id).execute()
        return
    except Exception as e2:
        print(f"[save_report] Tier-2 update failed: {e2}")

    _db().table("reports").update(base_update).eq("id", report_id).execute()


def get_report(session_id: str) -> Optional[dict]:
    """Fetch the most recent report for a given session_id."""
    res = _db().table("reports").select("*").eq("session_id", session_id).order("created_at", desc=True).limit(1).execute()
    if res.data:
        row = res.data[0]
        report_blob = row.get("report_data") or {}
        if isinstance(report_blob, str):
            try:
                report_blob = json.loads(report_blob)
            except Exception:
                report_blob = {}
        # Merge strategy: start with flat DB columns, then overlay with report_data blob.
        # This ensures rich JSONB fields (checklist, study_schedule, peer_comparison, …)
        # always win over NULL flat columns that haven't been backfilled yet.
        blob = report_blob if isinstance(report_blob, dict) else {}
        merged = {k: v for k, v in row.items() if k != "report_data"}
        # Overlay non-None blob values so they override any NULL flat columns
        for k, v in blob.items():
            if v is not None or k not in merged:
                merged[k] = v
        if blob:
            merged["report_data"] = blob
        return merged
    return None


def get_user_reports(user_id: str) -> list:
    """
    Fetch all completed sessions for a user that have associated reports.
    Returns merged list of session + report data for the dashboard history table.
    """
    try:
        # Get all completed sessions for this user
        sessions_res = (
            _db()
            .table("sessions")
            .select("id, round_type, difficulty, num_questions, status, created_at, ended_at, context_bundle")
            .eq("user_id", user_id)
            .eq("status", "completed")
            .order("created_at", desc=True)
            .limit(50)
            .execute()
        )
        sessions = sessions_res.data or []
        if not sessions:
            return []

        # Get reports for these sessions
        session_ids = [s["id"] for s in sessions]
        reports_res = (
            _db()
            .table("reports")
            .select("session_id, overall_score, grade, created_at")
            .in_("session_id", session_ids)
            .execute()
        )
        reports_map = {r["session_id"]: r for r in (reports_res.data or [])}

        # Merge
        merged = []
        for s in sessions:
            effective_round_type = _extract_effective_round_type(s)
            r = reports_map.get(s["id"], {})
            merged.append({
                "id":            r.get("session_id", s["id"]),
                "session_id":    s["id"],
                "round_type":    effective_round_type,
                "difficulty":    s.get("difficulty", "medium"),
                "num_questions": s.get("num_questions", 0),
                "overall_score": r.get("overall_score"),
                "grade":         r.get("grade"),
                "created_at":    s.get("created_at"),
                "status":        s.get("status"),
            })
        return merged
    except Exception:
        return []


def get_user_sessions(user_id: str) -> list:
    """Return all sessions (with or without reports) for a user."""
    try:
        res = (
            _db()
            .table("sessions")
            .select("id, round_type, difficulty, num_questions, status, created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(50)
            .execute()
        )
        return res.data or []
    except Exception:
        return []


# ── Context Hub ───────────────────────────────────────────────────────────────

def get_hub_reports(user_id: str, round_type: Optional[str] = None,
                    difficulty: Optional[str] = None, sort_order: str = "desc") -> list:
    """
    Fetch all completed sessions + their report summaries for the hub spreadsheet.
    Returns merged list with session + report fields.
    """
    try:
        q = (
            _db().table("sessions")
            .select("id, round_type, difficulty, num_questions, created_at, ended_at, context_bundle")
            .eq("user_id", user_id)
            .eq("status", "completed")
        )
        if difficulty:
            q = q.eq("difficulty", difficulty)
        q = q.order("created_at", desc=(sort_order == "desc")).limit(100)
        sessions = q.execute().data or []

        if not sessions:
            return []

        session_ids = [s["id"] for s in sessions]
        reports_res = (
            _db().table("reports")
            .select("session_id, id, overall_score, grade, weak_areas, summary, "
                    "interviewer_name, weak_parts_summary, strong_areas, study_recommendations")
            .in_("session_id", session_ids)
            .execute()
        )
        reports_map = {r["session_id"]: r for r in (reports_res.data or [])}

        merged = []
        for s in sessions:
            effective_round_type = _extract_effective_round_type(s)
            if round_type and effective_round_type != round_type:
                continue
            r = reports_map.get(s["id"], {})
            # Build weak_parts list from weak_areas JSONB
            raw_weak = r.get("weak_areas") or []
            if isinstance(raw_weak, str):
                try:
                    import json as _json
                    raw_weak = _json.loads(raw_weak)
                except Exception:
                    raw_weak = []
            weak_parts = [w.get("area", "") for w in raw_weak if isinstance(w, dict)]
            what_went_wrong = "; ".join(
                w.get("what_was_missed", "") for w in raw_weak
                if isinstance(w, dict) and w.get("what_was_missed")
            )
            merged.append({
                "session_id":       s["id"],
                "report_id":        r.get("id"),
                "session_date":     s.get("created_at"),
                "round_type":       effective_round_type,
                "difficulty":       s.get("difficulty"),
                "num_questions":    s.get("num_questions"),
                "overall_score":    r.get("overall_score"),
                "grade":            r.get("grade"),
                "weak_parts":       weak_parts,
                "what_went_wrong":  what_went_wrong,
                "interviewer_name": r.get("interviewer_name", "Groq / LLaMA-3.3"),
                "summary":          r.get("summary", ""),
            })
        return merged
    except Exception as e:
        print(f"[get_hub_reports] error: {e}")
        return []


def get_analytics(user_id: str) -> dict:
    """
    Aggregate performance stats for the hub analytics section.
    """
    try:
        rows = get_hub_reports(user_id, sort_order="asc")  # asc for trend chart
        if not rows:
            return {
                "total_interviews": 0,
                "average_score": 0,
                "best_round_type": None,
                "win_rate": 0,
                "score_trend": [],
                "by_round_type": {},
                "by_difficulty": {},
            }

        total = len(rows)
        scores = [r["overall_score"] for r in rows if r["overall_score"] is not None]
        avg_score = round(sum(scores) / len(scores), 1) if scores else 0
        wins = sum(1 for s in scores if s >= 70)
        win_rate = round(wins / len(scores), 2) if scores else 0

        # By round type
        by_round: dict = {}
        for r in rows:
            rt = r["round_type"] or "technical"
            if rt not in by_round:
                by_round[rt] = {"count": 0, "scores": []}
            by_round[rt]["count"] += 1
            if r["overall_score"] is not None:
                by_round[rt]["scores"].append(r["overall_score"])
        by_round_summary = {
            rt: {
                "count": v["count"],
                "avg_score": round(sum(v["scores"]) / len(v["scores"]), 1) if v["scores"] else 0,
            }
            for rt, v in by_round.items()
        }
        best_round = max(by_round_summary, key=lambda rt: by_round_summary[rt]["avg_score"]) \
            if by_round_summary else None

        # By difficulty
        by_diff: dict = {}
        for r in rows:
            d = r["difficulty"] or "medium"
            if d not in by_diff:
                by_diff[d] = {"count": 0, "scores": []}
            by_diff[d]["count"] += 1
            if r["overall_score"] is not None:
                by_diff[d]["scores"].append(r["overall_score"])
        by_diff_summary = {
            d: {
                "count": v["count"],
                "avg_score": round(sum(v["scores"]) / len(v["scores"]), 1) if v["scores"] else 0,
            }
            for d, v in by_diff.items()
        }

        # Score trend (chronological)
        score_trend = [
            {
                "date": r["session_date"][:10] if r["session_date"] else "",
                "score": r["overall_score"],
                "round_type": r["round_type"],
            }
            for r in rows if r["overall_score"] is not None
        ]

        return {
            "total_interviews": total,
            "average_score": avg_score,
            "best_round_type": best_round,
            "win_rate": win_rate,
            "score_trend": score_trend,
            "by_round_type": by_round_summary,
            "by_difficulty": by_diff_summary,
        }
    except Exception as e:
        print(f"[get_analytics] error: {e}")
        return {}


def get_topics_mastery(user_id: str) -> dict:
    """
    Extract all topics from weak_areas + study_recommendations across reports.
    Compute per-topic proficiency level.
    """
    try:
        sessions_res = (
            _db().table("sessions")
            .select("id")
            .eq("user_id", user_id)
            .eq("status", "completed")
            .execute()
        )
        session_ids = [s["id"] for s in (sessions_res.data or [])]
        if not session_ids:
            return {"topics": [], "ai_recommendations": []}

        reports_res = (
            _db().table("reports")
            .select("session_id, overall_score, weak_areas, study_recommendations, created_at")
            .in_("session_id", session_ids)
            .execute()
        )
        reports = reports_res.data or []

        # Aggregate topic data
        topic_map: dict = {}
        rec_map: dict = {}

        for rep in reports:
            score = rep.get("overall_score") or 0
            raw_weak = rep.get("weak_areas") or []
            raw_recs = rep.get("study_recommendations") or []
            session_date = (rep.get("created_at") or "")[:10]

            if isinstance(raw_weak, str):
                try:
                    import json as _j
                    raw_weak = _j.loads(raw_weak)
                except Exception:
                    raw_weak = []
            if isinstance(raw_recs, str):
                try:
                    import json as _j
                    raw_recs = _j.loads(raw_recs)
                except Exception:
                    raw_recs = []

            for w in raw_weak:
                if not isinstance(w, dict):
                    continue
                topic = (w.get("area") or "").strip()
                if not topic:
                    continue
                key = topic.lower()
                if key not in topic_map:
                    topic_map[key] = {
                        "topic": topic, "appearances": 0,
                        "scores": [], "last_seen": session_date,
                    }
                topic_map[key]["appearances"] += 1
                t_score = w.get("score") or score
                topic_map[key]["scores"].append(t_score)
                if session_date > topic_map[key]["last_seen"]:
                    topic_map[key]["last_seen"] = session_date

            for rec in raw_recs:
                if not isinstance(rec, dict):
                    continue
                topic = (rec.get("topic") or "").strip()
                if not topic:
                    continue
                key = topic.lower()
                priority = rec.get("priority", "Medium")
                resources = rec.get("resources", [])
                reason = rec.get("reason", "")
                # Keep highest priority recommendation per topic
                priority_rank = {"High": 3, "Medium": 2, "Low": 1}
                if key not in rec_map or priority_rank.get(priority, 0) > priority_rank.get(rec_map[key].get("priority"), 0):
                    rec_map[key] = {"topic": topic, "priority": priority,
                                    "resources": resources, "reason": reason}

        def _proficiency(avg: float) -> str:
            if avg >= 80: return "expert"
            if avg >= 60: return "proficient"
            if avg >= 40: return "developing"
            return "beginner"

        topics = []
        for tm in topic_map.values():
            avg = round(sum(tm["scores"]) / len(tm["scores"]), 1) if tm["scores"] else 0
            topics.append({
                "topic":       tm["topic"],
                "appearances": tm["appearances"],
                "avg_score":   avg,
                "proficiency": _proficiency(avg),
                "last_seen":   tm["last_seen"],
            })
        # Sort: weakest first
        topics.sort(key=lambda t: t["avg_score"])

        return {
            "topics": topics,
            "ai_recommendations": list(rec_map.values()),
        }
    except Exception as e:
        print(f"[get_topics_mastery] error: {e}")
        return {"topics": [], "ai_recommendations": []}


def get_session_note(session_id: str, user_id: str) -> Optional[dict]:
    """Fetch the note for a given session and user."""
    try:
        res = (
            _db().table("session_notes")
            .select("id, content, tags, updated_at")
            .eq("session_id", session_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        return res.data[0] if res.data else None
    except Exception as e:
        print(f"[get_session_note] error: {e}")
        return None


def upsert_session_note(session_id: str, user_id: str, content: str, tags: list) -> str:
    """
    Create or update a session note.
    Returns note_id.
    """
    try:
        existing = get_session_note(session_id, user_id)
        if existing:
            _db().table("session_notes").update({
                "content":    content,
                "tags":       tags,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", existing["id"]).execute()
            return existing["id"]
        else:
            note_id = str(uuid.uuid4())
            _db().table("session_notes").insert({
                "id":         note_id,
                "session_id": session_id,
                "user_id":    user_id,
                "content":    content,
                "tags":       tags,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).execute()
            return note_id
    except Exception as e:
        print(f"[upsert_session_note] error: {e}")
        raise


def get_applications(user_id: str, status: Optional[str] = None) -> list:
    """List company applications for a user, optionally filtered by status."""
    try:
        q = (
            _db().table("company_applications")
            .select("*")
            .eq("user_id", user_id)
        )
        if status:
            q = q.eq("status", status)
        res = q.order("created_at", desc=True).execute()
        return res.data or []
    except Exception as e:
        print(f"[get_applications] error: {e}")
        return []


def create_application(user_id: str, data: dict) -> str:
    """Insert a new company application. Returns app_id."""
    try:
        app_id = str(uuid.uuid4())
        _db().table("company_applications").insert({
            "id":              app_id,
            "user_id":         user_id,
            "company_name":    data["company_name"],
            "role":            data["role"],
            "date_applied":    data.get("date_applied"),
            "status":          data.get("status", "applied"),
            "outcome":         data.get("outcome"),
            "notes":           data.get("notes", ""),
            "linked_sessions": data.get("linked_sessions", []),
            "created_at":      datetime.now(timezone.utc).isoformat(),
            "updated_at":      datetime.now(timezone.utc).isoformat(),
        }).execute()
        return app_id
    except Exception as e:
        print(f"[create_application] error: {e}")
        raise


def update_application(app_id: str, user_id: str, updates: dict) -> bool:
    """Update fields on a company application. Returns True on success."""
    try:
        allowed = {"company_name", "role", "date_applied", "status",
                   "outcome", "notes", "linked_sessions"}
        payload = {k: v for k, v in updates.items() if k in allowed}
        payload["updated_at"] = datetime.now(timezone.utc).isoformat()
        res = (
            _db().table("company_applications")
            .update(payload)
            .eq("id", app_id)
            .eq("user_id", user_id)
            .execute()
        )
        return bool(res.data)
    except Exception as e:
        print(f"[update_application] error: {e}")
        return False


def delete_application(app_id: str, user_id: str) -> bool:
    """Hard-delete a company application."""
    try:
        res = (
            _db().table("company_applications")
            .delete()
            .eq("id", app_id)
            .eq("user_id", user_id)
            .execute()
        )
        return bool(res.data)
    except Exception as e:
        print(f"[delete_application] error: {e}")
        return False


def get_resume_versions(user_id: str) -> list:
    """List all resume versions for a user, newest first."""
    try:
        res = (
            _db().table("profiles")
            .select("id, label, file_name, is_active, created_at, parsed_data")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )
        rows = res.data or []
        result = []
        for row in rows:
            pd = row.get("parsed_data") or {}
            if isinstance(pd, str):
                try:
                    import json as _j
                    pd = _j.loads(pd)
                except Exception:
                    pd = {}
            result.append({
                "profile_id":       row["id"],
                "label":            row.get("label") or f"Resume — {(row.get('created_at') or '')[:10]}",
                "file_name":        row.get("file_name", ""),
                "is_active":        row.get("is_active", False),
                "created_at":       row.get("created_at"),
                "parsed_summary": {
                    "name":             pd.get("name", ""),
                    "skills":           pd.get("skills", []),
                    "skills_count":     len(pd.get("skills", [])),
                    "experience_count": len(pd.get("experience", [])),
                    "education_count":  len(pd.get("education", [])),
                    "projects_count":   len(pd.get("projects", [])),
                    "education":        pd.get("education", []),
                    "experience":       pd.get("experience", []),
                },
            })
        return result
    except Exception as e:
        print(f"[get_resume_versions] error: {e}")
        return []


def activate_resume(profile_id: str, user_id: str) -> bool:
    """Set one resume as active, deactivating all others for this user."""
    try:
        # Deactivate all for user
        _db().table("profiles").update({"is_active": False}).eq("user_id", user_id).execute()
        # Activate the chosen one
        res = (
            _db().table("profiles")
            .update({"is_active": True})
            .eq("id", profile_id)
            .eq("user_id", user_id)
            .execute()
        )
        return bool(res.data)
    except Exception as e:
        print(f"[activate_resume] error: {e}")
        return False

# ── Portfolio & Credentials ───────────────────────────────────────────────────

def get_portfolio_files(user_id: str) -> list:
    """Fetch all portfolio files for a given user."""
    try:
        res = (
            _db().table("portfolio_files")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )
        return res.data or []
    except Exception as e:
        print(f"[get_portfolio_files] error: {e}")
        return []

def add_portfolio_file(user_id: str, data: dict) -> str:
    """Insert a new portfolio file."""
    try:
        file_id = str(uuid.uuid4())
        _db().table("portfolio_files").insert({
            "id": file_id,
            "user_id": user_id,
            "title": data.get("title", ""),
            "file_category": data.get("file_category", "other"),
            "semester_year": data.get("semester_year"),
            "file_url": data.get("file_url", ""),
            "created_at": datetime.now(timezone.utc).isoformat()
        }).execute()
        return file_id
    except Exception as e:
        print(f"[add_portfolio_file] error: {e}")
        raise

def delete_portfolio_file(file_id: str, user_id: str) -> bool:
    """Delete a portfolio file by id for standard verification."""
    try:
        res = (
            _db().table("portfolio_files")
            .delete()
            .eq("id", file_id)
            .eq("user_id", user_id)
            .execute()
        )
        return bool(res.data)
    except Exception as e:
        print(f"[delete_portfolio_file] error: {e}")
        return False

def get_past_reports_for_context(user_id: str, limit: int = 5) -> list:
    """
    Fetch last N completed sessions + their reports for context assembly.
    Returns aggregated weak/strong areas and per-session summaries.
    Used by context_assembler to build the known_weak_areas / known_strong_areas lists.
    """
    try:
        sessions_res = (
            _db().table("sessions")
            .select("id, round_type, difficulty, created_at")
            .eq("user_id", user_id)
            .eq("status", "completed")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        sessions = sessions_res.data or []
        if not sessions:
            return []

        session_ids = [s["id"] for s in sessions]
        reports_res = (
            _db().table("reports")
            .select("session_id, overall_score, grade, weak_areas, strong_areas, created_at")
            .in_("session_id", session_ids)
            .execute()
        )
        reports_map = {r["session_id"]: r for r in (reports_res.data or [])}

        result = []
        for s in sessions:
            r = reports_map.get(s["id"], {})
            raw_weak = r.get("weak_areas") or []
            raw_strong = r.get("strong_areas") or []

            def _extract_areas(raw):
                if isinstance(raw, str):
                    try:
                        import json as _j
                        raw = _j.loads(raw)
                    except Exception:
                        return []
                if isinstance(raw, list):
                    names = []
                    for item in raw:
                        if isinstance(item, dict):
                            names.append(item.get("area", ""))
                        elif isinstance(item, str):
                            names.append(item)
                    return [n for n in names if n]
                return []

            result.append({
                "session_id":   s["id"],
                "round_type":   _extract_effective_round_type(s),
                "difficulty":   s.get("difficulty", "medium"),
                "overall_score": r.get("overall_score"),
                "grade":        r.get("grade"),
                "weak_areas":   _extract_areas(raw_weak),
                "strong_areas": _extract_areas(raw_strong),
                "date":         (s.get("created_at") or "")[:10],
            })
        return result
    except Exception as e:
        print(f"[get_past_reports_for_context] error: {e}")
        return []


# ── Enhanced Hub Reports (Phase 1) ───────────────────────────────────────────

def get_hub_reports_paginated(
    user_id: str,
    round_type: Optional[str] = None,
    difficulty: Optional[str] = None,
    sort_by: str = "date",
    sort_dir: str = "desc",
    page: int = 1,
    limit: int = 20,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    min_score: Optional[float] = None,
    max_score: Optional[float] = None,
) -> dict:
    """
    Paginated, filtered, sorted fetch of all reports for the Context Hub spreadsheet.
    Returns {rows, total, page, limit}.
    """
    try:
        q = (
            _db().table("sessions")
            .select("id, round_type, difficulty, num_questions, created_at, ended_at, target_company, context_bundle")
            .eq("user_id", user_id)
            .eq("status", "completed")
        )
        if difficulty:
            q = q.eq("difficulty", difficulty)
        if date_from:
            q = q.gte("created_at", date_from)
        if date_to:
            q = q.lte("created_at", date_to)

        q = q.order("created_at", desc=(sort_dir == "desc")).limit(200)
        sessions = q.execute().data or []

        if not sessions:
            return {"rows": [], "total": 0, "page": page, "limit": limit}

        session_ids = [s["id"] for s in sessions]
        reports_res = (
            _db().table("reports")
            .select(
                "session_id, id, overall_score, grade, hire_recommendation, "
                "weak_areas, strong_areas, what_went_wrong, skills_to_work_on, "
                "company_fit, delivery_consistency, improvement_vs_last, "
                "repeated_offenders, six_axis_radar, swot, communication_breakdown, "
                "pattern_groups, blind_spots, thirty_day_plan, follow_up_questions, "
                "interview_agent, confidence_score"
            )
            .in_("session_id", session_ids)
            .execute()
        )
        reports_map = {r["session_id"]: r for r in (reports_res.data or [])}

        def _safe_json(val):
            if isinstance(val, str):
                try:
                    return json.loads(val)
                except Exception:
                    return []
            return val or []

        rows = []
        for s in sessions:
            effective_round_type = _extract_effective_round_type(s)
            if round_type and effective_round_type != round_type:
                continue
            r = reports_map.get(s["id"], {})
            score = r.get("overall_score")

            # Apply score filters (post-fetch since Supabase join is complex)
            if min_score is not None and (score is None or score < min_score):
                continue
            if max_score is not None and (score is not None and score > max_score):
                continue

            raw_weak = _safe_json(r.get("weak_areas"))
            raw_skills = _safe_json(r.get("skills_to_work_on"))
            raw_repeated = _safe_json(r.get("repeated_offenders"))
            company_fit = r.get("company_fit") or {}
            delivery = r.get("delivery_consistency") or {}
            improvement = r.get("improvement_vs_last") or {}
            comm = r.get("communication_breakdown") or {}

            rows.append({
                "session_id":        s["id"],
                "report_id":         r.get("id"),
                "date":              s.get("created_at"),
                "interview_agent":   r.get("interview_agent") or effective_round_type.replace("_", " ").title(),
                "round_type":        effective_round_type,
                "difficulty":        s.get("difficulty"),
                "num_questions":     s.get("num_questions"),
                "target_company":    s.get("target_company") or "",
                "overall_score":     score,
                "grade":             r.get("grade"),
                "hire_recommendation": r.get("hire_recommendation"),
                "what_went_wrong":   r.get("what_went_wrong", ""),
                "weak_areas":        raw_weak[:3],
                "skills_to_work_on": raw_skills[:3],
                "pass_probability":  company_fit.get("pass_probability"),
                "delivery_verdict":  delivery.get("verdict"),
                "comm_avg":          round(
                    sum(v for v in comm.values() if isinstance(v, (int, float))) / max(len([v for v in comm.values() if isinstance(v, (int, float))]), 1),
                    1
                ) if comm else None,
                "score_delta":       improvement.get("score_delta"),
                "repeated_count":    len(raw_repeated),
                "six_axis_radar":    r.get("six_axis_radar"),
                "swot_preview":      {
                    "strengths":    (_safe_json(r.get("swot") or {}).get("strengths", []) if isinstance(r.get("swot"), dict) else [])[:2],
                    "weaknesses":   (_safe_json(r.get("swot") or {}).get("weaknesses", []) if isinstance(r.get("swot"), dict) else [])[:2],
                } if r.get("swot") else None,
            })

        total = len(rows)

        # Sort by score if requested (date sort was handled by Supabase query)
        if sort_by == "score":
            rows.sort(key=lambda x: (x["overall_score"] or 0), reverse=(sort_dir == "desc"))
        elif sort_by == "grade":
            grade_rank = {"A+": 7, "A": 6, "B+": 5, "B": 4, "C+": 3, "C": 2, "D": 1}
            rows.sort(key=lambda x: grade_rank.get(x.get("grade", "D"), 0), reverse=(sort_dir == "desc"))

        # Paginate
        start = (page - 1) * limit
        paginated = rows[start: start + limit]

        return {"rows": paginated, "total": total, "page": page, "limit": limit}
    except Exception as e:
        print(f"[get_hub_reports_paginated] error: {e}")
        return {"rows": [], "total": 0, "page": page, "limit": limit}


def get_reports_summary(user_id: str) -> dict:
    """
    Aggregate banner-level stats for the Context Hub Reports section header.
    Returns total sessions, avg score, best score, score trend (last 10),
    skill_decay alerts, repeated_offenders, topics_mastery, growth_trajectory.
    """
    try:
        sessions_res = (
            _db().table("sessions")
            .select("id, round_type, created_at, context_bundle")
            .eq("user_id", user_id)
            .eq("status", "completed")
            .order("created_at", desc=False)
            .execute()
        )
        sessions = sessions_res.data or []
        if not sessions:
            return {
                "total_sessions": 0, "avg_score": 0, "best_score": 0,
                "most_recent_grade": None, "score_trend": [],
                "skill_decay_alerts": [], "repeated_offenders": [],
                "growth_trajectory": None,
            }

        session_ids = [s["id"] for s in sessions]
        reports_res = (
            _db().table("reports")
            .select(
                "session_id, overall_score, grade, skill_decay, "
                "repeated_offenders, growth_trajectory, created_at"
            )
            .in_("session_id", session_ids)
            .order("created_at", desc=False)
            .execute()
        )
        reports = reports_res.data or []

        scores = [r["overall_score"] for r in reports if r.get("overall_score") is not None]
        score_trend = [
            {"score": r["overall_score"], "date": (r.get("created_at") or "")[:10]}
            for r in reports if r.get("overall_score") is not None
        ][-10:]  # last 10

        # Collect active skill_decay alerts from the most recent report
        latest_report = reports[-1] if reports else {}
        decay_raw = latest_report.get("skill_decay") or []
        if isinstance(decay_raw, str):
            try:
                decay_raw = json.loads(decay_raw)
            except Exception:
                decay_raw = []
        skill_decay_alerts = [d for d in decay_raw if isinstance(d, dict) and abs(d.get("delta", 0)) >= 10]

        # Collect repeated_offenders from the most recent report
        repeated_raw = latest_report.get("repeated_offenders") or []
        if isinstance(repeated_raw, str):
            try:
                repeated_raw = json.loads(repeated_raw)
            except Exception:
                repeated_raw = []

        return {
            "total_sessions":    len(sessions),
            "avg_score":         round(sum(scores) / len(scores), 1) if scores else 0,
            "best_score":        max(scores) if scores else 0,
            "most_recent_grade": latest_report.get("grade"),
            "score_trend":       score_trend,
            "skill_decay_alerts": skill_decay_alerts[:3],
            "repeated_offenders": repeated_raw[:3],
            "growth_trajectory": latest_report.get("growth_trajectory"),
        }
    except Exception as e:
        print(f"[get_reports_summary] error: {e}")
        return {
            "total_sessions": 0, "avg_score": 0, "best_score": 0,
            "most_recent_grade": None, "score_trend": [],
            "skill_decay_alerts": [], "repeated_offenders": [],
            "growth_trajectory": None,
        }


def compute_improvement_vs_last(user_id: str, session_id: str, round_type: str, current_score: float) -> Optional[dict]:
    """
    Compare current report to the most recent prior report of the same round_type.
    Returns {score_delta, areas_improved, areas_regressed} or None if no prior report.
    """
    try:
        try:
            prior_sessions_res = (
                _db().table("sessions")
                .select("id, created_at, round_type, context_bundle")
                .eq("user_id", user_id)
                .eq("status", "completed")
                .neq("id", session_id)
                .order("created_at", desc=True)
                .limit(20)
                .execute()
            )
        except Exception:
            prior_sessions_res = (
                _db().table("sessions")
                .select("id, created_at, round_type, questions")
                .eq("user_id", user_id)
                .eq("status", "completed")
                .neq("id", session_id)
                .order("created_at", desc=True)
                .limit(20)
                .execute()
            )
        prior_sessions = [
            row for row in (prior_sessions_res.data or [])
            if _extract_effective_round_type(row) == round_type
        ]
        if not prior_sessions:
            return None

        prior_report_res = (
            _db().table("reports")
            .select("overall_score, weak_areas, strong_areas")
            .eq("session_id", prior_sessions[0]["id"])
            .limit(1)
            .execute()
        )
        if not prior_report_res.data:
            return None

        prior = prior_report_res.data[0]
        prior_score = prior.get("overall_score") or 0
        score_delta = round(current_score - prior_score, 1)

        def _area_names(raw):
            if isinstance(raw, str):
                try:
                    raw = json.loads(raw)
                except Exception:
                    return []
            if isinstance(raw, list):
                return [item.get("area", "") for item in raw if isinstance(item, dict)]
            return []

        prior_weak = set(_area_names(prior.get("weak_areas")))
        prior_strong = set(_area_names(prior.get("strong_areas")))

        return {
            "prior_session_id": prior_sessions[0]["id"],
            "prior_score":      prior_score,
            "current_score":    current_score,
            "score_delta":      score_delta,
            "areas_improved":   list(prior_weak),   # were weak before — may be better now
            "areas_regressed":  list(prior_strong), # were strong before — watch for drop
            "verdict": "improved" if score_delta > 3 else "declined" if score_delta < -3 else "stable",
        }
    except Exception as e:
        print(f"[compute_improvement_vs_last] error: {e}")
        return None


def get_past_reports_for_analysis(user_id: str, exclude_session_id: str, limit: int = 10) -> list:
    """
    Fetch last N completed reports for cross-session analysis
    (skill decay, repeated offenders, growth trajectory).
    Returns list of {session_id, overall_score, weak_areas, grade, created_at}.
    """
    try:
        sessions_res = (
            _db().table("sessions")
            .select("id, round_type, created_at")
            .eq("user_id", user_id)
            .eq("status", "completed")
            .neq("id", exclude_session_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        sessions = sessions_res.data or []
        if not sessions:
            return []

        session_ids = [s["id"] for s in sessions]
        reports_res = (
            _db().table("reports")
            .select(
                "session_id, overall_score, grade, weak_areas, strong_areas, "
                "radar_scores, code_quality_metrics, round_type, created_at"
            )
            .in_("session_id", session_ids)
            .order("created_at", desc=False)
            .execute()
        )
        # Attach round_type from session if missing in report row
        session_map = {s["id"]: s for s in sessions}
        rows = reports_res.data or []
        for row in rows:
            if not row.get("round_type"):
                s = session_map.get(row.get("session_id"), {})
                row["round_type"] = _extract_effective_round_type(s)
        return rows
    except Exception as e:
        print(f"[get_past_reports_for_analysis] error: {e}")
        return []


def get_external_links(user_id: str) -> Optional[dict]:
    """Fetch external links for a user."""
    try:
        res = (
            _db().table("external_links")
            .select("*")
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        if res.data:
            return res.data[0]
        return None
    except Exception as e:
        print(f"[get_external_links] error: {e}")
        return None

def upsert_external_links(user_id: str, data: dict) -> bool:
    """Insert or update external links for a user."""
    try:
        existing = get_external_links(user_id)
        payload = {
            "linkedin_url": data.get("linkedin_url", ""),
            "github_url": data.get("github_url", ""),
            "portfolio_url": data.get("portfolio_url", ""),
            "other_links": data.get("other_links", []),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        if existing:
            res = (
                _db().table("external_links")
                .update(payload)
                .eq("id", existing["id"])
                .execute()
            )
        else:
            payload["user_id"] = user_id
            res = _db().table("external_links").insert(payload).execute()
        return bool(res.data)
    except Exception as e:
        print(f"[upsert_external_links] error: {e}")
        return False


# ── Benchmarks ────────────────────────────────────────────────────────────────

def save_benchmark(
    round_type: str,
    difficulty: str,
    overall_score: float,
    radar_scores: dict,
    grade: str,
    hire_recommendation: str,
    target_company: str = "",
    job_role: str = "",
) -> bool:
    """
    Insert one anonymised benchmark row.
    No user_id or session_id is stored — purely aggregate data.
    """
    try:
        payload = {
            "round_type":          round_type,
            "difficulty":          difficulty,
            "overall_score":       overall_score,
            "radar_scores":        radar_scores or {},
            "grade":               grade,
            "hire_recommendation": hire_recommendation,
            "created_at":          datetime.now(timezone.utc).isoformat(),
        }
        if target_company:
            payload["target_company"] = target_company
        if job_role:
            payload["job_role"] = job_role
        res = _db().table("benchmarks").insert(payload).execute()
        return bool(res.data)
    except Exception as e:
        print(f"[save_benchmark] error: {e}")
        return False


def get_benchmarks(
    round_type: str,
    difficulty: str,
    target_company: str = "",
    limit: int = 500,
) -> list:
    """
    Fetch benchmark rows for percentile computation.
    Returns list of {overall_score, radar_scores, grade}.
    """
    try:
        query = (
            _db().table("benchmarks")
            .select("overall_score, radar_scores, grade, hire_recommendation")
            .eq("round_type", round_type)
            .eq("difficulty", difficulty)
            .order("created_at", desc=True)
            .limit(limit)
        )
        if target_company:
            query = query.eq("target_company", target_company)
        res = query.execute()
        return res.data or []
    except Exception as e:
        print(f"[get_benchmarks] error: {e}")
        return []


# ── Study Resources ───────────────────────────────────────────────────────────

def get_study_resources(topics: list, round_type: str = "") -> list:
    """
    Fetch study resources matching given topics (case-insensitive partial match).
    Returns list of {topic, title, url, resource_type, estimated_hours}.
    """
    try:
        if not topics:
            return []
        query = (
            _db().table("study_resources")
            .select("topic, title, url, resource_type, estimated_hours, tags")
            .limit(50)
        )
        if round_type:
            query = query.eq("round_type", round_type)
        res = query.execute()
        rows = res.data or []
        # Client-side filter — match any row whose topic overlaps with requested topics
        topic_lower = [t.lower() for t in topics]
        return [
            r for r in rows
            if any(tl in (r.get("topic") or "").lower() for tl in topic_lower)
        ]
    except Exception as e:
        print(f"[get_study_resources] error: {e}")
        return []


def save_study_resources(resources: list) -> bool:
    """Bulk-insert study resource records (skips duplicates by url)."""
    try:
        if not resources:
            return True
        payload = [
            {
                "topic":           r.get("topic", ""),
                "round_type":      r.get("round_type", ""),
                "difficulty":      r.get("difficulty", ""),
                "resource_type":   r.get("resource_type", "article"),
                "title":           r.get("title", ""),
                "url":             r.get("url", ""),
                "estimated_hours": r.get("estimated_hours", 1.0),
                "tags":            r.get("tags", []),
            }
            for r in resources
        ]
        res = _db().table("study_resources").upsert(payload, on_conflict="url").execute()
        return bool(res.data)
    except Exception as e:
        print(f"[save_study_resources] error: {e}")
        return False


# ── Preparation Checklists ────────────────────────────────────────────────────

def save_checklist(user_id: str, session_id: str, items: list, expires_at: str = "") -> str:
    """
    Insert or replace preparation checklist for a user + session.
    Returns the checklist_id.
    """
    checklist_id = str(uuid.uuid4())
    try:
        payload = {
            "id":         checklist_id,
            "user_id":    user_id,
            "session_id": session_id,
            "items":      items,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        if expires_at:
            payload["expires_at"] = expires_at
        _db().table("preparation_checklists").insert(payload).execute()
        return checklist_id
    except Exception as e:
        print(f"[save_checklist] error: {e}")
        return checklist_id


def get_user_checklists(user_id: str, limit: int = 5, session_id: str = None) -> list:
    """
    Fetch the most recent preparation checklists for a user.
    Returns list of {id, session_id, items, created_at, expires_at}.
    Pass session_id to filter to a single session (used by ReportPage toggle).
    """
    try:
        q = (
            _db().table("preparation_checklists")
            .select("id, session_id, items, created_at, expires_at, updated_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
        )
        if session_id:
            q = q.eq("session_id", session_id)
        res = q.limit(limit).execute()
        return res.data or []
    except Exception as e:
        print(f"[get_user_checklists] error: {e}")
        return []


def update_checklist_item(checklist_id: str, item_id: str, checked: bool) -> bool:
    """Toggle the checked state of a single checklist item."""
    try:
        res = (
            _db().table("preparation_checklists")
            .select("items")
            .eq("id", checklist_id)
            .limit(1)
            .execute()
        )
        if not res.data:
            return False
        items = res.data[0].get("items") or []
        if isinstance(items, str):
            try:
                items = json.loads(items)
            except Exception:
                items = []
        for item in items:
            if isinstance(item, dict) and item.get("id") == item_id:
                item["checked"] = checked
                break
        update_res = (
            _db().table("preparation_checklists")
            .update({"items": items, "updated_at": datetime.now(timezone.utc).isoformat()})
            .eq("id", checklist_id)
            .execute()
        )
        return bool(update_res.data)
    except Exception as e:
        print(f"[update_checklist_item] error: {e}")


# ── Share Report ───────────────────────────────────────────────────────────────

def generate_share_token(session_id: str) -> Optional[dict]:
    """
    Generate (or reuse) a share token for a report.
    Returns { share_token, share_url_path } or None on error.
    """
    try:
        import secrets
        # Check if a share token already exists for this session
        existing = (
            _db().table("reports")
            .select("id, share_token, share_enabled")
            .eq("session_id", session_id)
            .maybe_single()
            .execute()
        )
        if not existing.data:
            return None

        token = existing.data.get("share_token")
        if not token:
            token = secrets.token_urlsafe(24)

        _db().table("reports").update({
            "share_token":   token,
            "share_enabled": True,
        }).eq("session_id", session_id).execute()

        return {"share_token": token, "report_id": existing.data["id"]}
    except Exception as e:
        print(f"[generate_share_token] error: {e}")
        return None


def get_report_by_share_token(token: str) -> Optional[dict]:
    """
    Fetch a report by its public share token.
    Returns the report row or None if not found / not enabled.
    """
    try:
        res = (
            _db().table("reports")
            .select("*")
            .eq("share_token", token)
            .eq("share_enabled", True)
            .maybe_single()
            .execute()
        )
        return res.data or None
    except Exception as e:
        print(f"[get_report_by_share_token] error: {e}")
        return None


def disable_share_token(session_id: str) -> bool:
    """Revoke the public share link for a report."""
    try:
        _db().table("reports").update({
            "share_enabled": False,
        }).eq("session_id", session_id).execute()
        return True
    except Exception as e:
        print(f"[disable_share_token] error: {e}")
        return False


# ── Audio Storage ──────────────────────────────────────────────────────────────

_AUDIO_BUCKET = "interview-audio"
_bucket_ready = False  # module-level guard so we only attempt creation once


def _ensure_audio_bucket() -> bool:
    """
    Create the interview-audio bucket if it doesn't exist yet.
    Returns True if the bucket is (now) available, False on any error.
    Called lazily before the first upload.
    """
    global _bucket_ready
    if _bucket_ready:
        return True
    try:
        existing = [b.name for b in _db().storage.list_buckets()]
        if _AUDIO_BUCKET not in existing:
            _db().storage.create_bucket(
                _AUDIO_BUCKET,
                options={"public": False, "file_size_limit": 10 * 1024 * 1024},  # 10 MB
            )
        _bucket_ready = True
        return True
    except Exception as e:
        print(f"[audio_storage] bucket ensure failed: {e}")
        return False


def upload_audio_clip(
    session_id: str,
    question_id: str,
    audio_bytes: bytes,
    content_type: str = "audio/webm",
) -> Optional[str]:
    """
    Upload a per-question audio clip to Supabase Storage.

    Storage path: interview-audio/{session_id}/{question_id}.webm
    Returns the storage path on success, None on failure.
    The path is stored in the transcript entry; signed URLs are generated
    on-demand via get_audio_signed_url().
    """
    if not audio_bytes:
        return None
    try:
        if not _ensure_audio_bucket():
            return None
        ext = ".ogg" if "ogg" in content_type else ".wav" if "wav" in content_type else ".webm"
        path = f"{session_id}/{question_id}{ext}"
        _db().storage.from_(_AUDIO_BUCKET).upload(
            path=path,
            file=audio_bytes,
            file_options={"content-type": content_type, "upsert": "true"},
        )
        return path
    except Exception as e:
        print(f"[upload_audio_clip] error: {e}")
        return None


def get_audio_signed_url(path: str, expires_in: int = 86400) -> Optional[str]:
    """
    Generate a time-limited signed URL for an audio clip.

    path:       storage path returned by upload_audio_clip()
    expires_in: seconds until expiry (default 24 h)
    Returns the URL string, or None if path is empty / Supabase errors.
    """
    if not path:
        return None
    try:
        result = _db().storage.from_(_AUDIO_BUCKET).create_signed_url(path, expires_in)
        # Supabase Python SDK ≥2.x returns an object with .signed_url
        url = getattr(result, "signed_url", None) or (result if isinstance(result, str) else None)
        if not url and isinstance(result, dict):
            url = result.get("signedURL") or result.get("signed_url")
        return url
    except Exception as e:
        print(f"[get_audio_signed_url] error: {e}")
        return None
