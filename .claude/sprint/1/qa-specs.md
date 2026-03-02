# Sprint 1 — QA Test Scenarios

Server: http://localhost:3737

## Prerequisites
- Server must be running: `cd /Users/victorsafta/onechat && npm run dev`
- At least 2 user accounts must exist in the database
- At least 1 direct room and 1 group room must exist

## Test 1: Real-Time Text Messages

**Scenario:** Send a text message in a room
1. User A is in Room X
2. User A types and sends a message
3. **Verify:** The message appears in User A's chat immediately (via socket broadcast)
4. **Verify:** User B (also in Room X) sees the message without refresh

**Check server handler:** `socket/handlers/messages.js` emits `io.to(room).emit('message', ...)`
**Check client handler:** `chat.js` `socket.on('message')` calls `appendMessage()`

## Test 2: Message Edit and Delete

**Scenario:** Edit then delete a message
1. User A sends "Hello"
2. User A edits it to "Hello World"
3. **Verify:** "Hello World" + "editat" label appears for all room members
4. User A deletes the message
5. **Verify:** Message disappears for all room members

## Test 3: Typing Indicator

**Scenario:** Typing broadcast
1. User A starts typing in Room X
2. **Verify:** User B sees "[A] scrie..." indicator
3. **Verify:** Indicator disappears after 3 seconds of no typing

## Test 4: Emoji Reactions

**Scenario:** React to a message
1. User A sends a message
2. User B clicks reaction emoji on that message
3. **Verify:** Reaction chip appears for both users via `reaction_update` event

## Test 5: File Upload Socket Broadcast (CRITICAL FIX)

**Scenario:** Upload an image in a room
1. User A uploads an image in Room X
2. **Verify:** The file message appears for User B WITHOUT page refresh
3. **Verify:** The message includes correct `file_url`, `file_name`, `sender_name`
4. **Verify:** The image renders inline (not just a file card)

**What to check in code:**
- `routes/files.js` must call `io.to(room).emit('message', message)` after DB insert
- The SQL SELECT must include `sender_color_index`

## Test 6: DM Auto-Redirect

**Scenario:** Receive a DM while in another room
1. User A is viewing Group Room
2. User B sends a DM to User A
3. **Verify:** User A's client automatically switches to the DM room
4. **Verify:** The DM message is visible
5. **Verify:** If User A is already in the DM room, no redirect happens

## Test 7: Image Compression

**Scenario:** Upload a large image
1. Prepare an image larger than 1280px on its longest side
2. Upload it via the attach button
3. **Verify in console:** Compression log shows before/after sizes
4. **Verify:** The uploaded image dimensions do not exceed 1280px
5. **Verify:** GIF files are NOT compressed (would lose animation)

## Test 8: Upload Progress Bar

**Scenario:** Upload a file and watch progress
1. User A uploads a file in Room X
2. **Verify:** User A sees local upload indicator
3. **Verify:** User B sees progress bar: "[A] uploading [filename]... X%"
4. **Verify:** Progress bar disappears after upload completes

## Test 9: Scroll-to-Bottom Threshold

**Scenario:** New messages while scrolled up
1. User A is in Room X and scrolls up to read older messages
2. User B sends a new message
3. **Verify:** User A does NOT get force-scrolled to bottom
4. **Verify:** If User A is near the bottom (within 150px), auto-scroll happens

## Test 10: CSS Audit

Run: `bash /Users/victorsafta/onechat/scripts/audit-css.sh`
**Verify:** 0 errors
