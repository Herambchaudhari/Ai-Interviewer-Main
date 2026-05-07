-- 026: HR Seniority Calibration — behavioral-evidence-based level verdict.
ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS seniority_calibration JSONB DEFAULT NULL;

COMMENT ON COLUMN reports.seniority_calibration IS
  'HR Enhancement: {level: Junior|Mid-Level|Senior|Staff/Principal, rationale, evidence_signals[], confidence: High|Medium|Low}.';
