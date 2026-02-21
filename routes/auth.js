const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { getDb } = require('../db/init');
const { authMiddleware, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

const registerSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/, 'Only letters, numbers and underscores'),
  password: z.string().min(6).max(100),
  display_name: z.string().min(1).max(50).optional(),
  invite_code: z.string().min(1),
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

// POST /api/auth/register
router.post('/register', (req, res) => {
  const result = registerSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.errors[0].message });
  }

  const { username, password, display_name, invite_code } = result.data;
  const db = getDb();

  const invite = db.prepare(
    'SELECT * FROM invitations WHERE code = ? AND used_by IS NULL'
  ).get(invite_code.toUpperCase());

  if (!invite) return res.status(400).json({ error: 'Invalid or already used invite code' });
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return res.status(400).json({ error: 'Invite code has expired' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(400).json({ error: 'Username already taken' });

  const passwordHash = bcrypt.hashSync(password, 12);
  const displayName = display_name || username;

  const createUser = db.transaction(() => {
    const r = db.prepare(
      `INSERT INTO users (username, display_name, password_hash, role, invited_by, invite_code)
       VALUES (?, ?, ?, 'user', ?, ?)`
    ).run(username, displayName, passwordHash, invite.created_by, invite.code);
    db.prepare('UPDATE invitations SET used_by = ? WHERE id = ?').run(r.lastInsertRowid, invite.id);
    return r.lastInsertRowid;
  });

  const userId = createUser();
  const token = jwt.sign({ id: userId, username, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { id: userId, username, display_name: displayName, role: 'user' } });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const result = loginSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.errors[0].message });
  }

  const { username, password } = result.data;
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  db.prepare("UPDATE users SET is_online = 1, last_seen = datetime('now') WHERE id = ?").run(user.id);

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, display_name: user.display_name },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({ token, user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role } });
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  const db = getDb();
  const user = db.prepare(
    'SELECT id, username, display_name, role, avatar_url, is_online, last_seen, created_at FROM users WHERE id = ?'
  ).get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

module.exports = router;
