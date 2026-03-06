const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const { getDb, getDbDriver, getPgPool } = require('../db');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const { setRevocationEpoch } = require('../lib/jwt-revoke');
const { getAllPermissions } = require('../middleware/permissions');
const { logEvent } = require('../lib/events');
const { search, listAgentMemoryStats, pruneAgentMemory } = require('../lib/vectorstore');

const JOIN_BASE_URL = process.env.JOIN_BASE_URL || 'http://platonos.mooo.com:3737/one21';

const router = express.Router();
router.use(authMiddleware, requireAdmin);

// POST /api/admin/logout-all — revoke all JWTs; users must log in again
router.post('/logout-all', (req, res) => {
  const db = getDb();
  setRevocationEpoch();
  db.prepare("UPDATE users SET is_online = 0").run();
  res.json({ ok: true, message: 'All users logged out' });
});

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

// PUT /api/admin/users/:id/password — admin resets user password
router.put('/users/:id/password', (req, res) => {
  const db = getDb();
  const userId = Number.parseInt(req.params.id, 10);
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  if (userId === req.user.id) {
    return res.status(400).json({ error: 'Use profile flow to change your own password' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const passwordHash = bcrypt.hashSync(password, 12);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);

  logEvent('admin_user_password_reset', `Admin ${req.user.username} reset password for @${user.username}`, {
    admin_id: req.user.id,
    target_user_id: userId,
  });
  res.json({ ok: true });
});

// DELETE /api/admin/users/:id — remove user from DB
router.delete('/users/:id', (req, res) => {
  const db = getDb();
  const userId = Number.parseInt(req.params.id, 10);

  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user id' });
  }
  if (userId === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (user.role === 'admin') {
    const admins = db.prepare("SELECT COUNT(*) as n FROM users WHERE role = 'admin'").get().n;
    if (admins <= 1) return res.status(400).json({ error: 'Cannot delete the last admin account' });
  }

  const deleteUserTx = db.transaction((targetUserId, actingAdminId) => {
    db.prepare('UPDATE users SET invited_by = NULL WHERE invited_by = ?').run(targetUserId);
    db.prepare('UPDATE rooms SET created_by = ? WHERE created_by = ?').run(actingAdminId, targetUserId);
    db.prepare('UPDATE invitations SET created_by = ? WHERE created_by = ?').run(actingAdminId, targetUserId);
    db.prepare('UPDATE invitations SET used_by = NULL WHERE used_by = ?').run(targetUserId);
    db.prepare('UPDATE user_permissions SET granted_by = NULL WHERE granted_by = ?').run(targetUserId);

    db.prepare('UPDATE messages SET reply_to = NULL WHERE reply_to IN (SELECT id FROM messages WHERE sender_id = ?)').run(targetUserId);
    db.prepare('DELETE FROM message_reads WHERE message_id IN (SELECT id FROM messages WHERE sender_id = ?)').run(targetUserId);
    db.prepare('DELETE FROM messages WHERE sender_id = ?').run(targetUserId);
    db.prepare('DELETE FROM message_reads WHERE user_id = ?').run(targetUserId);
    db.prepare('DELETE FROM room_members WHERE user_id = ?').run(targetUserId);

    db.prepare('DELETE FROM users WHERE id = ?').run(targetUserId);
  });

  deleteUserTx(userId, req.user.id);
  logEvent('admin_user_deleted', `Admin ${req.user.username} deleted @${user.username}`, {
    admin_id: req.user.id,
    target_user_id: userId,
  });
  res.json({ ok: true });
});

// GET /api/admin/invites/qr?token=XXX — returns PNG QR with the token only (unique code for identification at signup)
router.get('/invites/qr', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: 'token required' });
  const db = getDb();
  const invite = db.prepare('SELECT id FROM invitations WHERE token = ?').get(token);
  if (!invite) return res.status(404).json({ error: 'Invite not found' });
  try {
    const buf = await QRCode.toBuffer(token, { type: 'png', width: 256, margin: 2 });
    res.set('Content-Type', 'image/png');
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: 'QR generation failed' });
  }
});

// POST /api/admin/cult/documents/:docId/requeue — force requeue ingest job (admin only)
router.post('/cult/documents/:docId/requeue', async (req, res) => {
  const driver = getDbDriver();
  const docId = Number(req.params.docId);
  if (!Number.isInteger(docId) || docId <= 0) {
    return res.status(400).json({ error: 'Invalid doc id' });
  }

  try {
    if (driver === 'postgres') {
      const pool = getPgPool();
      const doc = (await pool.query('SELECT * FROM cult_documents WHERE id = $1', [docId])).rows[0];
      if (!doc) return res.status(404).json({ error: 'Document not found' });

      const existing = (await pool.query(
        `
        SELECT *
        FROM cult_document_jobs
        WHERE doc_id = $1 AND job_type = 'ingest'
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [docId]
      )).rows[0];

      let job;
      if (existing) {
        job = (await pool.query(
          `
          UPDATE cult_document_jobs
          SET status = 'queued',
              locked_at = NULL,
              locked_by = NULL,
              last_error = NULL,
              updated_at = now()
          WHERE id = $1
          RETURNING *
          `,
          [Number(existing.id)]
        )).rows[0];
      } else {
        job = (await pool.query(
          `
          INSERT INTO cult_document_jobs (doc_id, job_type, status, attempts, locked_at, locked_by, last_error, created_at, updated_at)
          VALUES ($1, 'ingest', 'queued', 0, NULL, NULL, NULL, now(), now())
          RETURNING *
          `,
          [docId]
        )).rows[0];
      }

      await pool.query(
        "UPDATE cult_documents SET status = 'queued', queued_at = now(), error = NULL WHERE id = $1",
        [docId]
      );

      return res.json({ ok: true, document_id: docId, job });
    }

    const db = getDb();
    const doc = db.prepare('SELECT * FROM cult_documents WHERE id = ?').get(docId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });

    const existing = db.prepare(
      "SELECT * FROM cult_document_jobs WHERE doc_id = ? AND job_type = 'ingest' ORDER BY created_at DESC LIMIT 1"
    ).get(docId);

    let job;
    if (existing) {
      db.prepare(
        "UPDATE cult_document_jobs SET status = 'queued', locked_at = NULL, locked_by = NULL, last_error = NULL, updated_at = datetime('now') WHERE id = ?"
      ).run(existing.id);
      job = db.prepare('SELECT * FROM cult_document_jobs WHERE id = ?').get(existing.id);
    } else {
      const ins = db.prepare(
        "INSERT INTO cult_document_jobs (doc_id, job_type, status, attempts, locked_at, locked_by, last_error, created_at, updated_at) VALUES (?, 'ingest', 'queued', 0, NULL, NULL, NULL, datetime('now'), datetime('now'))"
      ).run(docId);
      job = db.prepare('SELECT * FROM cult_document_jobs WHERE id = ?').get(ins.lastInsertRowid);
    }

    db.prepare("UPDATE cult_documents SET status = 'queued', queued_at = datetime('now'), error = NULL WHERE id = ?").run(docId);
    return res.json({ ok: true, document_id: docId, job });
  } catch (err) {
    return res.status(500).json({ error: 'Requeue failed', detail: err.message });
  }
});

// GET /api/admin/invites
router.get('/invites', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT i.*, u.username as created_by_name, u2.username as used_by_name, u2.display_name as used_by_display
    FROM invitations i
    LEFT JOIN users u ON i.created_by = u.id
    LEFT JOIN users u2 ON i.used_by = u2.id
    ORDER BY i.created_at DESC
  `).all();
  const invites = rows.map(inv => ({
    ...inv,
    join_link: inv.token ? JOIN_BASE_URL : null
  }));
  res.json({ invites, join_base_link: JOIN_BASE_URL });
});

function generateJoinToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// POST /api/admin/invites
router.post('/invites', (req, res) => {
  const driver = getDbDriver();
  const code = crypto.randomUUID().slice(0, 8).toUpperCase();
  const expiresAt = req.body.expires_at || null;
  const note = req.body.note || null;
  const nume = req.body.nume && typeof req.body.nume === 'string' ? req.body.nume.trim() || null : null;
  const prenume = req.body.prenume && typeof req.body.prenume === 'string' ? req.body.prenume.trim() || null : null;

  const send = async () => {
    let token = null;

    if (driver === 'postgres') {
      const pool = getPgPool();

      if (nume || prenume) {
        const existingForUser = (await pool.query(
          `
          SELECT id, code, token, used_by
          FROM invitations
          WHERE lower(trim(COALESCE(nume, ''))) = lower(trim($1))
            AND lower(trim(COALESCE(prenume, ''))) = lower(trim($2))
          ORDER BY created_at DESC
          LIMIT 1
          `,
          [nume || '', prenume || '']
        )).rows[0];
        if (existingForUser) {
          return res.status(400).json({
            error: 'Există deja un cod QR pentru acest user. Nu se poate genera altul.',
            existing_invite: {
              code: existingForUser.code,
              token: existingForUser.token || undefined,
              used: !!existingForUser.used_by,
            },
          });
        }

        for (let i = 0; i < 5; i++) {
          const t = generateJoinToken();
          const exists = await pool.query('SELECT 1 FROM invitations WHERE token = $1', [t]);
          if (exists.rowCount === 0) { token = t; break; }
        }
        if (!token) token = generateJoinToken() + Date.now().toString(36).slice(-4);
      }

      const defaultPermissions = req.body.default_permissions
        ? JSON.stringify(req.body.default_permissions)
        : '{}';

      await pool.query(
        `
        INSERT INTO invitations (code, created_by, expires_at, note, default_permissions, token, nume, prenume)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
        `,
        [code, Number(req.user.id), expiresAt ? new Date(expiresAt) : null, note, defaultPermissions, token, nume, prenume]
      );

      logEvent('invite_created', `Admin ${req.user.username} created invite ${code}${note ? ': ' + note : ''}`, {
        admin_id: req.user.id,
        code,
        note,
      });

      return res.json({
        code,
        token: token || undefined,
        join_link: token ? JOIN_BASE_URL : undefined,
        nume: nume || undefined,
        prenume: prenume || undefined,
        expires_at: expiresAt,
        note,
        default_permissions: req.body.default_permissions || {},
      });
    }

    const db = getDb();
    if (nume || prenume) {
      const existingForUser = db.prepare(`
        SELECT id, code, token, used_by
        FROM invitations
        WHERE lower(trim(COALESCE(nume, ''))) = lower(trim(?))
          AND lower(trim(COALESCE(prenume, ''))) = lower(trim(?))
        ORDER BY created_at DESC
        LIMIT 1
      `).get(nume || '', prenume || '');
      if (existingForUser) {
        return res.status(400).json({
          error: 'Există deja un cod QR pentru acest user. Nu se poate genera altul.',
          existing_invite: {
            code: existingForUser.code,
            token: existingForUser.token || undefined,
            used: !!existingForUser.used_by,
          },
        });
      }

      for (let i = 0; i < 5; i++) {
        const t = generateJoinToken();
        const exists = db.prepare('SELECT 1 FROM invitations WHERE token = ?').get(t);
        if (!exists) { token = t; break; }
      }
      if (!token) token = generateJoinToken() + Date.now().toString(36).slice(-4);
    }

    const defaultPermissions = req.body.default_permissions
      ? JSON.stringify(req.body.default_permissions)
      : '{}';
    db.prepare(
      'INSERT INTO invitations (code, created_by, expires_at, note, default_permissions, token, nume, prenume) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(code, req.user.id, expiresAt, note, defaultPermissions, token, nume, prenume);
    logEvent('invite_created', `Admin ${req.user.username} created invite ${code}${note ? ': ' + note : ''}`, {
      admin_id: req.user.id,
      code,
      note,
    });
    return res.json({
      code,
      token: token || undefined,
      join_link: token ? JOIN_BASE_URL : undefined,
      nume: nume || undefined,
      prenume: prenume || undefined,
      expires_at: expiresAt,
      note,
      default_permissions: req.body.default_permissions || {},
    });
  };

  Promise.resolve(send()).catch((err) => {
    res.status(500).json({ error: err.message || 'Failed to create invite' });
  });
});

// DELETE /api/admin/invites/:id — revoke unused invite
router.delete('/invites/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid invite id' });
  const db = getDb();
  const invite = db.prepare('SELECT * FROM invitations WHERE id = ?').get(id);
  if (!invite) return res.status(404).json({ error: 'Not found' });
  if (invite.used_by) return res.status(400).json({ error: 'Already used — cannot revoke' });
  db.prepare('DELETE FROM invitations WHERE id = ?').run(id);
  res.json({ ok: true });
});

// GET /api/admin/rooms — list all non-archived channel/group rooms (admin only)
router.get('/rooms', (req, res) => {
  const db = getDb();
  const rooms = db.prepare(`
    SELECT r.id, r.name, r.type,
      (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) as member_count
    FROM rooms r
    WHERE r.is_archived = 0 AND r.type IN ('channel', 'group')
    ORDER BY r.name ASC
  `).all();
  res.json({ rooms });
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
  logEvent('permissions_changed', `Admin ${req.user.username} updated permissions for user ${userId}`, {
    admin_id: req.user.id,
    target_user_id: userId,
  });
  res.json({ permissions: perms });
});

// GET /api/admin/search?q=...&collection=all|messages|admin_events
router.get('/search', async (req, res) => {
  const q = req.query.q;
  const collection = req.query.collection || 'all';
  if (!q || q.trim().length < 2) return res.status(400).json({ error: 'q must be at least 2 characters' });

  try {
    let results = [];
    if (collection === 'all' || collection === 'messages') {
      const msgs = await search('messages', q, 8);
      results.push(...msgs.map(r => ({ ...r, collection: 'messages' })));
    }
    if (collection === 'all' || collection === 'admin_events') {
      const evts = await search('admin_events', q, 5);
      results.push(...evts.map(r => ({ ...r, collection: 'admin_events' })));
    }
    results.sort((a, b) => b.score - a.score);
    res.json({ results: results.slice(0, 10) });
  } catch (err) {
    res.status(500).json({ error: 'Search failed', detail: err.message });
  }
});

// GET /api/admin/agent-memory/stats
router.get('/agent-memory/stats', (req, res) => {
  try {
    const stats = listAgentMemoryStats();
    res.json({
      collections: stats,
      total_collections: stats.length,
      total_docs: stats.reduce((acc, item) => acc + (item.doc_count || 0), 0),
    });
  } catch (err) {
    res.status(500).json({ error: 'Agent memory stats failed', detail: err.message });
  }
});

// POST /api/admin/agent-memory/prune
router.post('/agent-memory/prune', async (req, res) => {
  const ttlDays = Math.min(Math.max(parseInt(req.body.ttl_days, 10) || 30, 1), 3650);
  const maxDocs = Math.min(Math.max(parseInt(req.body.max_docs_per_agent, 10) || 5000, 100), 100000);
  const dryRun = !!req.body.dry_run;
  const agentUsername = req.body.agent_username && String(req.body.agent_username).trim()
    ? String(req.body.agent_username).trim()
    : null;

  try {
    const result = await pruneAgentMemory({
      agent_username: agentUsername,
      ttl_days: ttlDays,
      max_docs_per_agent: maxDocs,
      dry_run: dryRun,
    });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Agent memory prune failed', detail: err.message });
  }
});

const HUB_ACTION_TYPES = ['url', 'room', 'script', 'internal_app'];

// GET /api/admin/hub-cards
router.get('/hub-cards', (req, res) => {
  const db = getDb();
  const cards = db.prepare('SELECT * FROM hub_cards ORDER BY sort_order ASC, id ASC').all();
  res.json({ cards });
});

// POST /api/admin/hub-cards
router.post('/hub-cards', (req, res) => {
  const db = getDb();
  const { title, description, icon, image_url, accent_color, action_type, action_payload, sort_order } = req.body;
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title required' });
  }
  if (!action_type || !HUB_ACTION_TYPES.includes(action_type)) {
    return res.status(400).json({ error: 'action_type must be one of: url, room, script, internal_app' });
  }
  if (action_payload === undefined || action_payload === null || String(action_payload).trim() === '') {
    return res.status(400).json({ error: 'action_payload required' });
  }
  const payload = String(action_payload).trim();
  if (action_type === 'room' && !/^\d+$/.test(payload)) {
    return res.status(400).json({ error: 'action_payload for room must be a numeric id' });
  }
  const nextOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as n FROM hub_cards').get().n;
  const order = typeof sort_order === 'number' && Number.isInteger(sort_order) ? sort_order : nextOrder;
  const result = db.prepare(`
    INSERT INTO hub_cards (title, description, icon, image_url, accent_color, action_type, action_payload, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    title.trim(),
    description && typeof description === 'string' ? description.trim() || null : null,
    icon && typeof icon === 'string' ? icon.trim() || null : null,
    image_url && typeof image_url === 'string' ? image_url.trim() || null : null,
    accent_color && typeof accent_color === 'string' ? accent_color.trim() || null : null,
    action_type,
    payload,
    order
  );
  const card = db.prepare('SELECT * FROM hub_cards WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ card });
});

// PUT /api/admin/hub-cards/:id
router.put('/hub-cards/:id', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const card = db.prepare('SELECT * FROM hub_cards WHERE id = ?').get(id);
  if (!card) return res.status(404).json({ error: 'Card not found' });
  const { title, description, icon, image_url, accent_color, action_type, action_payload, sort_order } = req.body;
  const updates = [];
  const values = [];
  if (title !== undefined) {
    if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'title must be non-empty string' });
    updates.push('title = ?'); values.push(title.trim());
  }
  if (description !== undefined) { updates.push('description = ?'); values.push(description && String(description).trim() || null); }
  if (icon !== undefined) { updates.push('icon = ?'); values.push(icon && String(icon).trim() || null); }
  if (image_url !== undefined) { updates.push('image_url = ?'); values.push(image_url && String(image_url).trim() || null); }
  if (accent_color !== undefined) { updates.push('accent_color = ?'); values.push(accent_color && String(accent_color).trim() || null); }
  if (action_type !== undefined) {
    if (!HUB_ACTION_TYPES.includes(action_type)) return res.status(400).json({ error: 'action_type must be one of: url, room, script, internal_app' });
    updates.push('action_type = ?'); values.push(action_type);
  }
  if (action_payload !== undefined) {
    const payload = String(action_payload).trim();
    if (payload === '') return res.status(400).json({ error: 'action_payload cannot be empty' });
    const type = action_type !== undefined ? action_type : card.action_type;
    if (type === 'room' && !/^\d+$/.test(payload)) return res.status(400).json({ error: 'action_payload for room must be a numeric id' });
    updates.push('action_payload = ?'); values.push(payload);
  }
  if (sort_order !== undefined && typeof sort_order === 'number' && Number.isInteger(sort_order)) {
    updates.push('sort_order = ?'); values.push(sort_order);
  }
  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });
  values.push(id);
  db.prepare(`UPDATE hub_cards SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const updated = db.prepare('SELECT * FROM hub_cards WHERE id = ?').get(id);
  res.json({ card: updated });
});

// DELETE /api/admin/hub-cards/:id
router.delete('/hub-cards/:id', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const card = db.prepare('SELECT id FROM hub_cards WHERE id = ?').get(id);
  if (!card) return res.status(404).json({ error: 'Card not found' });
  db.prepare('DELETE FROM hub_cards WHERE id = ?').run(id);
  res.json({ ok: true });
});

module.exports = router;
