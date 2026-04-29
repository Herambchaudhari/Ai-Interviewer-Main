"""
Read-only audit: scan reports / sessions / context-hub tables for dirty data
that would let users see other users' reports, or that breaks user-scoped queries.

Reports per scan:
  1. reports orphaned (no parent session, or session.user_id is null)
  2. reports table columns (does reports.user_id exist? — informs CLAUDE.md claim)
  3. sessions whose user_id has no matching auth user (orphan sessions)
  4. duplicate cached reports per session_id (should be 0 after migration 008)
  5. context-hub tables with null user_id  (notes, applications, resumes, checklists)
  6. counts overall

Run with the backend venv:
    python backend/scripts/audit_user_scoping.py
"""
import os
import sys
from pathlib import Path

# Load .env from backend/
BACKEND = Path(__file__).resolve().parents[1]
ENV_FILE = BACKEND / ".env"
if ENV_FILE.exists():
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

try:
    from supabase import create_client
except ImportError:
    print("ERROR: supabase-py not installed. Run: pip install supabase")
    sys.exit(1)

URL = os.getenv("SUPABASE_URL")
KEY = os.getenv("SUPABASE_KEY")
if not URL or not KEY:
    print("ERROR: SUPABASE_URL / SUPABASE_KEY missing from backend/.env")
    sys.exit(1)

db = create_client(URL, KEY)


def header(s):
    print(f"\n{'-' * 70}\n {s}\n{'-' * 70}")


def safe(query_fn, label):
    """Run a query, swallow errors, return data or []."""
    try:
        return query_fn()
    except Exception as e:
        print(f"  [{label}] error: {type(e).__name__}: {e}")
        return None


# ── Counts ────────────────────────────────────────────────────────────────────
header("OVERALL COUNTS")
for tbl in ("sessions", "reports", "profiles", "resumes", "session_notes",
            "preparation_checklists", "applications"):
    res = safe(lambda t=tbl: db.table(t).select("id", count="exact").limit(1).execute(), tbl)
    if res is not None:
        print(f"  {tbl:<25} {getattr(res, 'count', '?')}")


# ── Probe: does reports.user_id exist? ────────────────────────────────────────
header("SCHEMA PROBE: reports.user_id column")
res = safe(lambda: db.table("reports").select("user_id").limit(1).execute(), "reports.user_id")
if res is None:
    print("  reports.user_id column likely DOES NOT EXIST (query failed)")
else:
    print("  reports.user_id column EXISTS")
    # Count rows where it's null
    null_res = safe(
        lambda: db.table("reports").select("id", count="exact").is_("user_id", "null").limit(1).execute(),
        "reports.user_id null count",
    )
    if null_res is not None:
        print(f"  rows where reports.user_id IS NULL: {getattr(null_res, 'count', '?')}")


# ── Scan 1: orphaned reports (no matching session row) ────────────────────────
header("SCAN 1: orphaned reports (report.session_id has no row in sessions)")
reports = safe(lambda: db.table("reports").select("id, session_id, created_at").limit(2000).execute(), "reports list")
if reports and reports.data:
    sess_ids = list({r["session_id"] for r in reports.data if r.get("session_id")})
    found = set()
    # in_() chunks of 100 to be safe
    for i in range(0, len(sess_ids), 100):
        chunk = sess_ids[i : i + 100]
        s = safe(lambda c=chunk: db.table("sessions").select("id").in_("id", c).execute(), "sessions in")
        if s and s.data:
            found.update(r["id"] for r in s.data)
    orphans = [r for r in reports.data if r.get("session_id") not in found]
    print(f"  total reports scanned: {len(reports.data)}")
    print(f"  ORPHANED reports (no session row): {len(orphans)}")
    for r in orphans[:10]:
        print(f"    - report {r['id']} session_id={r['session_id']} created_at={r.get('created_at')}")
    if len(orphans) > 10:
        print(f"    ... +{len(orphans) - 10} more")
else:
    print("  could not list reports")


# ── Scan 2: sessions with NULL user_id ────────────────────────────────────────
header("SCAN 2: sessions with NULL user_id (would belong to no one)")
res = safe(lambda: db.table("sessions").select("id, status, created_at", count="exact").is_("user_id", "null").limit(50).execute(), "sessions null user")
if res is not None:
    cnt = getattr(res, "count", len(res.data) if res.data else 0)
    print(f"  count: {cnt}")
    for s in (res.data or [])[:10]:
        print(f"    - session {s['id']} status={s.get('status')} created_at={s.get('created_at')}")


# ── Scan 3: reports whose parent session has NULL user_id ─────────────────────
header("SCAN 3: reports whose parent session has NULL user_id")
if reports and reports.data:
    null_sess = safe(
        lambda: db.table("sessions").select("id").is_("user_id", "null").limit(2000).execute(),
        "null-user sessions",
    )
    if null_sess and null_sess.data:
        bad_ids = {s["id"] for s in null_sess.data}
        bad_reports = [r for r in reports.data if r.get("session_id") in bad_ids]
        print(f"  reports linked to null-user sessions: {len(bad_reports)}")
        for r in bad_reports[:10]:
            print(f"    - report {r['id']} session_id={r['session_id']}")
    else:
        print("  none (no sessions with null user_id)")


# ── Scan 4: duplicate reports per session ─────────────────────────────────────
header("SCAN 4: duplicate cached reports per session_id (should be 0)")
if reports and reports.data:
    from collections import Counter
    c = Counter(r["session_id"] for r in reports.data if r.get("session_id"))
    dupes = {sid: n for sid, n in c.items() if n > 1}
    print(f"  sessions with >1 cached report: {len(dupes)}")
    for sid, n in list(dupes.items())[:10]:
        print(f"    - session {sid}: {n} reports")


# ── Scan 5: context-hub tables with NULL user_id ──────────────────────────────
header("SCAN 5: context-hub tables with NULL user_id")
for tbl in ("session_notes", "applications", "resumes", "preparation_checklists"):
    res = safe(
        lambda t=tbl: db.table(t).select("id", count="exact").is_("user_id", "null").limit(1).execute(),
        f"{tbl} null user",
    )
    if res is not None:
        cnt = getattr(res, "count", "?")
        marker = "[!] " if (isinstance(cnt, int) and cnt > 0) else "[ok]"
        print(f"  {marker}{tbl:<25} null user_id rows: {cnt}")


# ── Scan 6: orphan share-enabled rows (still sharing after revoke?) ───────────
header("SCAN 6: share-enabled reports — sample to spot-check")
res = safe(
    lambda: db.table("reports").select("id, session_id, share_enabled, share_token").eq("share_enabled", True).limit(20).execute(),
    "share enabled list",
)
if res is not None:
    rows = res.data or []
    print(f"  reports with share_enabled=true: {len(rows)} (sample)")
    for r in rows[:5]:
        print(f"    - {r['id']} session={r['session_id']} token={(r.get('share_token') or '')[:8]}…")


print(f"\n{'-' * 70}\n DONE — all read-only. No rows modified.\n{'-' * 70}")
