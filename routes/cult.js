const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const { getDb, getDbDriver, getPgPool } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { assertCanSendFiles } = require('../middleware/policy');
const { embedText } = require('../lib/cult-ingest');

const router = express.Router();
router.use(authMiddleware);

const CULT_UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'cult');
fs.mkdirSync(CULT_UPLOADS_DIR, { recursive: true });

const MAX_SIZE = 25 * 1024 * 1024; // 25MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, CULT_UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = crypto.randomBytes(16).toString('hex');
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
});

// POST /api/cult/rooms/:roomId/documents — upload a cult library document
router.post('/rooms/:roomId/documents', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const roomId = req.params.roomId;
  const driver = getDbDriver();

  const send = async () => {
    const policy = await assertCanSendFiles({ roomId, user: req.user });
    if (!policy.ok) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(policy.status).json({ error: policy.error });
    }

    const title = req.body && typeof req.body.title === 'string' ? req.body.title.trim() : null;
    const storageKey = path.basename(req.file.filename);

    if (driver === 'postgres') {
      const pool = getPgPool();
      const inserted = (await pool.query(
        `
        INSERT INTO cult_documents (room_id, uploaded_by, title, original_name, storage_key, mime, size_bytes)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING *
        `,
        [Number(roomId), Number(req.user.id), title, req.file.originalname, storageKey, req.file.mimetype, Number(req.file.size)]
      )).rows[0];

      return res.json({ document: { ...inserted, id: String(inserted.id), room_id: String(inserted.room_id) } });
    }

    const db = getDb();
    const r = db.prepare(
      `
      INSERT INTO cult_documents (room_id, uploaded_by, title, original_name, storage_key, mime, size_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    ).run(roomId, req.user.id, title, req.file.originalname, storageKey, req.file.mimetype, req.file.size);

    const doc = db.prepare('SELECT * FROM cult_documents WHERE id = ?').get(r.lastInsertRowid);
    return res.json({ document: doc });
  };

  Promise.resolve(send()).catch((err) => {
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: err.message || 'Upload failed' });
  });
});

// GET /api/cult/rooms/:roomId/documents — list documents in cult room
router.get('/rooms/:roomId/documents', (req, res) => {
  const roomId = req.params.roomId;
  const driver = getDbDriver();

  const send = async () => {
    const policy = await assertCanSendFiles({ roomId, user: req.user });
    if (!policy.ok) {
      return res.status(policy.status).json({ error: policy.error });
    }

    if (driver === 'postgres') {
      const pool = getPgPool();
      const rows = (await pool.query(
        `
        SELECT *
        FROM cult_documents
        WHERE room_id = $1
        ORDER BY created_at DESC
        LIMIT 200
        `,
        [Number(roomId)]
      )).rows;
      return res.json({ documents: rows.map((d) => ({ ...d, id: String(d.id), room_id: String(d.room_id) })) });
    }

    const db = getDb();
    const docs = db.prepare(
      `
      SELECT *
      FROM cult_documents
      WHERE room_id = ?
      ORDER BY created_at DESC
      LIMIT 200
      `
    ).all(roomId);
    return res.json({ documents: docs });
  };

  Promise.resolve(send()).catch((err) => {
    res.status(500).json({ error: err.message || 'Failed to list documents' });
  });
});

// POST /api/cult/documents/:docId/enqueue — enqueue ingest job (stub)
router.post('/documents/:docId/enqueue', (req, res) => {
  const docId = req.params.docId;
  const driver = getDbDriver();

  const send = async () => {
    if (driver === 'postgres') {
      const pool = getPgPool();
      const doc = (await pool.query('SELECT * FROM cult_documents WHERE id = $1', [Number(docId)])).rows[0];
      if (!doc) return res.status(404).json({ error: 'Document not found' });

      const policy = await assertCanSendFiles({ roomId: String(doc.room_id), user: req.user });
      if (!policy.ok) return res.status(policy.status).json({ error: policy.error });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        await client.query(
          "UPDATE cult_documents SET status = 'queued', queued_at = now(), error = NULL WHERE id = $1",
          [Number(docId)]
        );

        // Ensure a single job row per (doc_id, job_type)
        const existingJob = (await client.query(
          "SELECT id FROM cult_document_jobs WHERE doc_id = $1 AND job_type = 'ingest' ORDER BY id DESC LIMIT 1 FOR UPDATE",
          [Number(docId)]
        )).rows[0];
        if (existingJob) {
          await client.query(
            "UPDATE cult_document_jobs SET status = 'queued', updated_at = now(), last_error = NULL, locked_at = NULL, locked_by = NULL WHERE id = $1",
            [Number(existingJob.id)]
          );
        } else {
          await client.query(
            "INSERT INTO cult_document_jobs (doc_id, job_type, status) VALUES ($1, 'ingest', 'queued') ON CONFLICT (doc_id, job_type) DO UPDATE SET status = 'queued', updated_at = now(), last_error = NULL, locked_at = NULL, locked_by = NULL",
            [Number(docId)]
          );
        }

        await client.query('COMMIT');
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        try {
          await pool.query(
            "UPDATE cult_documents SET status = 'failed', error = $2 WHERE id = $1",
            [Number(docId), err.message]
          );
        } catch {}
        try {
          await pool.query(
            "UPDATE cult_document_jobs SET status = 'failed', updated_at = now(), last_error = $2 WHERE doc_id = $1 AND job_type = 'ingest'",
            [Number(docId), err.message]
          );
        } catch {}
        throw err;
      } finally {
        client.release();
      }

      const updated = (await pool.query('SELECT * FROM cult_documents WHERE id = $1', [Number(docId)])).rows[0];
      return res.json({ document: { ...updated, id: String(updated.id), room_id: String(updated.room_id) } });
    }

    const db = getDb();
    const doc = db.prepare('SELECT * FROM cult_documents WHERE id = ?').get(docId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const policy = await assertCanSendFiles({ roomId: String(doc.room_id), user: req.user });
    if (!policy.ok) return res.status(policy.status).json({ error: policy.error });

    db.transaction(() => {
      // Ensure a single job row per (doc_id, job_type)
      const existing = db.prepare(
        "SELECT id FROM cult_document_jobs WHERE doc_id = ? AND job_type = 'ingest' ORDER BY id DESC LIMIT 1"
      ).get(docId);
      if (existing) {
        db.prepare("UPDATE cult_document_jobs SET status = 'queued', updated_at = datetime('now'), last_error = NULL, locked_at = NULL, locked_by = NULL WHERE id = ?")
          .run(existing.id);
      } else {
        db.prepare(
          "INSERT INTO cult_document_jobs (doc_id, job_type, status) VALUES (?, 'ingest', 'queued')"
        ).run(docId);
      }

      db.prepare("UPDATE cult_documents SET status = 'queued', queued_at = datetime('now'), error = NULL WHERE id = ?")
        .run(docId);
    })();

    const updated = db.prepare('SELECT * FROM cult_documents WHERE id = ?').get(docId);
    return res.json({ document: updated });
  };

  Promise.resolve(send()).catch((err) => {
    res.status(500).json({ error: err.message || 'Failed to enqueue' });
  });
});

// GET /api/cult/rooms/:roomId/search?q=... — FTS search across processed chunks
router.get('/rooms/:roomId/search', (req, res) => {
  const roomId = req.params.roomId;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const driver = getDbDriver();

  if (!q || q.length < 2) return res.status(400).json({ error: 'q must be at least 2 characters' });

  const send = async () => {
    const policy = await assertCanSendFiles({ roomId, user: req.user });
    if (!policy.ok) return res.status(policy.status).json({ error: policy.error });

    if (driver === 'postgres') {
      const pool = getPgPool();
      const rows = (await pool.query(
        `
        SELECT
          c.doc_id,
          c.chunk_index,
          left(c.content, 280) as snippet,
          ts_rank(c.content_tsv, plainto_tsquery('simple', $2)) as rank
        FROM cult_document_chunks c
        WHERE c.room_id = $1
          AND c.content_tsv @@ plainto_tsquery('simple', $2)
        ORDER BY rank DESC, c.doc_id DESC, c.chunk_index ASC
        LIMIT 20
        `,
        [Number(roomId), q]
      )).rows;
      return res.json({ results: rows.map((r) => ({ ...r, doc_id: String(r.doc_id) })) });
    }

    const db = getDb();
    const rows = db.prepare(
      `
      SELECT doc_id, chunk_index, snippet(cult_document_chunks_fts, 0, '[', ']', '…', 16) as snippet
      FROM cult_document_chunks_fts
      WHERE cult_document_chunks_fts MATCH ?
        AND room_id = ?
      LIMIT 20
      `
    ).all(q.replace(/[^a-zA-Z0-9_\s]/g, ' '), roomId);
    return res.json({ results: rows });
  };

  Promise.resolve(send()).catch((err) => {
    res.status(500).json({ error: err.message || 'Search failed' });
  });
});

// GET /api/cult/rooms/:roomId/semantic?q=... — pgvector semantic search (Postgres only)
router.get('/rooms/:roomId/semantic', (req, res) => {
  const roomId = req.params.roomId;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const driver = getDbDriver();

  if (!q || q.length < 2) return res.status(400).json({ error: 'q must be at least 2 characters' });
  if (driver !== 'postgres') return res.status(501).json({ error: 'Semantic search requires Postgres + pgvector' });

  const send = async () => {
    const policy = await assertCanSendFiles({ roomId, user: req.user });
    if (!policy.ok) return res.status(policy.status).json({ error: policy.error });

    const pool = getPgPool();
    const queryEmbedding = await embedText(q);
    if (!queryEmbedding) return res.status(500).json({ error: 'Failed to compute embedding' });

    // ivfflat index needs probes for better recall
    await pool.query('SET ivfflat.probes = 10');

    const rows = (await pool.query(
      `
      SELECT
        doc_id,
        chunk_index,
        left(content, 280) as snippet,
        (embedding <=> $2::vector) as distance
      FROM cult_document_chunks
      WHERE room_id = $1
        AND embedding IS NOT NULL
      ORDER BY embedding <=> $2::vector ASC
      LIMIT 20
      `,
      [Number(roomId), queryEmbedding]
    )).rows;

    return res.json({ results: rows.map((r) => ({ ...r, doc_id: String(r.doc_id) })) });
  };

  Promise.resolve(send()).catch((err) => {
    res.status(500).json({ error: err.message || 'Semantic search failed' });
  });
});

module.exports = router;
