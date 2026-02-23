const express = require('express');
const crypto = require('crypto');
const { getDb } = require('../db/init');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const { getAllPermissions } = require('../middleware/permissions');

const router = express.Router();
router.use(authMiddleware, requireAdmin);

// GET /api/admin/stats
router.get('/stats', (req, res) => {
  const db = getDb();
  const stats = {
    users:        db.prepare("SELECT COUNT(*) as n FROM users WHERE role != 'agent'").get().n,
    agents:       db.prepare("SELECT COUNT(*) as n FROM users WHERE role = 'agent'").get().n,
    rooms:        db.prepare("SELECT COUNT(*) as n FROM rooms WHERE is_archived = 0").get().n,
    messages:     db.prepare("SELECT COUNT(*) as n FROM messages").get().n,
    online_now:   db.prepare("SELECT COUNT(*) as n FROM users WHERE is_online = 1").get().n,
    active_today: db.prepare("SELECT COUNT(DISTINCT sender_id) as n FROM messages WHERE created_at >= datetime('now', '-1 day')").get().n,
    msg_today:    db.prepare("SELECT COUNT(*) as n FROM messages WHERE created_at >= datetime('now', '-1 day')").get().n,
    invites_used: db.prepare("SELECT COUNT(*) as n FROM invitations WHERE used_by IS NOT NULL").get().n,
    invites_pending: db.prepare("SELECT COUNT(*) as n FROM invitations WHERE used_by IS NULL").get().n,
  };
  res.json({ stats });
});

// GET /api/admin/users
router.get('/users', (req, res) => {
  const db = getDb();
  const users = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.avatar_url,
           u.is_online, u.last_seen, u.created_at,
           (SELECT COUNT(*) FROM messages WHERE sender_id = u.id) as message_count,
           inv.username as invited_by_name
    FROM users u
    LEFT JOIN users inv ON u.invited_by = inv.id
    ORDER BY u.created_at DESC
  `).all();
  res.json({ users });
});

// PUT /api/admin/users/:id — edit user (role, display_name)
router.put('/users/:id', (req, res) => {
  const db = getDb();
  const { role, display_name } = req.body;
  const userId = req.params.id;

  if (parseInt(userId) === req.user.id) {
    return res.status(400).json({ error: 'Cannot edit your own account here' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const updates = [];
  const values = [];
  if (role && ['admin', 'user', 'agent'].includes(role)) { updates.push('role = ?'); values.push(role); }
  if (display_name) { updates.push('display_name = ?'); values.push(display_name.trim()); }
  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

  values.push(userId);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const updated = db.prepare('SELECT id, username, display_name, role, is_online FROM users WHERE id = ?').get(userId);
  res.json({ user: updated });
});

// GET /api/admin/invites
router.get('/invites', (req, res) => {
  const db = getDb();
  const invites = db.prepare(`
    SELECT i.*, u.username as created_by_name, u2.username as used_by_name, u2.display_name as used_by_display
    FROM invitations i
    LEFT JOIN users u ON i.created_by = u.id
    LEFT JOIN users u2 ON i.used_by = u2.id
    ORDER BY i.created_at DESC
  `).all();
  res.json({ invites });
});

// POST /api/admin/invites
router.post('/invites', (req, res) => {
  const db = getDb();
  const code = crypto.randomUUID().slice(0, 8).toUpperCase();
  const expiresAt = req.body.expires_at || null;
  db.prepare('INSERT INTO invitations (code, created_by, expires_at) VALUES (?, ?, ?)').run(code, req.user.id, expiresAt);
  res.json({ code, expires_at: expiresAt });
});

// DELETE /api/admin/invites/:id — revoke unused invite
router.delete('/invites/:id', (req, res) => {
  const db = getDb();
  const invite = db.prepare('SELECT * FROM invitations WHERE id = ?').get(req.params.id);
  if (!invite) return res.status(404).json({ error: 'Not found' });
  if (invite.used_by) return res.status(400).json({ error: 'Already used — cannot revoke' });
  db.prepare('DELETE FROM invitations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// GET /api/admin/conversations — all rooms with stats
router.get('/conversations', (req, res) => {
  const db = getDb();
  const rooms = db.prepare(`
    SELECT r.*,
      (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) as member_count,
      (SELECT COUNT(*) FROM messages WHERE room_id = r.id) as message_count,
      (SELECT m.text FROM messages m WHERE m.room_id = r.id ORDER BY m.created_at DESC LIMIT 1) as last_message,
      (SELECT m.created_at FROM messages m WHERE m.room_id = r.id ORDER BY m.created_at DESC LIMIT 1) as last_message_at,
      u.display_name as created_by_name
    FROM rooms r
    LEFT JOIN users u ON r.created_by = u.id
    ORDER BY last_message_at DESC NULLS LAST
  `).all();
  res.json({ rooms });
});

// GET /api/admin/export/:roomId — export room as JSON
router.get('/export/:roomId', (req, res) => {
  const db = getDb();
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const members = db.prepare(`
    SELECT u.username, u.display_name, u.role, rm.role as room_role
    FROM room_members rm JOIN users u ON rm.user_id = u.id WHERE rm.room_id = ?
  `).all(req.params.roomId);

  const messages = db.prepare(`
    SELECT m.id, m.text, m.type, m.file_name, m.is_edited, m.created_at,
           u.username as sender, u.display_name as sender_name
    FROM messages m JOIN users u ON m.sender_id = u.id
    WHERE m.room_id = ? ORDER BY m.created_at ASC
  `).all(req.params.roomId);

  const exportData = {
    exported_at: new Date().toISOString(),
    room: { id: room.id, name: room.name, description: room.description, type: room.type, created_at: room.created_at },
    members,
    messages,
    stats: { total_messages: messages.length, members_count: members.length },
  };

  res.setHeader('Content-Disposition', `attachment; filename="one21-${room.name.replace(/\s+/g, '-')}-export.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.json(exportData);
});

// GET /api/admin/users/:id/permissions
router.get('/users/:id/permissions', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const perms = getAllPermissions(parseInt(req.params.id));
  res.json({ permissions: perms });
});

// PUT /api/admin/users/:id/permissions
router.put('/users/:id/permissions', (req, res) => {
  const db = getDb();
  const userId = parseInt(req.params.id);
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const ALLOWED_KEYS = ['can_send_files', 'allowed_agents', 'max_messages_per_day', 'allowed_rooms'];
  const upsert = db.prepare(`
    INSERT INTO user_permissions (user_id, permission, value, granted_by)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, permission) DO UPDATE SET value = excluded.value, granted_by = excluded.granted_by, granted_at = datetime('now')
  `);
  const del = db.prepare('DELETE FROM user_permissions WHERE user_id = ? AND permission = ?');

  db.transaction(() => {
    for (const key of ALLOWED_KEYS) {
      if (!(key in req.body)) continue;
      const val = req.body[key];
      if (val === null) {
        del.run(userId, key);
      } else {
        upsert.run(userId, key, JSON.stringify(val), req.user.id);
      }
    }
  })();

  const perms = getAllPermissions(userId);
  res.json({ permissions: perms });
});

module.exports = router;
