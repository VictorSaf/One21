# Messaging UX Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade the reply compose experience to a proper quoted bubble, add emoji reactions on messages, and add @mention autocomplete for group chats.

**Architecture:** All three features are client-driven with Socket.IO sync. Reactions require a new DB table and two new socket events (`react` / `reaction_update`). Reply bubble and @mentions are purely frontend (JS + CSS). No new routes needed.

**Tech Stack:** Vanilla JS (ES6, no framework), Socket.IO, SQLite (better-sqlite3), CSS Cascade Layers (`@layer pages` in `chat.css`, `@layer components` in `components.css`).

---

## What Already Exists (do NOT duplicate)

- `reply_to`, `reply_to_sender`, `reply_to_text` fields in DB + message query — **already working**
- `startReply(msgId, senderName, text)` in `public/js/chat.js:477` — creates `.reply-bar` DOM element
- `buildReplyQuoteHtml(msg)` in `public/js/chat.js:297` — renders quote block inside received bubbles
- `.reply-bar`, `.msg__reply-quote` CSS in `public/css/layers/pages/chat.css:91–148`
- Typing indicator, read receipts, edit/delete, file upload — all working

---

## Task 1: Reply Compose Bubble — Visual Upgrade

**Problem:** The current reply bar is a tiny strip of text. Users expect a WhatsApp/iMessage-style preview bubble above the compose input that clearly shows the original message content.

**Files:**
- Modify: `public/js/chat.js:477–494` (`startReply` function)
- Modify: `public/css/layers/pages/chat.css` (upgrade `.reply-bar` styles)

**Step 1: Update `startReply()` in `chat.js`**

Replace the existing `startReply` function (lines 477–495) with:

```js
function startReply(msgId, senderName, text, fileUrl, fileName) {
  replyingToId = msgId;

  let bar = document.getElementById('replyBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'replyBar';
    bar.className = 'reply-bar';
    composeInput.parentElement.insertBefore(bar, composeInput);
    bar.addEventListener('click', e => {
      if (e.target.closest('.reply-bar__cancel')) cancelReply();
    });
  }

  const isImage = fileName && /\.(jpg|jpeg|png|gif|webp)$/i.test(fileName);
  const previewContent = fileUrl && isImage
    ? `<img src="${fileUrl}" class="reply-bar__thumb" alt="${esc(fileName)}">`
    : `<span class="reply-bar__preview">${esc(text.substring(0, 80))}${text.length > 80 ? '…' : ''}</span>`;

  bar.innerHTML = `
    <div class="reply-bar__accent"></div>
    <div class="reply-bar__body">
      <span class="reply-bar__sender">↩ ${esc(senderName)}</span>
      ${previewContent}
    </div>
    <button class="reply-bar__cancel" title="Anulează">✕</button>`;

  composeInput.focus();
}
```

**Step 2: Pass `file_url` / `file_name` when opening reply from menu**

In `chat.js`, the menu `Reply` click handler (line ~63–67) passes only `id, senderName, text`. Update `menuTargetMsg` to also store `fileUrl` and `fileName`, and pass them to `startReply`:

```js
// When building menuTargetMsg in openMsgMenu (find openMsgMenu call ~line 374):
// Change openMsgMenu call inside buildMessageEl to pass full msg:
openMsgMenu(e, {
  id: msg.id,
  senderId: msg.sender_id,
  senderName: msg.sender_name || msg.sender_username || '',
  text: msg.text || '',
  fileUrl: msg.file_url || '',
  fileName: msg.file_name || '',
});

// In msgMenuReply click handler (~line 63):
startReply(menuTargetMsg.id, menuTargetMsg.senderName, menuTargetMsg.text, menuTargetMsg.fileUrl, menuTargetMsg.fileName);
```

**Step 3: Update CSS for the upgraded reply bar**

In `public/css/layers/pages/chat.css`, replace existing `.reply-bar` block with:

```css
/* Reply compose bubble */
.reply-bar {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  background: var(--bg-elevated);
  border: 1px solid var(--border-accent);
  border-radius: 8px 8px 0 0;
  padding: var(--sp-2) var(--sp-3);
  margin-bottom: -1px;
}
.reply-bar__accent {
  width: 3px;
  align-self: stretch;
  background: var(--accent);
  border-radius: 2px;
  flex-shrink: 0;
}
.reply-bar__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.reply-bar__sender {
  font-size: var(--font-xs);
  font-family: var(--font-mono);
  color: var(--text-accent);
  font-weight: 600;
}
.reply-bar__preview {
  font-size: var(--font-xs);
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.reply-bar__thumb {
  height: 36px;
  width: auto;
  border-radius: 4px;
  object-fit: cover;
}
.reply-bar__cancel {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: var(--font-sm);
  padding: var(--sp-1);
  flex-shrink: 0;
  line-height: 1;
}
.reply-bar__cancel:hover { color: var(--text-primary); }
```

**Step 4: Test manually**
1. Go to `http://localhost:3737/one21/chat`
2. Click on any message → context menu → Reply
3. Verify: reply bar shows with accent bar, sender name in accent color, text preview
4. For an image message: verify thumbnail appears
5. Press ✕ → bar disappears
6. Send a reply → verify the quote block appears in the sent message bubble

**Step 5: Commit**
```bash
git add public/js/chat.js public/css/layers/pages/chat.css
git commit -m "feat(chat): upgrade reply compose bar to quoted bubble with accent strip"
```

---

## Task 2: Emoji Reactions — DB + Socket

**What it does:** Users hover a message and see a row of 6 emoji buttons. Click an emoji to react; click again to remove. Reaction counts appear below the bubble. All users in the room see updates in real time.

### 2a — DB Migration

**Files:**
- Modify: `db/init.js`

**Step 1: Add `message_reactions` table in `db/init.js`**

Find the `safeAdd` block near the end of `initDb()` (around line 185) and add before the final `return`:

```js
db.prepare(`
  CREATE TABLE IF NOT EXISTS message_reactions (
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    emoji      TEXT NOT NULL,
    PRIMARY KEY (message_id, user_id, emoji)
  )
`).run();
```

**Step 2: Restart server and verify table exists**
```bash
node -e "const {getDb}=require('./db/init');const db=getDb();console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE name='message_reactions'\").get())"
```
Expected: `{ name: 'message_reactions' }`

### 2b — Socket Handler

**Files:**
- Modify: `socket/handlers/messages.js`

**Step 3: Add `react` socket handler**

Inside the `register(io, socket, db)` function, after the `mark_read` handler, add:

```js
socket.on('react', (data) => {
  const { message_id, emoji } = data;
  if (!message_id || !emoji || typeof emoji !== 'string') return;
  // Whitelist allowed emojis
  const ALLOWED = ['👍','❤️','😂','😮','😢','🔥'];
  if (!ALLOWED.includes(emoji)) return;

  const msg = db.prepare('SELECT room_id FROM messages WHERE id = ?').get(message_id);
  if (!msg) return;

  // Check membership
  const membership = db.prepare('SELECT 1 FROM room_members WHERE room_id = ? AND user_id = ?')
    .get(msg.room_id, socket.user.id);
  if (!membership) return;

  // Toggle: if exists → remove, else → insert
  const existing = db.prepare(
    'SELECT 1 FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?'
  ).get(message_id, socket.user.id, emoji);

  if (existing) {
    db.prepare('DELETE FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')
      .run(message_id, socket.user.id, emoji);
  } else {
    db.prepare('INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)')
      .run(message_id, socket.user.id, emoji);
  }

  // Build current reaction summary: [{emoji, count, users:[]}]
  const rows = db.prepare(
    'SELECT emoji, COUNT(*) as count FROM message_reactions WHERE message_id = ? GROUP BY emoji'
  ).all(message_id);

  io.to(`room:${msg.room_id}`).emit('reaction_update', {
    message_id,
    reactions: rows,  // [{emoji, count}]
  });
});
```

### 2c — Frontend UI

**Files:**
- Modify: `public/js/chat.js`
- Modify: `public/css/layers/pages/chat.css`

**Step 4: Add reaction bar HTML to each message bubble**

In `buildMessageEl()` (around the `msg__actions` div), add a reaction strip before the close of the `if/else` block. For both `isMine` and received branches, add to the innerHTML:

```js
// Add after the msg__meta div in both branches:
const EMOJIS = ['👍','❤️','😂','😮','😢','🔥'];
const reactionPickerHtml = `
  <div class="msg__reaction-picker">
    ${EMOJIS.map(e => `<button class="msg__react-btn" data-emoji="${e}" data-msg-id="${msg.id}">${e}</button>`).join('')}
  </div>`;
const reactionBarHtml = `<div class="msg__reactions" id="reactions-${msg.id}"></div>`;
```

Append `reactionPickerHtml + reactionBarHtml` to both `isMine` and received `innerHTML` strings.

**Step 5: Wire reaction picker click**

After the existing action button bindings in `buildMessageEl()`, add:

```js
el.querySelectorAll('.msg__react-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    socket.emit('react', {
      message_id: parseInt(btn.dataset.msgId),
      emoji: btn.dataset.emoji,
    });
  });
});
```

**Step 6: Handle `reaction_update` socket event**

In `connectSocket()`, add:

```js
socket.on('reaction_update', ({ message_id, reactions }) => {
  const bar = document.getElementById(`reactions-${message_id}`);
  if (!bar) return;
  if (!reactions.length) { bar.innerHTML = ''; return; }
  bar.innerHTML = reactions.map(r =>
    `<span class="msg__reaction-chip">${r.emoji} <span class="msg__reaction-count">${r.count}</span></span>`
  ).join('');
});
```

**Step 7: Fetch existing reactions when loading messages**

In the API that loads messages (`/api/rooms/:id/messages`), reactions need to come with messages. Find `routes/messages.js` — add a query that fetches reactions per message and attaches them.

In `routes/messages.js`, after fetching `messages`, add:

```js
// Attach reactions
const msgIds = messages.map(m => m.id);
if (msgIds.length) {
  const placeholders = msgIds.map(() => '?').join(',');
  const reactionRows = db.prepare(
    `SELECT message_id, emoji, COUNT(*) as count
     FROM message_reactions WHERE message_id IN (${placeholders})
     GROUP BY message_id, emoji`
  ).all(...msgIds);

  const reactionMap = {};
  reactionRows.forEach(r => {
    if (!reactionMap[r.message_id]) reactionMap[r.message_id] = [];
    reactionMap[r.message_id].push({ emoji: r.emoji, count: r.count });
  });
  messages.forEach(m => { m.reactions = reactionMap[m.id] || []; });
}
```

**Step 8: Render existing reactions when building message element**

In `buildMessageEl()`, after creating `reactionBarHtml`, render pre-existing reactions immediately:

```js
// After el is built, populate existing reactions:
if (msg.reactions && msg.reactions.length) {
  const bar = el.querySelector(`#reactions-${msg.id}`);
  if (bar) {
    bar.innerHTML = msg.reactions.map(r =>
      `<span class="msg__reaction-chip">${r.emoji} <span class="msg__reaction-count">${r.count}</span></span>`
    ).join('');
  }
}
```

**Step 9: Add CSS for reactions**

In `public/css/layers/pages/chat.css`, add:

```css
/* Reaction picker — shown on hover */
.msg__reaction-picker {
  display: none;
  position: absolute;
  bottom: calc(100% + 4px);
  left: 0;
  background: var(--bg-elevated);
  border: 1px solid var(--border-mid);
  border-radius: 20px;
  padding: var(--sp-1) var(--sp-2);
  gap: var(--sp-1);
  z-index: var(--z-dropdown);
}
.msg:hover .msg__reaction-picker { display: flex; }
.msg__react-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 18px;
  padding: 2px;
  border-radius: 4px;
  transition: transform var(--transition-fast);
}
.msg__react-btn:hover { transform: scale(1.3); }

/* Reaction chips below bubble */
.msg__reactions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-1);
  margin-top: 2px;
}
.msg__reaction-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-dim);
  border-radius: 12px;
  padding: 1px 8px;
  font-size: var(--font-xs);
  cursor: pointer;
}
.msg__reaction-count {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
}
```

**Step 10: Ensure `msg` has `position: relative`**

The reaction picker uses `position: absolute` relative to the `.msg` bubble. Verify `components.css` has `.msg { position: relative; }`. If not, add it.

**Step 11: Test reactions**
1. Hover any message → 6 emoji buttons appear above bubble
2. Click 👍 → chip `👍 1` appears below bubble for all users in room
3. Click 👍 again → chip disappears (toggle)
4. Reload page → reactions still there (persisted)

**Step 12: Commit**
```bash
git add db/init.js socket/handlers/messages.js routes/messages.js public/js/chat.js public/css/layers/pages/chat.css
git commit -m "feat(chat): add emoji reactions with real-time sync and persistence"
```

---

## Task 3: @Mention Autocomplete

**What it does:** When user types `@` in the compose input, a dropdown appears with matching room members. Selecting one inserts `@username` into the input. The mention is highlighted in the sent message.

**Files:**
- Modify: `public/js/chat.js`
- Modify: `public/css/layers/pages/chat.css`

### 3a — Mention Picker UI

**Step 1: Add mention picker DOM to `chat.html`**

Find the compose area in `public/chat.html`. After the `composeInput` textarea, add (inside the compose wrapper):

```html
<div class="mention-picker" id="mentionPicker" style="display:none"></div>
```

**Step 2: Add mention tracking variables** at top of the chat IIFE (near `replyingToId`):

```js
let mentionQuery = '';
let mentionStart = -1;
```

**Step 3: Add `@` detection in the keyup handler**

In the existing `composeInput` keyup listener (around line 618), add mention detection:

```js
composeInput.addEventListener('input', () => {
  const val = composeInput.value;
  const pos = composeInput.selectionStart;
  // Find @ before cursor
  const before = val.slice(0, pos);
  const atIdx = before.lastIndexOf('@');
  if (atIdx !== -1 && (atIdx === 0 || /\s/.test(before[atIdx - 1]))) {
    const query = before.slice(atIdx + 1).toLowerCase();
    if (!/\s/.test(query)) {
      mentionStart = atIdx;
      mentionQuery = query;
      showMentionPicker(query);
      return;
    }
  }
  hideMentionPicker();
});
```

**Step 4: Implement `showMentionPicker(query)` and `hideMentionPicker()`**

```js
function showMentionPicker(query) {
  const picker = document.getElementById('mentionPicker');
  if (!picker || !currentMembers.length) return;

  const matches = currentMembers
    .filter(m => m.username.toLowerCase().includes(query) && m.id !== user.id)
    .slice(0, 5);

  if (!matches.length) { hideMentionPicker(); return; }

  picker.innerHTML = matches.map(m => `
    <div class="mention-option" data-username="${esc(m.username)}">
      <span class="mention-option__name">${esc(m.display_name || m.username)}</span>
      <span class="mention-option__user">@${esc(m.username)}</span>
    </div>`).join('');

  picker.querySelectorAll('.mention-option').forEach(opt => {
    opt.addEventListener('mousedown', (e) => {
      e.preventDefault(); // don't blur input
      insertMention(opt.dataset.username);
    });
  });

  picker.style.display = 'block';
}

function hideMentionPicker() {
  const picker = document.getElementById('mentionPicker');
  if (picker) picker.style.display = 'none';
  mentionStart = -1;
}

function insertMention(username) {
  const val = composeInput.value;
  const before = val.slice(0, mentionStart);
  const after = val.slice(composeInput.selectionStart);
  composeInput.value = before + '@' + username + ' ' + after;
  composeInput.focus();
  hideMentionPicker();
}
```

**Step 5: Close picker on Escape / blur**

In the existing `keydown` handler add: `if (e.key === 'Escape') hideMentionPicker();`
Add: `composeInput.addEventListener('blur', () => setTimeout(hideMentionPicker, 150));`

### 3b — Mention Highlight in Rendered Messages

**Step 6: Highlight `@username` in rendered message text**

In `buildContentHtml()` (around line 423), update the text return to highlight mentions:

```js
function highlightMentions(text) {
  return text.replace(/@(\w+)/g, (match, uname) => {
    const isSelf = uname.toLowerCase() === user.username.toLowerCase();
    return `<span class="msg__mention${isSelf ? ' msg__mention--self' : ''}">${match}</span>`;
  });
}
// In buildContentHtml, change the text return:
return `<p class="msg__text">${highlightMentions(linkify(esc(msg.text)))}</p>`;
```

**Step 7: CSS for mention picker + highlights**

In `public/css/layers/pages/chat.css`, add:

```css
/* @mention picker */
.mention-picker {
  position: absolute;
  bottom: calc(100% + 4px);
  left: var(--sp-3);
  background: var(--bg-elevated);
  border: 1px solid var(--border-mid);
  border-radius: 8px;
  overflow: hidden;
  min-width: 180px;
  z-index: var(--z-dropdown);
  box-shadow: 0 4px 16px var(--overlay-bg);
}
.mention-option {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  cursor: pointer;
}
.mention-option:hover { background: var(--bg-hover); }
.mention-option__name {
  font-size: var(--font-sm);
  color: var(--text-primary);
}
.mention-option__user {
  font-size: var(--font-xs);
  font-family: var(--font-mono);
  color: var(--text-tertiary);
  margin-left: auto;
}

/* @mention in message text */
.msg__mention {
  color: var(--text-accent);
  font-weight: 600;
}
.msg__mention--self {
  background: color-mix(in srgb, var(--accent) 20%, transparent);
  border-radius: 3px;
  padding: 0 3px;
}
```

**Step 8: Ensure compose wrapper has `position: relative`** so the picker positions correctly above the input. Check `components.css`; if `.compose` doesn't have it, add in `chat.css`:
```css
.compose { position: relative; }
```

**Step 9: Test @mentions**
1. Open a group chat room with members
2. Type `@` → picker appears with matching members
3. Select a member → `@username ` inserted
4. Send message → `@username` highlighted in teal in the bubble
5. If message mentions your own username → background highlight visible

**Step 10: Commit**
```bash
git add public/js/chat.js public/css/layers/pages/chat.css public/chat.html
git commit -m "feat(chat): add @mention autocomplete and mention highlighting in messages"
```

---

## Task 4: Final Verification

**Step 1: Restart server**
```bash
pkill -f "node server.js"; node server.js &
```

**Step 2: Open browser at `http://localhost:3737/one21/chat`**

**Step 3: Test checklist**
- [ ] Click Reply on any message → styled bubble with accent bar appears above compose input
- [ ] Reply on image message → thumbnail visible in reply bar
- [ ] Send reply → quote block appears correctly in the sent bubble
- [ ] Cancel reply (✕) → bar disappears
- [ ] Hover message → emoji picker row appears (6 emojis)
- [ ] Click emoji → reaction chip appears below bubble
- [ ] Click same emoji again → chip disappears
- [ ] Reload page → reactions still shown (DB persisted)
- [ ] Type `@` in group chat → member picker appears
- [ ] Select member → `@username` inserted
- [ ] Send with mention → `@username` rendered in teal
- [ ] Own username mentioned → background highlight shown
- [ ] No hardcoded colors (use `var(--token-name)` only)
- [ ] CSS `bash scripts/audit-css.sh` → 0 errors

**Step 4: Run CSS audit**
```bash
cd /Users/victorsafta/onechat && bash scripts/audit-css.sh
```
Expected: `0 errors`

**Step 5: Final commit**
```bash
git add -A
git commit -m "feat(chat): messaging UX — reply bubble, emoji reactions, @mentions"
git push
```

---

## Summary

| Feature | Files Changed | Complexity |
|---------|--------------|------------|
| Reply compose bubble | `chat.js`, `chat.css` | Low |
| Emoji reactions | `db/init.js`, `socket/handlers/messages.js`, `routes/messages.js`, `chat.js`, `chat.css` | Medium |
| @mention autocomplete | `chat.js`, `chat.css`, `chat.html` | Medium |

Sources consulted:
- [Essential Chat Features for Communication Apps — Sceyt](https://sceyt.com/blog/must-have-chat-features-for-communication-apps)
- [Stream React Chat — Threads & Replies Docs](https://getstream.io/chat/docs/react/threads/)
