-- 002_cult_library.sql

BEGIN;

CREATE TABLE IF NOT EXISTS cult_documents (
  id           bigserial PRIMARY KEY,
  room_id      bigint NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  uploaded_by  bigint NOT NULL REFERENCES users(id),
  title        text,
  original_name text,
  storage_key  text NOT NULL,
  mime         text,
  size_bytes   bigint,
  status       text NOT NULL DEFAULT 'uploaded' CHECK(status IN ('uploaded','queued','processing','processed','failed')),
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  queued_at    timestamptz,
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_cult_documents_room ON cult_documents(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cult_documents_status ON cult_documents(status);

CREATE TABLE IF NOT EXISTS cult_document_jobs (
  id           bigserial PRIMARY KEY,
  doc_id       bigint NOT NULL REFERENCES cult_documents(id) ON DELETE CASCADE,
  job_type     text NOT NULL DEFAULT 'ingest' CHECK(job_type IN ('ingest')),
  status       text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','done','failed')),
  attempts     integer NOT NULL DEFAULT 0,
  locked_at    timestamptz,
  locked_by    text,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(doc_id, job_type, status)
);

CREATE INDEX IF NOT EXISTS idx_cult_jobs_status ON cult_document_jobs(status, created_at);

COMMIT;
