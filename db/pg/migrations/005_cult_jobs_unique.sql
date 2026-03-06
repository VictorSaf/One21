-- 005_cult_jobs_unique.sql

BEGIN;

ALTER TABLE cult_document_jobs
  DROP CONSTRAINT IF EXISTS cult_document_jobs_doc_id_job_type_status_key;

ALTER TABLE cult_document_jobs
  ADD CONSTRAINT cult_document_jobs_doc_id_job_type_key UNIQUE (doc_id, job_type);

COMMIT;
