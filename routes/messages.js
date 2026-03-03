const express = require('express');
const { z } = require('zod');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');
const { getPermission } = require('../middleware/permissions');
const { addDocument, addAgentMemory } = require('../lib/vectorstore');

const router = express.Router();
router.use(authMiddleware);

function queueAgentRoomMemory(db, roomId, text, metadata) {
  const agentsInRoom = db.prepare(`
    SELECT u.username
    FROM room_members rm
    JOIN users u ON rm.user_id = u.id
    WHERE rm.room_id = ? AND u.role = 'agent'
  `).all(roomId);
  if (!agentsInRoom.length) return;
  for (const agent of agentsInRoom) {
    addAgentMemory(agent.username, text, {
      ...metadata,
      room_id: roomId,
    }).catch(() => {});
  }
}

function normalizeAccessLevel(value) {
  return ['readonly', 'readandwrite', 'post_docs'].includes(value) ? value : 'readandwrite';
}

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

  const BASE_SELECT = `
    SELECT m.*,
      u.username as sender_username, u.display_name as sender_name,
      u.role as sender_role,
      COALESCE(rmc.color_index, u.chat_color_index) as sender_color_index,
      reply_m.text as reply_to_text,
      ru.username as reply_to_sender,
      rec.username as recipient_username, rec.display_name as recipient_name
    FROM messages m
    JOIN users u ON m.sender_id = u.id
    LEFT JOIN room_members rmc ON rmc.room_id = m.room_id AND rmc.user_id = m.sender_id
    LEFT JOIN messages reply_m ON reply_m.id = m.reply_to
    LEFT JOIN users ru ON ru.id = reply_m.sender_id
    LEFT JOIN users rec ON rec.id = m.recipient_id
  `;

  const visFilter = 'AND (m.recipient_id IS NULL OR m.sender_id = ? OR m.recipient_id = ?)';
  const query = before
    ? `${BASE_SELECT} WHERE m.room_id = ? ${visFilter} AND m.id < ? ORDER BY m.created_at DESC LIMIT ?`
    : `${BASE_SELECT} WHERE m.room_id = ? ${visFilter} ORDER BY m.created_at DESC LIMIT ?`;

  const args = before
    ? [roomId, req.user.id, req.user.id, before, limit]
    : [roomId, req.user.id, req.user.id, limit];
  const messages = db.prepare(query).all(...args).reverse();

  // Attach reactions
  const msgIds = messages.map(m => m.id);
  if (msgIds.length) {
    const placeholders = msgIds.map(() => '?').join(',');
    const reactionRows = db.prepare(
      `SELECT message_id, emoji, COUNT(*) as count
       FROM message_reactions WHERE message_id IN (${placeholders})
       GROUP BY message_id, emoji`
    ).all(...msgIds);

    const reactionMap = {};
    reactionRows.forEach(r => {
      if (!reactionMap[r.message_id]) reactionMap[r.message_id] = [];
      reactionMap[r.message_id].push({ emoji: r.emoji, count: r.count });
    });
    messages.forEach(m => { m.reactions = reactionMap[m.id] || []; });
  }

  res.json({ messages, has_more: messages.length === limit });
});

// POST /api/rooms/:id/messages
router.post('/:id/messages', (req, res) => {
  const result = sendSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ error: result.error.issues[0].message });

  const db = getDb();
  const roomId = req.params.id;
  const { text, type, reply_to } = result.data;

  const membership = db.prepare(
    'SELECT * FROM room_members WHERE room_id = ? AND user_id = ?'
  ).get(roomId, req.user.id);
  if (!membership) return res.status(403).json({ error: 'Not a member of this room' });
  const accessLevel = normalizeAccessLevel(membership.access_level);

  if (req.user.role !== 'admin') {
    if (accessLevel === 'readonly') {
      return res.status(403).json({ error: 'This room is read-only for your account.' });
    }
    if (accessLevel === 'post_docs') {
      return res.status(403).json({ error: 'You can only post documents in this room.' });
    }
    // Channel rooms enforce whisper-only posting; use the app socket for @username messages
    const room = db.prepare('SELECT type FROM rooms WHERE id = ?').get(roomId);
    if (room?.type === 'channel') {
      return res.status(403).json({ error: 'Folosește @username în aplicație pentru mesaje private în acest canal.' });
    }
  }

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

  // Vectorize message (fire-and-forget)
  const msgId = r.lastInsertRowid;
  const senderName = req.user.display_name || req.user.username;
  setImmediate(() => {
    addDocument('messages', text, {
      message_id: msgId,
      room_id: roomId,
      sender_id: req.user.id,
      sender: senderName,
      ts: new Date().toISOString(),
    }).catch(() => {});
    queueAgentRoomMemory(db, roomId, text, {
      message_id: msgId,
      sender_id: req.user.id,
      sender: senderName,
      sender_username: req.user.username,
      sender_role: req.user.role,
      memory_type: 'room_message',
      ts: new Date().toISOString(),
    });
  });

  const message = db.prepare(`
    SELECT m.*, u.username as sender_username, u.display_name as sender_name, u.role as sender_role, u.chat_color_index as sender_color_index
    FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?
  `).get(r.lastInsertRowid);

  res.json({ message });
});

// PUT /api/messages/:id — edit own message
router.put('/messages/:id', (req, res) => {
  const result = editSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ error: result.error.issues[0].message });

  const db = getDb();
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  if (msg.sender_id !== req.user.id) return res.status(403).json({ error: 'Can only edit your own messages' });

  db.prepare("UPDATE messages SET text = ?, is_edited = 1 WHERE id = ?")
    .run(result.data.text, msg.id);

  const updated = db.prepare(`
    SELECT m.*, u.username as sender_username, u.display_name as sender_name, u.role as sender_role, u.chat_color_index as sender_color_index
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

  const escapedQ = q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  const messages = db.prepare(`
    SELECT m.*, u.username as sender_username, u.display_name as sender_name, u.role as sender_role, u.chat_color_index as sender_color_index
    FROM messages m JOIN users u ON m.sender_id = u.id
    WHERE m.room_id = ?
      AND (m.recipient_id IS NULL OR m.sender_id = ? OR m.recipient_id = ?)
      AND m.text LIKE ? ESCAPE '\\'
    ORDER BY m.created_at DESC LIMIT 50
  `).all(roomId, req.user.id, req.user.id, `%${escapedQ}%`);

  res.json({ messages, query: q });
});

// DELETE /api/rooms/:id/messages — clear all messages in a room (admin only)
router.delete('/:id/messages', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const db = getDb();
  const roomId = req.params.id;

  const room = db.prepare('SELECT id FROM rooms WHERE id = ?').get(roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const { count } = db.prepare('SELECT COUNT(*) as count FROM messages WHERE room_id = ?').get(roomId);

  db.transaction(() => {
    db.prepare('DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE room_id = ?)').run(roomId);
    db.prepare('DELETE FROM message_reads WHERE message_id IN (SELECT id FROM messages WHERE room_id = ?)').run(roomId);
    db.prepare('DELETE FROM messages WHERE room_id = ?').run(roomId);
  })();

  const io = req.app.get('io');
  io.to(`room:${roomId}`).emit('room_cleared', { room_id: roomId });

  res.json({ ok: true, deleted: count, room_id: roomId });
});

module.exports = router;
