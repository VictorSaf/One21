# Invite Room Access Picker — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Before an admin generates a QR invite code, they must explicitly select which rooms the new user will join and at what access level.

**Architecture:** Add a room-picker section to the existing invite modal that loads all non-archived channels/groups via a new `GET /api/admin/rooms` endpoint. Room assignments are stored as `default_permissions.rooms` on the invitation. The registration handler reads those assignments and adds the new user to exactly those rooms (instead of all rooms). Invite detail view shows which rooms were assigned.

**Tech Stack:** Express.js (SQLite via better-sqlite3), vanilla HTML/JS, CSS Cascade Layers (`pages/admin.css`)

---

## Current flow (what exists today)

- Admin opens modal → sets permissions (can_send_files, allowed_agents) → enters nome/prenume → clicks Generate → QR appears
- `POST /api/admin/invites` stores `default_permissions` as JSON
- `POST /api/auth/register` reads `default_permissions` and applies user_permissions rows, then **auto-joins ALL non-archived channels/groups** regardless of invite

## New flow (what we are building)

- Admin opens modal → sets permissions + **picks rooms with access levels** → enters nome/prenume → clicks Generate → QR appears
- `default_permissions.rooms` = `[{id, access_level}]`
- Registration: if `rooms` present → join only those; else fallback to all-rooms (backward compat)

---

## Task 1: Add `GET /api/admin/rooms` endpoint

**Files:**
- Modify: `routes/admin.js`

**Step 1: Add the endpoint** — after the existing `/invites` routes, add:

```js
// GET /api/admin/rooms — list all non-archived channel/group rooms (admin only)
router.get('/rooms', requireAdmin, (req, res) => {
  const db = getDb();
  const rooms = db.prepare(`
    SELECT r.id, r.name, r.type,
      (SELECT COUNT(*) FROM room_members WHERE room_id = r.id) as member_count
    FROM rooms r
    WHERE r.is_archived = 0 AND r.type IN ('channel', 'group')
    ORDER BY r.name ASC
  `).all();
  res.json({ rooms });
});
```

**Step 2: Verify with curl**

```bash
# get a token first
TOKEN=$(curl -s -X POST http://localhost:3737/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"YOUR_ADMIN","password":"YOUR_PASS"}' | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).token))")

curl -s http://localhost:3737/api/admin/rooms \
  -H "Authorization: Bearer $TOKEN" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(d),null,2)))"
```

Expected: `{"rooms":[{"id":1,"name":"general","type":"channel","member_count":3}, ...]}`

**Step 3: Commit**

```bash
git add routes/admin.js
git commit -m "feat(admin): add GET /api/admin/rooms endpoint for invite room picker"
```

---

## Task 2: Add room picker HTML to invite modal

**Files:**
- Modify: `public/admin.html` (HTML section of invite modal, around line 479–521)
- Modify: `public/css/layers/pages/admin.css`

**Step 1: Add the room picker block inside the invite modal `__body`**

Find the block that ends with:
```html
<p class="invite-join-hint">Completează nume + prenume pentru a genera QR; invitatul răspunde cu prenumele la „Who are you?"</p>
```

Immediately after that closing `</div>` (end of `.invite-join-block`), insert:

```html
      <!-- Room access picker -->
      <div class="invite-rooms-block">
        <div class="perm-row__label">Rooms_Access</div>
        <p class="invite-join-hint">Selectează camerele la care va avea acces noul user.</p>
        <div id="invRoomsList" class="invite-rooms-list">
          <div class="u-dim">Se încarcă camerele…</div>
        </div>
      </div>
```

**Step 2: Add CSS for room picker** in `public/css/layers/pages/admin.css`:

```css
@layer pages {
  /* Invite modal — room picker */
  .invite-rooms-block {
    margin-top: var(--sp-4);
  }

  .invite-rooms-list {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
    margin-top: var(--sp-2);
    max-height: 200px;
    overflow-y: auto;
  }

  .invite-room-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    padding: var(--sp-1) var(--sp-2);
    border-radius: var(--sp-1);
    background: var(--bg-surface);
  }

  .invite-room-row__name {
    flex: 1;
    font-size: var(--font-xs);
    color: var(--text-secondary);
  }

  .invite-room-row__level {
    font-size: var(--font-xs);
    background: var(--bg-elevated);
    color: var(--text-secondary);
    border: 1px solid var(--border-dim);
    border-radius: var(--sp-1);
    padding: 2px var(--sp-1);
  }

  .invite-room-row__level:disabled {
    opacity: 0.35;
  }
}
```

**Step 3: Verify visually** — open invite modal in browser, confirm room picker block appears below the nome/prenume section.

**Step 4: Commit**

```bash
git add public/admin.html public/css/layers/pages/admin.css
git commit -m "feat(admin): add room picker block to invite modal HTML + CSS"
```

---

## Task 3: Load rooms in `openInviteModal()` and render room rows

**Files:**
- Modify: `public/admin.html` (JS: `openInviteModal` function, ~line 1561)

**Step 1: Add `renderInviteRooms(rooms)` helper** — add this function near `openInviteModal`:

```js
function renderInviteRooms(rooms) {
  const list = document.getElementById('invRoomsList');
  if (!rooms || rooms.length === 0) {
    list.innerHTML = '<div class="u-dim">Nicio cameră disponibilă.</div>';
    return;
  }
  list.innerHTML = rooms.map(r => `
    <div class="invite-room-row">
      <input type="checkbox" class="perm-toggle inv-room" data-room-id="${r.id}" id="inv_room_${r.id}">
      <label class="invite-room-row__name" for="inv_room_${r.id}"># ${r.name} <span class="u-dim">(${r.member_count})</span></label>
      <select class="invite-room-row__level" data-room-level="${r.id}" disabled>
        <option value="readandwrite" selected>read+write</option>
        <option value="readonly">readonly</option>
        <option value="post_docs">post_docs</option>
      </select>
    </div>
  `).join('');

  // Enable/disable the access_level select based on checkbox
  list.querySelectorAll('.inv-room').forEach(cb => {
    cb.addEventListener('change', () => {
      const sel = list.querySelector(`[data-room-level="${cb.dataset.roomId}"]`);
      if (sel) sel.disabled = !cb.checked;
    });
  });
}
```

**Step 2: Update `openInviteModal()` to fetch and render rooms** — find the existing function and add fetch call at the end:

```js
function openInviteModal() {
  // ... existing code stays unchanged ...
  document.getElementById('invRoomsList').innerHTML = '<div class="u-dim">Se încarcă…</div>';
  Auth.api('/api/admin/rooms').then(data => {
    renderInviteRooms(data && data.rooms ? data.rooms : []);
  });
}
```

**Step 3: Verify in browser** — open invite modal → room list should show all channel/group rooms with checkboxes and disabled selects. Checking a room enables its select.

**Step 4: Commit**

```bash
git add public/admin.html
git commit -m "feat(admin): load and render room picker in invite modal"
```

---

## Task 4: Include rooms in invite submission

**Files:**
- Modify: `public/admin.html` (JS: `generateInviteWithPerms`, ~line 1592)

**Step 1: Collect room assignments** — in `generateInviteWithPerms`, before the `Auth.api('/api/admin/invites', ...)` call, add:

```js
const roomCheckboxes = document.querySelectorAll('.inv-room');
const rooms = [...roomCheckboxes]
  .filter(cb => cb.checked)
  .map(cb => ({
    id: parseInt(cb.dataset.roomId),
    access_level: document.querySelector(`[data-room-level="${cb.dataset.roomId}"]`).value
  }));
```

**Step 2: Add rooms to the POST body** — update the `body` object:

```js
body: JSON.stringify({
  note: note || null,
  nume,
  prenume,
  default_permissions: {
    can_send_files: canSendFiles,
    allowed_agents: allowedAgents,
    rooms,                          // ← add this line
  },
}),
```

**Step 3: Verify with curl**

```bash
curl -s -X POST http://localhost:3737/api/admin/invites \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"nume":"Test","prenume":"User","default_permissions":{"can_send_files":true,"allowed_agents":[],"rooms":[{"id":1,"access_level":"readandwrite"}]}}' \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).token))"
```

Expected: returns a token.

**Step 4: Confirm in DB**

```bash
sqlite3 /Users/victorsafta/onechat/data/one21.db \
  "SELECT default_permissions FROM invitations ORDER BY id DESC LIMIT 1;"
```

Expected: `{"can_send_files":true,"allowed_agents":[],"rooms":[{"id":1,"access_level":"readandwrite"}]}`

**Step 5: Commit**

```bash
git add public/admin.html
git commit -m "feat(admin): collect room assignments and include in invite default_permissions"
```

---

## Task 5: Apply room assignments on registration

**Files:**
- Modify: `routes/auth.js` (transaction block, ~line 70–90)

**Step 1: Replace the all-rooms auto-join logic** — find this block inside the `db.transaction`:

```js
// Canale + grupuri: noul user devine membru în toate camerele non-direct, non-arhivate
const roomIds = db.prepare("SELECT id FROM rooms WHERE type IN ('channel', 'group') AND is_archived = 0").all();
const addMember = db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)');
for (const row of roomIds) addMember.run(row.id, newUserId, 'member');
```

Replace it with:

```js
// Room access: use invite's rooms assignment if present, else fall back to all channels/groups
let roomAssignments;
if (perms.rooms && Array.isArray(perms.rooms) && perms.rooms.length > 0) {
  roomAssignments = perms.rooms; // [{id, access_level}]
} else {
  const allRooms = db.prepare("SELECT id FROM rooms WHERE type IN ('channel', 'group') AND is_archived = 0").all();
  roomAssignments = allRooms.map(r => ({ id: r.id, access_level: 'readandwrite' }));
}
const addMember = db.prepare(
  'INSERT OR IGNORE INTO room_members (room_id, user_id, role, access_level) VALUES (?, ?, ?, ?)'
);
for (const rm of roomAssignments) {
  addMember.run(rm.id, newUserId, 'member', rm.access_level || 'readandwrite');
}
```

**Important:** The `perms` variable is already declared earlier in the registration block when parsing `default_permissions`. Verify it is in scope — if `default_permissions === '{}'`, add a guard so `perms` is always an object:

In the register handler, find:
```js
let perms = {};
try { perms = JSON.parse(invite.default_permissions); } catch {}
```

Make sure this is BEFORE the transaction, so `perms` is available inside `db.transaction(() => { ... })`. If `default_permissions` parsing is inside the transaction, move the parse outside or duplicate it — the result is the same since it's read-only.

**Step 2: Verify** — create a test invite with a specific room, register a user with that invite token, then check:

```bash
sqlite3 /Users/victorsafta/onechat/data/one21.db \
  "SELECT rm.user_id, u.username, rm.room_id, rm.access_level FROM room_members rm JOIN users u ON u.id = rm.user_id ORDER BY rm.user_id DESC LIMIT 5;"
```

Expected: new user appears only in the invited rooms, not all rooms.

**Step 3: Commit**

```bash
git add routes/auth.js
git commit -m "feat(auth): apply invite room assignments on registration instead of auto-joining all rooms"
```

---

## Task 6: Show assigned rooms in invite detail view

**Files:**
- Modify: `public/admin.html` (HTML: invite detail modal, ~line 224; JS: `loadInvites`, `showInviteDetailView`)

**Step 1: Add rooms row to invite detail modal HTML** — inside `#inviteDetailModal .modal__body`, after the existing `invite-detail-grid`, add:

```html
      <div id="inviteDetailRoomsSection" class="u-mt-3">
        <p class="perm-row__label">Rooms_Access</p>
        <div id="inviteDetailRoomsList" class="invite-rooms-list"></div>
      </div>
```

**Step 2: Include `default_permissions` in table row data attributes** — in `loadInvites()`, find the `<tr data-inv-...>` template string and add:

```js
data-inv-perms="${esc(JSON.stringify(inv.default_permissions || {}))}"
```

This requires `GET /api/admin/invites` to return `default_permissions` on each invite. Check `routes/admin.js` GET /invites query — add `i.default_permissions` to the SELECT if not already there.

**Step 3: Render rooms in `showInviteDetailView()`** — at the end of the function, add:

```js
const permsRaw = tr.dataset.invPerms;
let perms = {};
try { perms = JSON.parse(permsRaw); } catch {}
const roomsList = document.getElementById('inviteDetailRoomsList');
const roomsSec = document.getElementById('inviteDetailRoomsSection');
if (perms.rooms && perms.rooms.length > 0) {
  roomsSec.style.display = '';
  // Map room ids to names using allRooms if available, else just show id
  roomsList.innerHTML = perms.rooms.map(rm => {
    const name = (window._adminRooms || []).find(r => r.id === rm.id);
    return `<div class="invite-room-row">
      <span class="invite-room-row__name"># ${name ? name.name : 'room ' + rm.id}</span>
      <span class="invite-room-row__level">${rm.access_level}</span>
    </div>`;
  }).join('');
} else {
  roomsSec.style.display = 'none';
}
```

**Step 4: Cache rooms list globally** — in `openInviteModal`, after the rooms fetch succeeds, also cache:

```js
Auth.api('/api/admin/rooms').then(data => {
  window._adminRooms = data && data.rooms ? data.rooms : [];
  renderInviteRooms(window._adminRooms);
});
```

**Step 5: Verify in browser** — generate an invite with rooms, then click the QR button to open detail view → "Rooms_Access" section should show the assigned rooms with their access levels.

**Step 6: Verify `GET /api/admin/invites` returns `default_permissions`**

```bash
curl -s http://localhost:3737/api/admin/invites \
  -H "Authorization: Bearer $TOKEN" \
  | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const i=JSON.parse(d).invites;console.log(i[0]&&i[0].default_permissions)})"
```

Expected: `{"can_send_files":true,"allowed_agents":[],"rooms":[...]}`

**Step 7: Commit**

```bash
git add public/admin.html routes/admin.js
git commit -m "feat(admin): show assigned rooms in invite detail modal"
```

---

## End-to-end manual test

1. Log in as admin → go to Access_Codes page
2. Click Generate → invite modal opens
3. Room picker shows all channels/groups
4. Check 2 rooms, set one to `readonly`, one to `readandwrite`
5. Enter nome/prenume → click Generate → QR appears
6. Click QR button on new invite → detail view shows "Rooms_Access" with the 2 rooms
7. Open `/one21/join/TOKEN` in incognito → complete registration flow
8. Log in as new user → sidebar shows only the 2 assigned rooms
9. In the `readonly` room: verify can read but not post
10. In the `readandwrite` room: verify can post

---

## Files touched summary

| File | Change |
|------|--------|
| `routes/admin.js` | Add `GET /api/admin/rooms`; add `default_permissions` to invites list query |
| `routes/auth.js` | Replace all-rooms auto-join with invite-scoped room assignments |
| `public/admin.html` | Room picker UI, JS render/collect/display |
| `public/css/layers/pages/admin.css` | `.invite-rooms-*` styles |
