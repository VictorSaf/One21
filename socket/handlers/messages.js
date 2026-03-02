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

function register(io, socket, db) {
  socket.on('typing', (data) => {
    const { room_id } = data;
    if (!room_id) return;
    socket.to(`room:${room_id}`).emit('typing', {
      room_id,
      user_id:      socket.user.id,
      username:     socket.user.username,
      display_name: socket.user.display_name || socket.user.username,
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

    // Channel: doar admin poate trimite
    const room = db.prepare('SELECT type FROM rooms WHERE id = ?').get(room_id);
    if (room?.type === 'channel' && socket.user.role !== 'admin') {
      socket.emit('error', { message: 'Doar admin poate trimite în acest canal.' });
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
      'INSERT INTO messages (room_id, sender_id, text, type, reply_to) VALUES (?, ?, ?, ?, ?)'
    ).run(room_id, socket.user.id, text.trim(), type || 'text', reply_to || null);

    // Vectorizare (fire-and-forget)
    setImmediate(() => {
      const ts = new Date().toISOString();
      addDocument('messages', text.trim(), {
        message_id: result.lastInsertRowid,
        room_id,
        sender_id: socket.user.id,
        sender: socket.user.display_name || socket.user.username,
        ts,
      }).catch(() => {});
      queueAgentRoomMemory(db, room_id, text.trim(), {
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
      SELECT m.*, u.username as sender_username, u.display_name as sender_name, u.role as sender_role, u.chat_color_index as sender_color_index
      FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?
    `).get(result.lastInsertRowid);

    io.to(`room:${room_id}`).emit('message', message);

    // Push notif pentru useri offline
    const offlineMembers = db.prepare(`
      SELECT u.id FROM room_members rm
      JOIN users u ON rm.user_id = u.id
      WHERE rm.room_id = ? AND u.id != ? AND u.is_online = 0
    `).all(room_id, socket.user.id);

    const senderName = socket.user.display_name || socket.user.username;
    const roomName = db.prepare('SELECT name FROM rooms WHERE id = ?').get(room_id)?.name || 'One21';
    for (const member of offlineMembers) {
      notifyUser(member.id, {
        title: `${senderName} în ${roomName}`,
        body:  text.trim().slice(0, 100),
        tag:   `room-${room_id}`,
        url:   '/chat.html',
      }).catch(() => {});
    }
  });

  socket.on('message_edit', (data) => {
    const { message_id, text } = data;
    if (!message_id || !text || typeof text !== 'string' || text.trim().length === 0) return;
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(message_id);
    if (!msg || msg.sender_id !== socket.user.id) return;
    db.prepare("UPDATE messages SET text = ?, is_edited = 1 WHERE id = ?").run(text.trim(), message_id);
    io.to(`room:${msg.room_id}`).emit('message_edited', {
      message_id,
      text: text.trim(),
      room_id: msg.room_id,
    });
  });

  socket.on('message_delete', (data) => {
    const { message_id } = data;
    if (!message_id) return;
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(message_id);
    if (!msg) return;
    if (msg.sender_id !== socket.user.id && socket.user.role !== 'admin') return;
    db.prepare('DELETE FROM message_reads WHERE message_id = ?').run(message_id);
    db.prepare('DELETE FROM messages WHERE id = ?').run(message_id);
    io.to(`room:${msg.room_id}`).emit('message_deleted', {
      message_id,
      room_id: msg.room_id,
    });
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
}

module.exports = { register };
