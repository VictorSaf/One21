const express = require('express');
const { z } = require('zod');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const createSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(200).optional(),
  type: z.enum(['direct', 'group', 'channel']).optional(),
  member_ids: z.array(z.number().int().positive()).optional(),
});

const editSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(200).optional(),
  is_archived: z.boolean().optional(),
});

// GET /api/rooms — list rooms the current user belongs to
router.get('/', (req, res) => {
  const db = getDb();
  const rooms = db.prepare(`
    SELECT r.*, rm.role as my_role,
      (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) as member_count,
      (SELECT m.text FROM messages m WHERE m.room_id = r.id ORDER BY m.created_at DESC LIMIT 1) as last_message,
      (SELECT m.created_at FROM messages m WHERE m.room_id = r.id ORDER BY m.created_at DESC LIMIT 1) as last_message_at,
      (SELECT u.display_name FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.room_id = r.id ORDER BY m.created_at DESC LIMIT 1) as last_message_sender,
      (SELECT COUNT(*) FROM messages m
       WHERE m.room_id = r.id
         AND m.sender_id != ?
         AND m.id NOT IN (SELECT message_id FROM message_reads WHERE user_id = ?)) as unread_count
    FROM rooms r
    JOIN room_members rm ON r.id = rm.room_id AND rm.user_id = ?
    WHERE r.is_archived = 0
    ORDER BY last_message_at DESC NULLS LAST
  `).all(req.user.id, req.user.id, req.user.id);
  res.json({ rooms });
});

// POST /api/rooms — create room
router.post('/', (req, res) => {
  const result = createSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ error: result.error.errors[0].message });

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Users cannot create rooms directly. Submit a room request instead.' });
  }

  const { name, description, type, member_ids } = result.data;
  const db = getDb();

  // For direct messages: check if DM already exists
  if (type === 'direct' && member_ids && member_ids.length === 1) {
    const otherId = member_ids[0];
    const existing = db.prepare(`
      SELECT r.id FROM rooms r
      JOIN room_members rm1 ON r.id = rm1.room_id AND rm1.user_id = ?
      JOIN room_members rm2 ON r.id = rm2.room_id AND rm2.user_id = ?
      WHERE r.type = 'direct'
      LIMIT 1
    `).get(req.user.id, otherId);
    if (existing) return res.json({ room: db.prepare('SELECT * FROM rooms WHERE id = ?').get(existing.id) });
  }

  const roomId = db.transaction(() => {
    const r = db.prepare(
      'INSERT INTO rooms (name, description, type, created_by) VALUES (?, ?, ?, ?)'
    ).run(name, description || null, type || 'group', req.user.id);
    const id = r.lastInsertRowid;
    db.prepare('INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)').run(id, req.user.id, 'owner');
    if (Array.isArray(member_ids)) {
      const add = db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)');
      for (const uid of member_ids) {
        if (uid !== req.user.id) add.run(id, uid, 'member');
      }
    }
    return id;
  })();

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  res.json({ room });
});

// GET /api/rooms/:id — room details + members
router.get('/:id', (req, res) => {
  const db = getDb();
  const roomId = req.params.id;
  const membership = db.prepare('SELECT * FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, req.user.id);
  if (!membership) return res.status(403).json({ error: 'Not a member of this room' });

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  const members = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.avatar_url, u.is_online, rm.role as room_role
    FROM room_members rm JOIN users u ON rm.user_id = u.id WHERE rm.room_id = ?
  `).all(roomId);

  res.json({ room, members });
});

// PUT /api/rooms/:id — edit room (owner or admin)
router.put('/:id', (req, res) => {
  const result = editSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ error: result.error.errors[0].message });

  const db = getDb();
  const roomId = req.params.id;
  const membership = db.prepare('SELECT * FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, req.user.id);
  if (!membership || (membership.role !== 'owner' && req.user.role !== 'admin')) {
    return res.status(403).json({ error: 'Only room owner or admin can edit' });
  }

  const { name, description, is_archived } = result.data;
  const updates = [];
  const values = [];
  if (name !== undefined)        { updates.push('name = ?');        values.push(name); }
  if (description !== undefined) { updates.push('description = ?'); values.push(description); }
  if (is_archived !== undefined) { updates.push('is_archived = ?'); values.push(is_archived ? 1 : 0); }

  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

  values.push(roomId);
  db.prepare(`UPDATE rooms SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  res.json({ room });
});

// DELETE /api/rooms/:id — admin only, delete room + cascade members
router.delete('/:id', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const db = getDb();
  const roomId = req.params.id;
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  db.transaction(() => {
    db.prepare('DELETE FROM room_members WHERE room_id = ?').run(roomId);
    db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
  })();
  res.json({ ok: true });
});

// POST /api/rooms/:id/members — add member (owner or admin)
router.post('/:id/members', (req, res) => {
  const db = getDb();
  const roomId = req.params.id;
  const { user_id } = req.body;

  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const membership = db.prepare('SELECT * FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, req.user.id);
  if (!membership || (membership.role !== 'owner' && req.user.role !== 'admin')) {
    return res.status(403).json({ error: 'Only owner or admin can add members' });
  }

  const targetUser = db.prepare('SELECT id, username, display_name, role FROM users WHERE id = ?').get(user_id);
  if (!targetUser) return res.status(404).json({ error: 'User not found' });

  db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)').run(roomId, user_id, 'member');
  res.json({ ok: true, user: targetUser });
});

// DELETE /api/rooms/:id/members/:userId — remove member
router.delete('/:id/members/:userId', (req, res) => {
  const db = getDb();
  const roomId = req.params.id;
  const targetId = parseInt(req.params.userId);

  const membership = db.prepare('SELECT * FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, req.user.id);
  const isSelf = targetId === req.user.id;
  const isOwnerOrAdmin = membership && (membership.role === 'owner' || req.user.role === 'admin');

  if (!isSelf && !isOwnerOrAdmin) return res.status(403).json({ error: 'Not allowed' });

  db.prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?').run(roomId, targetId);
  res.json({ ok: true });
});

// GET /api/rooms/users/list — all users (for adding to rooms)
router.get('/users/list', (req, res) => {
  const db = getDb();
  const users = db.prepare(
    "SELECT id, username, display_name, role, is_online FROM users WHERE role != 'admin' OR id = ? ORDER BY display_name"
  ).all(req.user.id);
  res.json({ users });
});

module.exports = router;
