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

      await pool.query(
        "UPDATE cult_documents SET status = 'queued', queued_at = now(), error = NULL WHERE id = $1",
        [Number(docId)]
      );
      await pool.query(
        `
        INSERT INTO cult_document_jobs (doc_id, job_type, status)
        VALUES ($1, 'ingest', 'queued')
        ON CONFLICT DO NOTHING
        `,
        [Number(docId)]
      );

      const updated = (await pool.query('SELECT * FROM cult_documents WHERE id = $1', [Number(docId)])).rows[0];
      return res.json({ document: { ...updated, id: String(updated.id), room_id: String(updated.room_id) } });
    }

    const db = getDb();
    const doc = db.prepare('SELECT * FROM cult_documents WHERE id = ?').get(docId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const policy = await assertCanSendFiles({ roomId: String(doc.room_id), user: req.user });
    if (!policy.ok) return res.status(policy.status).json({ error: policy.error });

    db.prepare("UPDATE cult_documents SET status = 'queued', queued_at = datetime('now'), error = NULL WHERE id = ?")
      .run(docId);
    db.prepare(
      "INSERT INTO cult_document_jobs (doc_id, job_type, status) VALUES (?, 'ingest', 'queued')"
    ).run(docId);

    const updated = db.prepare('SELECT * FROM cult_documents WHERE id = ?').get(docId);
    return res.json({ document: updated });
  };

  Promise.resolve(send()).catch((err) => {
    res.status(500).json({ error: err.message || 'Failed to enqueue' });
  });
});

module.exports = router;
