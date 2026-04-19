"""
Backfill service — pre-generates and persists reports for completed sessions
that were never cached (i.e. completed before the report-caching fix).

Key design decisions:
- Reuses _generate_report_sse() directly: the generator already calls save_report()
  internally, so draining it to the "complete" event is all we need.
- An asyncio.Lock prevents concurrent backfill runs (e.g. two startup triggers).
- Sessions are processed one at a time with a configurable delay to avoid
  hammering the Groq API rate limit.
- Any single failure is logged and skipped; remaining sessions still process.
"""

import asyncio
import json
import logging
from typing import Optional

from services.db_service import get_sessions_pending_report, get_report

logger = logging.getLogger(__name__)

_backfill_lock = asyncio.Lock()
_is_running = False


async def _drain_sse_generator(gen) -> Optional[dict]:
    """
    Consume an async SSE generator until the 'complete' or 'error' event.
    Returns the report dict on success, None on error/timeout.
    """
    async for raw_sse in gen:
        if not isinstance(raw_sse, str):
            continue
        # SSE lines look like: "data: {...}\n\n"
        for line in raw_sse.split("\n"):
            line = line.strip()
            if not line.startswith("data: "):
                continue
            try:
                event = json.loads(line[6:])
            except Exception:
                continue
            stage = event.get("stage", "")
            if stage == "complete":
                return event.get("report")
            if stage == "error":
                logger.warning("[backfill] SSE error event: %s", event.get("error"))
                return None
    return None


async def backfill_single_session(session_id: str, user_id: str) -> bool:
    """
    Generate and persist the report for one session.
    Returns True on success, False on failure.
    Skips silently if a complete report already exists (idempotent).
    """
    # Late import to avoid circular dependency (report router imports db_service,
    # backfill_service also imports db_service — importing report router here
    # keeps the dependency one-directional at module load time).
    from routers.report import _generate_report_sse, _is_complete_report

    try:
        existing = get_report(session_id)
        if existing and _is_complete_report(existing):
            logger.info("[backfill] session %s already has a complete report — skipping", session_id)
            return True
    except Exception as e:
        logger.warning("[backfill] Could not check existing report for %s: %s", session_id, e)

    logger.info("[backfill] Generating report for session %s …", session_id)
    try:
        gen = _generate_report_sse(session_id, user_id)
        report = await asyncio.wait_for(_drain_sse_generator(gen), timeout=180)
        if report:
            logger.info("[backfill] ✓ Report saved for session %s", session_id)
            return True
        else:
            logger.warning("[backfill] ✗ No report produced for session %s", session_id)
            return False
    except asyncio.TimeoutError:
        logger.error("[backfill] Timeout generating report for session %s", session_id)
        return False
    except Exception as e:
        logger.error("[backfill] Exception for session %s: %s", session_id, e)
        return False


async def run_backfill_batch(
    user_id: Optional[str] = None,
    limit: int = 10,
    delay_seconds: float = 3.0,
) -> dict:
    """
    Find up to `limit` sessions without cached reports and generate them
    sequentially (one at a time, with `delay_seconds` between calls).

    Returns: { "processed": int, "failed": int, "skipped": int }
    """
    global _is_running

    if _backfill_lock.locked():
        logger.info("[backfill] Another backfill run is already in progress — skipping.")
        return {"processed": 0, "failed": 0, "skipped": 0, "status": "already_running"}

    async with _backfill_lock:
        _is_running = True
        processed = failed = skipped = 0
        try:
            pending = get_sessions_pending_report(user_id=user_id, limit=limit)
            logger.info("[backfill] Found %d session(s) pending report generation.", len(pending))

            for row in pending:
                sid = row.get("session_id") or row.get("id")
                uid = row.get("user_id")
                if not sid or not uid:
                    skipped += 1
                    continue

                success = await backfill_single_session(sid, uid)
                if success:
                    processed += 1
                else:
                    failed += 1

                if delay_seconds > 0 and row is not pending[-1]:
                    await asyncio.sleep(delay_seconds)

        except Exception as e:
            logger.error("[backfill] Batch error: %s", e)
        finally:
            _is_running = False

        logger.info(
            "[backfill] Batch done — processed=%d failed=%d skipped=%d",
            processed, failed, skipped,
        )
        return {"processed": processed, "failed": failed, "skipped": skipped, "status": "done"}


def is_backfill_running() -> bool:
    return _backfill_lock.locked()
