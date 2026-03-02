# Message Context Menu — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Click pe un message bubble → mini-meniu cu Reply și Private chat.

**Architecture:** 4 layere independente: (1) backend JOIN pentru reply context în messages API, (2) backend endpoint DM pentru useri non-admin, (3) CSS clase noi în chat.css, (4) JS — context menu, reply bar, quoted block render, private chat nav. Infrastructura `reply_to` există deja în DB și socket handler.

**Tech Stack:** Express.js + SQLite (better-sqlite3), vanilla JS, CSS Cascade Layers (`@layer pages` în `public/css/layers/pages/chat.css`)

---

## Task 1: Backend — reply context în GET messages

**Files:**
- Modify: `routes/messages.js` (liniile ~53-64, query-urile SELECT)

**Context:** Există 2 query-uri identice ca structură (cu/fără `before` pagination). Ambele trebuie să includă LEFT JOIN pentru mesajul original la care se răspunde.

**Step 1: Read routes/messages.js**
Găsește cele 2 query-uri SELECT (cu `before` și fără). Sunt la liniile ~53-64.

**Step 2: Înlocuiește ambele query-uri** cu variante care includ reply context:

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

const query = before
  ? `${BASE_SELECT} WHERE m.room_id = ? AND m.id < ? ORDER BY m.created_at DESC LIMIT ?`
  : `${BASE_SELECT} WHERE m.room_id = ? ORDER BY m.created_at DESC LIMIT ?`;
```

**Step 3: Verify cu curl** (serverul e pe 3737):
```bash
TOKEN=$(curl -s -X POST http://localhost:3737/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"PAROLA"}' | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).token))")

curl -s "http://localhost:3737/api/rooms/1/messages" \
  -H "Authorization: Bearer $TOKEN" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const m=JSON.parse(d).messages[0];console.log('reply_to_text' in m, 'reply_to_sender' in m)})"
```
Expected: `true true`

**Step 4: Commit**
```bash
git add routes/messages.js
git commit -m "feat(messages): add reply context fields to GET messages query"
```

---

## Task 2: Backend — POST /api/rooms/direct pentru DM

**Files:**
- Modify: `routes/rooms.js`

**Context:** Endpoint-ul `POST /api/rooms` existент este admin-only. Userii obișnuiți nu pot crea DM-uri. Adăugăm un endpoint separat `POST /api/rooms/direct` care permite oricărui user autentificat să găsească sau să creeze un DM cu alt user.

**Step 1: Read routes/rooms.js** — găsește unde se termină `router.get('/')` și înainte de `router.post('/')`. Inserează noul endpoint ÎNAINTE de `router.post('/')`.

**Step 2: Adaugă endpoint-ul:**

```js
// POST /api/rooms/direct — find or create DM between current user and another user
router.post('/direct', (req, res) => {
  const { participant_id } = req.body;
  if (!participant_id || typeof participant_id !== 'number') {
    return res.status(400).json({ error: 'participant_id required' });
  }
  if (participant_id === req.user.id) {
    return res.status(400).json({ error: 'Cannot DM yourself' });
  }
  const db = getDb();

  // Find existing DM
  const existing = db.prepare(`
    SELECT r.id FROM rooms r
    JOIN room_members rm1 ON r.id = rm1.room_id AND rm1.user_id = ?
    JOIN room_members rm2 ON r.id = rm2.room_id AND rm2.user_id = ?
    WHERE r.type = 'direct'
    LIMIT 1
  `).get(req.user.id, participant_id);

  if (existing) {
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(existing.id);
    return res.json({ room });
  }

  // Create new DM
  const other = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(participant_id);
  if (!other) return res.status(404).json({ error: 'User not found' });

  const roomId = db.transaction(() => {
    const r = db.prepare(
      "INSERT INTO rooms (name, type, created_by) VALUES (?, 'direct', ?)"
    ).run(`dm-${req.user.id}-${participant_id}`, req.user.id);
    const id = r.lastInsertRowid;
    const add = db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id, role, access_level) VALUES (?, ?, ?, ?)');
    add.run(id, req.user.id, 'member', 'readandwrite');
    add.run(id, participant_id, 'member', 'readandwrite');
    return id;
  })();

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
  res.json({ room });
});
```

**Step 3: Verify**
```bash
curl -s -X POST http://localhost:3737/api/rooms/direct \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"participant_id": 2}' | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);console.log(r.room && r.room.type)})"
```
Expected: `direct`

**Step 4: Commit**
```bash
git add routes/rooms.js
git commit -m "feat(rooms): add POST /api/rooms/direct for non-admin DM creation"
```

---

## Task 3: CSS — context menu, reply bar, quoted block, highlight

**Files:**
- Modify: `public/css/layers/pages/chat.css`

**REGULI OBLIGATORII (CLAUDE.md):**
- Totul merge INSIDE blocul existent `@layer pages { }` — NU crea un block nou
- ZERO culori hardcodate — doar `var(--token-name)`
- ZERO `style=` inline în HTML

**Step 1: Read public/css/layers/pages/chat.css** — găsește ultimul `}` care închide `@layer pages { }`.

**Step 2: Adaugă ÎNAINTE de acel `}` final:**

```css
  /* ── Message context menu ─────────────────────────── */
  .msg-menu {
    position: fixed;
    z-index: var(--z-dropdown);
    background: var(--bg-elevated);
    border: 1px solid var(--border-mid);
    border-radius: var(--sp-2);
    box-shadow: 0 4px 16px color-mix(in srgb, var(--bg-base) 60%, transparent);
    padding: var(--sp-1) 0;
    min-width: 140px;
    display: none;
  }
  .msg-menu.is-open { display: block; }
  .msg-menu__item {
    display: block;
    width: 100%;
    padding: var(--sp-2) var(--sp-3);
    background: none;
    border: none;
    color: var(--text-secondary);
    font-size: var(--font-sm);
    font-family: var(--font-mono);
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
  }
  .msg-menu__item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  /* ── Reply bar (above compose) ────────────────────── */
  .reply-bar {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-1) var(--sp-3);
    background: var(--bg-surface);
    border-top: 1px solid var(--border-dim);
    font-size: var(--font-xs);
    color: var(--text-secondary);
    font-family: var(--font-mono);
  }
  .reply-bar__label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .reply-bar__label strong {
    color: var(--text-accent);
  }
  .reply-bar__cancel {
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    font-size: var(--font-sm);
    padding: 0 var(--sp-1);
    line-height: 1;
  }
  .reply-bar__cancel:hover { color: var(--text-primary); }

  /* ── Quoted block inside bubble ───────────────────── */
  .msg__reply-quote {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--sp-1) var(--sp-2);
    margin-bottom: var(--sp-1);
    border-left: 2px solid var(--border-accent);
    background: color-mix(in srgb, var(--bg-base) 40%, transparent);
    border-radius: 2px var(--sp-1) var(--sp-1) 2px;
    cursor: pointer;
    font-size: var(--font-xs);
  }
  .msg__reply-quote:hover { background: color-mix(in srgb, var(--accent-dim) 20%, transparent); }
  .msg__reply-quote__sender {
    color: var(--text-accent);
    font-weight: 600;
    font-family: var(--font-mono);
  }
  .msg__reply-quote__text {
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 280px;
  }

  /* ── Highlight flash on scroll-to ────────────────── */
  @keyframes msg-highlight-flash {
    0%   { outline: 2px solid var(--accent); outline-offset: 2px; }
    80%  { outline: 2px solid var(--accent); outline-offset: 2px; }
    100% { outline: none; }
  }
  .msg--highlight { animation: msg-highlight-flash 1.2s ease-out forwards; }
```

**Step 3: Commit**
```bash
git add public/css/layers/pages/chat.css
git commit -m "feat(chat): add CSS for context menu, reply bar, quoted block, highlight animation"
```

---

## Task 4: Frontend — context menu HTML + show/hide JS

**Files:**
- Modify: `public/chat.html` (adaugă HTML-ul meniului în body)
- Modify: `public/js/chat.js` (adaugă state + funcții menu)

**Step 1: Read public/chat.html** — găsește `</body>` tag. Adaugă ÎNAINTE de `</body>`:

```html
<!-- Message context menu -->
<div id="msgMenu" class="msg-menu" role="menu">
  <button class="msg-menu__item" id="msgMenuReply">↩ Reply</button>
  <button class="msg-menu__item" id="msgMenuDm">→ Private chat</button>
</div>
```

**Step 2: Read public/js/chat.js** — găsește `let editingMsgId = null;` (sau zona cu state variables). Adaugă DUPĂ el:

```js
let replyingToId = null;
let menuTargetMsg = null; // { id, senderId, senderName, text }
```

**Step 3: Adaugă funcțiile meniului** — DUPĂ declararea variabilelor de state:

```js
const msgMenu = document.getElementById('msgMenu');
const msgMenuReply = document.getElementById('msgMenuReply');
const msgMenuDm = document.getElementById('msgMenuDm');

function openMsgMenu(e, msgData) {
  e.stopPropagation();
  menuTargetMsg = msgData;

  // Show/hide Private chat based on ownership
  msgMenuDm.style.display = msgData.senderId === user.id ? 'none' : '';

  // Position menu near click, adjust for viewport edges
  const x = Math.min(e.clientX, window.innerWidth - 160);
  const y = Math.min(e.clientY, window.innerHeight - 90);
  msgMenu.style.left = x + 'px';
  msgMenu.style.top = y + 'px';
  msgMenu.classList.add('is-open');
}

function closeMsgMenu() {
  msgMenu.classList.remove('is-open');
  menuTargetMsg = null;
}

document.addEventListener('click', closeMsgMenu);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMsgMenu(); });
msgMenu.addEventListener('click', e => e.stopPropagation());
```

**Step 4: Wire click pe bubble** — în `buildMessageEl()`, ÎNAINTE de `return el;`, adaugă:

```js
  if (!isSystem) {
    el.addEventListener('click', (e) => {
      // Nu declanșa menu dacă userul a dat click pe un action button
      if (e.target.closest('.msg__action-btn')) return;
      openMsgMenu(e, {
        id: msg.id,
        senderId: msg.sender_id,
        senderName: msg.sender_name || msg.sender_username || '',
        text: msg.text || ''
      });
    });
  }
```

**Step 5: Verify în browser** — deschide `/one21/login`, loghează-te, dă click pe un mesaj → meniul apare. Click în afara lui → dispare.

**Step 6: Commit**
```bash
git add public/chat.html public/js/chat.js
git commit -m "feat(chat): add message context menu with click trigger"
```

---

## Task 5: Frontend — reply bar + state + sendMessage update

**Files:**
- Modify: `public/js/chat.js`

**Context:** Pattern identic cu edit bar (liniile 366-390). `startReply()` / `cancelReply()` urmăresc același model.

**Step 1: Adaugă `startReply()` și `cancelReply()`** — DUPĂ `cancelEdit()`:

```js
function startReply(msgId, senderName, text) {
  replyingToId = msgId;
  const preview = text.length > 60 ? text.substring(0, 60) + '…' : text;

  let bar = document.getElementById('replyBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'replyBar';
    bar.className = 'reply-bar';
    bar.innerHTML = `
      <span class="reply-bar__label">↩ <strong></strong>: <span class="reply-bar__preview"></span></span>
      <button class="reply-bar__cancel" id="cancelReply" title="Anulează">✕</button>`;
    composeInput.parentElement.insertBefore(bar, composeInput);
    document.getElementById('cancelReply').addEventListener('click', cancelReply);
  }
  bar.querySelector('strong').textContent = senderName;
  bar.querySelector('.reply-bar__preview').textContent = preview;
  composeInput.focus();
}

function cancelReply() {
  replyingToId = null;
  const bar = document.getElementById('replyBar');
  if (bar) bar.remove();
}
```

**Step 2: Update `sendMessage()`** — adaugă `reply_to` în emit și apelează `cancelReply()`:

Găsește:
```js
    socket.emit('message', { room_id: currentRoomId, text });
```

Înlocuiește cu:
```js
    socket.emit('message', { room_id: currentRoomId, text, reply_to: replyingToId || undefined });
    if (replyingToId) cancelReply();
```

**Step 3: Update keydown handler** — adaugă ESC pentru cancelReply:

Găsește:
```js
  if (e.key === 'Escape' && editingMsgId) cancelEdit();
```

Înlocuiește cu:
```js
  if (e.key === 'Escape') { if (editingMsgId) cancelEdit(); else if (replyingToId) cancelReply(); }
```

**Step 4: Wire butonul Reply din meniu** — adaugă după `msgMenu.addEventListener(...)`:

```js
msgMenuReply.addEventListener('click', () => {
  if (!menuTargetMsg) return;
  closeMsgMenu();
  startReply(menuTargetMsg.id, menuTargetMsg.senderName, menuTargetMsg.text);
});
```

**Step 5: Verify** — click pe mesaj → Reply → reply bar apare cu preview. ESC sau ✕ → dispare. Trimite → socket emit include `reply_to`.

**Step 6: Commit**
```bash
git add public/js/chat.js
git commit -m "feat(chat): add reply bar, startReply/cancelReply, wire reply_to into sendMessage"
```

---

## Task 6: Frontend — render quoted block în bubble

**Files:**
- Modify: `public/js/chat.js` (funcțiile `buildMessageEl()` și `buildContentHtml()`)

**Context:** Mesajele cu `reply_to` au acum `reply_to_text` și `reply_to_sender` din API (Task 1).

**Step 1: Adaugă helper `buildReplyQuoteHtml(msg)`** — ÎNAINTE de `buildMessageEl()`:

```js
function buildReplyQuoteHtml(msg) {
  if (!msg.reply_to) return '';
  const sender = esc(msg.reply_to_sender || 'utilizator');
  const text = esc((msg.reply_to_text || 'mesaj șters').substring(0, 80));
  return `<div class="msg__reply-quote" data-ref-id="${msg.reply_to}">
    <span class="msg__reply-quote__sender">${sender}</span>
    <span class="msg__reply-quote__text">${text}</span>
  </div>`;
}
```

**Step 2: Include `buildReplyQuoteHtml(msg)` în template-ul bubblului** — în `buildMessageEl()`, pentru AMBELE ramuri (sent și received), adaugă `buildReplyQuoteHtml(msg)` ÎNAINTE de `${contentHtml}`:

Pentru sent (găsește `${senderHtml}` în ramura `isMine`):
```js
    el.innerHTML = `
      ${senderHtml}
      ${buildReplyQuoteHtml(msg)}
      ${contentHtml}
      ...
```

Pentru received (ramura `else`):
```js
    el.innerHTML = `
      ${senderHtml}
      ${buildReplyQuoteHtml(msg)}
      ${contentHtml}
      ...
```

**Step 3: Wire click pe quoted block → scroll la mesajul original** — în `buildMessageEl()`, ÎNAINTE de `return el;`, adaugă:

```js
  const quoteEl = el.querySelector('.msg__reply-quote');
  if (quoteEl) {
    quoteEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const refId = quoteEl.dataset.refId;
      const target = document.querySelector(`[data-msg-id="${refId}"]`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('msg--highlight');
        target.addEventListener('animationend', () => target.classList.remove('msg--highlight'), { once: true });
      }
    });
  }
```

**Step 4: Verify** — trimite un reply, reîncarcă chat-ul, verifică că bubblul cu reply arată blocul citat. Click pe bloc → scroll + flash pe mesajul original.

**Step 5: Commit**
```bash
git add public/js/chat.js
git commit -m "feat(chat): render quoted reply block in message bubble with scroll-to-original"
```

---

## Task 7: Frontend — Private chat navigation

**Files:**
- Modify: `public/js/chat.js`

**Context:** `POST /api/rooms/direct` există acum (Task 2). Sidebar-ul are `selectRoom(roomId)` sau similar pentru navigare. Verifică cum se navighează la un room în chat.js.

**Step 1: Read public/js/chat.js** — caută `selectRoom` sau `loadRoom` sau `currentRoomId =` pentru a înțelege cum se schimbă room-ul activ.

**Step 2: Adaugă `openPrivateChat(userId)`**:

```js
async function openPrivateChat(userId) {
  const data = await Auth.api('/api/rooms/direct', {
    method: 'POST',
    body: JSON.stringify({ participant_id: userId })
  });
  if (!data || !data.room) return;
  const room = data.room;

  // Navigate to the DM room — same as clicking it in sidebar
  // If room already in sidebar, select it; else add it first
  const existing = document.querySelector(`[data-room-id="${room.id}"]`);
  if (existing) {
    existing.click();
  } else {
    // Room not yet in sidebar — reload rooms then navigate
    await loadRooms();
    const newEl = document.querySelector(`[data-room-id="${room.id}"]`);
    if (newEl) newEl.click();
  }
}
```

**Note:** Dacă funcția de navigare are un alt nume (ex: `switchRoom`, `enterRoom`), ajustează apelul. Citește chat.js pentru naming exact.

**Step 3: Wire butonul Private chat din meniu**:

```js
msgMenuDm.addEventListener('click', () => {
  if (!menuTargetMsg) return;
  closeMsgMenu();
  openPrivateChat(menuTargetMsg.senderId);
});
```

**Step 4: Verify** — click pe mesajul altcuiva → Private chat → sidebar navighează la DM sau îl creează.

**Step 5: Commit**
```bash
git add public/js/chat.js
git commit -m "feat(chat): add Private chat from message menu — find or create DM room"
```

---

## End-to-end manual test

1. Login ca user → deschide un channel
2. Click pe un mesaj al altcuiva → meniu apare cu Reply + Private chat
3. Click Reply → reply bar apare cu preview
4. Scrie un mesaj și trimite → bubblul nou are bloc citat
5. Click pe blocul citat → scroll + flash pe mesajul original
6. Click pe propriul mesaj → meniu apare cu DOAR Reply (fără Private chat)
7. Click pe mesajul altcuiva → Private chat → navighează la DM
8. A doua oară Private chat pe același user → deschide DM-ul existent (nu duplicat)

---

## Files touched summary

| File | Task |
|------|------|
| `routes/messages.js` | Task 1 — reply context JOIN |
| `routes/rooms.js` | Task 2 — POST /direct endpoint |
| `public/css/layers/pages/chat.css` | Task 3 — CSS |
| `public/chat.html` | Task 4 — menu HTML |
| `public/js/chat.js` | Task 4, 5, 6, 7 — JS |
