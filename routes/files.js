const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

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
router.post('/:id/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const db = getDb();
  const roomId = req.params.id;

  const membership = db.prepare(
    'SELECT * FROM room_members WHERE room_id = ? AND user_id = ?'
  ).get(roomId, req.user.id);
  if (!membership) {
    fs.unlinkSync(req.file.path);
    return res.status(403).json({ error: 'Not a member of this room' });
  }

  const fileUrl = `/api/files/${req.file.filename}`;
  const isImage = req.file.mimetype.startsWith('image/');

  const result = db.prepare(
    `INSERT INTO messages (room_id, sender_id, text, type, file_url, file_name)
     VALUES (?, ?, ?, 'file', ?, ?)`
  ).run(roomId, req.user.id,
    isImage ? `📷 ${req.file.originalname}` : `📎 ${req.file.originalname}`,
    fileUrl,
    req.file.originalname
  );

  const message = db.prepare(`
    SELECT m.*, u.username as sender_username, u.display_name as sender_name, u.role as sender_role
    FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?
  `).get(result.lastInsertRowid);

  res.json({ message, file_url: fileUrl, file_name: req.file.originalname, mime: req.file.mimetype });
});

// GET /api/files/:filename — serve file with auth check
router.get('/:filename', (req, res) => {
  const filename = path.basename(req.params.filename); // prevent traversal
  const filePath = path.join(UPLOADS_DIR, filename);

  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.sendFile(filePath);
});

module.exports = router;
