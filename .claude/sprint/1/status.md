# Sprint 1 -- FINALIZED

## Goal
Fix real-time WebSocket flows, add DM auto-redirect, image compression, live upload progress, ensure all messages appear without refresh.

## Completed Work

### Critical Bug Fix
- File upload route (`routes/files.js`) now broadcasts `message` via Socket.IO after DB insert -- file messages appear for all room members without refresh
- Fixed SELECT query to include `sender_color_index` via COALESCE + LEFT JOIN on room_members

### New Features
- `upload_progress` socket event in `socket/handlers/messages.js` -- broadcasts upload progress to room members
- Client-side image compression via Canvas API (max 1280px, JPEG 0.82, skips GIF) in `chat.js`
- XHR-based upload with progress events replacing fetch in `chat.js`
- Upload progress UI (`showUploadProgress()`) with `.upload-status` CSS component
- DM auto-redirect: incoming DM in a direct room auto-navigates the user to that conversation
- Scroll-to-bottom threshold: only auto-scrolls if user is within 150px of bottom

### Bug Fix (QA-discovered, pre-existing)
- Zod v4 `.errors[0]` changed to `.issues[0]` in `auth.js`, `messages.js`, `rooms.js` (6 occurrences) -- validation errors now return 400 instead of 500

## Test Results
- API conformance: 26/26 PASS
- Static analysis: 23/23 PASS
- UI tests: 8/8 PASS
- CSS audit: 0 errors

## Files Modified
- `/Users/victorsafta/onechat/routes/files.js`
- `/Users/victorsafta/onechat/routes/auth.js`
- `/Users/victorsafta/onechat/routes/messages.js`
- `/Users/victorsafta/onechat/routes/rooms.js`
- `/Users/victorsafta/onechat/socket/handlers/messages.js`
- `/Users/victorsafta/onechat/public/js/chat.js`
- `/Users/victorsafta/onechat/public/css/layers/pages/chat.css`

## Known Limitations
- PNG transparency lost on JPEG compression (acceptable trade-off for size reduction)
- DM auto-redirect may be disruptive if user is actively typing in another room
- Route mount inconsistency `/api/messages/messages/:id` remains (pre-existing, out of scope)
