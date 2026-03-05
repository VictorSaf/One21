// socket/handlers/presence.js
'use strict';

function register(io, socket, db) {
  const ctx = db;

  const joinRooms = async () => {
    console.log(`[WS] ${socket.user.username} connected`);

    socket.broadcast.emit('user_online', {
      user_id: socket.user.id,
      username: socket.user.username,
    });

    if (ctx && ctx.driver === 'postgres') {
      const pool = ctx.pool;
      await pool.query(
        'UPDATE users SET is_online = true, last_seen = now() WHERE id = $1',
        [Number(socket.user.id)]
      );
      const memberships = (await pool.query(
        'SELECT room_id FROM room_members WHERE user_id = $1',
        [Number(socket.user.id)]
      )).rows;
      for (const m of memberships) {
        socket.join(`room:${String(m.room_id)}`);
      }
      socket.join(`user:${socket.user.id}`);

      socket.on('disconnect', async () => {
        console.log(`[WS] ${socket.user.username} disconnected`);
        try {
          await pool.query(
            'UPDATE users SET is_online = false, last_seen = now() WHERE id = $1',
            [Number(socket.user.id)]
          );
        } catch {}
        socket.broadcast.emit('user_offline', { user_id: socket.user.id });
      });
      return;
    }

    const sqlite = ctx.db || ctx;
    // Mark online la connect
    sqlite.prepare("UPDATE users SET is_online = 1, last_seen = datetime('now') WHERE id = ?")
      .run(socket.user.id);

    // Auto-join toate rooms-urile userului
    const memberships = sqlite.prepare('SELECT room_id FROM room_members WHERE user_id = ?')
      .all(socket.user.id);
    for (const m of memberships) {
      socket.join(`room:${m.room_id}`);
    }
    socket.join(`user:${socket.user.id}`);

    socket.on('disconnect', () => {
      console.log(`[WS] ${socket.user.username} disconnected`);
      sqlite.prepare("UPDATE users SET is_online = 0, last_seen = datetime('now') WHERE id = ?")
        .run(socket.user.id);
      socket.broadcast.emit('user_offline', { user_id: socket.user.id });
    });
  };

  Promise.resolve(joinRooms()).catch(() => {});
}

module.exports = { register };
