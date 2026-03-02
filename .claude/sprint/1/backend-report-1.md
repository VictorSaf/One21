# Backend Report — Sprint 1, Iteration 1

### TASK
Sprint 1: File upload socket broadcast fix, upload progress system, DM auto-redirect, image compression, and scroll-to-bottom threshold.

### CONFORMITY STATUS: YES

### DEVIATIONS:
None. All implementations follow the specs exactly. The only inline `style=` attribute used is on `.upload-status__fill` div (`style="width:X%"`) which sets a dynamic percentage width for the progress bar fill. This is in JavaScript-generated DOM (not in HTML files), so it does not trigger the CSS audit and is the standard approach for dynamic progress bars.

### FILES CHANGED:
- `routes/files.js` — Fixed SELECT query to include `sender_color_index` via `room_members` LEFT JOIN with COALESCE fallback; added Socket.IO broadcast (`req.app.get('io').to(...).emit('message', message)`) after DB insert.
- `socket/handlers/messages.js` — Added `upload_progress` event handler in `register()` that broadcasts progress data to room members (excluding sender) with clamped percent value.
- `public/js/chat.js` — (1) Scroll-to-bottom threshold: only auto-scrolls if user is within 150px of bottom. (2) DM auto-redirect: navigates to DM room when incoming message is in a direct room not currently viewed. (3) `compressImage()` helper: resizes images >1280px via Canvas, outputs JPEG at 0.82 quality, skips GIFs. (4) `uploadFile()` rewritten with XHR for progress events, emits `upload_progress` socket event during upload. (5) `showUploadProgress()` creates/updates `.upload-status` element above compose row. (6) `upload_progress` socket listener for receiving progress from other users.
- `public/css/layers/pages/chat.css` — Added `.upload-status`, `.upload-status__bar`, `.upload-status__fill` styles inside `@layer pages` using only CSS design tokens.

### ISSUES FOUND:
- None. CSS audit passes with 0 errors.

### NOTES:
- File upload route broadcasts message to ALL sockets in the room via `io.to()`, including the uploader. The client handles this correctly since it only renders messages from the socket event (not from XHR response). No duplication risk.
- `compressImage()` converts all non-GIF images to JPEG. PNG transparency will be lost on upload. Could be refined in a future sprint.
- DM auto-redirect could be disruptive if user is actively typing in another room. Consider debounce/notification in future sprint.
