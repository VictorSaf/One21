const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const { getDb, getDbDriver, getPgPool } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { assertCanSendFiles } = require('../middleware/policy');

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

function chunkText(text) {
  const cleaned = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];

  const maxLen = 900;
  const overlap = 120;
  const chunks = [];
  let i = 0;
  while (i < cleaned.length) {
    const end = Math.min(cleaned.length, i + maxLen);
    const slice = cleaned.slice(i, end);
    chunks.push(slice.trim());
    if (end >= cleaned.length) break;
    i = Math.max(0, end - overlap);
  }
  return chunks.filter(Boolean);
}

function resolveDocPath(storageKey) {
  return path.join(CULT_UPLOADS_DIR, path.basename(storageKey));
}

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
        await client.query(
          `
          INSERT INTO cult_document_jobs (doc_id, job_type, status)
          VALUES ($1, 'ingest', 'queued')
          ON CONFLICT DO NOTHING
          `,
          [Number(docId)]
        );

        // Minimal ingest for text/plain only
        if (doc.mime === 'text/plain' || (doc.storage_key || '').toLowerCase().endsWith('.txt')) {
          await client.query("UPDATE cult_documents SET status = 'processing' WHERE id = $1", [Number(docId)]);

          const p = resolveDocPath(doc.storage_key);
          const raw = fs.readFileSync(p, 'utf8');
          const chunks = chunkText(raw);

          await client.query('DELETE FROM cult_document_chunks WHERE doc_id = $1', [Number(docId)]);
          for (let idx = 0; idx < chunks.length; idx++) {
            await client.query(
              `
              INSERT INTO cult_document_chunks (doc_id, room_id, chunk_index, content)
              VALUES ($1,$2,$3,$4)
              ON CONFLICT (doc_id, chunk_index) DO UPDATE SET content = EXCLUDED.content
              `,
              [Number(docId), Number(doc.room_id), idx, chunks[idx]]
            );
          }

          await client.query(
            "UPDATE cult_documents SET status = 'processed', processed_at = now(), error = NULL WHERE id = $1",
            [Number(docId)]
          );
          await client.query(
            "UPDATE cult_document_jobs SET status = 'done', updated_at = now() WHERE doc_id = $1 AND job_type = 'ingest'",
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
      db.prepare("UPDATE cult_documents SET status = 'queued', queued_at = datetime('now'), error = NULL WHERE id = ?")
        .run(docId);
      db.prepare(
        "INSERT INTO cult_document_jobs (doc_id, job_type, status) VALUES (?, 'ingest', 'queued')"
      ).run(docId);

      if (doc.mime === 'text/plain' || String(doc.storage_key || '').toLowerCase().endsWith('.txt')) {
        db.prepare("UPDATE cult_documents SET status = 'processing' WHERE id = ?").run(docId);
        const p = resolveDocPath(doc.storage_key);
        const raw = fs.readFileSync(p, 'utf8');
        const chunks = chunkText(raw);

        db.prepare('DELETE FROM cult_document_chunks WHERE doc_id = ?').run(docId);
        const ins = db.prepare(
          'INSERT OR REPLACE INTO cult_document_chunks (doc_id, room_id, chunk_index, content) VALUES (?, ?, ?, ?)'
        );
        for (let idx = 0; idx < chunks.length; idx++) {
          ins.run(docId, doc.room_id, idx, chunks[idx]);
        }
        db.prepare("UPDATE cult_documents SET status = 'processed', processed_at = datetime('now'), error = NULL WHERE id = ?")
          .run(docId);
        db.prepare("UPDATE cult_document_jobs SET status = 'done', updated_at = datetime('now') WHERE doc_id = ? AND job_type = 'ingest'")
          .run(docId);
      }
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

module.exports = router;
