-- 006_cult_jobs_backoff.sql

BEGIN;

ALTER TABLE cult_document_jobs
  ADD COLUMN IF NOT EXISTS next_run_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_cult_jobs_next_run
  ON cult_document_jobs(status, next_run_at, created_at);

COMMIT;
