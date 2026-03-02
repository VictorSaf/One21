# Per-Room User Colors Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Each user in a group chat gets a unique color assigned when they join that group — colors are per-room, not global.

**Architecture:** Add a `color_index INTEGER` column to `room_members`. When any user is added to a room, pick the lowest available color (0–7) not yet taken by another member in that room. Update all message queries to read color from `room_members` instead of `users.chat_color_index`.

**Tech Stack:** SQLite (better-sqlite3), Node.js/Express, Socket.IO — no frontend changes needed (already uses `sender_color_index` field name).

---

## Current State

- Colors are stored globally in `users.chat_color_index` (assigned at registration: `userCount % 8`)
- Two users with the same global index appear identical in the same group
- Messages query: `u.chat_color_index as sender_color_index`

## Target State

- Colors stored per-room in `room_members.color_index`
- When a user joins a room → they get the lowest unused color (0–7) in that room
- Messages query: `rm_color.color_index as sender_color_index` via JOIN on room_members

---

### Task 1: DB Migration — add `color_index` to `room_members`

**File:**
- Modify: `db/init.js` — inside the `migrate()` function

**What to add** (after the existing `safeAdd('room_members', 'access_level', ...)` line, ~line 186):

```js
safeAdd('room_members', 'color_index', 'INTEGER');
// Backfill: for each room, assign colors 0,1,2... to members in join order
try {
  const membersWithoutColor = db.prepare(
    'SELECT room_id, user_id FROM room_members WHERE color_index IS NULL ORDER BY room_id, joined_at'
  ).all();

  // Group by room
  const byRoom = {};
  for (const row of membersWithoutColor) {
    if (!byRoom[row.room_id]) byRoom[row.room_id] = [];
    byRoom[row.room_id].push(row.user_id);
  }

  const update = db.prepare('UPDATE room_members SET color_index = ? WHERE room_id = ? AND user_id = ?');
  for (const [roomId, userIds] of Object.entries(byRoom)) {
    userIds.forEach((uid, i) => update.run(i % 8, roomId, uid));
  }
  if (membersWithoutColor.length > 0) {
    console.log(`[DB] Backfilled room_members.color_index for ${membersWithoutColor.length} rows`);
  }
} catch (e) { console.error('[DB] color_index backfill error:', e.message); }
```

**Step 1: Apply the migration**

Restart the server (`node server.js` or however it runs). Check console for:
```
[DB] Migrated: added room_members.color_index
[DB] Backfilled room_members.color_index for N rows
```

**Step 2: Verify in SQLite**

```bash
cd /Users/victorsafta/onechat
node -e "
const {getDb} = require('./db/init');
const db = getDb();
console.table(db.prepare('SELECT room_id, user_id, color_index FROM room_members LIMIT 20').all());
"
```

Expected: each row has a `color_index` 0–7, unique per room_id group.

**Step 3: Commit**

```bash
git add db/init.js
git commit -m "feat(db): add color_index to room_members, backfill existing members"
```

---

### Task 2: Helper — `assignRoomColor(db, roomId)`

**File:**
- Modify: `routes/rooms.js` — add helper function near the top (after `normalizeAccessLevel`, ~line 12)

**Code to add:**

```js
function assignRoomColor(db, roomId) {
  const used = db.prepare(
    'SELECT color_index FROM room_members WHERE room_id = ? AND color_index IS NOT NULL'
  ).all(roomId).map(r => r.color_index);
  for (let i = 0; i < 8; i++) {
    if (!used.includes(i)) return i;
  }
  // All 8 taken — wrap around based on member count
  return used.length % 8;
}
```

No test needed for this step — it's a pure helper with no side effects, tested implicitly by Task 3.

**Step 1: Commit**

```bash
git add routes/rooms.js
git commit -m "feat(rooms): add assignRoomColor helper"
```

---

### Task 3: Assign color on room creation

**File:**
- Modify: `routes/rooms.js` — three INSERT locations

**3a. Room creation — owner (line ~124)**

Find:
```js
db.prepare('INSERT INTO room_members (room_id, user_id, role, access_level) VALUES (?, ?, ?, ?)')
  .run(id, req.user.id, 'owner', 'readandwrite');
```

Replace with:
```js
db.prepare('INSERT INTO room_members (room_id, user_id, role, access_level, color_index) VALUES (?, ?, ?, ?, ?)')
  .run(id, req.user.id, 'owner', 'readandwrite', 0);
```
Owner always gets color 0 (first in empty room).

**3b. Room creation — channel bulk-add (line ~130)**

Find:
```js
const add = db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id, role, access_level) VALUES (?, ?, ?, ?)');
for (const u of nonAgents) add.run(id, u.id, 'member', 'readandwrite');
```

Replace with (color must be assigned sequentially since INSERT OR IGNORE doesn't update):
```js
const addMember = db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id, role, access_level, color_index) VALUES (?, ?, ?, ?, ?)');
nonAgents.forEach((u, i) => addMember.run(id, u.id, 'member', 'readandwrite', (i + 1) % 8));
```
`(i + 1)` because owner already has 0.

**3c. Room creation — group initial members (line ~132)**

Find:
```js
const add = db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id, role, access_level) VALUES (?, ?, ?, ?)');
for (const uid of member_ids) {
  if (uid !== req.user.id) {
    const accessLevel = normalizeAccessLevel(member_access && member_access[String(uid)]);
    add.run(id, uid, 'member', accessLevel);
  }
}
```

Replace with:
```js
const add = db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id, role, access_level, color_index) VALUES (?, ?, ?, ?, ?)');
let colorCounter = 1; // owner already has 0
for (const uid of member_ids) {
  if (uid !== req.user.id) {
    const accessLevel = normalizeAccessLevel(member_access && member_access[String(uid)]);
    add.run(id, uid, 'member', accessLevel, colorCounter % 8);
    colorCounter++;
  }
}
```

**3d. DM creation (line ~83–85)**

Find:
```js
const add = db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id, role, access_level) VALUES (?, ?, ?, ?)');
add.run(id, req.user.id, 'member', 'readandwrite');
add.run(id, participant_id, 'member', 'readandwrite');
```

Replace with:
```js
const add = db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id, role, access_level, color_index) VALUES (?, ?, ?, ?, ?)');
add.run(id, req.user.id, 'member', 'readandwrite', 0);
add.run(id, participant_id, 'member', 'readandwrite', 1);
```

**Step 1: Apply all 4 sub-changes**

**Step 2: Manual smoke test — create a new group room**

Open admin panel → create new group with 2+ users → check the DB:
```bash
node -e "
const {getDb} = require('./db/init');
const db = getDb();
const lastRoom = db.prepare('SELECT id FROM rooms ORDER BY id DESC LIMIT 1').get();
console.table(db.prepare('SELECT * FROM room_members WHERE room_id = ?').all(lastRoom.id));
"
```
Expected: owner has `color_index = 0`, first member has `1`, second has `2`, etc.

**Step 3: Commit**

```bash
git add routes/rooms.js
git commit -m "feat(rooms): assign per-room color_index on room creation and DM creation"
```

---

### Task 4: Assign color when adding a member to an existing room

**File:**
- Modify: `routes/rooms.js` — `POST /:id/members` handler (line ~233)

Find:
```js
db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id, role, access_level) VALUES (?, ?, ?, ?)')
  .run(roomId, user_id, 'member', accessLevel);
db.prepare('UPDATE room_members SET access_level = ? WHERE room_id = ? AND user_id = ?')
  .run(accessLevel, roomId, user_id);
```

Replace with:
```js
// Only assign a new color if the user isn't already a member
const existing = db.prepare('SELECT color_index FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, user_id);
const colorIdx = existing ? existing.color_index : assignRoomColor(db, roomId);
db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id, role, access_level, color_index) VALUES (?, ?, ?, ?, ?)')
  .run(roomId, user_id, 'member', accessLevel, colorIdx);
db.prepare('UPDATE room_members SET access_level = ? WHERE room_id = ? AND user_id = ?')
  .run(accessLevel, roomId, user_id);
```

**Step 1: Apply the change**

**Step 2: Manual smoke test — add a user to an existing room**

```bash
node -e "
const {getDb} = require('./db/init');
const db = getDb();
// Show all room_members with color_index for room 1
console.table(db.prepare('SELECT room_id, user_id, color_index FROM room_members WHERE room_id = 1').all());
"
```
Expected: the newly added member gets a `color_index` different from all existing members in room 1.

**Step 3: Commit**

```bash
git add routes/rooms.js
git commit -m "feat(rooms): assign unique per-room color when adding member to existing room"
```

---

### Task 5: Update message queries to use `room_members.color_index`

This is the key change — instead of reading the global `users.chat_color_index`, read the per-room value from `room_members`.

**5a. `routes/messages.js` — `BASE_SELECT` (~line 53)**

Find:
```js
const BASE_SELECT = `
    SELECT m.*,
      u.username as sender_username, u.display_name as sender_name,
      u.role as sender_role, u.chat_color_index as sender_color_index,
      rm.text as reply_to_text,
      ru.display_name as reply_to_sender
    FROM messages m
    JOIN users u ON m.sender_id = u.id
    LEFT JOIN messages rm ON rm.id = m.reply_to
    LEFT JOIN users ru ON ru.id = rm.sender_id
  `;
```

Replace with (note: `rm` alias is taken by reply_to messages — use `rmc` for room_members_color):
```js
const BASE_SELECT = `
    SELECT m.*,
      u.username as sender_username, u.display_name as sender_name,
      u.role as sender_role,
      COALESCE(rmc.color_index, u.chat_color_index) as sender_color_index,
      reply_m.text as reply_to_text,
      ru.display_name as reply_to_sender
    FROM messages m
    JOIN users u ON m.sender_id = u.id
    LEFT JOIN room_members rmc ON rmc.room_id = m.room_id AND rmc.user_id = m.sender_id
    LEFT JOIN messages reply_m ON reply_m.id = m.reply_to
    LEFT JOIN users ru ON ru.id = reply_m.sender_id
  `;
```

Note: `COALESCE(rmc.color_index, u.chat_color_index)` falls back to global color if per-room color is somehow NULL (safety net).

Also update the two query strings below BASE_SELECT (they reference `rm.id` for reply_to — change to `reply_m.id`):

Find (line ~65-67):
```js
const query = before
  ? `${BASE_SELECT} WHERE m.room_id = ? AND m.id < ? ORDER BY m.created_at DESC LIMIT ?`
  : `${BASE_SELECT} WHERE m.room_id = ? ORDER BY m.created_at DESC LIMIT ?`;
```
This doesn't reference `rm` directly, so no change needed here.

**5b. `socket/handlers/messages.js` — real-time broadcast query (~line 116)**

Find:
```js
const message = db.prepare(`
  SELECT m.*, u.username as sender_username, u.display_name as sender_name, u.role as sender_role, u.chat_color_index as sender_color_index,
         rm.text as reply_to_text, ru.display_name as reply_to_sender
  FROM messages m
  JOIN users u ON m.sender_id = u.id
  LEFT JOIN messages rm ON rm.id = m.reply_to
  LEFT JOIN users ru ON ru.id = rm.sender_id
  WHERE m.id = ?
`).get(result.lastInsertRowid);
```

Replace with:
```js
const message = db.prepare(`
  SELECT m.*, u.username as sender_username, u.display_name as sender_name, u.role as sender_role,
         COALESCE(rmc.color_index, u.chat_color_index) as sender_color_index,
         reply_m.text as reply_to_text, ru.display_name as reply_to_sender
  FROM messages m
  JOIN users u ON m.sender_id = u.id
  LEFT JOIN room_members rmc ON rmc.room_id = m.room_id AND rmc.user_id = m.sender_id
  LEFT JOIN messages reply_m ON reply_m.id = m.reply_to
  LEFT JOIN users ru ON ru.id = reply_m.sender_id
  WHERE m.id = ?
`).get(result.lastInsertRowid);
```

**Step 1: Apply both changes**

**Step 2: Restart server and verify in browser**

Open http://localhost:3737/one21/chat in Chrome. Open a group room with 2+ non-admin users. Verify:
- Each user's messages have a DIFFERENT border color
- The same user's messages keep the same color throughout the conversation
- In a different group, the same user may have a different color (it's per-room)

**Step 3: Commit**

```bash
git add routes/messages.js socket/handlers/messages.js
git commit -m "feat(messages): use per-room color_index from room_members instead of global users.chat_color_index"
```

---

### Task 6: Visual verification in Chrome DevTools

**Open:** http://localhost:3737/one21/chat

**Check group room with 2+ non-admin users:**

1. User A's messages → should show color border (e.g. green teal)
2. User B's messages → should show a DIFFERENT color border (e.g. purple or orange)
3. Hover a received message → `▾` button → dropdown opens with correct sender info

**Inspect with DevTools:**
- Right-click a received message bubble → Inspect
- Verify class like `msg msg--received msg--color-0` (or any 0–7)
- Verify another user has a DIFFERENT `msg--color-N`

**Check the DB for confirmation:**
```bash
node -e "
const {getDb} = require('./db/init');
const db = getDb();
const rooms = db.prepare(\"SELECT id, name, type FROM rooms WHERE type IN ('group','channel')\").all();
for (const r of rooms) {
  console.log('\\nRoom:', r.name);
  console.table(db.prepare('SELECT u.display_name, rm.color_index FROM room_members rm JOIN users u ON rm.user_id = u.id WHERE rm.room_id = ?').all(r.id));
}
"
```
Expected: within each room, all `color_index` values are unique (or wrap if >8 members).

**Step 1: If colors look wrong visually — check that CSS classes still match**

In `public/css/layers/pages/chat.css`, verify lines with `.msg--received.msg--color-0` through `.msg--received.msg--color-7` still exist (they do — no CSS changes needed).

**Step 2: Final commit if any fixes were applied, then push**

```bash
git push
```

---

## Summary of Files Changed

| File | Change |
|------|--------|
| `db/init.js` | Migration: `safeAdd room_members.color_index` + backfill |
| `routes/rooms.js` | `assignRoomColor()` helper + assign color at all INSERT points |
| `routes/messages.js` | `BASE_SELECT` uses `room_members.color_index` via JOIN |
| `socket/handlers/messages.js` | Real-time broadcast query uses `room_members.color_index` |

**No frontend changes needed** — `chat.js` already reads `msg.sender_color_index` and applies `msg--color-N` class.
