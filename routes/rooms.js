const express = require('express');
const { z } = require('zod');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const ACCESS_LEVELS = new Set(['readonly', 'readandwrite', 'post_docs']);
function normalizeAccessLevel(value) {
  return ACCESS_LEVELS.has(value) ? value : 'readandwrite';
}

function assignRoomColor(db, roomId) {
  const used = db.prepare(
    'SELECT color_index FROM room_members WHERE room_id = ? AND color_index IS NOT NULL'
  ).all(roomId).map(r => r.color_index);
  for (let i = 0; i < 8; i++) {
    if (!used.includes(i)) return i;
  }
  // All 8 taken — wrap around based on member count
  return used.length % 8;
}

const createSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(200).optional(),
  type: z.enum(['direct', 'group', 'channel']).optional(),
  member_ids: z.array(z.number().int().positive()).optional(),
  member_access: z.record(z.string(), z.enum(['readonly', 'readandwrite', 'post_docs'])).optional(),
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
    SELECT r.*, rm.role as my_role, rm.access_level as my_access_level,
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

// POST /api/rooms/direct — find or create DM between current user and another user
router.post('/direct', (req, res) => {
  const { participant_id } = req.body;
  if (!participant_id || typeof participant_id !== 'number') {
    return res.status(400).json({ error: 'participant_id required' });
  }
  if (participant_id === req.user.id) {
    return res.status(400).json({ error: 'Cannot DM yourself' });
  }
  const db = getDb();

  // Find existing DM
  const existing = db.prepare(`
    SELECT r.id FROM rooms r
    JOIN room_members rm1 ON r.id = rm1.room_id AND rm1.user_id = ?
    JOIN room_members rm2 ON r.id = rm2.room_id AND rm2.user_id = ?
    WHERE r.type = 'direct'
    LIMIT 1
  `).get(req.user.id, participant_id);

  if (existing) {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(existing.id);
    return res.json({ room });
  }

  // Create new DM
  const other = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(participant_id);
  if (!other) return res.status(404).json({ error: 'User not found' });

  const roomId = db.transaction(() => {
    const r = db.prepare(
      "INSERT INTO rooms (name, type, created_by) VALUES (?, 'direct', ?)"
    ).run(`dm-${req.user.id}-${participant_id}`, req.user.id);
    const id = r.lastInsertRowid;
    const add = db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id, role, access_level, color_index) VALUES (?, ?, ?, ?, ?)');
    add.run(id, req.user.id, 'member', 'readandwrite', 0);
    add.run(id, participant_id, 'member', 'readandwrite', 1);
    return id;
  })();

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  res.json({ room });
});

// POST /api/rooms — create room
router.post('/', (req, res) => {
  const result = createSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ error: result.error.issues[0].message });

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Users cannot create rooms directly. Submit a room request instead.' });
  }

  const { name, description, type, member_ids, member_access } = result.data;
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

  const roomType = type || 'group';
  const roomId = db.transaction(() => {
    const r = db.prepare(
      'INSERT INTO rooms (name, description, type, created_by) VALUES (?, ?, ?, ?)'
    ).run(name, description || null, roomType, req.user.id);
    const id = r.lastInsertRowid;
    db.prepare('INSERT INTO room_members (room_id, user_id, role, access_level, color_index) VALUES (?, ?, ?, ?, ?)')
      .run(id, req.user.id, 'owner', 'readandwrite', 0);
    if (roomType === 'channel') {
      // Canale: toți userii (fără agenți) sunt membri; admin poate scoate pe cine vrea din Members
      const nonAgents = db.prepare("SELECT id FROM users WHERE role != 'agent' AND id != ?").all(req.user.id);
      const addMember = db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id, role, access_level, color_index) VALUES (?, ?, ?, ?, ?)');
      nonAgents.forEach((u, i) => addMember.run(id, u.id, 'member', 'readandwrite', (i + 1) % 8));
    } else if (Array.isArray(member_ids)) {
      const add = db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id, role, access_level, color_index) VALUES (?, ?, ?, ?, ?)');
      let colorCounter = 1; // owner already has 0
      for (const uid of member_ids) {
        if (uid !== req.user.id) {
          const accessLevel = normalizeAccessLevel(member_access && member_access[String(uid)]);
          add.run(id, uid, 'member', accessLevel, colorCounter % 8);
          colorCounter++;
        }
      }
    }
    return id;
  })();

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  res.json({ room });
});

// GET /api/rooms/:id — room details + members (admin can access any room)
router.get('/:id', (req, res) => {
  const db = getDb();
  const roomId = req.params.id;
  const membership = db.prepare('SELECT * FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, req.user.id);
  if (!membership && req.user.role !== 'admin') return res.status(403).json({ error: 'Not a member of this room' });

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const members = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.avatar_url, u.is_online, rm.role as room_role, rm.access_level
    FROM room_members rm JOIN users u ON rm.user_id = u.id WHERE rm.room_id = ?
  `).all(roomId);

  res.json({ room, members });
});

// PUT /api/rooms/:id — edit room (owner or admin; admin can edit any room)
router.put('/:id', (req, res) => {
  const result = editSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ error: result.error.issues[0].message });

  const db = getDb();
  const roomId = req.params.id;
  const existing = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  if (!existing) return res.status(404).json({ error: 'Room not found' });
  const membership = db.prepare('SELECT * FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, req.user.id);
  const canEdit = req.user.role === 'admin' || (membership && membership.role === 'owner');
  if (!canEdit) return res.status(403).json({ error: 'Only room owner or admin can edit' });

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

// DELETE /api/rooms/:id — admin only; :id can be numeric id or node_id (room name)
router.delete('/:id', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const db = getDb();
  const idOrName = req.params.id;
  let roomId;
  if (/^\d+$/.test(idOrName)) {
    roomId = parseInt(idOrName, 10);
  } else {
    const row = db.prepare('SELECT id FROM rooms WHERE name = ?').get(idOrName);
    if (!row) return res.status(404).json({ error: 'Room not found' });
    roomId = row.id;
  }
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  db.transaction(() => {
    db.prepare('DELETE FROM room_members WHERE room_id = ?').run(roomId);
    db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
  })();
  res.json({ ok: true });
});

// POST /api/rooms/:id/members — add member (owner or admin; admin can add to any room)
router.post('/:id/members', (req, res) => {
  const db = getDb();
  const roomId = req.params.id;
  const { user_id } = req.body;
  const accessLevel = normalizeAccessLevel(req.body && req.body.access_level);

  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const membership = db.prepare('SELECT * FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, req.user.id);
  const canAdd = req.user.role === 'admin' || (membership && (membership.role === 'owner' || req.user.role === 'admin'));
  if (!canAdd) return res.status(403).json({ error: 'Only owner or admin can add members' });

  const targetUser = db.prepare('SELECT id, username, display_name, role FROM users WHERE id = ?').get(user_id);
  if (!targetUser) return res.status(404).json({ error: 'User not found' });

  // Only assign a new color if the user isn't already a member
  const existing = db.prepare('SELECT color_index FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, user_id);
  const colorIdx = existing ? existing.color_index : assignRoomColor(db, roomId);
  db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id, role, access_level, color_index) VALUES (?, ?, ?, ?, ?)')
    .run(roomId, user_id, 'member', accessLevel, colorIdx);
  db.prepare('UPDATE room_members SET access_level = ? WHERE room_id = ? AND user_id = ?')
    .run(accessLevel, roomId, user_id);
  res.json({ ok: true, user: targetUser });
});

// PUT /api/rooms/:id/members/:userId/access-level — set member access level (owner or admin)
router.put('/:id/members/:userId/access-level', (req, res) => {
  const db = getDb();
  const roomId = req.params.id;
  const targetId = parseInt(req.params.userId, 10);
  const accessLevel = normalizeAccessLevel(req.body && req.body.access_level);

  const membership = db.prepare('SELECT * FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, req.user.id);
  const isOwnerOrAdmin = req.user.role === 'admin' || (membership && membership.role === 'owner');
  if (!isOwnerOrAdmin) return res.status(403).json({ error: 'Only owner or admin can edit member access level' });

  const target = db.prepare('SELECT role FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, targetId);
  if (!target) return res.status(404).json({ error: 'Member not found' });
  if (target.role === 'owner' && accessLevel !== 'readandwrite') {
    return res.status(400).json({ error: 'Owner access level must remain readandwrite' });
  }

  db.prepare('UPDATE room_members SET access_level = ? WHERE room_id = ? AND user_id = ?')
    .run(accessLevel, roomId, targetId);
  res.json({ ok: true, access_level: accessLevel });
});

// DELETE /api/rooms/:id/members/:userId — remove member (admin can remove from any room)
router.delete('/:id/members/:userId', (req, res) => {
  const db = getDb();
  const roomId = req.params.id;
  const targetId = parseInt(req.params.userId);

  const membership = db.prepare('SELECT * FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, req.user.id);
  const isSelf = targetId === req.user.id;
  const isOwnerOrAdmin = req.user.role === 'admin' || (membership && (membership.role === 'owner' || req.user.role === 'admin'));

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
