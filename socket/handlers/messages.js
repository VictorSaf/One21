// socket/handlers/messages.js
'use strict';

const { addDocument, addAgentMemory } = require('../../lib/vectorstore');
const { notifyUser } = require('../../routes/push');
const { getPermission } = require('../../middleware/permissions');

function queueAgentRoomMemory(db, roomId, text, metadata) {
  const agentsInRoom = db.prepare(`
    SELECT u.username
    FROM room_members rm
    JOIN users u ON rm.user_id = u.id
    WHERE rm.room_id = ? AND u.role = 'agent'
  `).all(roomId);
  if (!agentsInRoom.length) return;
  for (const agent of agentsInRoom) {
    addAgentMemory(agent.username, text, { ...metadata, room_id: roomId }).catch(() => {});
  }
}

function findOrCreatePrivateRoom(db, userId1, userId2) {
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

function register(io, socket, db) {
  socket.on('typing', (data) => {
    const { room_id } = data;
    if (!room_id) return;
    let displayName;
    try {
      displayName = db.prepare('SELECT display_name FROM users WHERE id = ?').get(socket.user.id)?.display_name;
    } catch {}
    socket.to(`room:${room_id}`).emit('typing', {
      room_id,
      user_id:      socket.user.id,
      username:     socket.user.username,
      display_name: displayName || socket.user.username,
    });
  });

  socket.on('message', (data) => {
    const { room_id, text, type, reply_to } = data;
    if (!room_id || !text || typeof text !== 'string') return;
    if (text.trim().length === 0 || text.length > 4000) return;

    const membership = db.prepare(
      'SELECT * FROM room_members WHERE room_id = ? AND user_id = ?'
    ).get(room_id, socket.user.id);
    if (!membership) return;

    const ACCESS_LEVELS = new Set(['readonly', 'readandwrite', 'post_docs']);
    const accessLevel = ACCESS_LEVELS.has(membership.access_level) ? membership.access_level : 'readandwrite';
    if (socket.user.role !== 'admin') {
      if (accessLevel === 'readonly') {
        socket.emit('error', { message: 'This room is read-only for your account.' });
        return;
      }
      if (accessLevel === 'post_docs' && type !== 'file') {
        socket.emit('error', { message: 'You can only post documents in this room.' });
        return;
      }
    }

    let actualText = text.trim();

    // @username <text> from any room → route silently to private DM room
    const atMatch = actualText.match(/^@(\S+)\s+([\s\S]+)$/);
    if (atMatch) {
      const targetUser = db.prepare(
        'SELECT id, username FROM users WHERE username = ? COLLATE NOCASE'
      ).get(atMatch[1]);
      if (!targetUser) {
        socket.emit('error', { message: `Utilizatorul @${atMatch[1]} nu există.` });
        return;
      }
      if (targetUser.id === socket.user.id) {
        socket.emit('error', { message: 'Nu poți trimite mesaj ție însuți.' });
        return;
      }

      const dmText = atMatch[2].trim();
      const { id: dmRoomId, isNew } = findOrCreatePrivateRoom(db, socket.user.id, targetUser.id);

      const dmResult = db.prepare(
        'INSERT INTO messages (room_id, sender_id, text, type, reply_to) VALUES (?, ?, ?, ?, ?)'
      ).run(dmRoomId, socket.user.id, dmText, 'text', reply_to || null);

      setImmediate(() => {
        addDocument('messages', dmText, {
          message_id: dmResult.lastInsertRowid,
          room_id: dmRoomId,
          sender_id: socket.user.id,
          sender: socket.user.display_name || socket.user.username,
          ts: new Date().toISOString(),
        }).catch(() => {});
        queueAgentRoomMemory(db, dmRoomId, dmText, {
          message_id: dmResult.lastInsertRowid,
          sender_id: socket.user.id,
          sender: socket.user.display_name || socket.user.username,
          sender_username: socket.user.username,
          sender_role: socket.user.role,
          memory_type: 'room_message',
          ts: new Date().toISOString(),
        });
      });

      const dmMessage = db.prepare(`
        SELECT m.*, u.username as sender_username, u.username as sender_name, u.role as sender_role,
               COALESCE(rmc.color_index, u.chat_color_index) as sender_color_index,
               reply_m.text as reply_to_text, ru.username as reply_to_sender
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        LEFT JOIN room_members rmc ON rmc.room_id = m.room_id AND rmc.user_id = m.sender_id
        LEFT JOIN messages reply_m ON reply_m.id = m.reply_to
        LEFT JOIN users ru ON ru.id = reply_m.sender_id
        WHERE m.id = ?
      `).get(dmResult.lastInsertRowid);

      if (isNew) {
        const dmRoomRaw = db.prepare('SELECT * FROM rooms WHERE id = ?').get(dmRoomId);
        io.to(`user:${socket.user.id}`).emit('room_added', {
          room: { ...dmRoomRaw, display_name: targetUser.username },
          silent: true,
        });
        io.to(`user:${targetUser.id}`).emit('room_added', {
          room: { ...dmRoomRaw, display_name: socket.user.username },
          silent: true,
        });
      }

      io.to(`user:${socket.user.id}`).to(`user:${targetUser.id}`).emit('message', dmMessage);

      const recipientOnline = db.prepare('SELECT is_online FROM users WHERE id = ?').get(targetUser.id);
      if (!recipientOnline?.is_online) {
        notifyUser(targetUser.id, {
          title: `${socket.user.username} (DM)`,
          body:  dmText.slice(0, 100),
          tag:   `dm-${socket.user.id}`,
          url:   '/chat.html',
        }).catch(() => {});
      }
      return;
    }

    // Channel: non-admin cannot post without @username (which now routes to DM)
    const room = db.prepare('SELECT type FROM rooms WHERE id = ?').get(room_id);
    let recipientId = null;
    if (room?.type === 'channel' && socket.user.role !== 'admin') {
      socket.emit('error', { message: 'Folosește @username mesaj pentru a trimite un mesaj direct.' });
      return;
    }

    // Limită mesaje/zi
    if (socket.user.role !== 'admin') {
      const maxPerDay = getPermission(socket.user.id, 'max_messages_per_day');
      if (maxPerDay !== null) {
        const todayCount = db.prepare(
          "SELECT COUNT(*) as n FROM messages WHERE sender_id = ? AND created_at >= date('now')"
        ).get(socket.user.id).n;
        if (todayCount >= maxPerDay) {
          socket.emit('error', { message: `Daily message limit of ${maxPerDay} reached.` });
          return;
        }
      }
    }

    // Acces la agent
    if (socket.user.role !== 'admin') {
      const agentMembers = db.prepare(
        "SELECT u.id FROM room_members rm JOIN users u ON rm.user_id = u.id WHERE rm.room_id = ? AND u.role = 'agent'"
      ).all(room_id);
      if (agentMembers.length > 0) {
        const allowedAgents = getPermission(socket.user.id, 'allowed_agents') || [];
        if (!agentMembers.some(m => allowedAgents.includes(m.id))) {
          socket.emit('error', { message: 'You do not have access to AI agents in this room.' });
          return;
        }
      }
    }

    const result = db.prepare(
      'INSERT INTO messages (room_id, sender_id, text, type, reply_to, recipient_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(room_id, socket.user.id, actualText, type || 'text', reply_to || null, recipientId);

    // Vectorizare (fire-and-forget)
    setImmediate(() => {
      const ts = new Date().toISOString();
      addDocument('messages', actualText, {
        message_id: result.lastInsertRowid,
        room_id,
        sender_id: socket.user.id,
        sender: socket.user.display_name || socket.user.username,
        ts,
      }).catch(() => {});
      queueAgentRoomMemory(db, room_id, actualText, {
        message_id: result.lastInsertRowid,
        sender_id: socket.user.id,
        sender: socket.user.display_name || socket.user.username,
        sender_username: socket.user.username,
        sender_role: socket.user.role,
        memory_type: 'room_message',
        ts,
      });
    });

    const message = db.prepare(`
      SELECT m.*, u.username as sender_username, u.username as sender_name, u.role as sender_role,
             COALESCE(rmc.color_index, u.chat_color_index) as sender_color_index,
             reply_m.text as reply_to_text, ru.username as reply_to_sender,
             rec.username as recipient_username, rec.username as recipient_name
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      LEFT JOIN room_members rmc ON rmc.room_id = m.room_id AND rmc.user_id = m.sender_id
      LEFT JOIN messages reply_m ON reply_m.id = m.reply_to
      LEFT JOIN users ru ON ru.id = reply_m.sender_id
      LEFT JOIN users rec ON rec.id = m.recipient_id
      WHERE m.id = ?
    `).get(result.lastInsertRowid);

    if (recipientId) {
      io.to(`user:${socket.user.id}`).to(`user:${recipientId}`).emit('message', message);
    } else {
      io.to(`room:${room_id}`).emit('message', message);
    }

    const senderName = socket.user.username;
    if (recipientId) {
      // Push only to recipient if offline
      const recipient = db.prepare('SELECT id, is_online FROM users WHERE id = ?').get(recipientId);
      if (recipient && !recipient.is_online) {
        notifyUser(recipient.id, {
          title: `${senderName} (privat)`,
          body:  actualText.slice(0, 100),
          tag:   `whisper-${socket.user.id}`,
          url:   '/chat.html',
        }).catch(() => {});
      }
    } else {
      const offlineMembers = db.prepare(`
        SELECT u.id FROM room_members rm
        JOIN users u ON rm.user_id = u.id
        WHERE rm.room_id = ? AND u.id != ? AND u.is_online = 0
      `).all(room_id, socket.user.id);
      const roomName = db.prepare('SELECT name FROM rooms WHERE id = ?').get(room_id)?.name || 'One21';
      for (const member of offlineMembers) {
        notifyUser(member.id, {
          title: `${senderName} în ${roomName}`,
          body:  actualText.slice(0, 100),
          tag:   `room-${room_id}`,
          url:   '/chat.html',
        }).catch(() => {});
      }
    }
  });

  socket.on('message_edit', (data) => {
    const { message_id, text } = data;
    if (!message_id || !text || typeof text !== 'string' || text.trim().length === 0) return;
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(message_id);
    if (!msg || msg.sender_id !== socket.user.id) return;
    db.prepare("UPDATE messages SET text = ?, is_edited = 1 WHERE id = ?").run(text.trim(), message_id);
    const editPayload = { message_id, text: text.trim(), room_id: msg.room_id };
    if (msg.recipient_id) {
      io.to(`user:${msg.sender_id}`).to(`user:${msg.recipient_id}`).emit('message_edited', editPayload);
    } else {
      io.to(`room:${msg.room_id}`).emit('message_edited', editPayload);
    }
  });

  socket.on('message_delete', (data) => {
    const { message_id } = data;
    if (!message_id) return;
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(message_id);
    if (!msg) return;
    if (msg.sender_id !== socket.user.id && socket.user.role !== 'admin') return;
    db.prepare('DELETE FROM message_reads WHERE message_id = ?').run(message_id);
    db.prepare('DELETE FROM messages WHERE id = ?').run(message_id);
    const deletePayload = { message_id, room_id: msg.room_id };
    if (msg.recipient_id) {
      io.to(`user:${msg.sender_id}`).to(`user:${msg.recipient_id}`).emit('message_deleted', deletePayload);
    } else {
      io.to(`room:${msg.room_id}`).emit('message_deleted', deletePayload);
    }
  });

  socket.on('mark_read', (data) => {
    const { message_id } = data;
    if (!message_id) return;
    try {
      db.prepare(
        `INSERT OR IGNORE INTO message_reads (message_id, user_id, read_at)
         VALUES (?, ?, datetime('now'))`
      ).run(message_id, socket.user.id);
      const msg = db.prepare('SELECT room_id FROM messages WHERE id = ?').get(message_id);
      if (msg) {
        socket.to(`room:${msg.room_id}`).emit('message_read', {
          message_id,
          user_id: socket.user.id,
        });
      }
    } catch {}
  });

  socket.on('upload_progress', (data) => {
    const { room_id, filename, percent } = data;
    if (!room_id || !filename) return;
    socket.to(`room:${room_id}`).emit('upload_progress', {
      room_id,
      user_id: socket.user.id,
      username: socket.user.username,
      filename,
      percent: Math.min(100, Math.max(0, parseInt(percent) || 0)),
    });
  });

  socket.on('react', (data) => {
    const { message_id, emoji } = data;
    if (!message_id || !emoji || typeof emoji !== 'string') return;
    const ALLOWED = ['\u{1F44D}','\u2764\uFE0F','\u{1F602}','\u{1F62E}','\u{1F622}','\u{1F525}'];
    if (!ALLOWED.includes(emoji)) return;

    const msg = db.prepare('SELECT room_id, sender_id, recipient_id FROM messages WHERE id = ?').get(message_id);
    if (!msg) return;

    const membership = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?')
      .get(msg.room_id, socket.user.id);
    if (!membership) return;
    // Whisper: only sender and recipient can react
    if (msg.recipient_id && socket.user.id !== msg.sender_id && socket.user.id !== msg.recipient_id) return;

    const existing = db.prepare(
      'SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'
    ).get(message_id, socket.user.id, emoji);

    if (existing) {
      db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')
        .run(message_id, socket.user.id, emoji);
    } else {
      db.prepare('INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)')
        .run(message_id, socket.user.id, emoji);
    }

    const rows = db.prepare(
      'SELECT emoji, COUNT(*) as count FROM message_reactions WHERE message_id = ? GROUP BY emoji'
    ).all(message_id);

    const reactPayload = { message_id, reactions: rows };
    if (msg.recipient_id) {
      io.to(`user:${msg.sender_id}`).to(`user:${msg.recipient_id}`).emit('reaction_update', reactPayload);
    } else {
      io.to(`room:${msg.room_id}`).emit('reaction_update', reactPayload);
    }
  });
}

module.exports = { register };
