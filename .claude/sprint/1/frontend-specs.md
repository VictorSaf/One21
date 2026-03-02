# Sprint 1 — Frontend Specs

All changes are in `/Users/victorsafta/onechat/public/js/chat.js` and `/Users/victorsafta/onechat/public/css/layers/pages/chat.css`.

## 1. DM Auto-Redirect on Incoming Message

**File:** `public/js/chat.js` — inside `socket.on('message', ...)` handler (line 69-76)

**Current behavior:** When a message arrives for a room the user is NOT viewing, it only updates the sidebar preview/badge via `updateRoomPreview()`.

**Required behavior:** If the incoming message is in a `direct` room AND the sender is not the current user, auto-navigate to that DM room.

**Implementation:**

In the `socket.on('message', ...)` handler, after the existing `if (msg.room_id === currentRoomId)` block and after `updateRoomPreview(msg)`, add:

```js
// Auto-redirect to DM if message is in a direct room we're not viewing
if (msg.room_id !== currentRoomId && msg.sender_id !== user.id) {
  const room = rooms.find(r => r.id === msg.room_id);
  if (room && room.type === 'direct') {
    selectRoom(msg.room_id);
  }
}
```

**Note:** The `rooms` array already contains `type` for each room (returned by `/api/rooms`). No extra API call needed.

## 2. Client-Side Image Compression Before Upload

**File:** `public/js/chat.js` — `uploadFile()` function (line 683)

**Implementation:** Add a `compressImage()` helper and call it before creating FormData.

```js
async function compressImage(file, maxDimension = 1280, quality = 0.82) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width <= maxDimension && height <= maxDimension) {
        URL.revokeObjectURL(img.src);
        resolve(file); // No compression needed
        return;
      }
      if (width > height) {
        height = Math.round(height * (maxDimension / width));
        width = maxDimension;
      } else {
        width = Math.round(width * (maxDimension / height));
        height = maxDimension;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(img.src);
        console.log(`[Compress] ${file.name}: ${(file.size/1024).toFixed(0)}KB → ${(blob.size/1024).toFixed(0)}KB`);
        resolve(new File([blob], file.name, { type: 'image/jpeg' }));
      }, 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(img.src); resolve(file); };
    img.src = URL.createObjectURL(file);
  });
}
```

In `uploadFile()`, before creating FormData, add:

```js
const isImage = /\.(jpg|jpeg|png|webp|gif)$/i.test(file.name);
let fileToUpload = file;
if (isImage) {
  fileToUpload = await compressImage(file);
}
```

Then use `fileToUpload` in the FormData append instead of `file`.

**GIF exception:** GIFs should skip the Canvas compression (it would lose animation). Check `file.name` extension: if `.gif`, skip compression.

## 3. Live Upload Progress Bar

### Client-side changes (`public/js/chat.js`)

Replace `fetch()` in `uploadFile()` with `XMLHttpRequest` to get upload progress events.

**During upload:**
1. Emit `socket.emit('upload_progress', { room_id: currentRoomId, filename: file.name, percent })` on each progress tick
2. Show a local progress indicator in the status bar area

**On receiving `upload_progress` from others:**

Add a socket listener:

```js
socket.on('upload_progress', (data) => {
  if (data.room_id !== currentRoomId) return;
  showUploadProgress(data.username, data.filename, data.percent);
});
```

**`showUploadProgress()` implementation:**
- Find or create a `.upload-status` element above the compose bar (inside `.compose`, before `.compose__row`)
- Show: `[username] uploading [filename]... X%` with a progress bar
- When percent >= 100, fade out and remove after 1 second

### CSS changes (`public/css/layers/pages/chat.css`)

Add styles for `.upload-status` inside `@layer pages`:

```css
.upload-status {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-1) var(--sp-3);
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border-dim);
  font-size: var(--font-xs);
  font-family: var(--font-mono);
  color: var(--text-secondary);
}
.upload-status__bar {
  flex: 1;
  height: 3px;
  background: var(--bg-active);
  border-radius: 2px;
  overflow: hidden;
}
.upload-status__fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width var(--transition-fast);
}
```

## 4. Scroll-to-Bottom Threshold Fix

**File:** `public/js/chat.js`

**Current behavior:** `scrollToBottom()` is called unconditionally after `appendMessage()` in the `socket.on('message')` handler.

**Required behavior:** Only auto-scroll if user is near the bottom (within 150px). If user has scrolled up (reading older messages), do NOT force scroll.

**Implementation:** Modify the `socket.on('message')` handler:

```js
socket.on('message', (msg) => {
  if (msg.room_id === currentRoomId) {
    const nearBottom = messagesArea.scrollHeight - messagesArea.scrollTop - messagesArea.clientHeight < 150;
    appendMessage(msg);
    if (nearBottom) scrollToBottom();
    if (document.hasFocus()) socket.emit('mark_read', { message_id: msg.id });
  }
  updateRoomPreview(msg);
  // ... DM redirect logic
});
```

## 5. Prevent Duplicate Messages from Own Send

**Current behavior:** When the user sends a message via socket, the server broadcasts it to `io.to(room)` which includes the sender. The sender then sees a duplicate (their sent message + the broadcast).

**Analysis:** Actually, looking at the code more carefully, `io.to()` broadcasts to ALL sockets in the room including the sender. The client `appendMessage()` only adds messages from the socket event, not from the send action. So there should be no duplication. This is correct behavior - the message appears only when the server confirms it via broadcast.

No fix needed here.

## Files to modify

1. `/Users/victorsafta/onechat/public/js/chat.js` — All client-side changes
2. `/Users/victorsafta/onechat/public/css/layers/pages/chat.css` — Upload status bar styles
