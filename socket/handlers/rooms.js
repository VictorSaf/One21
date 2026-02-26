// socket/handlers/rooms.js
'use strict';

function register(io, socket, db) {
  socket.on('join_room', (roomId) => {
    const membership = db.prepare(
      'SELECT * FROM room_members WHERE room_id = ? AND user_id = ?'
    ).get(roomId, socket.user.id);
    if (membership) {
      socket.join(`room:${roomId}`);
      socket.emit('joined_room', { room_id: roomId });
    }
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
