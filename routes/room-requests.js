const express = require('express');
const { z } = require('zod');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const requestSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(200).optional(),
  requested_members: z.array(z.number().int().positive()).optional(),
});

// POST /api/room-requests — user submits a room request
router.post('/', (req, res) => {
  const result = requestSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ error: result.error.errors[0].message });

  const { name, description, requested_members } = result.data;
  const db = getDb();
  const r = db.prepare(`
    INSERT INTO room_requests (requested_by, name, description, requested_members)
    VALUES (?, ?, ?, ?)
  `).run(req.user.id, name, description || null, JSON.stringify(requested_members || []));

  res.json({ id: r.lastInsertRowid, status: 'pending', name });
});

// GET /api/room-requests — user sees their own requests
router.get('/', (req, res) => {
  const db = getDb();
  const requests = db.prepare(`
    SELECT rr.*, u.username as reviewed_by_name
    FROM room_requests rr
    LEFT JOIN users u ON rr.reviewed_by = u.id
    WHERE rr.requested_by = ?
    ORDER BY rr.created_at DESC
  `).all(req.user.id);
  res.json({ requests });
});

module.exports = router;
