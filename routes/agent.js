const express = require('express');
const { getDb } = require('../db/init');
const { agentMiddleware } = require('../middleware/agent');
const { addAgentMemory, searchAgentMemory } = require('../lib/vectorstore');

const router = express.Router();
router.use(agentMiddleware);

// GET /api/agent/rooms — list all rooms where this agent is member
router.get('/rooms', (req, res) => {
  const db = getDb();
  const rooms = db.prepare(`
    SELECT r.*, rm.role as my_role,
      (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) as member_count,
      (SELECT m.text FROM messages m WHERE m.room_id = r.id ORDER BY m.created_at DESC LIMIT 1) as last_message,
      (SELECT m.created_at FROM messages m WHERE m.room_id = r.id ORDER BY m.created_at DESC LIMIT 1) as last_message_at
    FROM rooms r
    JOIN room_members rm ON r.id = rm.room_id AND rm.user_id = ?
    WHERE r.is_archived = 0
    ORDER BY last_message_at DESC NULLS LAST
  `).all(req.agentUser.id);

  res.json({ rooms, agent_id: req.agentUser.id });
});

// GET /api/agent/messages?room=ID&since=MSG_ID&limit=50
// Returns new messages in a room since a given message ID
router.get('/messages', (req, res) => {
  const db = getDb();
  const roomId = req.query.room;
  const since = req.query.since ? parseInt(req.query.since) : 0;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);

  if (!roomId) return res.status(400).json({ error: 'room parameter required' });

  const membership = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, req.agentUser.id);
  if (!membership) return res.status(403).json({ error: 'Agent not member of this room' });

  const messages = db.prepare(`
    SELECT m.*, u.username as sender_username, u.display_name as sender_name, u.role as sender_role
    FROM messages m JOIN users u ON m.sender_id = u.id
    WHERE m.room_id = ? AND m.id > ?
    ORDER BY m.created_at ASC
    LIMIT ?
  `).all(roomId, since, limit);

  const lastId = messages.length > 0 ? messages[messages.length - 1].id : since;
  res.json({ messages, last_id: lastId, has_more: messages.length === limit });
});

// GET /api/agent/memory?q=...&room=ID&k=10
// Semantic memory retrieval for this agent only
router.get('/memory', async (req, res) => {
  const db = getDb();
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const roomId = req.query.room ? String(req.query.room).trim() : null;
  const k = Math.min(parseInt(req.query.k, 10) || 10, 25);
  const ttlDays = Math.min(parseInt(req.query.ttl_days, 10) || 30, 365);

  if (!query || query.length < 2) {
    return res.status(400).json({ error: 'q must be at least 2 characters' });
  }

  if (roomId) {
    const membership = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, req.agentUser.id);
    if (!membership) return res.status(403).json({ error: 'Agent not member of this room' });
  }

  try {
    const results = await searchAgentMemory(req.agentUser.username, query, {
      k,
      filters: roomId ? { room_id: roomId } : null,
      ttl_days: ttlDays,
    });
    return res.json({
      results,
      agent: req.agentUser.username,
      room_id: roomId,
      ttl_days: ttlDays,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Memory search failed', detail: err.message });
  }
});

// POST /api/agent/send — send message as this agent
router.post('/send', (req, res) => {
  const db = getDb();
  const { room_id, text, reply_to } = req.body;

  if (!room_id || !text) return res.status(400).json({ error: 'room_id and text required' });
  if (typeof text !== 'string' || text.trim().length === 0 || text.length > 4000) {
    return res.status(400).json({ error: 'Invalid text' });
  }

  const membership = db.prepare(
    'SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?'
  ).get(room_id, req.agentUser.id);
  if (!membership) return res.status(403).json({ error: 'Agent not member of this room' });

  const result = db.prepare(
    'INSERT INTO messages (room_id, sender_id, text, type, reply_to) VALUES (?, ?, ?, ?, ?)'
  ).run(room_id, req.agentUser.id, text.trim(), 'text', reply_to || null);

  const message = db.prepare(`
    SELECT m.*, u.username as sender_username, u.display_name as sender_name, u.role as sender_role
    FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?
  `).get(result.lastInsertRowid);

  // Emit via Socket.IO if available
  if (req.app.get('io')) {
    req.app.get('io').to(`room:${room_id}`).emit('message', message);
  }

  // Persist this agent's own output to its semantic memory store
  setImmediate(() => {
    addAgentMemory(req.agentUser.username, text.trim(), {
      message_id: result.lastInsertRowid,
      room_id,
      sender_id: req.agentUser.id,
      sender: req.agentUser.display_name || req.agentUser.username,
      sender_username: req.agentUser.username,
      sender_role: req.agentUser.role,
      memory_type: 'agent_output',
      ts: new Date().toISOString(),
    }).catch(() => {});
  });

  res.json({ message });
});

// GET /api/agent/users — list users (for context)
router.get('/users', (req, res) => {
  const db = getDb();
  const users = db.prepare(
    'SELECT id, username, display_name, role, is_online, last_seen FROM users'
  ).all();
  res.json({ users });
});

module.exports = router;
