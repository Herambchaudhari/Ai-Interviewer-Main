-- Migration 018: HR Phase 2 — Red Flags Structured Schema (documentation only)
-- ─────────────────────────────────────────────────────────────────────────────
-- No DDL change required. behavioral_red_flags already exists as JSONB (migration 001).
--
-- From this migration onwards, behavioral_red_flags stores List[Dict] instead of List[str]:
--   [{ "flag": "<label>", "severity": "Critical|Moderate|Minor", "evidence": "<quote>" }]
--
-- Backward compatibility: _normalize_report_payload() in report.py coerces old
-- string arrays into the new dict format automatically on read. No data migration needed.
-- ─────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN reports.behavioral_red_flags IS
  'HR Phase 2: structured red flags [{flag, severity: Critical|Moderate|Minor, evidence}]. Old string-list format is auto-coerced on read.';
