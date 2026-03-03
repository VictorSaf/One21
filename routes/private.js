'use strict';
const express = require('express');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// POST /api/private/request — initiate a private chat request
router.post('/request', (req, res) => {
  const { to_user_id, initial_message } = req.body;
  if (!to_user_id || !initial_message || typeof initial_message !== 'string') {
    return res.status(400).json({ error: 'to_user_id and initial_message required' });
  }
  if (to_user_id === req.user.id) {
    return res.status(400).json({ error: 'Cannot private chat with yourself' });
  }
  const db = getDb();
  const io = req.app.get('io');

  // Check if private room already exists between these two users
  const existing = db.prepare(`
    SELECT r.id FROM rooms r
    JOIN room_members rm1 ON r.id = rm1.room_id AND rm1.user_id = ?
    JOIN room_members rm2 ON r.id = rm2.room_id AND rm2.user_id = ?
    WHERE r.type = 'private'
    LIMIT 1
  `).get(req.user.id, to_user_id);

  if (existing) {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(existing.id);
    return res.json({ exists: true, room });
  }

  const target = db.prepare('SELECT id, username FROM users WHERE id = ?').get(to_user_id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  // Check for pending request already sent
  const pendingCheck = db.prepare(
    "SELECT id FROM private_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'"
  ).get(req.user.id, to_user_id);
  if (pendingCheck) return res.status(409).json({ error: 'Request already pending' });

  const result = db.prepare(
    "INSERT INTO private_requests (from_user_id, to_user_id, initial_message) VALUES (?, ?, ?)"
  ).run(req.user.id, to_user_id, initial_message.trim().slice(0, 500));

  // Notify recipient via their personal socket room
  io.to(`user:${to_user_id}`).emit('private_request', {
    request_id: result.lastInsertRowid,
    from_user_id: req.user.id,
    from_username: req.user.username,
    initial_message: initial_message.trim().slice(0, 500),
  });

  res.json({ ok: true, request_id: result.lastInsertRowid });
});

// POST /api/private/request/:id/accept
router.post('/request/:id/accept', (req, res) => {
  const db = getDb();
  const io = req.app.get('io');
  const requestId = parseInt(req.params.id);

  const request = db.prepare(
    "SELECT * FROM private_requests WHERE id = ? AND to_user_id = ? AND status = 'pending'"
  ).get(requestId, req.user.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });

  const roomId = db.transaction(() => {
    // Create the private room
    const r = db.prepare(
      "INSERT INTO rooms (name, type, created_by) VALUES (?, 'private', ?)"
    ).run(`private-${request.from_user_id}-${request.to_user_id}`, request.from_user_id);
    const id = r.lastInsertRowid;

    // Add both users as members
    const add = db.prepare(
      'INSERT OR IGNORE INTO room_members (room_id, user_id, role, access_level, color_index) VALUES (?, ?, ?, ?, ?)'
    );
    add.run(id, request.from_user_id, 'owner', 'readandwrite', 0);
    add.run(id, request.to_user_id, 'member', 'readandwrite', 1);

    // Store the initial message
    db.prepare(
      'INSERT INTO messages (room_id, sender_id, text, type) VALUES (?, ?, ?, ?)'
    ).run(id, request.from_user_id, request.initial_message, 'text');

    // Mark request accepted
    db.prepare(
      "UPDATE private_requests SET status = 'accepted', responded_at = datetime('now') WHERE id = ?"
    ).run(requestId);

    return id;
  })();

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  const fromUser = db.prepare('SELECT username FROM users WHERE id = ?').get(request.from_user_id);
  const toUser = db.prepare('SELECT username FROM users WHERE id = ?').get(request.to_user_id);

  // Notify both users to add the new room to their sidebar (each sees the other's username)
  io.to(`user:${request.from_user_id}`).emit('room_added', { room: { ...room, display_name: toUser?.username } });
  io.to(`user:${request.to_user_id}`).emit('room_added', { room: { ...room, display_name: fromUser?.username } });

  res.json({ ok: true, room });
});

// POST /api/private/request/:id/decline
router.post('/request/:id/decline', (req, res) => {
  const db = getDb();
  const io = req.app.get('io');
  const requestId = parseInt(req.params.id);

  const request = db.prepare(
    "SELECT * FROM private_requests WHERE id = ? AND to_user_id = ? AND status = 'pending'"
  ).get(requestId, req.user.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });

  db.prepare(
    "UPDATE private_requests SET status = 'declined', responded_at = datetime('now') WHERE id = ?"
  ).run(requestId);

  io.to(`user:${request.from_user_id}`).emit('private_declined', {
    request_id: requestId,
    from_username: req.user.username,
  });

  res.json({ ok: true });
});

// GET /api/private/requests/pending — get incoming pending requests for current user
router.get('/requests/pending', (req, res) => {
  const db = getDb();
  const requests = db.prepare(`
    SELECT pr.*, u.display_name as from_display_name, u.username as from_username
    FROM private_requests pr
    JOIN users u ON u.id = pr.from_user_id
    WHERE pr.to_user_id = ? AND pr.status = 'pending'
    ORDER BY pr.created_at DESC
  `).all(req.user.id);
  res.json({ requests });
});

module.exports = router;
