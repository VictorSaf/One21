// socket/handlers/rooms.js
'use strict';

function register(io, socket, db) {
  const ctx = db;

  socket.on('join_room', (roomId) => {
    const join = async () => {
      if (ctx && ctx.driver === 'postgres') {
        const pool = ctx.pool;
        const membership = await pool.query(
          'SELECT 1 FROM room_members WHERE room_id = $1 AND user_id = $2',
          [Number(roomId), Number(socket.user.id)]
        );
        if (membership.rowCount > 0) {
          socket.join(`room:${roomId}`);
          socket.emit('joined_room', { room_id: roomId });
        }
        return;
      }

      const sqlite = ctx.db || ctx;
      const membership = sqlite.prepare(
        'SELECT * FROM room_members WHERE room_id = ? AND user_id = ?'
      ).get(roomId, socket.user.id);
      if (membership) {
        socket.join(`room:${roomId}`);
        socket.emit('joined_room', { room_id: roomId });
      }
    };

    Promise.resolve(join()).catch(() => {});
  });

  socket.on('leave_room', (roomId) => {
    socket.leave(`room:${roomId}`);
  });

  socket.on('room_updated', (data) => {
    const { room_id } = data;
    if (!room_id) return;
    io.to(`room:${room_id}`).emit('room_updated', data);
  });

  socket.on('member_added', (data) => {
    const { room_id, user_id } = data;
    if (!room_id || !user_id) return;
    io.to(`room:${room_id}`).emit('member_added', data);
  });

  socket.on('member_removed', (data) => {
    const { room_id, user_id } = data;
    if (!room_id || !user_id) return;
    io.to(`room:${room_id}`).emit('member_removed', data);
  });
}

module.exports = { register };
