# Sprint 1 — Real-Time WebSocket & Attachment Improvements

## Goal
Verify and fix all real-time WebSocket flows. Ensure private messages redirect instantly to the correct DM room. Add attachment compression. Show live upload status bar for all room members. All new messages appear live without refresh.

## Tech Stack
- Backend: Node.js / Express / Socket.IO / better-sqlite3
- Frontend: Vanilla JS (ES6), Socket.IO client, CSS Cascade Layers
- No framework (no React/Vue)
- Server: http://localhost:3737

## UI Testing Mode: automated

## Features

### 1. WebSocket Verification — All Real-Time Flows
- Verify `message` event is received by all room members in real time
- Verify `message_edited` and `message_deleted` are broadcast correctly
- Verify `typing` indicator is broadcast to room members (not sender)
- Verify `reaction_update` is broadcast after emoji react
- Verify `mark_read` / `message_read` events work
- Verify user presence (`user_online`, `user_offline`) if implemented
- Fix any broken or missing real-time handlers

### 2. Private Message — Instant Room Redirect
- When a user receives a `message` event in a `direct` room they are not currently viewing, the client should automatically navigate to that DM room
- The sidebar DM item should highlight / show unread badge
- If the user is already in that DM room, no redirect needed
- This should happen via the existing socket `message` event — no new events needed

### 3. Attachment Compression
- Before uploading images (jpg, jpeg, png, webp, gif), compress client-side using Canvas API
- Target: max 1280px on longest side, JPEG quality 0.82
- Non-image files (pdf, zip, etc.) skip compression
- Show file size before/after compression in console (debug only)
- The compressed Blob is sent instead of the original File

### 4. Live Upload Status Bar
- When a file upload starts, emit a `upload_progress` socket event from the client with `{ room_id, user_id, filename, percent }`
- All room members see a progress bar in the status bar area showing `[username] is uploading [filename]... X%`
- On completion or error, the progress bar disappears
- Use existing `.compose__statusbar` area if available, or add a `.upload-status` element above compose

### 5. New Message Without Refresh
- Verify that `socket.on('message', ...)` in `chat.js` correctly calls `appendMessage()` or `buildMessageEl()` for incoming messages
- Fix any case where a page reload is needed to see new messages from others
- The scroll-to-bottom behavior should trigger automatically when the user is already near the bottom (within 150px)

## Files Likely Involved
- `public/js/chat.js` — main client logic
- `socket/handlers/messages.js` — server socket handlers
- `routes/files.js` — file upload route
- `public/css/layers/pages/chat.css` — upload status bar styles

## Acceptance Criteria
- [ ] Sending a message in any room → all other members see it instantly (no reload)
- [ ] Receiving a DM while in a different room → auto-redirect to DM room
- [ ] Uploading an image → compressed before send, all members see live progress
- [ ] Upload completes → new file message appears for everyone without refresh
- [ ] CSS audit passes: 0 errors
