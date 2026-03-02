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
  invite_code: z.string().min(1).optional(),
  token: z.string().min(1).optional(),
}).refine(data => data.invite_code || data.token, { message: 'invite_code or token required' });

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

function normalizeLoginIdentifier(value) {
  return String(value || '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[-_'`".,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// POST /api/auth/register
router.post('/register', (req, res) => {
  const result = registerSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const { username, password, display_name, invite_code, token } = result.data;
  const db = getDb();

  let invite;
  if (token) {
    invite = db.prepare(
      'SELECT * FROM invitations WHERE token = ? AND used_by IS NULL'
    ).get(token);
  } else {
    invite = db.prepare(
      'SELECT * FROM invitations WHERE code = ? AND used_by IS NULL'
    ).get(invite_code.toUpperCase());
  }

  if (!invite) return res.status(400).json({ error: 'Invalid or already used invite' });
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return res.status(400).json({ error: 'Invite has expired' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(400).json({ error: 'Username already taken' });

  const passwordHash = bcrypt.hashSync(password, 12);
  const displayName = display_name
    || (invite.nume && invite.prenume ? `${invite.nume} ${invite.prenume}`.trim() : null)
    || (invite.prenume || invite.nume || username);

  let userId;
  try {
    userId = db.transaction(() => {
    const userCount = db.prepare("SELECT COUNT(*) as n FROM users WHERE role = 'user'").get().n;
    const chatColorIndex = userCount % 8;
    const r = db.prepare(
      `INSERT INTO users (username, display_name, password_hash, role, invited_by, invite_code, chat_color_index)
       VALUES (?, ?, ?, 'user', ?, ?, ?)`
    ).run(username, displayName, passwordHash, invite.created_by, invite.code, chatColorIndex);
    const claim = db.prepare('UPDATE invitations SET used_by = ? WHERE id = ? AND used_by IS NULL')
      .run(r.lastInsertRowid, invite.id);
    if (claim.changes === 0) {
      throw new Error('Invite already consumed');
    }

    // Parse default_permissions from invite
    let perms = {};
    if (invite.default_permissions && invite.default_permissions !== '{}') {
      try { perms = JSON.parse(invite.default_permissions); } catch (e) {
        console.error('[register] Failed to parse invite permissions:', e.message);
      }
      const upsert = db.prepare(`
        INSERT INTO user_permissions (user_id, permission, value, granted_by)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, permission) DO UPDATE SET value = excluded.value
      `);
      for (const [key, val] of Object.entries(perms)) {
        if (key === 'rooms') continue; // rooms handled separately below
        upsert.run(r.lastInsertRowid, key, JSON.stringify(val), invite.created_by);
      }
    }
    const newUserId = r.lastInsertRowid;
    // Room access: use invite's room assignments if present, else join all channels/groups
    let roomAssignments;
    if (perms.rooms && Array.isArray(perms.rooms) && perms.rooms.length > 0) {
      roomAssignments = perms.rooms;
    } else {
      const allRooms = db.prepare(
        "SELECT id, type FROM rooms WHERE type IN ('channel', 'group') AND is_archived = 0"
      ).all();
      roomAssignments = allRooms.map(r => ({
        id: r.id,
        access_level: r.type === 'channel' ? 'readonly' : 'readandwrite',
      }));
    }

    // General (channel) is always included — even when invite has explicit rooms
    const generalRoom = db.prepare(
      "SELECT id FROM rooms WHERE name = 'General' AND type = 'channel'"
    ).get();
    if (generalRoom && !roomAssignments.some(r => Number(r.id) === Number(generalRoom.id))) {
      roomAssignments.push({ id: generalRoom.id, access_level: 'readonly' });
    }
    const validRoomIds = new Set(
      db.prepare("SELECT id FROM rooms WHERE type IN ('channel','group') AND is_archived = 0").all().map(r => r.id)
    );
    roomAssignments = roomAssignments.filter(rm => validRoomIds.has(rm.id));
    const addMember = db.prepare(
      'INSERT OR IGNORE INTO room_members (room_id, user_id, role, access_level) VALUES (?, ?, ?, ?)'
    );
    const VALID_ACCESS = new Set(['readonly', 'readandwrite', 'post_docs']);
    for (const rm of roomAssignments) {
      const level = VALID_ACCESS.has(rm.access_level) ? rm.access_level : 'readandwrite';
      addMember.run(rm.id, newUserId, 'member', level);
    }
    return newUserId;
    })();
  } catch (err) {
    return res.status(400).json({ error: 'Invite already used' });
  }
  const authToken = jwt.sign({ id: userId, username, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token: authToken, user: { id: userId, username, display_name: displayName, role: 'user' } });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const result = loginSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const { username, password } = result.data;
  const db = getDb();
  const identifier = normalizeLoginIdentifier(username);
  const users = db.prepare('SELECT * FROM users').all();
  const candidates = users.filter((u) => {
    const usernameNorm = normalizeLoginIdentifier(u.username);
    const displayNorm = normalizeLoginIdentifier(u.display_name);
    const firstNameNorm = displayNorm ? displayNorm.split(' ')[0] : '';
    return (
      identifier &&
      (
        identifier === usernameNorm ||
        identifier === displayNorm ||
        identifier === firstNameNorm
      )
    );
  });

  const user = candidates.find((u) => bcrypt.compareSync(password, u.password_hash));
  if (!user) {
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
