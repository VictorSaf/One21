const express = require('express');
const { z } = require('zod');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');
const { getPermission } = require('../middleware/permissions');

const router = express.Router();
router.use(authMiddleware);

const sendSchema = z.object({
  text: z.string().min(1).max(4000),
  type: z.enum(['text', 'file', 'system']).optional(),
  reply_to: z.number().int().positive().optional(),
});

const editSchema = z.object({
  text: z.string().min(1).max(4000),
});

// GET /api/rooms/:id/messages?before=ID&limit=50
router.get('/:id/messages', (req, res) => {
  const db = getDb();
  const roomId = req.params.id;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const before = req.query.before ? parseInt(req.query.before) : null;

  const membership = db.prepare(
    'SELECT * FROM room_members WHERE room_id = ? AND user_id = ?'
  ).get(roomId, req.user.id);
  if (!membership) return res.status(403).json({ error: 'Not a member of this room' });

  const query = before
    ? `SELECT m.*, u.username as sender_username, u.display_name as sender_name, u.role as sender_role
       FROM messages m JOIN users u ON m.sender_id = u.id
       WHERE m.room_id = ? AND m.id < ?
       ORDER BY m.created_at DESC LIMIT ?`
    : `SELECT m.*, u.username as sender_username, u.display_name as sender_name, u.role as sender_role
       FROM messages m JOIN users u ON m.sender_id = u.id
       WHERE m.room_id = ?
       ORDER BY m.created_at DESC LIMIT ?`;

  const args = before ? [roomId, before, limit] : [roomId, limit];
  const messages = db.prepare(query).all(...args).reverse();

  res.json({ messages, has_more: messages.length === limit });
});

// POST /api/rooms/:id/messages
router.post('/:id/messages', (req, res) => {
  const result = sendSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ error: result.error.errors[0].message });

  const db = getDb();
  const roomId = req.params.id;
  const { text, type, reply_to } = result.data;

  const membership = db.prepare(
    'SELECT * FROM room_members WHERE room_id = ? AND user_id = ?'
  ).get(roomId, req.user.id);
  if (!membership) return res.status(403).json({ error: 'Not a member of this room' });

  // Check max_messages_per_day
  if (req.user.role !== 'admin') {
    const maxPerDay = getPermission(req.user.id, 'max_messages_per_day');
    if (maxPerDay !== null) {
      const todayCount = db.prepare(
        "SELECT COUNT(*) as n FROM messages WHERE sender_id = ? AND created_at >= date('now')"
      ).get(req.user.id).n;
      if (todayCount >= maxPerDay) {
        return res.status(429).json({ error: `Daily message limit of ${maxPerDay} reached.` });
      }
    }
  }

  // Check allowed_agents — if room has agent members, user must have access
  if (req.user.role !== 'admin') {
    const agentMembers = db.prepare(
      "SELECT u.id FROM room_members rm JOIN users u ON rm.user_id = u.id WHERE rm.room_id = ? AND u.role = 'agent'"
    ).all(roomId);
    if (agentMembers.length > 0) {
      const allowedAgents = getPermission(req.user.id, 'allowed_agents') || [];
      const hasAccess = agentMembers.some(m => allowedAgents.includes(m.id));
      if (!hasAccess) {
        return res.status(403).json({ error: 'You do not have access to AI agents in this room.' });
      }
    }
  }

  const r = db.prepare(
    'INSERT INTO messages (room_id, sender_id, text, type, reply_to) VALUES (?, ?, ?, ?, ?)'
  ).run(roomId, req.user.id, text, type || 'text', reply_to || null);

  const message = db.prepare(`
    SELECT m.*, u.username as sender_username, u.display_name as sender_name, u.role as sender_role
    FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?
  `).get(r.lastInsertRowid);

  res.json({ message });
});

// PUT /api/messages/:id — edit own message
router.put('/messages/:id', (req, res) => {
  const result = editSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ error: result.error.errors[0].message });

  const db = getDb();
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  if (msg.sender_id !== req.user.id) return res.status(403).json({ error: 'Can only edit your own messages' });

  db.prepare("UPDATE messages SET text = ?, is_edited = 1 WHERE id = ?")
    .run(result.data.text, msg.id);

  const updated = db.prepare(`
    SELECT m.*, u.username as sender_username, u.display_name as sender_name, u.role as sender_role
    FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?
  `).get(msg.id);

  res.json({ message: updated });
});

// DELETE /api/messages/:id — delete own message or admin
router.delete('/messages/:id', (req, res) => {
  const db = getDb();
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });

  const isOwner = msg.sender_id === req.user.id;
  const isAdmin = req.user.role === 'admin';
  if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Not allowed' });

  db.prepare('DELETE FROM message_reads WHERE message_id = ?').run(msg.id);
  db.prepare('DELETE FROM messages WHERE id = ?').run(msg.id);

  res.json({ deleted: true, message_id: msg.id, room_id: msg.room_id });
});

// GET /api/rooms/:id/search?q=text
router.get('/:id/search', (req, res) => {
  const db = getDb();
  const roomId = req.params.id;
  const q = (req.query.q || '').trim();

  if (!q || q.length < 2) return res.status(400).json({ error: 'Query too short' });

  const membership = db.prepare(
    'SELECT * FROM room_members WHERE room_id = ? AND user_id = ?'
  ).get(roomId, req.user.id);
  if (!membership) return res.status(403).json({ error: 'Not a member of this room' });

  const messages = db.prepare(`
    SELECT m.*, u.username as sender_username, u.display_name as sender_name, u.role as sender_role
    FROM messages m JOIN users u ON m.sender_id = u.id
    WHERE m.room_id = ? AND m.text LIKE ?
    ORDER BY m.created_at DESC LIMIT 50
  `).all(roomId, `%${q}%`);

  res.json({ messages, query: q });
});

module.exports = router;
