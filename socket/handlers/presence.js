// socket/handlers/presence.js
'use strict';

function register(io, socket, db) {
  // Mark online la connect
  db.prepare("UPDATE users SET is_online = 1, last_seen = datetime('now') WHERE id = ?")
    .run(socket.user.id);

  console.log(`[WS] ${socket.user.username} connected`);

  socket.broadcast.emit('user_online', {
    user_id: socket.user.id,
    username: socket.user.username,
  });

  // Auto-join toate rooms-urile userului
  const memberships = db.prepare('SELECT room_id FROM room_members WHERE user_id = ?')
    .all(socket.user.id);
  for (const m of memberships) {
    socket.join(`room:${m.room_id}`);
  }
  // Personal room for targeted whisper delivery
  socket.join(`user:${socket.user.id}`);

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`[WS] ${socket.user.username} disconnected`);
    db.prepare("UPDATE users SET is_online = 0, last_seen = datetime('now') WHERE id = ?")
      .run(socket.user.id);
    socket.broadcast.emit('user_offline', { user_id: socket.user.id });
  });
}

module.exports = { register };
