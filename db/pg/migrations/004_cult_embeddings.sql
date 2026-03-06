-- 004_cult_embeddings.sql

BEGIN;

-- Add embeddings for semantic search (pgvector)
ALTER TABLE cult_document_chunks
  ADD COLUMN IF NOT EXISTS embedding vector(384);

-- IVF index for cosine distance (requires ANALYZE and reasonable lists)
CREATE INDEX IF NOT EXISTS idx_cult_chunks_embedding_ivfflat
  ON cult_document_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

COMMIT;
