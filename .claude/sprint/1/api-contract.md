# Sprint 1 — API Contract

## Existing Endpoints (no changes needed)

- `POST /api/rooms/:id/upload` — file upload (already exists, needs socket broadcast fix)
- All socket events listed below already exist in the protocol

## Socket Events — Changes Required

### Existing Events (verify/fix)

| Event | Direction | Payload | Status |
|-------|-----------|---------|--------|
| `message` | server->client | `{ id, room_id, sender_id, text, type, file_url, file_name, sender_username, sender_name, sender_role, sender_color_index, reply_to, reply_to_text, reply_to_sender, created_at, is_edited, reactions }` | Working for text; BROKEN for file uploads |
| `message_edited` | server->client | `{ message_id, text, room_id }` | Working |
| `message_deleted` | server->client | `{ message_id, room_id }` | Working |
| `typing` | server->client | `{ room_id, user_id, username, display_name }` | Working |
| `reaction_update` | server->client | `{ message_id, reactions: [{emoji, count}] }` | Working |
| `mark_read` | client->server | `{ message_id }` | Working |
| `message_read` | server->client | `{ message_id, user_id }` | Working |
| `user_online` | server->client | `{ user_id, username }` | Working |
| `user_offline` | server->client | `{ user_id }` | Working |

### New Event: `upload_progress`

| Field | Type | Description |
|-------|------|-------------|
| `room_id` | number | Room where upload is happening |
| `user_id` | number | Uploader's user ID |
| `username` | string | Uploader's display name |
| `filename` | string | Original filename |
| `percent` | number | 0-100 |

**Direction:** client -> server -> broadcast to `room:{room_id}` (excluding sender)

**Lifecycle:**
1. Client emits `upload_progress` with percent 0-99 during upload
2. On upload complete (100%) or error, client emits `upload_progress` with percent 100
3. Other clients show progress bar, auto-remove after completion

## Critical Fix: File Upload Socket Broadcast

`routes/files.js` must emit `message` event via Socket.IO after inserting the file message to DB. Currently it only returns JSON to the uploading client.

**Fix approach:** Use `req.app.get('io')` to access the io instance (already set in server.js line 100) and emit `message` to the room.
