require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { getDb } = require('./db/init');
const { JWT_SECRET } = require('./middleware/auth');
const authRoutes    = require('./routes/auth');
const adminRoutes   = require('./routes/admin');
const roomRoutes    = require('./routes/rooms');
const messageRoutes = require('./routes/messages');
const fileRoutes    = require('./routes/files');
const agentRoutes   = require('./routes/agent');
const pushRoutes    = require('./routes/push');
const { notifyUser } = require('./routes/push');
const roomRequestsRouter = require('./routes/room-requests');
const { addDocument } = require('./lib/vectorstore');
const { getPermission } = require('./middleware/permissions');

const PORT = process.env.PORT || 3737;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3737').split(',');

// Initialize DB on startup
getDb();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST']
  }
});

// --- Security Middleware ---
app.use(helmet({
  contentSecurityPolicy: false // disabled so inline scripts in public HTML work
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Rate Limiting ---
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Prea multe requesturi, incearca din nou mai tarziu.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Prea multe incercari de autentificare.' }
});

app.use('/api', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// --- Health Check ---
app.get('/health', (req, res) => {
  const db = getDb();
  const { users, rooms, messages } = {
    users:    db.prepare('SELECT COUNT(*) as n FROM users').get().n,
    rooms:    db.prepare('SELECT COUNT(*) as n FROM rooms WHERE is_archived = 0').get().n,
    messages: db.prepare('SELECT COUNT(*) as n FROM messages').get().n,
  };
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    env: process.env.NODE_ENV,
    stats: { users, rooms, messages },
    ts: new Date().toISOString(),
  });
});

// --- API Routes ---
app.use('/api/agent', agentRoutes);      // agent first — no JWT auth
app.use('/api/files', fileRoutes);       // file download — auth inside route
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/room-requests', roomRequestsRouter);
app.use('/api/push', pushRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/rooms', messageRoutes);
app.use('/api/rooms', fileRoutes);       // upload
app.use('/api/messages', messageRoutes); // PUT/DELETE /api/messages/:id

// --- HTML Routes ---
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

// --- Global Error Handler ---
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// Expose io to routes (used by agent route to broadcast messages)
app.set('io', io);

// --- Socket.IO Authentication ---
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.user = payload;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

// --- Socket.IO Events ---
io.on('connection', (socket) => {
  const db = getDb();
  console.log(`[WS] ${socket.user.username} connected`);

  db.prepare("UPDATE users SET is_online = 1, last_seen = datetime('now') WHERE id = ?")
    .run(socket.user.id);

  // Notify others: user online
  socket.broadcast.emit('user_online', { user_id: socket.user.id, username: socket.user.username });

  // Auto-join all rooms the user belongs to
  const memberships = db.prepare('SELECT room_id FROM room_members WHERE user_id = ?')
    .all(socket.user.id);
  for (const m of memberships) {
    socket.join(`room:${m.room_id}`);
  }

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
    // notify the new member's socket to join the room
    io.to(`room:${room_id}`).emit('member_added', data);
  });

  socket.on('member_removed', (data) => {
    const { room_id, user_id } = data;
    if (!room_id || !user_id) return;
    io.to(`room:${room_id}`).emit('member_removed', data);
  });

  socket.on('message', (data) => {
    const { room_id, text, type, reply_to } = data;
    if (!room_id || !text || typeof text !== 'string') return;
    if (text.trim().length === 0 || text.length > 4000) return;

    const membership = db.prepare(
      'SELECT * FROM room_members WHERE room_id = ? AND user_id = ?'
    ).get(room_id, socket.user.id);
    if (!membership) return;

    // Check max_messages_per_day
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

    // Check allowed_agents — if room has agent members, user must have access
    if (socket.user.role !== 'admin') {
      const agentMembers = db.prepare(
        "SELECT u.id FROM room_members rm JOIN users u ON rm.user_id = u.id WHERE rm.room_id = ? AND u.role = 'agent'"
      ).all(room_id);
      if (agentMembers.length > 0) {
        const allowedAgents = getPermission(socket.user.id, 'allowed_agents') || [];
        const hasAccess = agentMembers.some(m => allowedAgents.includes(m.id));
        if (!hasAccess) {
          socket.emit('error', { message: 'You do not have access to AI agents in this room.' });
          return;
        }
      }
    }

    const result = db.prepare(
      'INSERT INTO messages (room_id, sender_id, text, type, reply_to) VALUES (?, ?, ?, ?, ?)'
    ).run(room_id, socket.user.id, text.trim(), type || 'text', reply_to || null);

    // Vectorize message (fire-and-forget)
    setImmediate(() => {
      addDocument('messages', text.trim(), {
        message_id: result.lastInsertRowid,
        room_id,
        sender_id: socket.user.id,
        sender: socket.user.display_name || socket.user.username,
        ts: new Date().toISOString(),
      }).catch(() => {});
    });

    const message = db.prepare(`
      SELECT m.*, u.username as sender_username, u.display_name as sender_name, u.role as sender_role
      FROM messages m JOIN users u ON m.sender_id = u.id
      WHERE m.id = ?
    `).get(result.lastInsertRowid);

    io.to(`room:${room_id}`).emit('message', message);

    // Push notification to offline members
    const members = db.prepare(`
      SELECT u.id FROM room_members rm
      JOIN users u ON rm.user_id = u.id
      WHERE rm.room_id = ? AND u.id != ? AND u.is_online = 0
    `).all(room_id, socket.user.id);

    const senderName = socket.user.display_name || socket.user.username;
    const roomName = db.prepare('SELECT name FROM rooms WHERE id = ?').get(room_id)?.name || 'One21';
    for (const member of members) {
      notifyUser(member.id, {
        title: `${senderName} în ${roomName}`,
        body: text.trim().slice(0, 100),
        tag: `room-${room_id}`,
        url: '/chat.html',
      }).catch(() => {});
    }
  });

  socket.on('typing', (data) => {
    const { room_id } = data;
    if (!room_id) return;
    socket.to(`room:${room_id}`).emit('typing', {
      room_id,
      user_id: socket.user.id,
      username: socket.user.username,
      display_name: socket.user.display_name || socket.user.username
    });
  });

  socket.on('message_edit', (data) => {
    const { message_id, text } = data;
    if (!message_id || !text || typeof text !== 'string' || text.trim().length === 0) return;
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(message_id);
    if (!msg || msg.sender_id !== socket.user.id) return;
    db.prepare("UPDATE messages SET text = ?, is_edited = 1 WHERE id = ?").run(text.trim(), message_id);
    io.to(`room:${msg.room_id}`).emit('message_edited', { message_id, text: text.trim(), room_id: msg.room_id });
  });

  socket.on('message_delete', (data) => {
    const { message_id } = data;
    if (!message_id) return;
    const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(message_id);
    if (!msg) return;
    const isOwner = msg.sender_id === socket.user.id;
    const isAdmin = socket.user.role === 'admin';
    if (!isOwner && !isAdmin) return;
    db.prepare('DELETE FROM message_reads WHERE message_id = ?').run(message_id);
    db.prepare('DELETE FROM messages WHERE id = ?').run(message_id);
    io.to(`room:${msg.room_id}`).emit('message_deleted', { message_id, room_id: msg.room_id });
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
          user_id: socket.user.id
        });
      }
    } catch {}
  });

  socket.on('disconnect', () => {
    console.log(`[WS] ${socket.user.username} disconnected`);
    db.prepare("UPDATE users SET is_online = 0, last_seen = datetime('now') WHERE id = ?")
      .run(socket.user.id);
    socket.broadcast.emit('user_offline', { user_id: socket.user.id });
  });
});

// --- Start ---
server.listen(PORT, '0.0.0.0', () => {
  console.log(`One21 running on http://localhost:${PORT} [${process.env.NODE_ENV || 'development'}]`);
});
