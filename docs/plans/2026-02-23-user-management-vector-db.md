# User Management + Vector DB Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Add granular per-user permission management with invite-based access configuration, a room-request approval flow, and LangChain/HNSWLib vector storage for all interactions.

**Architecture:** SQLite handles relational data (new `user_permissions` and `room_requests` tables). A `middleware/permissions.js` helper reads per-user overrides and enforces them on existing routes. LangChain.js with `@xenova/transformers` (local embeddings, no API key) and HNSWLib provides semantic search across messages and admin events.

**Tech Stack:** Node.js + Express 5 + better-sqlite3 + LangChain.js + @xenova/transformers + hnswlib-node + existing JWT/Socket.IO

**Permission model:**
- `can_send_files` — default `true`
- `allowed_agents` — JSON array of agent user IDs, default `[]` (no AI access)
- `max_messages_per_day` — number or `null` (unlimited)
- `allowed_rooms` — JSON array of room IDs or `null` (all rooms user is member of)
- Users **never** create rooms directly; they submit requests that admin approves

---

## Task 1: DB migrations — user_permissions + room_requests

**Files:**
- Modify: `db/init.js` (add tables + migration)

**Context:**
`db/init.js` has a `migrate()` function with a `safeAdd()` helper. Add new tables in the main `db.exec()` block and two new migration entries. The `getDb()` function calls `migrate()` after `db.exec()`.

**Step 1: Add tables to the `db.exec()` CREATE TABLE block**

In `db/init.js`, inside the template literal passed to `db.exec()`, after the `push_subscriptions` table, add:

```js
    CREATE TABLE IF NOT EXISTS user_permissions (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission TEXT NOT NULL,
      value      TEXT NOT NULL DEFAULT 'true',
      granted_by INTEGER REFERENCES users(id),
      granted_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, permission)
    );

    CREATE TABLE IF NOT EXISTS room_requests (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      requested_by     INTEGER NOT NULL REFERENCES users(id),
      name             TEXT NOT NULL,
      description      TEXT,
      requested_members TEXT DEFAULT '[]',
      status           TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      reviewed_by      INTEGER REFERENCES users(id),
      reviewed_at      TEXT,
      admin_note       TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id);
    CREATE INDEX IF NOT EXISTS idx_room_requests_status  ON room_requests(status);
```

**Step 2: Add migration entries in `migrate()`**

```js
safeAdd('invitations', 'default_permissions', "TEXT DEFAULT '{}'");
safeAdd('invitations', 'note', 'TEXT');
```

**Step 3: Verify migration runs cleanly**

```bash
node -e "const {getDb} = require('./db/init'); const db = getDb(); console.log(db.prepare('SELECT name FROM sqlite_master WHERE type=\\'table\\'').all().map(r=>r.name).join(', '));"
```

Expected output includes: `user_permissions, room_requests`

**Step 4: Commit**

```bash
git add db/init.js
git commit -m "feat: add user_permissions and room_requests tables"
```

---

## Task 2: Permission helper middleware

**Files:**
- Create: `middleware/permissions.js`

**Context:**
This module reads a user's permission from `user_permissions` table and enforces it. It will be imported in routes. The `getDb()` is from `db/init.js`.

**Permission defaults (hardcoded):**
```js
const DEFAULTS = {
  can_send_files: true,
  allowed_agents: [],       // empty = no AI access
  max_messages_per_day: null,
  allowed_rooms: null,      // null = all rooms user is a member of
};
```

**Step 1: Create `middleware/permissions.js`**

```js
const { getDb } = require('../db/init');

const DEFAULTS = {
  can_send_files: true,
  allowed_agents: [],
  max_messages_per_day: null,
  allowed_rooms: null,
};

/**
 * Read a single permission value for a user.
 * Falls back to DEFAULTS if no row exists.
 */
function getPermission(userId, permission) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM user_permissions WHERE user_id = ? AND permission = ?').get(userId, permission);
  if (!row) return DEFAULTS[permission] ?? null;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

/**
 * Read all permissions for a user (merged with defaults).
 */
function getAllPermissions(userId) {
  const db = getDb();
  const rows = db.prepare('SELECT permission, value FROM user_permissions WHERE user_id = ?').all(userId);
  const perms = { ...DEFAULTS };
  for (const r of rows) {
    try { perms[r.permission] = JSON.parse(r.value); } catch { perms[r.permission] = r.value; }
  }
  return perms;
}

/**
 * Express middleware: blocks request if user lacks permission.
 * Usage: router.post('/', checkPermission('can_send_files'), handler)
 */
function checkPermission(permission, defaultAllowed = true) {
  return (req, res, next) => {
    if (req.user.role === 'admin') return next(); // admin bypasses all
    const value = getPermission(req.user.id, permission);
    const allowed = value !== null ? value : defaultAllowed;
    if (!allowed) return res.status(403).json({ error: `Permission denied: ${permission}` });
    next();
  };
}

module.exports = { getPermission, getAllPermissions, checkPermission, DEFAULTS };
```

**Step 2: Smoke-test the module loads**

```bash
node -e "const p = require('./middleware/permissions'); console.log(p.DEFAULTS);"
```

Expected: `{ can_send_files: true, allowed_agents: [], max_messages_per_day: null, allowed_rooms: null }`

**Step 3: Commit**

```bash
git add middleware/permissions.js
git commit -m "feat: add permission helper middleware"
```

---

## Task 3: Admin — permissions API endpoints

**Files:**
- Modify: `routes/admin.js`

**Context:**
`routes/admin.js` already has `router.use(authMiddleware, requireAdmin)` at the top. Add two new endpoints at the bottom (before `module.exports`).

**Step 1: Add imports at top of `routes/admin.js`**

After the existing `require` lines, add:
```js
const { getAllPermissions } = require('../middleware/permissions');
```

**Step 2: Add GET endpoint**

```js
// GET /api/admin/users/:id/permissions
router.get('/users/:id/permissions', (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const perms = getAllPermissions(parseInt(req.params.id));
  res.json({ permissions: perms });
});
```

**Step 3: Add PUT endpoint**

```js
// PUT /api/admin/users/:id/permissions
router.put('/users/:id/permissions', (req, res) => {
  const db = getDb();
  const userId = parseInt(req.params.id);
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const ALLOWED_KEYS = ['can_send_files', 'allowed_agents', 'max_messages_per_day', 'allowed_rooms'];
  const upsert = db.prepare(`
    INSERT INTO user_permissions (user_id, permission, value, granted_by)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, permission) DO UPDATE SET value = excluded.value, granted_by = excluded.granted_by, granted_at = datetime('now')
  `);
  const del = db.prepare('DELETE FROM user_permissions WHERE user_id = ? AND permission = ?');

  db.transaction(() => {
    for (const key of ALLOWED_KEYS) {
      if (!(key in req.body)) continue;
      const val = req.body[key];
      if (val === null) {
        del.run(userId, key); // reset to default
      } else {
        upsert.run(userId, key, JSON.stringify(val), req.user.id);
      }
    }
  })();

  const perms = getAllPermissions(userId);
  res.json({ permissions: perms });
});
```

**Step 4: Test endpoints with curl**

```bash
# Start server: npm run dev
# Login first to get admin token, then:
TOKEN=$(curl -s -X POST http://localhost:3737/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).token))")

# Get permissions for user 3
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3737/api/admin/users/3/permissions

# Set permissions
curl -s -X PUT http://localhost:3737/api/admin/users/3/permissions \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"can_send_files":false,"allowed_agents":[2]}'
```

Expected: `{"permissions":{"can_send_files":false,"allowed_agents":[2],"max_messages_per_day":null,"allowed_rooms":null}}`

**Step 5: Commit**

```bash
git add routes/admin.js
git commit -m "feat: admin permissions GET/PUT endpoints"
```

---

## Task 4: Enhanced invite creation with default_permissions

**Files:**
- Modify: `routes/admin.js` (POST /api/admin/invites)
- Modify: `routes/auth.js` (register — apply default_permissions)

**Context:**
`POST /api/admin/invites` currently only accepts `expires_at`. Extend it to accept `default_permissions` (object) and `note`. On registration, copy the invite's `default_permissions` into `user_permissions`.

**Step 1: Update POST /api/admin/invites in `routes/admin.js`**

Replace the existing invite POST handler:

```js
// POST /api/admin/invites
router.post('/invites', (req, res) => {
  const db = getDb();
  const code = crypto.randomUUID().slice(0, 8).toUpperCase();
  const expiresAt = req.body.expires_at || null;
  const note = req.body.note || null;
  const defaultPermissions = req.body.default_permissions
    ? JSON.stringify(req.body.default_permissions)
    : '{}';
  db.prepare('INSERT INTO invitations (code, created_by, expires_at, note, default_permissions) VALUES (?, ?, ?, ?, ?)')
    .run(code, req.user.id, expiresAt, note, defaultPermissions);
  res.json({ code, expires_at: expiresAt, note, default_permissions: req.body.default_permissions || {} });
});
```

**Step 2: Update `routes/auth.js` register — apply default_permissions**

After the `createUser()` transaction, add permission application. Replace the `const userId = createUser();` block:

```js
  const userId = db.transaction(() => {
    const r = db.prepare(
      `INSERT INTO users (username, display_name, password_hash, role, invited_by, invite_code)
       VALUES (?, ?, ?, 'user', ?, ?)`
    ).run(username, displayName, passwordHash, invite.created_by, invite.code);
    db.prepare('UPDATE invitations SET used_by = ? WHERE id = ?').run(r.lastInsertRowid, invite.id);

    // Apply default_permissions from invite
    if (invite.default_permissions && invite.default_permissions !== '{}') {
      let perms = {};
      try { perms = JSON.parse(invite.default_permissions); } catch {}
      const upsert = db.prepare(`
        INSERT INTO user_permissions (user_id, permission, value, granted_by)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, permission) DO UPDATE SET value = excluded.value
      `);
      for (const [key, val] of Object.entries(perms)) {
        upsert.run(r.lastInsertRowid, key, JSON.stringify(val), invite.created_by);
      }
    }
    return r.lastInsertRowid;
  })();
```

Also remove the old separate `createUser` transaction and its call — the above replaces both.

**Step 3: Test invite with default_permissions**

```bash
# Create invite with restricted permissions
curl -s -X POST http://localhost:3737/api/admin/invites \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"note":"Guest access","default_permissions":{"can_send_files":false,"allowed_agents":[]}}'
```

Expected: `{"code":"XXXXXXXX","note":"Guest access","default_permissions":{"can_send_files":false,"allowed_agents":[]}}`

**Step 4: Commit**

```bash
git add routes/admin.js routes/auth.js
git commit -m "feat: invite default_permissions applied on registration"
```

---

## Task 5: Enforce permissions on routes

**Files:**
- Modify: `routes/rooms.js` (block POST / for non-admin)
- Modify: `routes/files.js` (check can_send_files)
- Modify: `routes/messages.js` (check allowed_agents, max_messages_per_day)

**Context:**
- `POST /api/rooms` must be admin-only. Users submit room requests instead (Task 7).
- File uploads: check `can_send_files`.
- Messages to agent users: check `allowed_agents`.
- `max_messages_per_day`: count today's messages by the user and reject if exceeded.

**Step 1: Block room creation in `routes/rooms.js`**

In `routes/rooms.js`, in the `POST /` handler, add at the very beginning (after `safeParse`):

```js
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Users cannot create rooms directly. Submit a room request instead.' });
  }
```

**Step 2: Add file permission check to `routes/files.js`**

First check what the file upload route looks like:

```bash
cat routes/files.js | head -30
```

Then add at the start of the upload handler:

```js
const { checkPermission } = require('../middleware/permissions');
// On the upload route:
router.post('/upload', checkPermission('can_send_files', true), uploadHandler);
```

(Adjust to match actual route structure in files.js)

**Step 3: Check allowed_agents for agent messages in `routes/messages.js`**

First inspect messages.js:

```bash
cat routes/messages.js | head -60
```

Find where messages are created. Add before saving:

```js
const { getPermission } = require('../middleware/permissions');

// Inside POST handler, before db.prepare INSERT:
// Find the target room's members to detect if any is an agent
const roomMembers = db.prepare(
  "SELECT u.id, u.role FROM room_members rm JOIN users u ON rm.user_id = u.id WHERE rm.room_id = ? AND u.role = 'agent'"
).all(req.body.room_id || req.params.room_id);

if (roomMembers.length > 0 && req.user.role !== 'admin') {
  const allowedAgents = getPermission(req.user.id, 'allowed_agents') || [];
  const hasAccess = roomMembers.some(m => allowedAgents.includes(m.id));
  if (!hasAccess) {
    return res.status(403).json({ error: 'You do not have access to AI agents in this room.' });
  }
}
```

**Step 4: Add max_messages_per_day check in messages.js**

```js
const maxPerDay = getPermission(req.user.id, 'max_messages_per_day');
if (maxPerDay !== null && req.user.role !== 'admin') {
  const todayCount = db.prepare(
    "SELECT COUNT(*) as n FROM messages WHERE sender_id = ? AND created_at >= datetime('now', 'start of day')"
  ).get(req.user.id).n;
  if (todayCount >= maxPerDay) {
    return res.status(429).json({ error: `Daily message limit of ${maxPerDay} reached.` });
  }
}
```

**Step 5: Test enforcement**

```bash
# Login as claudiu (non-admin user)
CLAUDIU_TOKEN=$(curl -s -X POST http://localhost:3737/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"claudiu","password":"claudiu123"}' | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).token))")

# Try to create room — should get 403
curl -s -X POST http://localhost:3737/api/rooms \
  -H "Authorization: Bearer $CLAUDIU_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test","type":"group"}'
```

Expected: `{"error":"Users cannot create rooms directly. Submit a room request instead."}`

**Step 6: Commit**

```bash
git add routes/rooms.js routes/files.js routes/messages.js
git commit -m "feat: enforce permissions on rooms/files/messages routes"
```

---

## Task 6: Room requests API

**Files:**
- Create: `routes/room-requests.js`
- Modify: `server.js` (mount new route)
- Modify: `routes/admin.js` (add admin endpoints for reviewing requests)

**Context:**
Users submit room requests. Admin sees them in a dedicated section and can approve (creates the room) or reject. WebSocket broadcast notifies user of the decision.

**Step 1: Create `routes/room-requests.js`**

```js
const express = require('express');
const { z } = require('zod');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const requestSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(200).optional(),
  requested_members: z.array(z.number().int().positive()).optional(),
});

// POST /api/room-requests — user submits a request
router.post('/', (req, res) => {
  const result = requestSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json({ error: result.error.errors[0].message });

  const { name, description, requested_members } = result.data;
  const db = getDb();
  const r = db.prepare(`
    INSERT INTO room_requests (requested_by, name, description, requested_members)
    VALUES (?, ?, ?, ?)
  `).run(req.user.id, name, description || null, JSON.stringify(requested_members || []));

  res.json({ id: r.lastInsertRowid, status: 'pending' });
});

// GET /api/room-requests — user sees their own requests
router.get('/', (req, res) => {
  const db = getDb();
  const requests = db.prepare(`
    SELECT rr.*, u.username as reviewed_by_name
    FROM room_requests rr
    LEFT JOIN users u ON rr.reviewed_by = u.id
    WHERE rr.requested_by = ?
    ORDER BY rr.created_at DESC
  `).all(req.user.id);
  res.json({ requests });
});

module.exports = router;
```

**Step 2: Add admin endpoints to `routes/admin.js`**

```js
// GET /api/admin/room-requests
router.get('/room-requests', (req, res) => {
  const db = getDb();
  const requests = db.prepare(`
    SELECT rr.*, u.username as requester_name, u.display_name as requester_display
    FROM room_requests rr
    JOIN users u ON rr.requested_by = u.id
    ORDER BY rr.created_at DESC
  `).all();
  res.json({ requests });
});

// PUT /api/admin/room-requests/:id — approve or reject
router.put('/room-requests/:id', (req, res) => {
  const db = getDb();
  const { status, admin_note, member_ids } = req.body; // status: 'approved' | 'rejected'
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status must be approved or rejected' });
  }

  const request = db.prepare('SELECT * FROM room_requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.status !== 'pending') return res.status(400).json({ error: 'Request already reviewed' });

  db.prepare(`
    UPDATE room_requests SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), admin_note = ?
    WHERE id = ?
  `).run(status, req.user.id, admin_note || null, req.params.id);

  let room = null;
  if (status === 'approved') {
    const members = Array.isArray(member_ids) ? member_ids : JSON.parse(request.requested_members || '[]');
    const roomResult = db.transaction(() => {
      const r = db.prepare(
        'INSERT INTO rooms (name, description, type, created_by) VALUES (?, ?, ?, ?)'
      ).run(request.name, request.description || null, 'group', req.user.id);
      const id = r.lastInsertRowid;
      db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)').run(id, request.requested_by, 'owner');
      const add = db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)');
      for (const uid of members) {
        if (uid !== request.requested_by) add.run(id, uid, 'member');
      }
      return id;
    })();
    room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomResult);
  }

  res.json({ ok: true, status, room });
});
```

**Step 3: Mount route in `server.js`**

Find where other routes are mounted (e.g., `app.use('/api/rooms', roomsRouter)`) and add:

```js
const roomRequestsRouter = require('./routes/room-requests');
app.use('/api/room-requests', roomRequestsRouter);
```

**Step 4: Test room request flow**

```bash
# Submit request as claudiu
curl -s -X POST http://localhost:3737/api/room-requests \
  -H "Authorization: Bearer $CLAUDIU_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Marketing","description":"For marketing team","requested_members":[3]}'

# Admin lists requests
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3737/api/admin/room-requests

# Admin approves (replace 1 with actual request ID)
curl -s -X PUT http://localhost:3737/api/admin/room-requests/1 \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"status":"approved","member_ids":[3]}'
```

Expected: room created, `{"ok":true,"status":"approved","room":{...}}`

**Step 5: Commit**

```bash
git add routes/room-requests.js routes/admin.js server.js
git commit -m "feat: room request submit + admin approve/reject flow"
```

---

## Task 7: LangChain + HNSWLib vector store setup

**Files:**
- Create: `lib/vectorstore.js`
- Modify: `package.json` (add dependencies)

**Context:**
No API key needed — `@xenova/transformers` runs a 23MB embedding model locally (`Xenova/all-MiniLM-L6-v2`). HNSWLib persists to disk in `./data/vectorstore/`. On first run, the model downloads automatically.

Two collections:
- `messages` — chat messages (embed on save)
- `admin_events` — admin actions (invite created, permissions changed, request reviewed)

**Step 1: Install packages**

```bash
npm install langchain @langchain/community @xenova/transformers hnswlib-node
```

Note: `hnswlib-node` requires a C++ compiler. On macOS: `xcode-select --install` if not present.

**Step 2: Create `lib/vectorstore.js`**

```js
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data', 'vectorstore');
fs.mkdirSync(DATA_DIR, { recursive: true });

let _embeddings = null;
let _stores = {};
let _initPromise = null;

async function getEmbeddings() {
  if (_embeddings) return _embeddings;
  const { HuggingFaceTransformersEmbeddings } = await import('@langchain/community/embeddings/huggingface_transformers');
  _embeddings = new HuggingFaceTransformersEmbeddings({
    modelName: 'Xenova/all-MiniLM-L6-v2',
  });
  return _embeddings;
}

async function getStore(collection) {
  if (_stores[collection]) return _stores[collection];
  const { HNSWLib } = await import('@langchain/community/vectorstores/hnswlib');
  const storePath = path.join(DATA_DIR, collection);
  const embeddings = await getEmbeddings();

  if (fs.existsSync(path.join(storePath, 'hnswlib.index'))) {
    _stores[collection] = await HNSWLib.load(storePath, embeddings);
  } else {
    _stores[collection] = await HNSWLib.fromTexts(['_init'], [{ type: '_init' }], embeddings);
    await _stores[collection].save(storePath);
  }
  return _stores[collection];
}

/**
 * Add a document to a collection.
 * @param {string} collection - 'messages' | 'admin_events'
 * @param {string} text - text to embed
 * @param {object} metadata - arbitrary metadata stored alongside vector
 */
async function addDocument(collection, text, metadata = {}) {
  try {
    const store = await getStore(collection);
    await store.addDocuments([{ pageContent: text, metadata }]);
    const storePath = path.join(DATA_DIR, collection);
    await store.save(storePath);
  } catch (err) {
    console.error(`[VectorStore] addDocument error (${collection}):`, err.message);
  }
}

/**
 * Semantic search across a collection.
 * @param {string} collection
 * @param {string} query
 * @param {number} k - number of results
 */
async function search(collection, query, k = 10) {
  try {
    const store = await getStore(collection);
    const results = await store.similaritySearchWithScore(query, k);
    return results
      .filter(([doc]) => doc.metadata.type !== '_init')
      .map(([doc, score]) => ({ text: doc.pageContent, metadata: doc.metadata, score }));
  } catch (err) {
    console.error(`[VectorStore] search error (${collection}):`, err.message);
    return [];
  }
}

module.exports = { addDocument, search };
```

**Step 3: Smoke-test (non-blocking, fire-and-forget pattern)**

```bash
node -e "
const { addDocument, search } = require('./lib/vectorstore');
(async () => {
  console.log('Adding test doc...');
  await addDocument('messages', 'Hello from One21 platform', { user: 'test', ts: new Date().toISOString() });
  console.log('Searching...');
  const r = await search('messages', 'greeting platform', 3);
  console.log('Results:', JSON.stringify(r, null, 2));
})().catch(console.error);
"
```

Expected: model downloads on first run (~23MB), then returns result with text + score.

**Step 4: Commit**

```bash
git add lib/vectorstore.js package.json package-lock.json
git commit -m "feat: LangChain + HNSWLib vector store setup (local embeddings)"
```

---

## Task 8: Vectorize messages on save

**Files:**
- Modify: `routes/messages.js`

**Context:**
After a message is saved to SQLite, fire-and-forget an async embed call. Do NOT await it in the request handler — the response returns immediately, embedding happens in background.

**Step 1: Read the current messages.js save handler**

```bash
cat routes/messages.js
```

Find the `db.prepare('INSERT INTO messages...')` call.

**Step 2: Add vectorization after message insert**

```js
const { addDocument } = require('../lib/vectorstore');

// After the INSERT (non-blocking):
const msgId = result.lastInsertRowid; // or however the ID is captured
const senderName = req.user.display_name || req.user.username;
setImmediate(() => {
  addDocument('messages', text, {
    message_id: msgId,
    room_id: roomId,
    sender_id: req.user.id,
    sender: senderName,
    ts: new Date().toISOString(),
  }).catch(() => {}); // silent failure — vectorization is best-effort
});
```

**Step 3: Test — send a message and verify it gets indexed**

```bash
# Send a message via API (or use the UI)
# Then search:
node -e "
const { search } = require('./lib/vectorstore');
search('messages', 'buna ziua', 5).then(r => console.log(JSON.stringify(r, null, 2)));
"
```

**Step 4: Commit**

```bash
git add routes/messages.js
git commit -m "feat: vectorize messages on save (background, best-effort)"
```

---

## Task 9: Vectorize admin events

**Files:**
- Create: `lib/events.js`
- Modify: `routes/admin.js` (emit events at key actions)

**Context:**
Admin events to track: user permission change, invite created, room request reviewed. Call `logEvent()` after each action — fire-and-forget.

**Step 1: Create `lib/events.js`**

```js
const { addDocument } = require('./vectorstore');

/**
 * Log an admin event to the vector store.
 * @param {string} type - event type slug
 * @param {string} summary - human-readable summary (what gets embedded)
 * @param {object} metadata - extra data
 */
function logEvent(type, summary, metadata = {}) {
  setImmediate(() => {
    addDocument('admin_events', summary, {
      type,
      ts: new Date().toISOString(),
      ...metadata,
    }).catch(() => {});
  });
}

module.exports = { logEvent };
```

**Step 2: Add event logging to `routes/admin.js`**

```js
const { logEvent } = require('../lib/events');

// In PUT /users/:id/permissions, after permissions are saved:
logEvent('permissions_changed', `Admin ${req.user.username} updated permissions for user ${userId}`, {
  admin_id: req.user.id,
  target_user_id: userId,
});

// In POST /invites, after insert:
logEvent('invite_created', `Admin ${req.user.username} created invite ${code}${note ? ': ' + note : ''}`, {
  admin_id: req.user.id,
  code,
  note,
});

// In PUT /room-requests/:id, after update:
logEvent('room_request_reviewed', `Admin ${req.user.username} ${status} room request "${request.name}"`, {
  admin_id: req.user.id,
  request_id: req.params.id,
  status,
});
```

**Step 3: Commit**

```bash
git add lib/events.js routes/admin.js
git commit -m "feat: log admin events to vector store"
```

---

## Task 10: Semantic search API endpoint

**Files:**
- Modify: `routes/admin.js`

**Context:**
Add `GET /api/admin/search?q=TEXT&collection=messages|admin_events|all` that returns semantic search results.

**Step 1: Add import at top of admin.js**

```js
const { search } = require('../lib/vectorstore');
```

**Step 2: Add search endpoint**

```js
// GET /api/admin/search?q=...&collection=all|messages|admin_events
router.get('/search', async (req, res) => {
  const q = req.query.q;
  const collection = req.query.collection || 'all';
  if (!q || q.trim().length < 2) return res.status(400).json({ error: 'q must be at least 2 characters' });

  try {
    let results = [];
    if (collection === 'all' || collection === 'messages') {
      const msgs = await search('messages', q, 8);
      results.push(...msgs.map(r => ({ ...r, collection: 'messages' })));
    }
    if (collection === 'all' || collection === 'admin_events') {
      const evts = await search('admin_events', q, 5);
      results.push(...evts.map(r => ({ ...r, collection: 'admin_events' })));
    }
    results.sort((a, b) => b.score - a.score);
    res.json({ results: results.slice(0, 10) });
  } catch (err) {
    res.status(500).json({ error: 'Search failed', detail: err.message });
  }
});
```

**Step 3: Test**

```bash
curl -s "http://localhost:3737/api/admin/search?q=buna+ziua" \
  -H "Authorization: Bearer $TOKEN"
```

Expected: `{"results":[{"text":"...","metadata":{...},"score":0.XX,"collection":"messages"}]}`

**Step 4: Commit**

```bash
git add routes/admin.js
git commit -m "feat: semantic search API endpoint"
```

---

## Task 11: Admin UI — user permissions panel

**Files:**
- Modify: `public/admin.html` (users table rows → clickable, permissions panel HTML + JS)
- Modify: `public/css/layers/pages/admin.css` (panel styles)

**Context:**
In admin.html, the `loadUsers()` function renders rows in `#usersBody`. Add a click handler that opens a slide-in panel on the right showing permissions for that user.

**Step 1: Add panel HTML**

In `admin.html`, just before `</div>` closing `class="admin-layout"`, add:

```html
<!-- ── USER PERMISSIONS PANEL ── -->
<div class="perms-panel" id="permsPanel">
  <div class="perms-panel__header">
    <span class="perms-panel__title" id="permsPanelTitle">Node_Permissions</span>
    <button class="perms-panel__close" onclick="closePermsPanel()">✕</button>
  </div>
  <div class="perms-panel__body" id="permsPanelBody">
    <!-- filled by JS -->
  </div>
  <div class="perms-panel__footer">
    <button class="t-btn t-btn--accent" onclick="savePermissions()">Save_Permissions</button>
    <button class="t-btn" onclick="closePermsPanel()">Cancel</button>
  </div>
</div>
<div class="perms-overlay" id="permsOverlay" onclick="closePermsPanel()"></div>
```

**Step 2: Add panel CSS to `public/css/layers/pages/admin.css`**

```css
/* Permissions slide-in panel */
.perms-panel {
  position: fixed; top: 0; right: -420px; width: 420px; height: 100vh;
  background: var(--color-surface); border-left: 1px solid var(--color-border);
  display: flex; flex-direction: column; z-index: 200;
  transition: right 0.25s ease;
}
.perms-panel.open { right: 0; }
.perms-panel__header {
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--color-border);
}
.perms-panel__title { font-family: var(--font-mono); font-size: 0.85rem; color: var(--color-accent); }
.perms-panel__close { background: none; border: none; color: var(--color-text-muted); cursor: pointer; font-size: 1.1rem; }
.perms-panel__body { flex: 1; overflow-y: auto; padding: var(--space-5); display: flex; flex-direction: column; gap: var(--space-5); }
.perms-panel__footer { padding: var(--space-4) var(--space-5); border-top: 1px solid var(--color-border); display: flex; gap: var(--space-3); }
.perms-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 199; }
.perms-overlay.open { display: block; }

.perm-row { display: flex; align-items: center; justify-content: space-between; padding: var(--space-3) 0; border-bottom: 1px solid var(--color-border); }
.perm-row__label { font-size: 0.85rem; color: var(--color-text-secondary); font-family: var(--font-mono); }
.perm-row__value { display: flex; align-items: center; gap: var(--space-2); }
.perm-toggle { appearance: none; width: 36px; height: 20px; background: var(--color-border); border-radius: 10px; cursor: pointer; position: relative; transition: background 0.2s; }
.perm-toggle:checked { background: var(--color-accent); }
.perm-toggle::after { content:''; position: absolute; width: 14px; height: 14px; background: white; border-radius: 50%; top: 3px; left: 3px; transition: left 0.2s; }
.perm-toggle:checked::after { left: 19px; }
```

**Step 3: Add JS in admin.html script section**

```js
let currentPermUserId = null;
let currentPerms = {};

async function openPermsPanel(userId, username) {
  currentPermUserId = userId;
  document.getElementById('permsPanelTitle').textContent = `Permissions: ${username}`;
  document.getElementById('permsPanelBody').innerHTML = '<div class="u-dim">Loading...</div>';
  document.getElementById('permsPanel').classList.add('open');
  document.getElementById('permsOverlay').classList.add('open');

  const data = await Auth.api(`/api/admin/users/${userId}/permissions`);
  if (!data) return;
  currentPerms = data.permissions;
  renderPermsPanel(data.permissions);
}

function renderPermsPanel(p) {
  const agents = allUsers.filter(u => u.role === 'agent');
  document.getElementById('permsPanelBody').innerHTML = `
    <div class="perm-row">
      <span class="perm-row__label">can_send_files</span>
      <div class="perm-row__value">
        <input type="checkbox" class="perm-toggle" id="perm_files" ${p.can_send_files ? 'checked' : ''}>
      </div>
    </div>
    <div class="perm-row">
      <span class="perm-row__label">max_messages_per_day</span>
      <div class="perm-row__value">
        <input type="number" class="admin-toolbar__input" id="perm_maxmsg" style="width:80px"
          placeholder="∞" value="${p.max_messages_per_day ?? ''}">
      </div>
    </div>
    <div>
      <div class="perm-row__label" style="margin-bottom:8px">allowed_agents</div>
      ${agents.map(a => `
        <div class="perm-row">
          <span class="perm-row__label">${a.display_name} (${a.username})</span>
          <input type="checkbox" class="perm-toggle perm-agent" data-agent-id="${a.id}"
            ${(p.allowed_agents || []).includes(a.id) ? 'checked' : ''}>
        </div>
      `).join('')}
      ${agents.length === 0 ? '<div class="u-dim">No agents configured</div>' : ''}
    </div>
  `;
}

async function savePermissions() {
  const canSendFiles = document.getElementById('perm_files').checked;
  const maxMsg = document.getElementById('perm_maxmsg').value;
  const agentCheckboxes = document.querySelectorAll('.perm-agent');
  const allowedAgents = [...agentCheckboxes].filter(c => c.checked).map(c => parseInt(c.dataset.agentId));

  const payload = {
    can_send_files: canSendFiles,
    allowed_agents: allowedAgents,
    max_messages_per_day: maxMsg ? parseInt(maxMsg) : null,
  };

  const data = await Auth.api(`/api/admin/users/${currentPermUserId}/permissions`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (data) { toast('Permissions saved'); closePermsPanel(); }
}

function closePermsPanel() {
  document.getElementById('permsPanel').classList.remove('open');
  document.getElementById('permsOverlay').classList.remove('open');
  currentPermUserId = null;
}
```

**Step 4: Make user rows clickable**

In the `renderUsers()` or `loadUsers()` function, find where `<tr>` elements are rendered and add `onclick="openPermsPanel(${u.id}, '${u.username}')"` to the `<tr>` tag. Also add a `.clickable` CSS class with `cursor: pointer`.

**Step 5: Test in browser**

Navigate to admin.html → Node_Registry → click a user row → panel slides in → toggle permissions → save → verify via API.

**Step 6: Commit**

```bash
git add public/admin.html public/css/layers/pages/admin.css
git commit -m "feat: admin user permissions panel slide-in"
```

---

## Task 12: Admin UI — enhanced invite wizard

**Files:**
- Modify: `public/admin.html`
- Modify: `public/css/layers/pages/admin.css`

**Context:**
Replace the single "Generate_New_Code" button with a modal that lets admin choose a preset or configure custom permissions before generating the invite.

**Presets:**
- `Guest` — `{ can_send_files: false, allowed_agents: [] }`
- `Standard` — `{ can_send_files: true, allowed_agents: [] }`
- `AI User` — `{ can_send_files: true, allowed_agents: [all agent IDs] }`
- `Custom` — manual toggles

**Step 1: Add invite modal HTML**

```html
<div class="modal-overlay" id="inviteModal" style="display:none">
  <div class="modal">
    <div class="modal__header">
      <span class="modal__title">Generate_Access_Code</span>
      <button onclick="document.getElementById('inviteModal').style.display='none'">✕</button>
    </div>
    <div class="modal__body">
      <div style="margin-bottom:12px">
        <label class="perm-row__label">Preset</label>
        <select id="invitePreset" class="admin-toolbar__input" onchange="applyInvitePreset(this.value)">
          <option value="guest">Guest (no files, no AI)</option>
          <option value="standard" selected>Standard</option>
          <option value="ai">AI User (all agents)</option>
          <option value="custom">Custom</option>
        </select>
      </div>
      <div id="inviteCustomPerms">
        <div class="perm-row">
          <span class="perm-row__label">can_send_files</span>
          <input type="checkbox" class="perm-toggle" id="inv_files" checked>
        </div>
        <div id="inv_agents_section">
          <div class="perm-row__label" style="margin:8px 0 4px">allowed_agents</div>
          <!-- filled dynamically -->
        </div>
      </div>
      <div style="margin-top:12px">
        <label class="perm-row__label">Note (optional)</label>
        <input type="text" class="admin-toolbar__input" id="inviteNote" placeholder="e.g. For marketing team">
      </div>
    </div>
    <div class="modal__footer">
      <button class="t-btn t-btn--accent" onclick="generateInviteWithPerms()">Generate_Code</button>
      <button class="t-btn" onclick="document.getElementById('inviteModal').style.display='none'">Cancel</button>
    </div>
  </div>
</div>
```

**Step 2: Replace generateInvite() JS**

```js
function openInviteModal() {
  const agents = allUsers.filter(u => u.role === 'agent');
  const agentsHtml = agents.map(a => `
    <div class="perm-row">
      <span class="perm-row__label">${a.display_name}</span>
      <input type="checkbox" class="perm-toggle inv-agent" data-agent-id="${a.id}">
    </div>
  `).join('');
  document.getElementById('inv_agents_section').innerHTML =
    '<div class="perm-row__label" style="margin:8px 0 4px">allowed_agents</div>' + agentsHtml;
  document.getElementById('inviteModal').style.display = 'flex';
  applyInvitePreset('standard');
}

function applyInvitePreset(preset) {
  const agents = document.querySelectorAll('.inv-agent');
  const filesToggle = document.getElementById('inv_files');
  if (preset === 'guest') {
    filesToggle.checked = false;
    agents.forEach(a => a.checked = false);
  } else if (preset === 'standard') {
    filesToggle.checked = true;
    agents.forEach(a => a.checked = false);
  } else if (preset === 'ai') {
    filesToggle.checked = true;
    agents.forEach(a => a.checked = true);
  }
}

async function generateInviteWithPerms() {
  const canSendFiles = document.getElementById('inv_files').checked;
  const agentCheckboxes = document.querySelectorAll('.inv-agent');
  const allowedAgents = [...agentCheckboxes].filter(c => c.checked).map(c => parseInt(c.dataset.agentId));
  const note = document.getElementById('inviteNote').value.trim();

  const data = await Auth.api('/api/admin/invites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      note: note || null,
      default_permissions: { can_send_files: canSendFiles, allowed_agents: allowedAgents },
    }),
  });
  if (data) {
    document.getElementById('inviteModal').style.display = 'none';
    toast(`Code generated: ${data.code}`);
    loadInvites();
  }
}
```

**Step 3: Update "Generate_New_Code" button**

Change `onclick="generateInvite()"` to `onclick="openInviteModal()"`.

**Step 4: Add modal CSS to `admin.css`**

```css
.modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 300; align-items: center; justify-content: center; }
.modal { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); width: 440px; max-width: 95vw; }
.modal__header { display: flex; align-items: center; justify-content: space-between; padding: var(--space-4) var(--space-5); border-bottom: 1px solid var(--color-border); }
.modal__title { font-family: var(--font-mono); font-size: 0.85rem; color: var(--color-accent); }
.modal__body { padding: var(--space-5); }
.modal__footer { padding: var(--space-4) var(--space-5); border-top: 1px solid var(--color-border); display: flex; gap: var(--space-3); justify-content: flex-end; }
```

**Step 5: Test invite wizard**

Navigate to Access_Codes → click Generate_New_Code → select preset → generate → verify invite row appears with correct note.

**Step 6: Commit**

```bash
git add public/admin.html public/css/layers/pages/admin.css
git commit -m "feat: invite wizard with permission presets"
```

---

## Task 13: Admin UI — room requests section

**Files:**
- Modify: `public/admin.html`
- Modify: `public/css/layers/pages/admin.css`

**Context:**
Add a new sidebar item "Room_Requests" with a badge showing pending count. Admin can approve/reject with member selection.

**Step 1: Add nav item in admin.html sidebar**

After the existing `Access_Codes` nav button, add:

```html
<button class="admin-nav__item" data-page="room-requests">
  <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
  Room_Requests
  <span class="nav-badge" id="requestsBadge" style="display:none"></span>
</button>
```

**Step 2: Add page HTML**

```html
<!-- ── ROOM REQUESTS ── -->
<div class="admin-page" id="page-room-requests">
  <div class="admin-page-header">
    <div class="admin-page-label">Pending_Review</div>
    <div class="admin-page-title">Room_Requests</div>
  </div>
  <div class="admin-section">
    <table>
      <thead>
        <tr>
          <th>Requester</th>
          <th>Room_Name</th>
          <th>Description</th>
          <th>Requested_Members</th>
          <th>Submitted</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="requestsBody"></tbody>
    </table>
  </div>
</div>
```

**Step 3: Add JS**

```js
async function loadRoomRequests() {
  const data = await Auth.api('/api/admin/room-requests');
  if (!data) return;
  const pending = data.requests.filter(r => r.status === 'pending');
  const badge = document.getElementById('requestsBadge');
  if (pending.length > 0) { badge.textContent = pending.length; badge.style.display = 'inline'; }
  else badge.style.display = 'none';

  document.getElementById('requestsBody').innerHTML = data.requests.map(r => `
    <tr>
      <td class="td-meta">${r.requester_display || r.requester_name}</td>
      <td><strong>${r.name}</strong></td>
      <td class="td-meta">${r.description || '—'}</td>
      <td class="td-meta">${JSON.parse(r.requested_members || '[]').length} members</td>
      <td class="td-meta">${formatDate(r.created_at)}</td>
      <td><span class="badge badge--${r.status}">${r.status}</span></td>
      <td>${r.status === 'pending' ? `
        <button class="t-btn t-btn--accent" onclick="approveRequest(${r.id}, ${JSON.stringify(JSON.parse(r.requested_members || '[]'))})">Approve</button>
        <button class="t-btn t-btn--danger" onclick="rejectRequest(${r.id})">Reject</button>
      ` : '—'}</td>
    </tr>
  `).join('');
}

async function approveRequest(id, memberIds) {
  const data = await Auth.api(`/api/admin/room-requests/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'approved', member_ids: memberIds }),
  });
  if (data) { toast('Room created and approved'); loadRoomRequests(); }
}

async function rejectRequest(id) {
  const data = await Auth.api(`/api/admin/room-requests/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'rejected' }),
  });
  if (data) { toast('Request rejected'); loadRoomRequests(); }
}
```

Also add `'room-requests': loadRoomRequests` to the `loaders` object in the navigation event handler.

**Step 4: Add CSS for badge and status**

```css
.nav-badge { background: var(--color-danger); color: white; font-size: 0.65rem; border-radius: 9px; padding: 1px 6px; margin-left: auto; }
.badge { font-size: 0.72rem; font-family: var(--font-mono); padding: 2px 8px; border-radius: 4px; text-transform: uppercase; }
.badge--pending  { background: rgba(255,180,0,0.15); color: #ffb400; }
.badge--approved { background: rgba(0,200,100,0.15); color: var(--color-success); }
.badge--rejected { background: rgba(255,70,70,0.15);  color: var(--color-danger); }
```

**Step 5: Test in browser**

Submit a room request as a user → check admin Room_Requests → approve → verify room appears.

**Step 6: Commit**

```bash
git add public/admin.html public/css/layers/pages/admin.css
git commit -m "feat: admin room requests panel with approve/reject"
```

---

## Task 14: Admin UI — Neural Search section

**Files:**
- Modify: `public/admin.html`
- Modify: `public/css/layers/pages/admin.css`

**Context:**
Add a "Neural_Search" sidebar section that calls `GET /api/admin/search?q=...` and renders results with relevance scores.

**Step 1: Add nav item**

```html
<button class="admin-nav__item" data-page="search">
  <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
  Neural_Search
</button>
```

**Step 2: Add page HTML**

```html
<!-- ── NEURAL SEARCH ── -->
<div class="admin-page" id="page-search">
  <div class="admin-page-header">
    <div class="admin-page-label">Semantic_Query</div>
    <div class="admin-page-title">Neural_Search</div>
  </div>
  <div class="admin-toolbar">
    <input class="admin-toolbar__input" type="text" id="searchQuery"
      placeholder="QUERY_NEURAL_NETWORK..." onkeydown="if(event.key==='Enter') runSearch()">
    <select class="admin-toolbar__input" id="searchCollection" style="width:160px">
      <option value="all">All</option>
      <option value="messages">Messages</option>
      <option value="admin_events">Admin Events</option>
    </select>
    <button class="t-btn t-btn--accent" onclick="runSearch()">Search</button>
  </div>
  <div class="admin-section" id="searchResults">
    <div class="u-dim">Enter a query to search semantically across all interactions.</div>
  </div>
</div>
```

**Step 3: Add JS**

```js
async function runSearch() {
  const q = document.getElementById('searchQuery').value.trim();
  const col = document.getElementById('searchCollection').value;
  if (!q) return;
  document.getElementById('searchResults').innerHTML = '<div class="u-dim">Searching...</div>';

  const data = await Auth.api(`/api/admin/search?q=${encodeURIComponent(q)}&collection=${col}`);
  if (!data || !data.results.length) {
    document.getElementById('searchResults').innerHTML = '<div class="u-dim">No results found.</div>';
    return;
  }

  document.getElementById('searchResults').innerHTML = data.results.map(r => `
    <div class="search-result">
      <div class="search-result__meta">
        <span class="badge badge--${r.collection === 'messages' ? 'approved' : 'pending'}">${r.collection}</span>
        <span class="td-meta">${r.metadata.ts ? formatTime(r.metadata.ts) : ''}</span>
        ${r.metadata.sender ? `<span class="td-meta">${r.metadata.sender}</span>` : ''}
        <span class="u-dim" style="margin-left:auto">score: ${(r.score * 100).toFixed(0)}%</span>
      </div>
      <div class="search-result__text">${r.text}</div>
    </div>
  `).join('');
}
```

Also add `'search': () => {}` to the `loaders` object.

**Step 4: Add CSS**

```css
.search-result { padding: var(--space-4); border-bottom: 1px solid var(--color-border); }
.search-result__meta { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-2); }
.search-result__text { font-size: 0.9rem; color: var(--color-text); line-height: 1.5; }
```

**Step 5: Test**

Navigate to Neural_Search → search "buna ziua" → verify results appear with scores.

**Step 6: Commit**

```bash
git add public/admin.html public/css/layers/pages/admin.css
git commit -m "feat: neural search section in admin console"
```

---

## Task 15: Chat UI — room request button

**Files:**
- Modify: `public/chat.html`
- Modify: `public/css/layers/pages/chat.css` (if needed)

**Context:**
Users can no longer create rooms via `POST /api/rooms`. They need a "Request Room" button/modal in chat.html. Find where the existing "New Room" or create room button is and replace it with a request flow.

**Step 1: Inspect current create-room UI**

```bash
grep -n "createRoom\|new-room\|create.*room\|api/rooms" public/chat.html | head -20
```

**Step 2: Replace create-room button with request-room button**

Change button label and handler from creating directly to opening a request modal:

```html
<button class="btn btn--accent" onclick="openRoomRequestModal()">
  <svg ...>...</svg>
  Request_Room
</button>
```

**Step 3: Add request modal HTML in chat.html**

```html
<div class="modal-overlay" id="roomRequestModal" style="display:none">
  <div class="modal">
    <div class="modal__header">
      <span class="modal__title">Request_New_Room</span>
      <button onclick="document.getElementById('roomRequestModal').style.display='none'">✕</button>
    </div>
    <div class="modal__body">
      <input type="text" id="reqRoomName" placeholder="Room name" class="input" style="width:100%;margin-bottom:10px">
      <textarea id="reqRoomDesc" placeholder="Description (optional)" class="input" style="width:100%;height:60px;margin-bottom:10px"></textarea>
    </div>
    <div class="modal__footer">
      <button class="btn btn--accent" onclick="submitRoomRequest()">Submit_Request</button>
      <button class="btn" onclick="document.getElementById('roomRequestModal').style.display='none'">Cancel</button>
    </div>
  </div>
</div>
```

**Step 4: Add JS**

```js
function openRoomRequestModal() {
  document.getElementById('roomRequestModal').style.display = 'flex';
}

async function submitRoomRequest() {
  const name = document.getElementById('reqRoomName').value.trim();
  const desc = document.getElementById('reqRoomDesc').value.trim();
  if (!name) return;

  const data = await api('/api/room-requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description: desc }),
  });
  if (data) {
    document.getElementById('roomRequestModal').style.display = 'none';
    document.getElementById('reqRoomName').value = '';
    document.getElementById('reqRoomDesc').value = '';
    showToast('Room request submitted. Admin will review it shortly.');
  }
}
```

**Step 5: Test flow**

Log in as non-admin → try to see room request option → submit → log in as admin → see it in Room_Requests → approve → verify room appears for user.

**Step 6: Commit**

```bash
git add public/chat.html public/css/layers/pages/chat.css
git commit -m "feat: room request flow in chat UI"
```

---

## Summary

| # | Task | Files |
|---|------|-------|
| 1 | DB migrations | `db/init.js` |
| 2 | Permission middleware | `middleware/permissions.js` |
| 3 | Admin permissions API | `routes/admin.js` |
| 4 | Enhanced invite API + register | `routes/admin.js`, `routes/auth.js` |
| 5 | Enforce permissions on routes | `routes/rooms.js`, `routes/files.js`, `routes/messages.js` |
| 6 | Room requests API | `routes/room-requests.js`, `routes/admin.js`, `server.js` |
| 7 | Vector store setup | `lib/vectorstore.js`, `package.json` |
| 8 | Vectorize messages | `routes/messages.js` |
| 9 | Vectorize admin events | `lib/events.js`, `routes/admin.js` |
| 10 | Semantic search API | `routes/admin.js` |
| 11 | Admin UI — permissions panel | `public/admin.html`, `public/css/layers/pages/admin.css` |
| 12 | Admin UI — invite wizard | `public/admin.html`, `public/css/layers/pages/admin.css` |
| 13 | Admin UI — room requests | `public/admin.html`, `public/css/layers/pages/admin.css` |
| 14 | Admin UI — neural search | `public/admin.html`, `public/css/layers/pages/admin.css` |
| 15 | Chat UI — room request button | `public/chat.html` |
