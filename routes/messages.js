const express = require('express');
const { z } = require('zod');
const { getDb, getDbDriver, getPgPool } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { getPermission } = require('../middleware/permissions');
const { assertCanPostMessage } = require('../middleware/policy');
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

async function findOrCreatePrivateRoomPg(pool, userId1, userId2) {
  const existing = (await pool.query(
    `
    SELECT r.id
    FROM rooms r
    JOIN room_members rm1 ON r.id = rm1.room_id AND rm1.user_id = $1
    JOIN room_members rm2 ON r.id = rm2.room_id AND rm2.user_id = $2
    WHERE r.type = 'private' AND r.is_archived = false
    LIMIT 1
    `,
    [Number(userId1), Number(userId2)]
  )).rows[0];
  if (existing) return { id: Number(existing.id), isNew: false };

  await pool.query('BEGIN');
  try {
    const created = (await pool.query(
      "INSERT INTO rooms (name, type, created_by) VALUES ($1, 'private', $2) RETURNING id",
      [`private-${userId1}-${userId2}`, Number(userId1)]
    )).rows[0];
    const roomId = Number(created.id);
    await pool.query(
      'INSERT INTO room_members (room_id, user_id, role, access_level, color_index) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
      [roomId, Number(userId1), 'owner', 'readandwrite', 0]
    );
    await pool.query(
      'INSERT INTO room_members (room_id, user_id, role, access_level, color_index) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
      [roomId, Number(userId2), 'member', 'readandwrite', 1]
    );
    await pool.query('COMMIT');
    return { id: roomId, isNew: true };
  } catch (e) {
    try { await pool.query('ROLLBACK'); } catch {}
    throw e;
  }
}

function findOrCreatePrivateRoomSqlite(db, userId1, userId2) {
  const existing = db.prepare(`
    SELECT r.id FROM rooms r
    JOIN room_members rm1 ON r.id = rm1.room_id AND rm1.user_id = ?
    JOIN room_members rm2 ON r.id = rm2.room_id AND rm2.user_id = ?
    WHERE r.type = 'private' AND r.is_archived = 0
    LIMIT 1
  `).get(userId1, userId2);
  if (existing) return { id: existing.id, isNew: false };

  const id = db.transaction(() => {
    const r = db.prepare(
      "INSERT INTO rooms (name, type, created_by) VALUES (?, 'private', ?)"
    ).run(`private-${userId1}-${userId2}`, userId1);
    const roomId = r.lastInsertRowid;
    const add = db.prepare(
      'INSERT OR IGNORE INTO room_members (room_id, user_id, role, access_level, color_index) VALUES (?, ?, ?, ?, ?)'
    );
    add.run(roomId, userId1, 'owner', 'readandwrite', 0);
    add.run(roomId, userId2, 'member', 'readandwrite', 1);
    return roomId;
  })();
  return { id, isNew: true };
}

async function getUserPermissionPg(pool, userId, permission) {
  const row = (await pool.query(
    'SELECT value FROM user_permissions WHERE user_id = $1 AND permission = $2',
    [userId, permission]
  )).rows[0];
  if (!row) return null;
  return row.value;
}

async function queueAgentRoomMemoryPg(pool, roomId, text, metadata) {
  const agentsInRoom = (await pool.query(
    `
    SELECT u.username
    FROM room_members rm
    JOIN users u ON rm.user_id = u.id
    WHERE rm.room_id = $1 AND u.role = 'agent'
    `,
    [roomId]
  )).rows;
  if (!agentsInRoom.length) return;
  for (const agent of agentsInRoom) {
    addAgentMemory(agent.username, text, {
      ...metadata,
      room_id: roomId,
    }).catch(() => {});
  }
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
  const roomId = req.params.id;
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const before = req.query.before ? parseInt(req.query.before) : null;

  const driver = getDbDriver();

  const send = async () => {
    if (driver === 'postgres') {
      const pool = getPgPool();
      const roomIdNum = Number(roomId);
      const userId = Number(req.user.id);

      const membershipQ = await pool.query(
        'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
        [roomIdNum, userId]
      );
      if (membershipQ.rowCount === 0) {
        return res.status(403).json({ error: 'Not a member of this room' });
      }

      const BASE_SELECT = `
        SELECT
          m.id,
          m.room_id,
          m.sender_id,
          m.text,
          m.type,
          m.file_url,
          m.file_name,
          m.reply_to,
          CASE WHEN m.is_edited THEN 1 ELSE 0 END as is_edited,
          m.recipient_id,
          m.created_at,
          u.username as sender_username,
          u.username as sender_name,
          u.role as sender_role,
          COALESCE(rmc.color_index, u.chat_color_index) as sender_color_index,
          reply_m.text as reply_to_text,
          ru.username as reply_to_sender,
          rec.username as recipient_username,
          rec.username as recipient_name
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        LEFT JOIN room_members rmc ON rmc.room_id = m.room_id AND rmc.user_id = m.sender_id
        LEFT JOIN messages reply_m ON reply_m.id = m.reply_to
        LEFT JOIN users ru ON ru.id = reply_m.sender_id
        LEFT JOIN users rec ON rec.id = m.recipient_id
      `;

      const visFilter = 'AND (m.recipient_id IS NULL OR m.sender_id = $2 OR m.recipient_id = $2)';
      const query = before
        ? `${BASE_SELECT} WHERE m.room_id = $1 ${visFilter} AND m.id < $3 ORDER BY m.created_at DESC LIMIT $4`
        : `${BASE_SELECT} WHERE m.room_id = $1 ${visFilter} ORDER BY m.created_at DESC LIMIT $3`;

      const args = before
        ? [roomIdNum, userId, Number(before), Number(limit)]
        : [roomIdNum, userId, Number(limit)];

      const rows = (await pool.query(query, args)).rows;
      const messages = rows.reverse();

      // Attach reactions
      const msgIds = messages.map((m) => Number(m.id)).filter((n) => Number.isFinite(n));
      if (msgIds.length) {
        const reactionRows = (await pool.query(
          `
          SELECT message_id, emoji, COUNT(*)::int as count
          FROM message_reactions
          WHERE message_id = ANY($1::bigint[])
          GROUP BY message_id, emoji
          `,
          [msgIds]
        )).rows;

        const reactionMap = {};
        reactionRows.forEach((r) => {
          const mid = Number(r.message_id);
          if (!reactionMap[mid]) reactionMap[mid] = [];
          reactionMap[mid].push({ emoji: r.emoji, count: Number(r.count) });
        });
        messages.forEach((m) => {
          const mid = Number(m.id);
          m.reactions = reactionMap[mid] || [];
        });
      }

      return res.json({ messages, has_more: messages.length === limit });
    }

    const db = getDb();

    const membership = db.prepare(
      'SELECT * FROM room_members WHERE room_id = ? AND user_id = ?'
    ).get(roomId, req.user.id);
    if (!membership) return res.status(403).json({ error: 'Not a member of this room' });

    const BASE_SELECT = `
      SELECT m.*,
        u.username as sender_username, u.username as sender_name,
        u.role as sender_role,
        COALESCE(rmc.color_index, u.chat_color_index) as sender_color_index,
        reply_m.text as reply_to_text,
        ru.username as reply_to_sender,
        rec.username as recipient_username, rec.username as recipient_name
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
  };

  Promise.resolve(send()).catch((err) => {
    res.status(500).json({ error: err.message || 'Failed to fetch messages' });
  });
});

// POST /api/rooms/:id/messages
router.post('/:id/messages', (req, res) => {
  const result = sendSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ error: result.error.issues[0].message });

  const driver = getDbDriver();
  const roomId = req.params.id;
  const { text, type, reply_to } = result.data;

  const send = async () => {
    const policy = await assertCanPostMessage({
      roomId,
      user: req.user,
      messageType: type || 'text',
    });
    if (!policy.ok) return res.status(policy.status).json({ error: policy.error });

    const actualText = text.trim();
    const atMatch = actualText.match(/^@(\S+)\s+([\s\S]+)$/);
    if (atMatch) {
      if (driver === 'postgres') {
        const pool = getPgPool();
        const fromId = Number(req.user.id);
        const targetRow = (await pool.query(
          'SELECT id, username FROM users WHERE lower(username) = lower($1) LIMIT 1',
          [atMatch[1]]
        )).rows[0];
        if (!targetRow) return res.status(400).json({ error: `Utilizatorul @${atMatch[1]} nu există.` });
        const targetId = Number(targetRow.id);
        if (targetId === fromId) return res.status(400).json({ error: 'Nu poți trimite mesaj ție însuți.' });

        const dmText = atMatch[2].trim();
        const { id: dmRoomId, isNew } = await findOrCreatePrivateRoomPg(pool, fromId, targetId);
        const inserted = (await pool.query(
          `
          INSERT INTO messages (room_id, sender_id, text, type, reply_to)
          VALUES ($1, $2, $3, 'text', $4)
          RETURNING id
          `,
          [Number(dmRoomId), fromId, dmText, reply_to ? Number(reply_to) : null]
        )).rows[0];
        const msgId = Number(inserted.id);

        const message = (await pool.query(
          `
          SELECT
            m.id,
            m.room_id,
            m.sender_id,
            m.text,
            m.type,
            m.file_url,
            m.file_name,
            m.reply_to,
            CASE WHEN m.is_edited THEN 1 ELSE 0 END as is_edited,
            m.recipient_id,
            m.created_at,
            u.username as sender_username,
            u.username as sender_name,
            u.role as sender_role,
            COALESCE(rmc.color_index, u.chat_color_index) as sender_color_index
          FROM messages m
          JOIN users u ON m.sender_id = u.id
          LEFT JOIN room_members rmc ON rmc.room_id = m.room_id AND rmc.user_id = m.sender_id
          WHERE m.id = $1
          `,
          [msgId]
        )).rows[0];
        message.reactions = [];

        const io = req.app.get('io');
        if (isNew) {
          const dmRoom = (await pool.query('SELECT * FROM rooms WHERE id = $1', [Number(dmRoomId)])).rows[0];
          io.to(`user:${fromId}`).emit('room_added', { room: { ...dmRoom, display_name: targetRow.username }, silent: true });
          io.to(`user:${targetId}`).emit('room_added', { room: { ...dmRoom, display_name: req.user.username }, silent: true });
        }
        io.to(`user:${fromId}`).to(`user:${targetId}`).emit('message', message);

        return res.json({ message });
      }

      const db = getDb();
      const fromId = Number(req.user.id);
      const target = db.prepare(
        'SELECT id, username FROM users WHERE username = ? COLLATE NOCASE'
      ).get(atMatch[1]);
      if (!target) return res.status(400).json({ error: `Utilizatorul @${atMatch[1]} nu există.` });
      const targetId = Number(target.id);
      if (targetId === fromId) return res.status(400).json({ error: 'Nu poți trimite mesaj ție însuți.' });

      const dmText = atMatch[2].trim();
      const { id: dmRoomId, isNew } = findOrCreatePrivateRoomSqlite(db, fromId, targetId);
      const dmResult = db.prepare(
        'INSERT INTO messages (room_id, sender_id, text, type, reply_to) VALUES (?, ?, ?, ?, ?)'
      ).run(dmRoomId, fromId, dmText, 'text', reply_to || null);
      const msgId = dmResult.lastInsertRowid;

      const message = db.prepare(`
        SELECT m.*, u.username as sender_username, u.username as sender_name, u.role as sender_role,
               COALESCE(rmc.color_index, u.chat_color_index) as sender_color_index
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        LEFT JOIN room_members rmc ON rmc.room_id = m.room_id AND rmc.user_id = m.sender_id
        WHERE m.id = ?
      `).get(msgId);

      const io = req.app.get('io');
      if (isNew) {
        const dmRoom = db.prepare('SELECT * FROM rooms WHERE id = ?').get(dmRoomId);
        io.to(`user:${fromId}`).emit('room_added', { room: { ...dmRoom, display_name: target.username }, silent: true });
        io.to(`user:${targetId}`).emit('room_added', { room: { ...dmRoom, display_name: req.user.username }, silent: true });
      }
      io.to(`user:${fromId}`).to(`user:${targetId}`).emit('message', message);

      return res.json({ message });
    }

    if (driver === 'postgres') {
      const pool = getPgPool();
      const roomIdNum = Number(roomId);
      const userId = Number(req.user.id);
      const replyTo = reply_to ? Number(reply_to) : null;

      const inserted = (await pool.query(
        `
        INSERT INTO messages (room_id, sender_id, text, type, reply_to)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
        `,
        [roomIdNum, userId, text, type || 'text', replyTo]
      )).rows[0];
      const msgId = Number(inserted.id);

      // Vectorize message (fire-and-forget)
      const senderName = req.user.username;
      setImmediate(() => {
        addDocument('messages', text, {
          message_id: msgId,
          room_id: roomIdNum,
          sender_id: userId,
          sender: senderName,
          ts: new Date().toISOString(),
        }).catch(() => {});
        queueAgentRoomMemoryPg(pool, roomIdNum, text, {
          message_id: msgId,
          sender_id: userId,
          sender: senderName,
          sender_username: req.user.username,
          sender_role: req.user.role,
          memory_type: 'room_message',
          ts: new Date().toISOString(),
        }).catch(() => {});
      });

      const message = (await pool.query(
        `
        SELECT
          m.id,
          m.room_id,
          m.sender_id,
          m.text,
          m.type,
          m.file_url,
          m.file_name,
          m.reply_to,
          CASE WHEN m.is_edited THEN 1 ELSE 0 END as is_edited,
          m.recipient_id,
          m.created_at,
          u.username as sender_username,
          u.username as sender_name,
          u.role as sender_role,
          COALESCE(rmc.color_index, u.chat_color_index) as sender_color_index
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        LEFT JOIN room_members rmc ON rmc.room_id = m.room_id AND rmc.user_id = m.sender_id
        WHERE m.id = $1
        `,
        [msgId]
      )).rows[0];

      message.reactions = [];

      const io = req.app.get('io');
      io.to(`room:${roomId}`).emit('message', message);
      return res.json({ message });
    }

    const db = getDb();

    const r = db.prepare(
      'INSERT INTO messages (room_id, sender_id, text, type, reply_to) VALUES (?, ?, ?, ?, ?)'
    ).run(roomId, req.user.id, text, type || 'text', reply_to || null);

    // Vectorize message (fire-and-forget)
    const msgId = r.lastInsertRowid;
    const senderName = req.user.username;
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
      SELECT m.*, u.username as sender_username, u.username as sender_name, u.role as sender_role, u.chat_color_index as sender_color_index
      FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?
    `).get(r.lastInsertRowid);

    const io = req.app.get('io');
    io.to(`room:${roomId}`).emit('message', message);

    res.json({ message });
  };

  Promise.resolve(send()).catch((err) => {
    res.status(500).json({ error: err.message || 'Failed to send message' });
  });
});

function handleEditMessage(req, res) {
  const result = editSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ error: result.error.issues[0].message });

  const driver = getDbDriver();

  const send = async () => {
    if (driver === 'postgres') {
      const pool = getPgPool();
      const msgId = Number(req.params.id);
      const userId = Number(req.user.id);
      const text = result.data.text;

      const msgRow = (await pool.query(
        'SELECT id, sender_id FROM messages WHERE id = $1',
        [msgId]
      )).rows[0];
      if (!msgRow) return res.status(404).json({ error: 'Message not found' });
      if (Number(msgRow.sender_id) !== userId) {
        return res.status(403).json({ error: 'Can only edit your own messages' });
      }

      await pool.query('UPDATE messages SET text = $1, is_edited = true WHERE id = $2', [text, msgId]);

      const updated = (await pool.query(
        `
        SELECT
          m.id,
          m.room_id,
          m.sender_id,
          m.text,
          m.type,
          m.file_url,
          m.file_name,
          m.reply_to,
          CASE WHEN m.is_edited THEN 1 ELSE 0 END as is_edited,
          m.recipient_id,
          m.created_at,
          u.username as sender_username,
          u.username as sender_name,
          u.role as sender_role,
          COALESCE(rmc.color_index, u.chat_color_index) as sender_color_index
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        LEFT JOIN room_members rmc ON rmc.room_id = m.room_id AND rmc.user_id = m.sender_id
        WHERE m.id = $1
        `,
        [msgId]
      )).rows[0];

      updated.reactions = [];

      const io = req.app.get('io');
      io.to(`room:${updated.room_id}`).emit('message_edited', {
        message_id: String(updated.id),
        text: updated.text,
        room_id: String(updated.room_id),
      });
      return res.json({ message: updated });
    }

    const db = getDb();
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.sender_id !== req.user.id) return res.status(403).json({ error: 'Can only edit your own messages' });

    db.prepare("UPDATE messages SET text = ?, is_edited = 1 WHERE id = ?")
      .run(result.data.text, msg.id);

    const updated = db.prepare(`
      SELECT m.*, u.username as sender_username, u.username as sender_name, u.role as sender_role, u.chat_color_index as sender_color_index
      FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?
    `).get(msg.id);

    const io = req.app.get('io');
    io.to(`room:${updated.room_id}`).emit('message_edited', {
      message_id: String(updated.id),
      text: updated.text,
      room_id: String(updated.room_id),
    });

    res.json({ message: updated });
  };

  Promise.resolve(send()).catch((err) => {
    res.status(500).json({ error: err.message || 'Failed to edit message' });
  });
}

// PUT /api/messages/:id — edit own message
router.put('/messages/:id', handleEditMessage);
// Alias for when this router is mounted at /api/messages
router.put('/:id', handleEditMessage);

function handleDeleteMessage(req, res) {
  const driver = getDbDriver();

  const send = async () => {
    if (driver === 'postgres') {
      const pool = getPgPool();
      const msgId = Number(req.params.id);
      const userId = Number(req.user.id);

      const msg = (await pool.query('SELECT id, room_id, sender_id FROM messages WHERE id = $1', [msgId])).rows[0];
      if (!msg) return res.status(404).json({ error: 'Message not found' });

      const isOwner = Number(msg.sender_id) === userId;
      const isAdmin = req.user.role === 'admin';
      if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Not allowed' });

      await pool.query('DELETE FROM message_reads WHERE message_id = $1', [msgId]);
      await pool.query('DELETE FROM message_reactions WHERE message_id = $1', [msgId]);
      await pool.query('DELETE FROM messages WHERE id = $1', [msgId]);

      const io = req.app.get('io');
      io.to(`room:${msg.room_id}`).emit('message_deleted', {
        message_id: String(msg.id),
        room_id: String(msg.room_id),
      });

      return res.json({ deleted: true, message_id: String(msg.id), room_id: String(msg.room_id) });
    }

    const db = getDb();
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    const isOwner = msg.sender_id === req.user.id;
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Not allowed' });

    db.prepare('DELETE FROM message_reads WHERE message_id = ?').run(msg.id);
    db.prepare('DELETE FROM messages WHERE id = ?').run(msg.id);

    const io = req.app.get('io');
    io.to(`room:${msg.room_id}`).emit('message_deleted', {
      message_id: String(msg.id),
      room_id: String(msg.room_id),
    });

    res.json({ deleted: true, message_id: msg.id, room_id: msg.room_id });
  };

  Promise.resolve(send()).catch((err) => {
    res.status(500).json({ error: err.message || 'Failed to delete message' });
  });
}

// DELETE /api/messages/:id — delete own message or admin
router.delete('/messages/:id', handleDeleteMessage);
// Alias for when this router is mounted at /api/messages
router.delete('/:id', handleDeleteMessage);

// GET /api/rooms/:id/search?q=text
router.get('/:id/search', (req, res) => {
  const roomId = req.params.id;
  const q = (req.query.q || '').trim();

  if (!q || q.length < 2) return res.status(400).json({ error: 'Query too short' });

  const driver = getDbDriver();

  const send = async () => {
    if (driver === 'postgres') {
      const pool = getPgPool();
      const roomIdNum = Number(roomId);
      const userId = Number(req.user.id);

      const membershipQ = await pool.query(
        'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
        [roomIdNum, userId]
      );
      if (membershipQ.rowCount === 0) {
        return res.status(403).json({ error: 'Not a member of this room' });
      }

      const escapedQ = q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      const like = `%${escapedQ}%`;

      const rows = (await pool.query(
        `
        SELECT
          m.id,
          m.room_id,
          m.sender_id,
          m.text,
          m.type,
          m.file_url,
          m.file_name,
          m.reply_to,
          CASE WHEN m.is_edited THEN 1 ELSE 0 END as is_edited,
          m.recipient_id,
          m.created_at,
          u.username as sender_username,
          u.username as sender_name,
          u.role as sender_role,
          COALESCE(rmc.color_index, u.chat_color_index) as sender_color_index
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        LEFT JOIN room_members rmc ON rmc.room_id = m.room_id AND rmc.user_id = m.sender_id
        WHERE m.room_id = $1
          AND (m.recipient_id IS NULL OR m.sender_id = $2 OR m.recipient_id = $2)
          AND m.text ILIKE $3 ESCAPE '\\'
        ORDER BY m.created_at DESC
        LIMIT 50
        `,
        [roomIdNum, userId, like]
      )).rows;

      return res.json({ messages: rows, query: q });
    }

    const db = getDb();
    const membership = db.prepare(
      'SELECT * FROM room_members WHERE room_id = ? AND user_id = ?'
    ).get(roomId, req.user.id);
    if (!membership) return res.status(403).json({ error: 'Not a member of this room' });

    const escapedQ = q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    const messages = db.prepare(`
      SELECT m.*, u.username as sender_username, u.username as sender_name, u.role as sender_role, u.chat_color_index as sender_color_index
      FROM messages m JOIN users u ON m.sender_id = u.id
      WHERE m.room_id = ?
        AND (m.recipient_id IS NULL OR m.sender_id = ? OR m.recipient_id = ?)
        AND m.text LIKE ? ESCAPE '\\'
      ORDER BY m.created_at DESC LIMIT 50
    `).all(roomId, req.user.id, req.user.id, `%${escapedQ}%`);

    res.json({ messages, query: q });
  };

  Promise.resolve(send()).catch((err) => {
    res.status(500).json({ error: err.message || 'Search failed' });
  });
});

// DELETE /api/rooms/:id/messages — clear all messages in a room (admin only)
router.delete('/:id/messages', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const roomId = req.params.id;

  const driver = getDbDriver();

  const send = async () => {
    if (driver === 'postgres') {
      const pool = getPgPool();
      const roomIdNum = Number(roomId);

      const room = (await pool.query('SELECT id FROM rooms WHERE id = $1', [roomIdNum])).rows[0];
      if (!room) return res.status(404).json({ error: 'Room not found' });

      const countRow = (await pool.query('SELECT COUNT(*)::int as count FROM messages WHERE room_id = $1', [roomIdNum])).rows[0];
      const count = Number(countRow.count);

      await pool.query('BEGIN');
      try {
        await pool.query(
          'DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE room_id = $1)',
          [roomIdNum]
        );
        await pool.query(
          'DELETE FROM message_reads WHERE message_id IN (SELECT id FROM messages WHERE room_id = $1)',
          [roomIdNum]
        );
        await pool.query('DELETE FROM messages WHERE room_id = $1', [roomIdNum]);
        await pool.query('COMMIT');
      } catch (e) {
        try { await pool.query('ROLLBACK'); } catch {}
        throw e;
      }

      const io = req.app.get('io');
      io.to(`room:${roomId}`).emit('room_cleared', { room_id: roomId });

      return res.json({ ok: true, deleted: count, room_id: roomId });
    }

    const db = getDb();
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
  };

  Promise.resolve(send()).catch((err) => {
    res.status(500).json({ error: err.message || 'Failed to clear room' });
  });
});

module.exports = router;
