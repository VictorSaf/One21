# Per-Room User Colors & Reply Username Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Apply distinct bubble colors to every user in group/cult/private rooms, and show `@username` instead of display name in reply quotes.

**Architecture:** Two independent fixes — (1) extend the existing `isGroup` color guard in `chat.js` to cover `cult` and `private` room types and remove the admin exclusion; (2) change the `reply_to_sender` SQL alias from `ru.display_name` to `ru.username` in both the REST route and the socket handler, then prefix with `@` in the render function.

**Tech Stack:** Node.js/Express, SQLite (better-sqlite3), Socket.IO, vanilla JS, CSS custom properties.

---

## Context for the implementer

The app already has a full per-user color system:
- DB: `room_members.color_index` (0–7) assigned at room creation
- API: returned as `sender_color_index` via `COALESCE(rmc.color_index, u.chat_color_index)`
- CSS: `.msg--received.msg--color-0…7` and `.msg--sent.msg--color-0…7` in `public/css/layers/pages/chat.css`
- JS: `buildMessageEl` in `public/js/chat.js` already computes `colorClass` and applies it

The only bug: line 358 only activates colors for `group` and `channel`, missing `cult` and `private`. Also, line 370 skips admin messages. Both restrictions need to be removed.

For replies: `reply_to_sender` currently stores `ru.display_name` in two SQL queries. The fix is `ru.username` in both places + `@` prefix in the render.

---

## Task 1 — Extend color logic to cult/private and include admin

**Files:**
- Modify: `public/js/chat.js:358–372`

### Step 1 — Locate the two lines to change

Open `public/js/chat.js` and find (around line 358):

```js
const isGroup = currentRoomType === 'group' || currentRoomType === 'channel';
```

and (around line 370):

```js
const useColor = isGroup && msg.sender_role !== 'admin' && msg.sender_color_index != null;
```

### Step 2 — Apply the change

Replace those two lines with:

```js
const isGroup = ['group', 'cult', 'private', 'channel'].includes(currentRoomType);
```

```js
const useColor = isGroup && msg.sender_color_index != null;
```

No other changes needed in this file for colors.

### Step 3 — Verify in browser

1. Start the server: `cd ~/onechat && node server.js`
2. Open `http://localhost:3737/one21/chat`
3. Open a group room with at least two users
4. Each user's bubble should have a distinct background color and left/right border color
5. Admin messages should also be colored (no longer white/default)

Expected: received messages show colored backgrounds (green/purple/teal/etc per user), sent messages show their own color variant.

### Step 4 — Commit

```bash
git add public/js/chat.js
git commit -m "fix(chat): apply per-room colors to cult/private rooms and admin messages"
```

---

## Task 2 — Show @username in reply quotes (SQL layer)

**Files:**
- Modify: `routes/messages.js:59`
- Modify: `socket/handlers/messages.js:136`

### Step 1 — Fix routes/messages.js

Open `routes/messages.js` and find (around line 58–59):

```js
      reply_m.text as reply_to_text,
      ru.display_name as reply_to_sender,
```

Change `ru.display_name` to `ru.username`:

```js
      reply_m.text as reply_to_text,
      ru.username as reply_to_sender,
```

### Step 2 — Fix socket/handlers/messages.js

Open `socket/handlers/messages.js` and find (around line 136):

```js
             reply_m.text as reply_to_text, ru.display_name as reply_to_sender,
```

Change `ru.display_name` to `ru.username`:

```js
             reply_m.text as reply_to_text, ru.username as reply_to_sender,
```

### Step 3 — Add @ prefix in the render function

Open `public/js/chat.js` and find `buildReplyQuoteHtml` (around line 338–345):

```js
  function buildReplyQuoteHtml(msg) {
    if (!msg.reply_to) return '';
    const sender = esc(msg.reply_to_sender || 'utilizator');
```

Change to:

```js
  function buildReplyQuoteHtml(msg) {
    if (!msg.reply_to) return '';
    const sender = msg.reply_to_sender ? '@' + esc(msg.reply_to_sender) : 'utilizator';
```

### Step 4 — Verify in browser

1. Restart the server (required — SQL change takes effect on restart)
2. In any room, reply to a message
3. The quoted block inside the sent message should show `@username` (e.g. `@test1`) not the display name (`Victor Safta`)
4. The reply bar above the compose area is unaffected (it already uses `senderName` which is `sender_username`)

Expected: reply quote header reads `@test1` / `@admin` style.

### Step 5 — Commit

```bash
git add routes/messages.js socket/handlers/messages.js public/js/chat.js
git commit -m "fix(chat): show @username in reply quotes instead of display name"
```

---

## Verification checklist

- [ ] Open a **group** room — each user has a distinct bubble color
- [ ] Open a **cult** room — same color differentiation applies
- [ ] Open a **private** room — both parties have distinct colors
- [ ] Admin messages are also colored (not white/default)
- [ ] Reply to a message → quoted header shows `@username` not `Firstname Lastname`
- [ ] Reply bar (above compose) still shows the correct name while composing
- [ ] No console errors in browser
