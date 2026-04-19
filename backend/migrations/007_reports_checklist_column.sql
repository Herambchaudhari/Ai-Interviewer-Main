-- Migration 007: Add checklist, study_schedule, and peer_comparison columns to reports table
-- These are rich JSONB fields generated during the 4-stage report pipeline that were
-- previously only stored inside the report_data blob.  Promoting them to first-class
-- columns lets get_report() read them reliably without depending on blob key ordering.

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS checklist      JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS study_schedule JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS peer_comparison JSONB DEFAULT NULL;
