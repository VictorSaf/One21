const express = require('express');
const { z } = require('zod');
const { getDb, getDbDriver, getPgPool } = require('../db');
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

async function assignRoomColorPg(client, roomId) {
  const used = (await client.query(
    'SELECT color_index FROM room_members WHERE room_id = $1 AND color_index IS NOT NULL',
    [Number(roomId)]
  )).rows.map((r) => Number(r.color_index));
  for (let i = 0; i < 8; i++) {
    if (!used.includes(i)) return i;
  }
  return used.length % 8;
}

const createSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(200).optional(),
  type: z.enum(['group', 'channel', 'cult']).optional(),
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
  const driver = getDbDriver();

  const send = async () => {
    if (driver === 'postgres') {
      const pool = getPgPool();
      const userId = Number(req.user.id);
      const { rows } = await pool.query(
        `
        SELECT
          r.id,
          r.name,
          r.description,
          r.type,
          CASE WHEN r.is_archived THEN 1 ELSE 0 END as is_archived,
          r.created_by,
          r.created_at,
          rm.role as my_role,
          rm.access_level as my_access_level,
          CASE WHEN r.type IN ('private', 'direct')
            THEN (
              SELECT u.username
              FROM room_members rm2
              JOIN users u ON u.id = rm2.user_id
              WHERE rm2.room_id = r.id AND rm2.user_id <> rm.user_id
              LIMIT 1
            )
            ELSE r.name
          END as display_name,
          (SELECT COUNT(*)::int FROM room_members WHERE room_id = r.id) as member_count,
          (SELECT m.text FROM messages m WHERE m.room_id = r.id AND m.recipient_id IS NULL ORDER BY m.created_at DESC LIMIT 1) as last_message,
          (SELECT m.created_at FROM messages m WHERE m.room_id = r.id AND m.recipient_id IS NULL ORDER BY m.created_at DESC LIMIT 1) as last_message_at,
          (SELECT u.username FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.room_id = r.id AND m.recipient_id IS NULL ORDER BY m.created_at DESC LIMIT 1) as last_message_sender,
          (
            SELECT COUNT(*)::int
            FROM messages m
            WHERE m.room_id = r.id
              AND m.sender_id <> $1
              AND (m.recipient_id IS NULL OR m.recipient_id = rm.user_id)
              AND NOT EXISTS (
                SELECT 1 FROM message_reads mr
                WHERE mr.user_id = $1 AND mr.message_id = m.id
              )
          ) as unread_count
        FROM rooms r
        JOIN room_members rm ON r.id = rm.room_id AND rm.user_id = $1
        WHERE r.is_archived = false
        ORDER BY last_message_at DESC NULLS LAST
        `,
        [userId]
      );
      return res.json({ rooms: rows });
    }

    const db = getDb();
    const rooms = db.prepare(`
      SELECT r.*, rm.role as my_role, rm.access_level as my_access_level,
        CASE WHEN r.type IN ('private', 'direct')
          THEN (
            SELECT u.username FROM room_members rm2
            JOIN users u ON u.id = rm2.user_id
            WHERE rm2.room_id = r.id AND rm2.user_id != rm.user_id
            LIMIT 1
          )
          ELSE r.name
        END as display_name,
        (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) as member_count,
        (SELECT m.text FROM messages m WHERE m.room_id = r.id AND m.recipient_id IS NULL ORDER BY m.created_at DESC LIMIT 1) as last_message,
        (SELECT m.created_at FROM messages m WHERE m.room_id = r.id AND m.recipient_id IS NULL ORDER BY m.created_at DESC LIMIT 1) as last_message_at,
        (SELECT u.username FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.room_id = r.id AND m.recipient_id IS NULL ORDER BY m.created_at DESC LIMIT 1) as last_message_sender,
        (SELECT COUNT(*) FROM messages m
         WHERE m.room_id = r.id
           AND m.sender_id != ?
           AND (m.recipient_id IS NULL OR m.recipient_id = rm.user_id)
           AND m.id NOT IN (SELECT message_id FROM message_reads WHERE user_id = ?)) as unread_count
      FROM rooms r
      JOIN room_members rm ON r.id = rm.room_id AND rm.user_id = ?
      WHERE r.is_archived = 0
      ORDER BY last_message_at DESC NULLS LAST
    `).all(req.user.id, req.user.id, req.user.id);
    res.json({ rooms });
  };

  Promise.resolve(send()).catch((err) => {
    res.status(500).json({ error: err.message || 'Failed to list rooms' });
  });
});

// POST /api/rooms/direct — deprecated; direct messages replaced by whispers in General
router.post('/direct', (req, res) => {
  return res.status(410).json({ error: 'Direct messages sunt dezactivate. Folosește @username în General pentru mesaje private.' });
});

// POST /api/rooms — create room
router.post('/', (req, res) => {
  const result = createSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ error: result.error.issues[0].message });

  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Users cannot create rooms directly. Submit a room request instead.' });
  }

  const { name, description, type, member_ids, member_access } = result.data;
  const driver = getDbDriver();

  const send = async () => {
    if (driver === 'postgres') {
      const pool = getPgPool();
      const roomType = type || 'group';
      const userId = Number(req.user.id);

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        const roomInsert = await client.query(
          `
          INSERT INTO rooms (name, description, type, created_by)
          VALUES ($1, $2, $3, $4)
          RETURNING *
          `,
          [name, description || null, roomType, userId]
        );
        const room = roomInsert.rows[0];

        // Owner membership
        await client.query(
          `
          INSERT INTO room_members (room_id, user_id, role, access_level, color_index)
          VALUES ($1, $2, 'owner', 'readandwrite', 0)
          ON CONFLICT (room_id, user_id) DO NOTHING
          `,
          [room.id, userId]
        );

        // Helpers for adding members w/ deterministic colors (room is new, so safe)
        const addMember = async (uid, accessLevel, colorIndex) => {
          await client.query(
            `
            INSERT INTO room_members (room_id, user_id, role, access_level, color_index)
            VALUES ($1, $2, 'member', $3, $4)
            ON CONFLICT (room_id, user_id) DO NOTHING
            `,
            [room.id, Number(uid), accessLevel, colorIndex]
          );
        };

        if (roomType === 'channel') {
          // Canale: toți userii (fără agenți) sunt membri
          const nonAgents = (await client.query(
            "SELECT id FROM users WHERE role != 'agent' AND id != $1 ORDER BY id",
            [userId]
          )).rows;
          for (let i = 0; i < nonAgents.length; i++) {
            const uid = Number(nonAgents[i].id);
            await addMember(uid, 'readandwrite', (i + 1) % 8);
          }
        } else if (roomType === 'cult') {
          // Auto-add all active AI agents to cult rooms
          const agents = (await client.query(
            "SELECT id FROM users WHERE role = 'agent' ORDER BY id"
          )).rows;
          for (let i = 0; i < agents.length; i++) {
            const uid = Number(agents[i].id);
            await addMember(uid, 'readandwrite', (i + 1) % 8);
          }

          if (Array.isArray(member_ids)) {
            let colorCounter = agents.length + 1;
            for (const uid of member_ids) {
              if (Number(uid) !== userId) {
                const accessLevel = normalizeAccessLevel(member_access && member_access[String(uid)]);
                await addMember(uid, accessLevel, colorCounter % 8);
                colorCounter++;
              }
            }
          }
        } else if (Array.isArray(member_ids)) {
          let colorCounter = 1; // owner already has 0
          for (const uid of member_ids) {
            if (Number(uid) !== userId) {
              const accessLevel = normalizeAccessLevel(member_access && member_access[String(uid)]);
              await addMember(uid, accessLevel, colorCounter % 8);
              colorCounter++;
            }
          }
        }

        await client.query('COMMIT');
        return res.json({ room: { ...room, id: String(room.id) } });
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        throw err;
      } finally {
        client.release();
      }
    }

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
      } else if (roomType === 'cult') {
        // Auto-add all active AI agents to cult rooms
        const agents = db.prepare("SELECT id FROM users WHERE role = 'agent'").all();
        const addMember = db.prepare(
          'INSERT OR IGNORE INTO room_members (room_id, user_id, role, access_level, color_index) VALUES (?, ?, ?, ?, ?)'
        );
        agents.forEach((a, i) => addMember.run(id, a.id, 'member', 'readandwrite', (i + 1) % 8));
        if (Array.isArray(member_ids)) {
          let colorCounter = agents.length + 1;
          for (const uid of member_ids) {
            if (uid !== req.user.id) {
              const accessLevel = normalizeAccessLevel(member_access && member_access[String(uid)]);
              addMember.run(id, uid, 'member', accessLevel, colorCounter % 8);
              colorCounter++;
            }
          }
        }
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
  };

  Promise.resolve(send()).catch((err) => {
    res.status(500).json({ error: err.message || 'Failed to create room' });
  });
});

// GET /api/rooms/:id — room details + members (admin can access any room)
router.get('/:id', (req, res) => {
  const driver = getDbDriver();
  const roomId = Number(req.params.id);

  const send = async () => {
    if (driver === 'postgres') {
      const pool = getPgPool();
      const userId = Number(req.user.id);

      const membershipQ = await pool.query(
        'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
        [roomId, userId]
      );
      if (membershipQ.rowCount === 0 && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Not a member of this room' });
      }

      const roomQ = await pool.query('SELECT * FROM rooms WHERE id = $1', [roomId]);
      if (roomQ.rowCount === 0) return res.status(404).json({ error: 'Room not found' });
      const room = roomQ.rows[0];

      const membersQ = await pool.query(
        `
        SELECT
          u.id,
          u.username,
          u.display_name,
          u.role,
          u.avatar_url,
          CASE WHEN u.is_online THEN 1 ELSE 0 END AS is_online,
          rm.role as room_role,
          rm.access_level
        FROM room_members rm
        JOIN users u ON rm.user_id = u.id
        WHERE rm.room_id = $1
        ORDER BY u.id
        `,
        [roomId]
      );

      // Normalize IDs to strings for consistent API contract
      const normalizedRoom = { ...room, id: String(room.id) };
      const normalizedMembers = membersQ.rows.map((m) => ({
        ...m,
        id: String(m.id),
      }));

      return res.json({ room: normalizedRoom, members: normalizedMembers });
    }

    const db = getDb();
    const roomIdStr = req.params.id;
    const membership = db.prepare('SELECT * FROM room_members WHERE room_id = ? AND user_id = ?').get(roomIdStr, req.user.id);
    if (!membership && req.user.role !== 'admin') return res.status(403).json({ error: 'Not a member of this room' });

    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomIdStr);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    const members = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.role, u.avatar_url, u.is_online, rm.role as room_role, rm.access_level
      FROM room_members rm JOIN users u ON rm.user_id = u.id WHERE rm.room_id = ?
    `).all(roomIdStr);

    res.json({ room, members });
  };

  Promise.resolve(send()).catch((err) => {
    res.status(500).json({ error: err.message || 'Failed to load room' });
  });
});

// PUT /api/rooms/:id — edit room (owner or admin; admin can edit any room)
router.put('/:id', (req, res) => {
  const result = editSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ error: result.error.issues[0].message });

  const driver = getDbDriver();
  const roomId = req.params.id;

  const send = async () => {
    if (driver === 'postgres') {
      const pool = getPgPool();
      const rid = Number(roomId);
      const userId = Number(req.user.id);

      const existingQ = await pool.query('SELECT * FROM rooms WHERE id = $1', [rid]);
      if (existingQ.rowCount === 0) return res.status(404).json({ error: 'Room not found' });

      const membershipQ = await pool.query(
        'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
        [rid, userId]
      );
      const canEdit = req.user.role === 'admin' || (membershipQ.rowCount > 0 && membershipQ.rows[0].role === 'owner');
      if (!canEdit) return res.status(403).json({ error: 'Only room owner or admin can edit' });

      const { name, description, is_archived } = result.data;
      const sets = [];
      const params = [];
      let idx = 1;
      if (name !== undefined)        { sets.push(`name = $${idx++}`); params.push(name); }
      if (description !== undefined) { sets.push(`description = $${idx++}`); params.push(description); }
      if (is_archived !== undefined) { sets.push(`is_archived = $${idx++}`); params.push(Boolean(is_archived)); }

      if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });
      params.push(rid);

      const updated = (await pool.query(
        `UPDATE rooms SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
        params
      )).rows[0];

      return res.json({ room: { ...updated, id: String(updated.id) } });
    }

    const db = getDb();
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
  };

  Promise.resolve(send()).catch((err) => {
    res.status(500).json({ error: err.message || 'Failed to update room' });
  });
});

// DELETE /api/rooms/:id — admin only; :id can be numeric id or node_id (room name)
router.delete('/:id', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

  const driver = getDbDriver();
  const idOrName = req.params.id;

  const send = async () => {
    if (driver === 'postgres') {
      const pool = getPgPool();
      let roomId;
      if (/^\d+$/.test(idOrName)) {
        roomId = Number.parseInt(idOrName, 10);
      } else {
        const row = (await pool.query('SELECT id FROM rooms WHERE name = $1 LIMIT 1', [idOrName])).rows[0];
        if (!row) return res.status(404).json({ error: 'Room not found' });
        roomId = Number(row.id);
      }

      const exists = await pool.query('SELECT id FROM rooms WHERE id = $1', [roomId]);
      if (exists.rowCount === 0) return res.status(404).json({ error: 'Room not found' });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Delete dependents first to avoid FK failures
        await client.query('DELETE FROM message_reads WHERE message_id IN (SELECT id FROM messages WHERE room_id = $1)', [roomId]);
        await client.query('DELETE FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE room_id = $1)', [roomId]);
        await client.query('DELETE FROM messages WHERE room_id = $1', [roomId]);
        await client.query('DELETE FROM room_members WHERE room_id = $1', [roomId]);
        await client.query('DELETE FROM rooms WHERE id = $1', [roomId]);
        await client.query('COMMIT');
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        throw err;
      } finally {
        client.release();
      }

      return res.json({ ok: true });
    }

    const db = getDb();
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
  };

  Promise.resolve(send()).catch((err) => {
    res.status(500).json({ error: err.message || 'Failed to delete room' });
  });
});

// POST /api/rooms/:id/members — add member (owner or admin; admin can add to any room)
router.post('/:id/members', (req, res) => {
  const driver = getDbDriver();
  const roomId = req.params.id;
  const { user_id } = req.body;
  const accessLevel = normalizeAccessLevel(req.body && req.body.access_level);

  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const send = async () => {
    if (driver === 'postgres') {
      const pool = getPgPool();
      const requesterId = Number(req.user.id);
      const targetId = Number(user_id);

      const roomQ = await pool.query('SELECT id FROM rooms WHERE id = $1', [Number(roomId)]);
      if (roomQ.rowCount === 0) return res.status(404).json({ error: 'Room not found' });

      const membershipQ = await pool.query(
        'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
        [Number(roomId), requesterId]
      );
      const canAdd = req.user.role === 'admin' || (membershipQ.rowCount > 0 && membershipQ.rows[0].role === 'owner');
      if (!canAdd) return res.status(403).json({ error: 'Only owner or admin can add members' });

      const targetQ = await pool.query(
        'SELECT id, username, display_name, role FROM users WHERE id = $1',
        [targetId]
      );
      if (targetQ.rowCount === 0) return res.status(404).json({ error: 'User not found' });
      const targetUser = targetQ.rows[0];

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const existing = (await client.query(
          'SELECT color_index FROM room_members WHERE room_id = $1 AND user_id = $2',
          [Number(roomId), targetId]
        )).rows[0];
        const colorIdx = existing ? Number(existing.color_index) : await assignRoomColorPg(client, roomId);

        await client.query(
          `
          INSERT INTO room_members (room_id, user_id, role, access_level, color_index)
          VALUES ($1, $2, 'member', $3, $4)
          ON CONFLICT (room_id, user_id) DO NOTHING
          `,
          [Number(roomId), targetId, accessLevel, colorIdx]
        );
        await client.query(
          'UPDATE room_members SET access_level = $1 WHERE room_id = $2 AND user_id = $3',
          [accessLevel, Number(roomId), targetId]
        );
        await client.query('COMMIT');
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        throw err;
      } finally {
        client.release();
      }

      return res.json({ ok: true, user: { ...targetUser, id: String(targetUser.id) } });
    }

    const db = getDb();
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
  };

  Promise.resolve(send()).catch((err) => {
    res.status(500).json({ error: err.message || 'Failed to add member' });
  });
});

// PUT /api/rooms/:id/members/:userId/access-level — set member access level (owner or admin)
router.put('/:id/members/:userId/access-level', (req, res) => {
  const driver = getDbDriver();
  const roomId = req.params.id;
  const targetId = parseInt(req.params.userId, 10);
  const accessLevel = normalizeAccessLevel(req.body && req.body.access_level);

  const send = async () => {
    if (driver === 'postgres') {
      const pool = getPgPool();
      const requesterId = Number(req.user.id);

      const membershipQ = await pool.query(
        'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
        [Number(roomId), requesterId]
      );
      const isOwnerOrAdmin = req.user.role === 'admin' || (membershipQ.rowCount > 0 && membershipQ.rows[0].role === 'owner');
      if (!isOwnerOrAdmin) return res.status(403).json({ error: 'Only owner or admin can edit member access level' });

      const targetQ = await pool.query(
        'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
        [Number(roomId), Number(targetId)]
      );
      if (targetQ.rowCount === 0) return res.status(404).json({ error: 'Member not found' });
      if (targetQ.rows[0].role === 'owner' && accessLevel !== 'readandwrite') {
        return res.status(400).json({ error: 'Owner access level must remain readandwrite' });
      }

      await pool.query(
        'UPDATE room_members SET access_level = $1 WHERE room_id = $2 AND user_id = $3',
        [accessLevel, Number(roomId), Number(targetId)]
      );
      return res.json({ ok: true, access_level: accessLevel });
    }

    const db = getDb();
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
  };

  Promise.resolve(send()).catch((err) => {
    res.status(500).json({ error: err.message || 'Failed to update access level' });
  });
});

// DELETE /api/rooms/:id/members/:userId — remove member (admin can remove from any room)
router.delete('/:id/members/:userId', (req, res) => {
  const driver = getDbDriver();
  const roomId = req.params.id;
  const targetId = parseInt(req.params.userId);

  const send = async () => {
    if (driver === 'postgres') {
      const pool = getPgPool();
      const requesterId = Number(req.user.id);
      const isSelf = Number(targetId) === requesterId;

      const membershipQ = await pool.query(
        'SELECT role FROM room_members WHERE room_id = $1 AND user_id = $2',
        [Number(roomId), requesterId]
      );
      const isOwnerOrAdmin = req.user.role === 'admin' || (membershipQ.rowCount > 0 && membershipQ.rows[0].role === 'owner');
      if (!isSelf && !isOwnerOrAdmin) return res.status(403).json({ error: 'Not allowed' });

      await pool.query('DELETE FROM room_members WHERE room_id = $1 AND user_id = $2', [Number(roomId), Number(targetId)]);
      return res.json({ ok: true });
    }

    const db = getDb();
    const membership = db.prepare('SELECT * FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, req.user.id);
    const isSelf = targetId === req.user.id;
    const isOwnerOrAdmin = req.user.role === 'admin' || (membership && (membership.role === 'owner' || req.user.role === 'admin'));

    if (!isSelf && !isOwnerOrAdmin) return res.status(403).json({ error: 'Not allowed' });

    db.prepare('DELETE FROM room_members WHERE room_id = ? AND user_id = ?').run(roomId, targetId);
    res.json({ ok: true });
  };

  Promise.resolve(send()).catch((err) => {
    res.status(500).json({ error: err.message || 'Failed to remove member' });
  });
});

// GET /api/rooms/users/list — all users (for adding to rooms)
router.get('/users/list', (req, res) => {
  const driver = getDbDriver();

  const send = async () => {
    if (driver === 'postgres') {
      const pool = getPgPool();
      const rows = (await pool.query(
        "SELECT id, username, role, CASE WHEN is_online THEN 1 ELSE 0 END as is_online FROM users WHERE role != 'admin' OR id = $1 ORDER BY username",
        [Number(req.user.id)]
      )).rows;
      return res.json({ users: rows.map((u) => ({ ...u, id: String(u.id) })) });
    }

    const db = getDb();
    const users = db.prepare(
      "SELECT id, username, role, is_online FROM users WHERE role != 'admin' OR id = ? ORDER BY username"
    ).all(req.user.id);
    return res.json({ users });
  };

  Promise.resolve(send()).catch((err) => {
    res.status(500).json({ error: err.message || 'Failed to list users' });
  });
});

module.exports = router;
