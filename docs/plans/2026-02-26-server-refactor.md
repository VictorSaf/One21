# Server.js Refactoring — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transformă `server.js` monolitic (~300 linii) într-un bootstrap slim (~50 linii) prin extragerea Socket.IO handlers, config centralizat, fix routing duplicat și guard securitate agent.

**Architecture:** Se creează `config.js` pentru env vars, `socket/index.js` pentru Socket.IO setup și `socket/handlers/{messages,presence,rooms}.js` pentru event handlers. `server.js` devine doar bootstrap: import-uri, middleware, routes, socket mount, listen.

**Tech Stack:** Node.js, Express.js v5, Socket.IO v4, better-sqlite3

---

## Verificare înainte de start

```bash
curl -s http://localhost:3737/health | python3 -m json.tool
# Trebuie să returneze status: "ok"
```

Salvează output-ul — după fiecare task re-rulezi ca să confirmi că nimic nu s-a stricat.

---

### Task 1: Creează `config.js` — centralizare env vars + guard securitate

**Files:**
- Create: `config.js`
- Modify: `middleware/agent.js:3`

**Step 1: Creează `config.js`**

```js
// config.js
require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';

const config = {
  port: parseInt(process.env.PORT) || 3737,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd,

  jwt: {
    secret: process.env.JWT_SECRET || 'one21-dev-secret-change-in-prod',
  },

  cors: {
    origins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3737').split(','),
  },

  agent: {
    apiKey: process.env.AGENT_API_KEY || 'agent-dev-key-change-in-prod',
  },

  join: {
    baseUrl: process.env.JOIN_BASE_URL || `http://localhost:3737/one21/join`,
  },

  vapid: {
    publicKey:  process.env.VAPID_PUBLIC_KEY  || null,
    privateKey: process.env.VAPID_PRIVATE_KEY || null,
  },
};

// Guard: avertizează în producție dacă secretele sunt cele default
if (isProd) {
  const warnings = [];
  if (config.jwt.secret === 'one21-dev-secret-change-in-prod')
    warnings.push('JWT_SECRET folosește valoarea default — schimbă-o!');
  if (config.agent.apiKey === 'agent-dev-key-change-in-prod')
    warnings.push('AGENT_API_KEY folosește valoarea default — schimbă-o!');
  if (warnings.length) {
    warnings.forEach(w => console.error(`[CONFIG] ⚠️  ${w}`));
  }
}

module.exports = config;
```

**Step 2: Actualizează `middleware/agent.js` să folosească config**

Înlocuiește linia 3:
```js
// ÎNAINTE:
const AGENT_API_KEY = process.env.AGENT_API_KEY || 'agent-dev-key-change-in-prod';

// DUPĂ:
const { agent } = require('../config');
const AGENT_API_KEY = agent.apiKey;
```

**Step 3: Verificare**

```bash
node -e "const c = require('./config'); console.log('port:', c.port, 'env:', c.nodeEnv)"
# Așteptat: port: 3737 env: development
```

**Step 4: Commit**

```bash
git add config.js middleware/agent.js
git commit -m "feat(config): centralizează env vars și adaugă guard securitate agent"
```

---

### Task 2: Creează `socket/handlers/presence.js`

**Files:**
- Create: `socket/handlers/presence.js`

Extrage din `server.js` logica de connect/disconnect.

**Step 1: Creează directorul și fișierul**

```bash
mkdir -p socket/handlers
```

```js
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

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`[WS] ${socket.user.username} disconnected`);
    db.prepare("UPDATE users SET is_online = 0, last_seen = datetime('now') WHERE id = ?")
      .run(socket.user.id);
    socket.broadcast.emit('user_offline', { user_id: socket.user.id });
  });
}

module.exports = { register };
```

**Step 2: Commit**

```bash
git add socket/handlers/presence.js
git commit -m "refactor(socket): extrage presence handlers (connect/disconnect)"
```

---

### Task 3: Creează `socket/handlers/rooms.js`

**Files:**
- Create: `socket/handlers/rooms.js`

**Step 1: Creează fișierul**

```js
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
```

**Step 2: Commit**

```bash
git add socket/handlers/rooms.js
git commit -m "refactor(socket): extrage room handlers (join/leave/member events)"
```

---

### Task 4: Creează `socket/handlers/messages.js`

**Files:**
- Create: `socket/handlers/messages.js`

Cel mai complex handler — include validare, permisiuni, vectorizare, push notifications.

**Step 1: Creează fișierul**

```js
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
      SELECT m.*, u.username as sender_username, u.display_name as sender_name, u.role as sender_role
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
```

**Step 2: Commit**

```bash
git add socket/handlers/messages.js
git commit -m "refactor(socket): extrage message handlers (message/edit/delete/read/typing)"
```

---

### Task 5: Creează `socket/index.js` — Socket.IO setup + auth middleware

**Files:**
- Create: `socket/index.js`

**Step 1: Creează fișierul**

```js
// socket/index.js
'use strict';

const jwt = require('jsonwebtoken');
const { getDb } = require('../db/init');
const config = require('../config');

const presenceHandlers = require('./handlers/presence');
const roomHandlers     = require('./handlers/rooms');
const messageHandlers  = require('./handlers/messages');

function initSocket(io) {
  // Auth middleware Socket.IO
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      socket.user = jwt.verify(token, config.jwt.secret);
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const db = getDb();

    presenceHandlers.register(io, socket, db);
    roomHandlers.register(io, socket, db);
    messageHandlers.register(io, socket, db);
  });
}

module.exports = { initSocket };
```

**Step 2: Commit**

```bash
git add socket/index.js
git commit -m "refactor(socket): creează socket/index.js cu auth middleware și handler mount"
```

---

### Task 6: Rescrie `server.js` slim + fix routing duplicat

**Files:**
- Modify: `server.js` (rescrie complet)

**Step 1: Înlocuiește `server.js` cu versiunea slim**

```js
// server.js
require('dotenv').config();

const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const path     = require('path');
const helmet   = require('helmet');
const rateLimit = require('express-rate-limit');

const config         = require('./config');
const { getDb }      = require('./db/init');
const { initSocket } = require('./socket');

const authRoutes     = require('./routes/auth');
const joinRoutes     = require('./routes/join');
const adminRoutes    = require('./routes/admin');
const roomRoutes     = require('./routes/rooms');
const messageRoutes  = require('./routes/messages');
const fileRoutes     = require('./routes/files');
const agentRoutes    = require('./routes/agent');
const pushRoutes     = require('./routes/push');
const settingsRoutes = require('./routes/settings');
const themeRoutes    = require('./routes/theme');

// Init DB
getDb();

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: config.cors.origins, methods: ['GET', 'POST'] },
});

// --- Security ---
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10mb' }));

// --- Static + HTML routes ---
app.get('/one21/join/:token', (req, res) => res.sendFile(path.join(__dirname, 'public/one21/join.html')));
app.get('/one21/join',        (req, res) => res.sendFile(path.join(__dirname, 'public/one21/join.html')));
app.get('/one21/hey',         (req, res) => res.sendFile(path.join(__dirname, 'public/chat.html')));
app.get('/one21/login',       (req, res) => res.sendFile(path.join(__dirname, 'public/login.html')));
app.get('/one21',             (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/',                  (req, res) => res.redirect('/one21/'));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/one21', express.static(path.join(__dirname, 'public')));

// --- Rate Limiting ---
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000, max: 200,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Prea multe requesturi, incearca din nou mai tarziu.' },
}));
app.use('/api/auth/login',    rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth/register', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false }));

// --- Health ---
app.get('/health', (req, res) => {
  const db = getDb();
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    env:    config.nodeEnv,
    stats: {
      users:    db.prepare('SELECT COUNT(*) as n FROM users').get().n,
      rooms:    db.prepare('SELECT COUNT(*) as n FROM rooms WHERE is_archived = 0').get().n,
      messages: db.prepare('SELECT COUNT(*) as n FROM messages').get().n,
    },
    ts: new Date().toISOString(),
  });
});

// --- API Routes ---
app.use('/api',              themeRoutes);
app.use('/api/admin/settings', settingsRoutes);
app.use('/api/agent',        agentRoutes);
app.use('/api/join',         joinRoutes);
app.use('/api/files',        fileRoutes);
app.use('/api/auth',         authRoutes);
app.use('/api/admin',        adminRoutes);
app.use('/api/push',         pushRoutes);
app.use('/api/rooms',        roomRoutes);
app.use('/api/rooms',        messageRoutes);   // GET/POST /:id/messages, GET /:id/search
app.use('/api/messages',     messageRoutes);   // PUT/DELETE /messages/:id
app.use('/api/rooms',        fileRoutes);      // POST /:id/upload

// --- Error Handler ---
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// --- Socket.IO ---
app.set('io', io);
initSocket(io);

// --- Start ---
server.listen(config.port, '0.0.0.0', () => {
  console.log(`One21 running on http://localhost:${config.port} [${config.nodeEnv}]`);
});
```

**Step 2: Verificare — serverul pornește și health check răspunde**

```bash
# Oprește serverul curent dacă rulează (Ctrl+C în terminalul dev)
# Pornește cu noul server.js:
node server.js &
sleep 2
curl -s http://localhost:3737/health | python3 -m json.tool
# Așteptat: status: "ok"
```

**Step 3: Commit**

```bash
git add server.js
git commit -m "refactor(server): slim bootstrap ~60 linii, mount socket via initSocket()"
```

---

### Task 7: Verificare finală + cleanup

**Step 1: Rulează serverul în modul dev și testează manual**

```bash
npm run dev
```

Verifică în browser:
- [ ] `http://localhost:3737/one21` — home dashboard se încarcă
- [ ] `http://localhost:3737/one21/login` — login funcționează
- [ ] Login cu `admin` / `admin123` → redirect la chat
- [ ] Trimite un mesaj în chat — apare în timp real
- [ ] Edit și delete mesaj funcționează
- [ ] Typing indicator apare

**Step 2: Verifică health endpoint**

```bash
curl -s http://localhost:3737/health | python3 -m json.tool
```

**Step 3: Commit final + cleanup**

```bash
# Verifică că nu există fișiere temporare sau console.log de debug
grep -rn "console.log\|debugger" socket/ config.js

git add -A
git commit -m "refactor(server): extragere completă Socket.IO handlers, config centralizat"
```

---

## Sumar fișiere create/modificate

| Acțiune | Fișier |
|---------|--------|
| CREATE | `config.js` |
| CREATE | `socket/index.js` |
| CREATE | `socket/handlers/presence.js` |
| CREATE | `socket/handlers/rooms.js` |
| CREATE | `socket/handlers/messages.js` |
| MODIFY | `server.js` (rescris slim) |
| MODIFY | `middleware/agent.js` (folosește config) |

## Fișiere neatinse

`routes/`, `db/`, `lib/`, `middleware/auth.js`, `middleware/permissions.js`, `public/` — toate rămân identice.
