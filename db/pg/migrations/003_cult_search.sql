-- 003_cult_search.sql

BEGIN;

-- Store extracted chunks of text for each document
CREATE TABLE IF NOT EXISTS cult_document_chunks (
  id           bigserial PRIMARY KEY,
  doc_id       bigint NOT NULL REFERENCES cult_documents(id) ON DELETE CASCADE,
  room_id      bigint NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  chunk_index  integer NOT NULL,
  content      text NOT NULL,
  content_tsv  tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(doc_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_cult_chunks_room ON cult_document_chunks(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cult_chunks_tsv ON cult_document_chunks USING GIN (content_tsv);

COMMIT;
