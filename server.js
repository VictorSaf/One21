require('dotenv').config();

const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const path      = require('path');
const fs        = require('fs');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');

const config         = require('./config');
const packageJson    = require('./package.json');
const { getDb, getDbDriver, getPgPool } = require('./db');
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
const privateRouter  = require('./routes/private');

// Init DB
if (getDbDriver() === 'sqlite') {
  getDb();
} else {
  getPgPool();
}

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: config.cors.origins, methods: ['GET', 'POST'] },
});

// --- Security ---
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10mb' }));

// --- Static + HTML routes ---
// New root routes (preferred)
app.get('/hey',          (req, res) => res.sendFile(path.join(__dirname, 'public/login.html')));
app.get('/chat',         (req, res) => res.sendFile(path.join(__dirname, 'public/chat.html')));
app.get('/join/:token',  (req, res) => res.sendFile(path.join(__dirname, 'public/one21/join.html')));
app.get('/join',         (req, res) => res.sendFile(path.join(__dirname, 'public/one21/join.html')));
app.get('/sw.js',        (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public/sw.js'));
});
app.get('/:token', (req, res, next) => {
  if (req.params.token.includes('.')) return next(); // pass static files to middleware
  if (req.params.token === 'health') return next();
  if (req.params.token === 'api') return next();
  if (req.params.token === 'admin.html') return next();
  if (req.params.token === 'sw.js') return next();
  if (req.params.token === 'manifest.json') return next();
  if (req.params.token === 'one21') return next();
  res.redirect(302, `/join/${encodeURIComponent(req.params.token)}`);
});

// Legacy /one21/* routes — redirect to new paths
app.get('/one21/hey',         (req, res) => res.redirect(301, '/hey'));
app.get('/one21/chat',        (req, res) => res.redirect(301, '/chat'));
app.get('/one21/join/:token', (req, res) => res.redirect(301, `/join/${encodeURIComponent(req.params.token)}`));
app.get('/one21/join',        (req, res) => res.redirect(301, '/join'));
app.get('/one21/:token', (req, res, next) => {
  if (req.params.token.includes('.')) return next();
  res.redirect(301, `/join/${encodeURIComponent(req.params.token)}`);
});
app.get('/one21',             (req, res) => res.redirect(301, '/join'));
app.get('/one21/',            (req, res) => res.redirect(301, '/join'));

// Landing
app.get('/',                  (req, res) => res.sendFile(path.join(__dirname, 'public/one21/join.html')));
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
  try {
    const nowIso = new Date().toISOString();

    const safeStatFs = (p) => {
      try {
        const s = fs.statfsSync(p);
        const block = Number(s.bsize || 0);
        const total = Number(s.blocks || 0) * block;
        const free = Number(s.bavail || 0) * block;
        return { ok: true, path: p, totalBytes: total, freeBytes: free };
      } catch (e) {
        return { ok: false, path: p, error: e.message };
      }
    };

    const driver = getDbDriver();

    const send = async () => {
      let stats;
      if (driver === 'postgres') {
        const pool = getPgPool();
        const usersQ = await pool.query('SELECT COUNT(*)::int AS n FROM users');
        const roomsQ = await pool.query('SELECT COUNT(*)::int AS n FROM rooms WHERE is_archived = false');
        const msgsQ = await pool.query('SELECT COUNT(*)::int AS n FROM messages');
        stats = {
          users: usersQ.rows[0].n,
          rooms: roomsQ.rows[0].n,
          messages: msgsQ.rows[0].n,
        };
      } else {
        const db = getDb();
        stats = {
          users: db.prepare('SELECT COUNT(*) as n FROM users').get().n,
          rooms: db.prepare('SELECT COUNT(*) as n FROM rooms WHERE is_archived = 0').get().n,
          messages: db.prepare('SELECT COUNT(*) as n FROM messages').get().n,
        };
      }

      res.json({
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        env:    config.nodeEnv,
        version: packageJson.version,
        stats,
        disk: {
          data: safeStatFs(path.join(__dirname, 'data')),
          uploads: safeStatFs(path.join(__dirname, 'uploads')),
        },
        flags: {
          vapidConfigured: Boolean(config.vapid && config.vapid.publicKey && config.vapid.privateKey),
          agentApiKeyConfigured: Boolean(config.agent && config.agent.apiKey && config.agent.apiKey !== 'agent-dev-key-change-in-prod'),
        },
        ts: nowIso,
      });
    };

    Promise.resolve(send()).catch((err) => {
      res.status(500).json({
        status: 'error',
        error: err.message,
        ts: new Date().toISOString(),
      });
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      error: err.message,
      ts: new Date().toISOString(),
    });
  }
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
app.use('/api/private',        privateRouter);

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
