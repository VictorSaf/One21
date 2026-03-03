# Live_Nodes Architecture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Introduce three distinct Live_Node types (Group, Cult, Private) with unique visual styles, auto-add General for all new users, and build a Private messaging system with an invitation/acceptance flow.

**Architecture:** Rooms stay as the DB primitive; `type` gains two new values (`cult`, `private`). The sidebar renders each type with a distinct icon prefix and CSS class. Private rooms are created only after the recipient accepts a `private_request`; until then, the initial message is held in a new `private_requests` table. All real-time events use the existing `user:{id}` socket rooms so no new infrastructure is needed.

**Tech Stack:** Node.js · Express · better-sqlite3 · Socket.IO · Vanilla JS · CSS Cascade Layers (`@layer components`, `@layer pages`)

---

## Task 1 — DB Migration: `cult`/`private` room types + `private_requests` table

**Files:**
- Modify: `db/init.js` (after line 234, end of current migrations)

### Step 1 — Add migration code to `db/init.js`

Append after all existing `safeAdd` / `try` migration blocks (around line 234, before `module.exports`):

```js
// ── Migrate: expand rooms.type CHECK to include cult + private ──────────────
try {
  // Test if new types are already supported
  db.exec("INSERT INTO rooms (name, type, created_by) VALUES ('__type_test', 'cult', 1)");
  db.exec("DELETE FROM rooms WHERE name = '__type_test'");
} catch {
  // Recreate rooms with updated CHECK constraint (SQLite can't ALTER CHECK inline)
  db.exec(`
    CREATE TABLE rooms_v2 (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      description TEXT,
      type        TEXT NOT NULL DEFAULT 'group'
                  CHECK(type IN ('direct','group','channel','cult','private')),
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_by  INTEGER REFERENCES users(id),
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`INSERT INTO rooms_v2 SELECT * FROM rooms`);
  db.exec(`DROP TABLE rooms`);
  db.exec(`ALTER TABLE rooms_v2 RENAME TO rooms`);
  console.log('[DB] Migrated: rooms.type CHECK expanded (cult, private)');
}

// ── private_requests table ───────────────────────────────────────────────────
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS private_requests (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user_id    INTEGER NOT NULL REFERENCES users(id),
      to_user_id      INTEGER NOT NULL REFERENCES users(id),
      initial_message TEXT    NOT NULL,
      status          TEXT    NOT NULL DEFAULT 'pending'
                      CHECK(status IN ('pending','accepted','declined')),
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      responded_at    TEXT
    )
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_private_req_pending
    ON private_requests(from_user_id, to_user_id) WHERE status = 'pending'
  `);
} catch {}
```

### Step 2 — Restart server and verify

```bash
node server.js &
# Expected in log: [DB] Migrated: rooms.type CHECK expanded (cult, private)
# (only first run; subsequent runs skip silently)
```

Verify in Node REPL:
```bash
node -e "
const { getDb } = require('./db/init.js');
const db = getDb();
const cols = db.prepare('PRAGMA table_info(private_requests)').all();
console.log(cols.map(c => c.name));
" 2>&1 | grep -v dotenv
# Expected: [ 'id', 'from_user_id', 'to_user_id', 'initial_message', 'status', 'created_at', 'responded_at' ]
```

### Step 3 — Commit

```bash
git add db/init.js
git commit -m "feat(db): add cult/private room types and private_requests table"
```

---

## Task 2 — General Always Auto-Included (auth.js + admin invite form)

**Files:**
- Modify: `routes/auth.js` (lines 101–107)
- Modify: `public/admin.html` (function `renderInviteRooms`, lines 1622–1646; function `openInviteModal`, line 1666)

### Step 1 — `routes/auth.js`: always inject General regardless of invite's explicit rooms

Find the block at lines 101–107 (starts with `if (perms.rooms && Array.isArray...)`).

Replace the entire `let roomAssignments; if ... else ...` block with:

```js
let roomAssignments;
if (perms.rooms && Array.isArray(perms.rooms) && perms.rooms.length > 0) {
  roomAssignments = perms.rooms;
} else {
  const allRooms = db.prepare(
    "SELECT id, type FROM rooms WHERE type IN ('channel', 'group') AND is_archived = 0"
  ).all();
  roomAssignments = allRooms.map(r => ({
    id: r.id,
    access_level: r.type === 'channel' ? 'readonly' : 'readandwrite',
  }));
}

// General (channel) is always included — even when invite has explicit rooms
const generalRoom = db.prepare(
  "SELECT id FROM rooms WHERE name = 'General' AND type = 'channel'"
).get();
if (generalRoom && !roomAssignments.some(r => r.id === generalRoom.id)) {
  roomAssignments.push({ id: generalRoom.id, access_level: 'readonly' });
}
```

### Step 2 — `public/admin.html`: hide General from room picker, show it as locked default

Find `function renderInviteRooms(rooms)` at line 1622. Change the `list.innerHTML = rooms.map(...)` to skip General and prepend a locked badge:

```js
function renderInviteRooms(rooms) {
  const list = document.getElementById('invRoomsList');
  if (!rooms || rooms.length === 0) {
    list.innerHTML = '<div class="u-dim">Nicio cameră disponibilă.</div>';
    return;
  }
  const nonGeneral = rooms.filter(r => !(r.type === 'channel' && r.name === 'General'));
  const generalLocked = `
    <div class="invite-room-row invite-room-row--locked">
      <span class="perm-toggle--locked">✓</span>
      <label class="invite-room-row__name">General <span class="badge badge--muted">default · readonly</span></label>
    </div>`;
  list.innerHTML = generalLocked + nonGeneral.map(r => `
    <div class="invite-room-row">
      <input type="checkbox" class="perm-toggle inv-room" data-room-id="${r.id}" id="inv_room_${r.id}">
      <label class="invite-room-row__name" for="inv_room_${r.id}">${r.type === 'cult' ? '⬡' : '#'} ${r.name} <span class="u-dim">(${r.member_count})</span></label>
      <select class="invite-room-row__level" data-room-level="${r.id}" disabled>
        <option value="readandwrite" selected>read+write</option>
        <option value="readonly">readonly</option>
        <option value="post_docs">post_docs</option>
      </select>
    </div>
  `).join('');
  list.querySelectorAll('.inv-room').forEach(cb => {
    cb.addEventListener('change', () => {
      const sel = list.querySelector(`[data-room-level="${cb.dataset.roomId}"]`);
      if (sel) sel.disabled = !cb.checked;
    });
  });
}
```

### Step 3 — Add locked-row CSS to `public/css/layers/pages/admin.css`

Append inside `@layer pages {}`:

```css
/* ── Invite room row — locked (General default) ── */
.invite-room-row--locked {
  opacity: 0.65;
  pointer-events: none;
  align-items: center;
  display: flex;
  gap: var(--sp-2);
  padding: var(--sp-1) 0;
}
.perm-toggle--locked {
  color: var(--online);
  font-size: var(--font-sm);
  width: 16px;
  text-align: center;
}
```

### Step 4 — Test

1. Create a new invite code in admin panel
2. Confirm General row shows "✓ default · readonly" and is not checkable
3. Create a fresh user with the code; confirm in DB:

```bash
node -e "
const { getDb } = require('./db/init.js');
const db = getDb();
const rows = db.prepare('SELECT r.name, rm.access_level FROM room_members rm JOIN rooms r ON r.id = rm.room_id WHERE rm.user_id = (SELECT id FROM users ORDER BY id DESC LIMIT 1)').all();
console.log(rows);
" 2>&1 | grep -v dotenv
# Expected: [{ name: 'General', access_level: 'readonly' }, ...]
```

### Step 5 — Commit

```bash
git add routes/auth.js public/admin.html public/css/layers/pages/admin.css
git commit -m "feat: General always auto-included for new users; locked in invite form"
```

---

## Task 3 — Sidebar: Visual Distinction per Live_Node Type

**Files:**
- Modify: `public/js/chat.js` (function `roomItemHtml`, lines 149–173; function `roomDisplayName` — new)
- Modify: `routes/rooms.js` (GET `/api/rooms`, lines 42–58 — add `display_name` subquery)
- Modify: `public/css/layers/components.css` (after existing `.chat-item` block, around line 650)

### Step 1 — `routes/rooms.js`: add `display_name` subquery for private rooms

Find the `db.prepare(\`SELECT r.*, rm.role...` query at line 42. Add `display_name` as a computed column after `rm.access_level as my_access_level,`:

```sql
CASE WHEN r.type = 'private'
  THEN (
    SELECT u.display_name FROM room_members rm2
    JOIN users u ON u.id = rm2.user_id
    WHERE rm2.room_id = r.id AND rm2.user_id != rm.user_id
    LIMIT 1
  )
  ELSE r.name
END as display_name,
```

Full updated SELECT opening (replace lines 43–57):

```js
const rooms = db.prepare(`
  SELECT r.*,
    rm.role as my_role, rm.access_level as my_access_level,
    CASE WHEN r.type = 'private'
      THEN (
        SELECT u.display_name FROM room_members rm2
        JOIN users u ON u.id = rm2.user_id
        WHERE rm2.room_id = r.id AND rm2.user_id != rm.user_id
        LIMIT 1
      )
      ELSE r.name
    END as display_name,
    (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) as member_count,
    (SELECT m.text FROM messages m WHERE m.room_id = r.id AND m.recipient_id IS NULL ORDER BY m.created_at DESC LIMIT 1) as last_message,
    (SELECT m.created_at FROM messages m WHERE m.room_id = r.id AND m.recipient_id IS NULL ORDER BY m.created_at DESC LIMIT 1) as last_message_at,
    (SELECT u.display_name FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.room_id = r.id AND m.recipient_id IS NULL ORDER BY m.created_at DESC LIMIT 1) as last_message_sender,
    (SELECT COUNT(*) FROM messages m
     WHERE m.room_id = r.id
       AND m.sender_id != ?
       AND (m.recipient_id IS NULL OR m.recipient_id = rm.user_id)
       AND m.id NOT IN (SELECT message_id FROM message_reads WHERE user_id = ?)) as unread_count
  FROM rooms r
  JOIN room_members rm ON r.id = rm.room_id AND rm.user_id = ?
  WHERE r.is_archived = 0
  ORDER BY last_message_at DESC NULLS LAST
`).all(req.user.id, req.user.id, req.user.id);
```

### Step 2 — `public/js/chat.js`: update `roomItemHtml` with type-aware icons and classes

Replace the entire `function roomItemHtml(room)` (lines 149–173) with:

```js
function roomItemHtml(room) {
  const isActive = room.id === currentRoomId;
  const label = room.display_name || room.name;
  const preview = room.last_message
    ? `${room.last_message_sender ? room.last_message_sender + ': ' : ''}${truncate(room.last_message, 35)}`
    : '> no_transmissions';
  const unread = (room.unread_count > 0 && !isActive)
    ? `<span class="badge badge--accent">${room.unread_count > 99 ? '99+' : room.unread_count}</span>`
    : '';

  // Icon and modifier class per Live_Node type
  const typeConfig = {
    channel: { icon: '■', mod: 'chat-item--channel' },
    group:   { icon: '#', mod: 'chat-item--group'   },
    cult:    { icon: '⬡', mod: 'chat-item--cult'    },
    private: { icon: '@', mod: 'chat-item--private'  },
    direct:  { icon: '@', mod: ''                   },
  };
  const { icon, mod } = typeConfig[room.type] || { icon: '#', mod: '' };

  return `
    <div class="chat-item ${mod} ${isActive ? 'chat-item--active' : ''}" data-room-id="${room.id}" data-room-type="${room.type}">
      <span class="chat-item__prefix">${icon}</span>
      <div class="chat-item__body">
        <div class="chat-item__header">
          <span class="chat-item__name">${esc(label)}</span>
          <span class="chat-item__time">${room.last_message_at ? formatTime(room.last_message_at) : ''}</span>
        </div>
        <div class="chat-item__preview">
          <span class="chat-item__text">${esc(preview)}</span>
          ${unread}
        </div>
      </div>
    </div>`;
}
```

### Step 3 — `public/css/layers/components.css`: add type modifier classes

Append after the existing `.chat-item--active .chat-item__prefix { color: var(--accent); }` line (around line 648):

```css
/* ── Live_Node type modifiers ──────────────────────────── */
/* Channel (General) — always-on gold accent */
.chat-item--channel .chat-item__prefix { color: var(--accent); }
.chat-item--channel .chat-item__name   { color: var(--text-accent); }

/* Cult — purple indicator */
.chat-item--cult { border-left-color: var(--purple) !important; }
.chat-item--cult .chat-item__prefix { color: var(--purple); }
.chat-item--cult:hover { border-left-color: var(--purple) !important; }
.chat-item--cult.chat-item--active { border-left-color: var(--purple) !important; }
.chat-item--cult.chat-item--active .chat-item__name  { color: var(--purple); }
.chat-item--cult.chat-item--active .chat-item__prefix { color: var(--purple); }

/* Private — warm amber indicator */
.chat-item--private { border-left-color: var(--warning) !important; }
.chat-item--private .chat-item__prefix { color: var(--warning); }
.chat-item--private:hover { border-left-color: var(--warning) !important; }
.chat-item--private.chat-item--active { border-left-color: var(--warning) !important; }
.chat-item--private.chat-item--active .chat-item__name   { color: var(--warning); }
.chat-item--private.chat-item--active .chat-item__prefix { color: var(--warning); }
```

### Step 4 — Run CSS audit

```bash
bash scripts/audit-css.sh
# Expected: 0 errors, 0 warnings — PASS
```

### Step 5 — Commit

```bash
git add routes/rooms.js public/js/chat.js public/css/layers/components.css
git commit -m "feat(ui): Live_Node visual distinction — channel/group/cult/private types"
```

---

## Task 4 — Admin: Create Cult Rooms

**Files:**
- Modify: `public/admin.html` (room creation form — find `createRoomModal` or equivalent JS)
- Modify: `routes/rooms.js` (POST `/api/rooms` — allow `cult` type)

### Step 1 — Find room creation modal in admin.html

```bash
grep -n "createRoom\|type.*channel\|type.*group\|room.*type\|newRoom" /Users/victorsafta/onechat/public/admin.html | head -20
```

### Step 2 — `routes/rooms.js`: add `cult` to `createSchema`

Find line 28:
```js
type: z.enum(['group', 'channel']).optional(),
```
Change to:
```js
type: z.enum(['group', 'channel', 'cult']).optional(),
```

### Step 3 — `routes/rooms.js`: auto-add agents to cult rooms on creation

In the `router.post('/', ...)` handler, find the `if (roomType === 'channel') { ... } else if (Array.isArray(member_ids))` block (lines 137–152).

Add a new branch for cult rooms **before** the `else if (Array.isArray(member_ids))` line:

```js
if (roomType === 'channel') {
  // existing channel code...
} else if (roomType === 'cult') {
  // Auto-add all active AI agents to cult rooms
  const agents = db.prepare("SELECT id FROM users WHERE role = 'agent'").all();
  const addMember = db.prepare(
    'INSERT OR IGNORE INTO room_members (room_id, user_id, role, access_level, color_index) VALUES (?, ?, ?, ?, ?)'
  );
  agents.forEach((a, i) => addMember.run(id, a.id, 'member', 'readandwrite', (i + 1) % 8));
  if (Array.isArray(member_ids)) {
    let colorCounter = agents.length + 1;
    for (const uid of member_ids) {
      if (uid !== req.user.id) {
        const accessLevel = normalizeAccessLevel(member_access && member_access[String(uid)]);
        addMember.run(id, uid, 'member', accessLevel, colorCounter % 8);
        colorCounter++;
      }
    }
  }
} else if (Array.isArray(member_ids)) {
  // existing group code...
}
```

### Step 4 — `public/admin.html`: add Cult option to room creation form

Find the room type `<select>` in the admin panel (search for `type.*channel` or `type.*group` near a form). Add `<option value="cult">⬡ Cult</option>` alongside group/channel options.

### Step 5 — Test

```bash
# Via API:
curl -X POST http://localhost:3737/api/rooms \
  -H "Authorization: Bearer $(cat /tmp/admin_token.txt)" \
  -H "Content-Type: application/json" \
  -d '{"name":"TestCult","type":"cult"}'
# Expected: { room: { ..., type: 'cult' } }
```

### Step 6 — Commit

```bash
git add routes/rooms.js public/admin.html
git commit -m "feat: Cult Live_Node type — admin creation, auto-assigns AI agents"
```

---

## Task 5 — Private Request: Backend Routes

**Files:**
- Create: `routes/private.js`
- Modify: `server.js` (mount the new router)

### Step 1 — Create `routes/private.js`

```js
'use strict';
const express = require('express');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// POST /api/private/request — initiate a private chat request
router.post('/request', (req, res) => {
  const { to_user_id, initial_message } = req.body;
  if (!to_user_id || !initial_message || typeof initial_message !== 'string') {
    return res.status(400).json({ error: 'to_user_id and initial_message required' });
  }
  if (to_user_id === req.user.id) {
    return res.status(400).json({ error: 'Cannot private chat with yourself' });
  }
  const db = getDb();
  const io = req.app.get('io');

  // Check if private room already exists between these two users
  const existing = db.prepare(`
    SELECT r.id FROM rooms r
    JOIN room_members rm1 ON r.id = rm1.room_id AND rm1.user_id = ?
    JOIN room_members rm2 ON r.id = rm2.room_id AND rm2.user_id = ?
    WHERE r.type = 'private'
    LIMIT 1
  `).get(req.user.id, to_user_id);

  if (existing) {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(existing.id);
    return res.json({ exists: true, room });
  }

  const target = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(to_user_id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  // Check for pending request already sent
  const pendingCheck = db.prepare(
    "SELECT id FROM private_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'"
  ).get(req.user.id, to_user_id);
  if (pendingCheck) return res.status(409).json({ error: 'Request already pending' });

  const result = db.prepare(
    "INSERT INTO private_requests (from_user_id, to_user_id, initial_message) VALUES (?, ?, ?)"
  ).run(req.user.id, to_user_id, initial_message.trim().slice(0, 500));

  // Notify recipient via their personal socket room
  io.to(`user:${to_user_id}`).emit('private_request', {
    request_id: result.lastInsertRowid,
    from_user_id: req.user.id,
    from_display_name: req.user.display_name || req.user.username,
    initial_message: initial_message.trim().slice(0, 500),
  });

  res.json({ ok: true, request_id: result.lastInsertRowid });
});

// POST /api/private/request/:id/accept
router.post('/request/:id/accept', (req, res) => {
  const db = getDb();
  const io = req.app.get('io');
  const requestId = parseInt(req.params.id);

  const request = db.prepare(
    "SELECT * FROM private_requests WHERE id = ? AND to_user_id = ? AND status = 'pending'"
  ).get(requestId, req.user.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });

  const roomId = db.transaction(() => {
    // Create the private room
    const r = db.prepare(
      "INSERT INTO rooms (name, type, created_by) VALUES (?, 'private', ?)"
    ).run(`private-${request.from_user_id}-${request.to_user_id}`, request.from_user_id);
    const id = r.lastInsertRowid;

    // Add both users as members
    const add = db.prepare(
      'INSERT OR IGNORE INTO room_members (room_id, user_id, role, access_level, color_index) VALUES (?, ?, ?, ?, ?)'
    );
    add.run(id, request.from_user_id, 'owner', 'readandwrite', 0);
    add.run(id, request.to_user_id, 'member', 'readandwrite', 1);

    // Store the initial message
    db.prepare(
      'INSERT INTO messages (room_id, sender_id, text, type) VALUES (?, ?, ?, ?)'
    ).run(id, request.from_user_id, request.initial_message, 'text');

    // Mark request accepted
    db.prepare(
      "UPDATE private_requests SET status = 'accepted', responded_at = datetime('now') WHERE id = ?"
    ).run(requestId);

    return id;
  })();

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);

  // Notify both users to add the new room to their sidebar
  io.to(`user:${request.from_user_id}`).to(`user:${request.to_user_id}`).emit('room_added', { room });

  res.json({ ok: true, room });
});

// POST /api/private/request/:id/decline
router.post('/request/:id/decline', (req, res) => {
  const db = getDb();
  const io = req.app.get('io');
  const requestId = parseInt(req.params.id);

  const request = db.prepare(
    "SELECT * FROM private_requests WHERE id = ? AND to_user_id = ? AND status = 'pending'"
  ).get(requestId, req.user.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });

  db.prepare(
    "UPDATE private_requests SET status = 'declined', responded_at = datetime('now') WHERE id = ?"
  ).run(requestId);

  io.to(`user:${request.from_user_id}`).emit('private_declined', {
    request_id: requestId,
    from_display_name: req.user.display_name || req.user.username,
  });

  res.json({ ok: true });
});

// GET /api/private/requests/pending — get incoming pending requests for current user
router.get('/requests/pending', (req, res) => {
  const db = getDb();
  const requests = db.prepare(`
    SELECT pr.*, u.display_name as from_display_name, u.username as from_username
    FROM private_requests pr
    JOIN users u ON u.id = pr.from_user_id
    WHERE pr.to_user_id = ? AND pr.status = 'pending'
    ORDER BY pr.created_at DESC
  `).all(req.user.id);
  res.json({ requests });
});

module.exports = router;
```

### Step 2 — Mount in `server.js`

Find where other routes are mounted (e.g., `app.use('/api/rooms', roomsRouter)`). Add:

```js
const privateRouter = require('./routes/private');
app.use('/api/private', privateRouter);
```

### Step 3 — Test the routes

```bash
# Check pending requests endpoint (should return empty array):
curl http://localhost:3737/api/private/requests/pending \
  -H "Authorization: Bearer <token>"
# Expected: { requests: [] }
```

### Step 4 — Commit

```bash
git add routes/private.js server.js
git commit -m "feat: private request REST API — send/accept/decline + pending list"
```

---

## Task 6 — Private Request: Socket `room_added` + `private_declined` in Client

**Files:**
- Modify: `public/js/chat.js` (function `connectSocket`, lines 58–126)

### Step 1 — Add socket listeners in `connectSocket()`

Inside `connectSocket()`, after the existing `socket.on('upload_progress', ...)` listener (around line 125), add:

```js
// Private room created (accepted request) — add to sidebar without full reload
socket.on('room_added', ({ room }) => {
  if (!rooms.find(r => r.id === room.id)) {
    rooms.unshift(room); // prepend so it shows at top
    renderSidebar();
  }
  selectRoom(room.id);
});

// Private request declined — show alert to sender
socket.on('private_declined', ({ from_display_name }) => {
  if (typeof showAlert === 'function') {
    showAlert(`${from_display_name} a refuzat conversia privată.`);
  }
});
```

### Step 2 — Load pending requests on startup

In `async function init()` (line 46), add after `await loadRooms()`:

```js
loadPendingPrivateRequests();
```

Add the function (after `init` definition):

```js
async function loadPendingPrivateRequests() {
  const data = await Auth.api('/api/private/requests/pending');
  if (!data || !data.requests) return;
  for (const req of data.requests) {
    showPrivateRequestToast(req);
  }
}
```

### Step 3 — Commit

```bash
git add public/js/chat.js
git commit -m "feat(socket): handle room_added and private_declined events"
```

---

## Task 7 — Private Request: Initiation UI (Member List Button + Dialog)

**Files:**
- Modify: `public/js/chat.js` (info panel member rendering, around line 200–280; add `showPrivateRequestDialog` function)
- Modify: `public/css/layers/pages/chat.css` (modal for private request)

### Step 1 — Find how info panel members are rendered

```bash
grep -n "infoPanelMembers\|member.*avatar\|renderMember\|membersHtml" /Users/victorsafta/onechat/public/js/chat.js | head -20
```

### Step 2 — Add "Private" button to each member row in the info panel

Find the function that builds member HTML for the info panel (look for `infoPanelMembers.innerHTML`). In each member row, add a button (skip self):

```js
const privateBtn = m.id !== user.id
  ? `<button class="btn btn--ghost btn--sm member-private-btn" data-user-id="${m.id}" data-display-name="${esc(m.display_name || m.username)}" title="Start private chat">🔒</button>`
  : '';
```

After setting `infoPanelMembers.innerHTML`, wire up the buttons:

```js
document.querySelectorAll('.member-private-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    showPrivateRequestDialog(parseInt(btn.dataset.userId), btn.dataset.displayName);
  });
});
```

### Step 3 — Add `showPrivateRequestDialog` function to `chat.js`

Add after the `loadPendingPrivateRequests` function:

```js
function showPrivateRequestDialog(toUserId, toDisplayName) {
  // Check if private room already exists in sidebar
  const existing = rooms.find(r =>
    r.type === 'private' &&
    currentMembers.some(m => m.id === toUserId) // cheap local check
  );

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal__header">
        <span class="modal__title">Private chat cu ${esc(toDisplayName)}</span>
        <button class="btn btn--ghost btn--icon modal__close" id="privReqClose">✕</button>
      </div>
      <div class="modal__body">
        <div class="modal__field">
          <label class="modal__label">Mesaj inițial</label>
          <textarea id="privReqMsg" class="input" rows="3" maxlength="500" placeholder="Scrie primul mesaj…"></textarea>
        </div>
      </div>
      <div class="modal__footer">
        <button class="btn btn--secondary" id="privReqCancel">Anulare</button>
        <button class="btn btn--primary" id="privReqSend">Trimite cerere</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelector('#privReqClose').addEventListener('click', close);
  overlay.querySelector('#privReqCancel').addEventListener('click', close);
  overlay.querySelector('#privReqSend').addEventListener('click', async () => {
    const msg = overlay.querySelector('#privReqMsg').value.trim();
    if (!msg) return;
    const data = await Auth.api('/api/private/request', {
      method: 'POST',
      body: JSON.stringify({ to_user_id: toUserId, initial_message: msg }),
    });
    close();
    if (data?.exists) {
      // Room already exists — just navigate to it
      selectRoom(data.room.id);
    } else if (data?.ok) {
      if (typeof showAlert === 'function') showAlert(`Cerere trimisă către ${toDisplayName}.`);
    }
  });
}
```

### Step 4 — Commit

```bash
git add public/js/chat.js
git commit -m "feat(ui): Private chat initiation — member list button + request dialog"
```

---

## Task 8 — Private Request: Acceptance Toast (Recipient Side)

**Files:**
- Modify: `public/js/chat.js` (add `showPrivateRequestToast`, wire socket `private_request` event)

### Step 1 — Add `showPrivateRequestToast` function

Add after `showPrivateRequestDialog`:

```js
function showPrivateRequestToast(req) {
  const toastId = `priv-req-${req.id}`;
  if (document.getElementById(toastId)) return; // already showing

  const toast = document.createElement('div');
  toast.id = toastId;
  toast.className = 'private-req-toast';
  toast.innerHTML = `
    <div class="private-req-toast__header">🔒 Chat privat — <strong>${esc(req.from_display_name || req.from_username)}</strong></div>
    <div class="private-req-toast__preview">${esc((req.initial_message || '').slice(0, 80))}</div>
    <div class="private-req-toast__actions">
      <button class="btn btn--primary btn--sm" id="${toastId}-accept">Acceptă</button>
      <button class="btn btn--secondary btn--sm" id="${toastId}-decline">Refuză</button>
    </div>`;
  document.body.appendChild(toast);

  document.getElementById(`${toastId}-accept`).addEventListener('click', async () => {
    toast.remove();
    const data = await Auth.api(`/api/private/request/${req.id}/accept`, { method: 'POST' });
    if (data?.room) {
      if (!rooms.find(r => r.id === data.room.id)) {
        rooms.unshift(data.room);
        renderSidebar();
      }
      selectRoom(data.room.id);
    }
  });

  document.getElementById(`${toastId}-decline`).addEventListener('click', async () => {
    toast.remove();
    await Auth.api(`/api/private/request/${req.id}/decline`, { method: 'POST' });
  });

  // Auto-dismiss after 30s
  setTimeout(() => { if (document.getElementById(toastId)) toast.remove(); }, 30000);
}
```

### Step 2 — Wire `private_request` socket event

Inside `connectSocket()`, after the `room_added` listener added in Task 6, add:

```js
socket.on('private_request', (req) => {
  showPrivateRequestToast(req);
});
```

### Step 3 — Add toast CSS to `public/css/layers/pages/chat.css`

Append inside `@layer pages {}`:

```css
/* ── Private Request Toast ──────────────────────────── */
.private-req-toast {
  position: fixed;
  bottom: calc(var(--statusbar-h) + var(--sp-4));
  right: var(--sp-4);
  background: var(--bg-elevated);
  border: 1px solid var(--warning);
  border-radius: 8px;
  box-shadow: 0 4px 20px color-mix(in srgb, var(--bg-base) 40%, transparent);
  padding: var(--sp-3) var(--sp-4);
  min-width: 280px;
  max-width: 340px;
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.private-req-toast__header {
  font-size: var(--font-sm);
  color: var(--text-primary);
  letter-spacing: 0.04em;
}
.private-req-toast__preview {
  font-size: var(--font-xs);
  color: var(--text-secondary);
  font-style: italic;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.private-req-toast__actions {
  display: flex;
  gap: var(--sp-2);
  justify-content: flex-end;
}
```

### Step 4 — Run CSS audit

```bash
bash scripts/audit-css.sh
# Expected: 0 errors, 0 warnings — PASS
```

### Step 5 — Test full flow

1. User A opens info panel in any room, clicks 🔒 next to User B
2. A fills in initial message, clicks "Trimite cerere"
3. User B sees a toast in bottom-right corner with A's name + message preview
4. B clicks "Acceptă"
5. Both A and B see a new Private node (with the other's name) appear in sidebar
6. A and B are both navigated to the new private room
7. B clicks "Refuză" — no room created, A sees "B a refuzat conversia privată."

### Step 6 — Commit

```bash
git add public/js/chat.js public/css/layers/pages/chat.css
git commit -m "feat(ui): Private request acceptance toast with accept/decline flow"
```

---

## Summary

| Task | Files | What changes |
|------|-------|-------------|
| 1 — DB migration | `db/init.js` | rooms.type CHECK expanded; `private_requests` table |
| 2 — General default | `routes/auth.js`, `public/admin.html`, `admin.css` | Always add General; locked in invite form |
| 3 — Visual types | `routes/rooms.js`, `public/js/chat.js`, `components.css` | `display_name` for private rooms; icons + CSS per type |
| 4 — Cult rooms | `routes/rooms.js`, `public/admin.html` | Cult creation auto-adds agents |
| 5 — Private API | `routes/private.js`, `server.js` | request / accept / decline REST endpoints |
| 6 — Socket events | `public/js/chat.js` | `room_added`, `private_declined` handlers |
| 7 — Send UI | `public/js/chat.js` | Member list 🔒 button + request dialog |
| 8 — Accept UI | `public/js/chat.js`, `chat.css` | Recipient toast with accept/decline |
