-- 025: HR Explicit Red Flags — consolidated severity-ranked top-level block.
-- Distinct from behavioral_red_flags (which keeps existing renders); this new column
-- drives the dedicated ExplicitRedFlagsBlock component near the top of the HR report.
ALTER TABLE reports
    ADD COLUMN IF NOT EXISTS explicit_red_flags JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN reports.explicit_red_flags IS
  'HR Enhancement: [{type, severity, evidence_quote, signal_meaning, question_id}]. type: Deflection|Vague Ending|Hypothetical-as-Real|Inconsistent Story|Defensive Language|Blame Shifting|Other. severity: High|Medium|Low.';
