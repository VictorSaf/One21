const express = require('express');
const { getDb } = require('../db/init');
const { agentMiddleware } = require('../middleware/agent');

const router = express.Router();
router.use(agentMiddleware);

// GET /api/agent/rooms — list all rooms where Claude agent is member
router.get('/rooms', (req, res) => {
  const db = getDb();
  const agent = db.prepare("SELECT id FROM users WHERE username = 'claude' AND role = 'agent'").get();
  if (!agent) return res.status(404).json({ error: 'Agent user not found' });

  const rooms = db.prepare(`
    SELECT r.*, rm.role as my_role,
      (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) as member_count,
      (SELECT m.text FROM messages m WHERE m.room_id = r.id ORDER BY m.created_at DESC LIMIT 1) as last_message,
      (SELECT m.created_at FROM messages m WHERE m.room_id = r.id ORDER BY m.created_at DESC LIMIT 1) as last_message_at
    FROM rooms r
    JOIN room_members rm ON r.id = rm.room_id AND rm.user_id = ?
    WHERE r.is_archived = 0
    ORDER BY last_message_at DESC NULLS LAST
  `).all(agent.id);

  res.json({ rooms, agent_id: agent.id });
});

// GET /api/agent/messages?room=ID&since=MSG_ID&limit=50
// Returns new messages in a room since a given message ID
router.get('/messages', (req, res) => {
  const db = getDb();
  const roomId = req.query.room;
  const since = req.query.since ? parseInt(req.query.since) : 0;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);

  if (!roomId) return res.status(400).json({ error: 'room parameter required' });

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

// POST /api/agent/send — send message as Claude agent
router.post('/send', (req, res) => {
  const db = getDb();
  const { room_id, text, reply_to } = req.body;

  if (!room_id || !text) return res.status(400).json({ error: 'room_id and text required' });
  if (typeof text !== 'string' || text.trim().length === 0 || text.length > 4000) {
    return res.status(400).json({ error: 'Invalid text' });
  }

  const agent = db.prepare("SELECT id FROM users WHERE username = 'claude' AND role = 'agent'").get();
  if (!agent) return res.status(404).json({ error: 'Agent user not found' });

  // Verify agent is member of the room
  const membership = db.prepare(
    'SELECT * FROM room_members WHERE room_id = ? AND user_id = ?'
  ).get(room_id, agent.id);
  if (!membership) return res.status(403).json({ error: 'Agent not member of this room' });

  const result = db.prepare(
    'INSERT INTO messages (room_id, sender_id, text, type, reply_to) VALUES (?, ?, ?, ?, ?)'
  ).run(room_id, agent.id, text.trim(), 'text', reply_to || null);

  const message = db.prepare(`
    SELECT m.*, u.username as sender_username, u.display_name as sender_name, u.role as sender_role
    FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?
  `).get(result.lastInsertRowid);

  // Emit via Socket.IO if available
  if (req.app.get('io')) {
    req.app.get('io').to(`room:${room_id}`).emit('message', message);
  }

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
