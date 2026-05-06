-- 024: HR Q&A Enrichment — adds question_text + answer_summary to star_story_matrix per-entry.
-- No structural ALTER needed: star_story_matrix is already JSONB on reports.
-- Old rows without these keys are back-filled by _normalize_report_payload() with "" defaults.
COMMENT ON COLUMN reports.star_story_matrix IS
  'HR: per-question STAR analysis. Entry shape: question_id, question_text, answer_summary, competency_category, situation_present, task_present, action_present, result_present, star_score, star_completeness_pct, missing_element, specificity_level, best_verbatim_quote.';
