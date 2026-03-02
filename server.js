require('dotenv').config();

const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const path      = require('path');
const helmet    = require('helmet');
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
app.get('/one21/hey',         (req, res) => res.sendFile(path.join(__dirname, 'public/login.html')));
app.get('/one21/chat',        (req, res) => res.sendFile(path.join(__dirname, 'public/chat.html')));
app.get('/one21/join/:token', (req, res) => res.sendFile(path.join(__dirname, 'public/one21/join.html')));
app.get('/one21/join',        (req, res) => res.sendFile(path.join(__dirname, 'public/one21/join.html')));
app.get('/one21/:token', (req, res, next) => {
  if (req.params.token.includes('.')) return next(); // pass .html files to static middleware
  res.sendFile(path.join(__dirname, 'public/one21/join.html'));
});
app.get('/one21',             (req, res) => res.sendFile(path.join(__dirname, 'public/one21/join.html')));
app.get('/',                  (req, res) => res.redirect('/one21/'));
app.get('/favicon.ico',       (req, res) => res.redirect('/favicon.svg'));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/one21', express.static(path.join(__dirname, 'public')));

// --- Rate Limiting ---
app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000, max: 200,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Prea multe requesturi, incearca din nou mai tarziu.' },
}));
app.use('/api/auth/login',    rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth/register', rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false }));

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
app.use('/api',                themeRoutes);
app.use('/api/admin/settings', settingsRoutes);
app.use('/api/agent',          agentRoutes);
app.use('/api/join',           joinRoutes);
app.use('/api/files',          fileRoutes);
app.use('/api/auth',           authRoutes);
app.use('/api/admin',          adminRoutes);
app.use('/api/push',           pushRoutes);
app.use('/api/rooms',          roomRoutes);
app.use('/api/rooms',          messageRoutes);  // GET/POST /:id/messages, GET /:id/search
app.use('/api/messages',       messageRoutes);  // PUT/DELETE /messages/:id
app.use('/api/rooms',          fileRoutes);     // POST /:id/upload

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
