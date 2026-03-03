const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { getDb, getDbDriver, getPgPool } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { checkPermission } = require('../middleware/permissions');
const { assertCanSendFiles } = require('../middleware/policy');

const router = express.Router();

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const unique = crypto.randomBytes(16).toString('hex');
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error(`Tip de fișier nepermis: ${file.mimetype}`));
    }
  },
});

// POST /api/rooms/:id/upload
router.post('/:id/upload', authMiddleware, checkPermission('can_send_files'), upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const roomId = req.params.id;
  const driver = getDbDriver();

  const send = async () => {
    const policy = await assertCanSendFiles({ roomId, user: req.user });
    if (!policy.ok) {
      try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(policy.status).json({ error: policy.error });
    }

    const fileUrl = `/api/files/${req.file.filename}`;
    const isImage = req.file.mimetype.startsWith('image/');
    const preview = isImage ? `📷 ${req.file.originalname}` : `📎 ${req.file.originalname}`;

    if (driver === 'postgres') {
      const pool = getPgPool();
      const roomIdNum = Number(roomId);
      const userId = Number(req.user.id);

      const inserted = (await pool.query(
        `
        INSERT INTO messages (room_id, sender_id, text, type, file_url, file_name)
        VALUES ($1, $2, $3, 'file', $4, $5)
        RETURNING id
        `,
        [roomIdNum, userId, preview, fileUrl, req.file.originalname]
      )).rows[0];
      const msgId = Number(inserted.id);

      const message = (await pool.query(
        `
        SELECT
          m.id,
          m.room_id,
          m.sender_id,
          m.text,
          m.type,
          m.file_url,
          m.file_name,
          m.reply_to,
          CASE WHEN m.is_edited THEN 1 ELSE 0 END as is_edited,
          m.recipient_id,
          m.created_at,
          u.username as sender_username,
          u.username as sender_name,
          u.role as sender_role,
          COALESCE(rmc.color_index, u.chat_color_index) as sender_color_index
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        LEFT JOIN room_members rmc ON rmc.room_id = m.room_id AND rmc.user_id = m.sender_id
        WHERE m.id = $1
        `,
        [msgId]
      )).rows[0];

      // Broadcast file message to all room members via Socket.IO
      const io = req.app.get('io');
      io.to(`room:${roomId}`).emit('message', message);

      return res.json({ message, file_url: fileUrl, file_name: req.file.originalname, mime: req.file.mimetype });
    }

    const db = getDb();
    const result = db.prepare(
      `INSERT INTO messages (room_id, sender_id, text, type, file_url, file_name)
       VALUES (?, ?, ?, 'file', ?, ?)`
    ).run(roomId, req.user.id, preview, fileUrl, req.file.originalname);

    const message = db.prepare(`
      SELECT m.*, u.username as sender_username, u.username as sender_name, u.role as sender_role,
             COALESCE(rmc.color_index, u.chat_color_index) as sender_color_index
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      LEFT JOIN room_members rmc ON rmc.room_id = m.room_id AND rmc.user_id = m.sender_id
      WHERE m.id = ?
    `).get(result.lastInsertRowid);

    // Broadcast file message to all room members via Socket.IO
    const io = req.app.get('io');
    io.to(`room:${roomId}`).emit('message', message);

    res.json({ message, file_url: fileUrl, file_name: req.file.originalname, mime: req.file.mimetype });
  };

  Promise.resolve(send()).catch((err) => {
    try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: err.message || 'Upload failed' });
  });
});

// GET /api/files/:filename — serve file with auth check
router.get('/:filename', (req, res) => {
  const filename = path.basename(req.params.filename); // prevent traversal
  const filePath = path.join(UPLOADS_DIR, filename);

  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.sendFile(filePath);
});

module.exports = router;
