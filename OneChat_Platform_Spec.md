# OneChat Platform — General Specifications

## 1. Infrastructure

| Item | Details |
|------|---------|
| **Server** | Mac Mini (macOS, arm64) in LAN |
| **IP** | 192.168.10.42 |
| **SSH** | `victorsafta@192.168.10.42` / password: `Assecca111213` |
| **Node.js** | v22.15.0 at `~/node/bin/node` (add `~/node/bin` to PATH) |
| **Project dir** | `~/onechat/` |
| **Port** | 3737 |
| **Public IP** | 31.153.116.47 (needs port forward 3737 TCP → 192.168.10.42:3737) |
| **Current state** | Prototype running (PID 80278), single-room, no auth |

---

## 2. Current Prototype

The working prototype at `~/onechat/` has:

- **server.js** — Express + Socket.IO, serves HTML inline, REST API for Claude
- **index.html** — Dark mode chat UI, responsive, Socket.IO client
- **conversation.json** — Flat JSON array of all messages
- **API**: `GET /api/messages?since=N` and `POST /api/send` (for Claude agent)
- **Socket.IO events**: `message`, `typing`
- Two participants: "Claude" (AI analyst) and "Claudiu" (founder)

---

## 3. Target Architecture

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22 |
| Framework | Express.js |
| Real-time | Socket.IO |
| Database | SQLite via `better-sqlite3` |
| Auth | JWT (jsonwebtoken) + bcrypt |
| File upload | multer (store in `~/onechat/uploads/`) |
| Process manager | PM2 |
| Reverse proxy | Caddy (auto SSL with Let's Encrypt) |
| Frontend | Vanilla JS + CSS (no framework, keep it lightweight) |

### Directory Structure

```
~/onechat/
├── server.js          # Main server entry
├── db/
│   └── chat.db        # SQLite database
├── routes/
│   ├── auth.js        # Login, register, JWT
│   ├── rooms.js       # Room CRUD
│   ├── messages.js    # Message CRUD + search
│   ├── files.js       # Upload/download
│   ├── admin.js       # Admin endpoints
│   └── agent.js       # Claude agent API
├── middleware/
│   ├── auth.js        # JWT verification
│   └── admin.js       # Admin role check
├── public/
│   ├── index.html     # Login page
│   ├── chat.html      # Main chat UI
│   ├── admin.html     # Admin dashboard
│   ├── css/
│   └── js/
├── uploads/           # Uploaded files
├── package.json
└── ecosystem.config.js  # PM2 config
```

---

## 4. Database Schema (SQLite)

### users
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| username | TEXT UNIQUE | Login name |
| display_name | TEXT | Shown in chat |
| password_hash | TEXT | bcrypt |
| role | TEXT | 'admin', 'user', 'agent' |
| avatar_url | TEXT | Optional |
| is_online | INTEGER | 0/1 |
| last_seen | TEXT | ISO timestamp |
| created_at | TEXT | ISO timestamp |

### rooms
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| name | TEXT | Room display name |
| description | TEXT | Optional |
| type | TEXT | 'direct', 'group', 'channel' |
| created_by | INTEGER FK | → users.id |
| is_archived | INTEGER | 0/1 |
| created_at | TEXT | ISO timestamp |

### room_members
| Column | Type | Notes |
|--------|------|-------|
| room_id | INTEGER FK | → rooms.id |
| user_id | INTEGER FK | → users.id |
| role | TEXT | 'owner', 'member' |
| joined_at | TEXT | ISO timestamp |
| PRIMARY KEY | (room_id, user_id) | |

### messages
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| room_id | INTEGER FK | → rooms.id |
| sender_id | INTEGER FK | → users.id |
| text | TEXT | Message content |
| type | TEXT | 'text', 'file', 'system' |
| file_url | TEXT | If type='file' |
| file_name | TEXT | Original filename |
| reply_to | INTEGER FK | → messages.id (nullable) |
| is_edited | INTEGER | 0/1 |
| created_at | TEXT | ISO timestamp |

### message_reads
| Column | Type | Notes |
|--------|------|-------|
| message_id | INTEGER FK | → messages.id |
| user_id | INTEGER FK | → users.id |
| read_at | TEXT | ISO timestamp |
| PRIMARY KEY | (message_id, user_id) | |

### Default seed data:
- **Admin user**: username `admin`, role `admin`
- **Claude agent**: username `claude`, display_name `Claude AI Analyst`, role `agent`
- **Claudiu**: username `claudiu`, display_name `Claudiu`, role `user`
- **Default room**: "Interviu Business" with all three members

---

## 5. API Endpoints

### Auth
- `POST /api/auth/login` — { username, password } → { token, user }
- `POST /api/auth/register` — { username, password, display_name } → { token, user } (admin only or open)
- `GET /api/auth/me` — Current user info (JWT required)

### Rooms
- `GET /api/rooms` — List user's rooms
- `POST /api/rooms` — Create room (admin)
- `GET /api/rooms/:id` — Room details + members
- `POST /api/rooms/:id/members` — Add member (admin)
- `DELETE /api/rooms/:id/members/:userId` — Remove member

### Messages
- `GET /api/rooms/:id/messages?before=ID&limit=50` — Paginated messages
- `POST /api/rooms/:id/messages` — Send message
- `PUT /api/messages/:id` — Edit message (own only)
- `DELETE /api/messages/:id` — Delete message (own or admin)
- `GET /api/rooms/:id/search?q=text` — Search in room

### Files
- `POST /api/rooms/:id/upload` — Upload file (multipart)
- `GET /api/files/:filename` — Download file

### Agent (Claude API — no JWT, uses API key header)
- `GET /api/agent/messages?room=ID&since=N` — Read new messages
- `POST /api/agent/send` — { room_id, text } → Send as Claude
- `GET /api/agent/rooms` — List all rooms

### Admin
- `GET /api/admin/stats` — User count, message count, active rooms
- `GET /api/admin/users` — List all users
- `PUT /api/admin/users/:id` — Edit user (role, ban)
- `GET /api/admin/conversations` — All rooms with last message
- `GET /api/admin/export/:roomId` — Export room as JSON/PDF

---

## 6. Socket.IO Events

### Client → Server
- `join_room` { room_id } — Join a room
- `leave_room` { room_id } — Leave a room
- `message` { room_id, text, reply_to? } — Send message
- `typing` { room_id } — Typing indicator
- `mark_read` { message_id } — Mark as read

### Server → Client
- `message` { full message object } — New message
- `typing` { room_id, user } — Someone typing
- `user_online` { user_id } — User came online
- `user_offline` { user_id } — User went offline
- `message_read` { message_id, user_id } — Read receipt

---

## 7. Frontend Pages

### Login (`/`)
- Username + password form
- Clean, centered design matching current dark theme
- JWT stored in localStorage

### Chat (`/chat`)
- Left sidebar: room list, user status, settings
- Center: message area with infinite scroll
- Right (optional): room members, search
- Mobile: sidebar hidden, swipe to reveal
- Dark mode default, light mode toggle
- Features: typing indicator, read receipts (checkmarks), file preview, reply threads

### Admin (`/admin`)
- Dashboard: stats cards (users, messages, rooms, active today)
- User management table
- Room/conversation browser
- Export functionality (JSON, PDF)

---

## 8. Features by Priority

### Sprint 1 — Core (Week 1)
- SQLite database setup with all tables
- JWT authentication (login/register)
- Multi-room support
- Message persistence and pagination
- Socket.IO with room-based events
- Agent API for Claude interaction
- Basic responsive UI

### Sprint 2 — Polish (Week 2)
- File upload and preview (images, PDFs)
- Read receipts (seen indicators)
- Message editing and deletion
- Search within rooms
- Online/offline status
- Dark/light mode toggle

### Sprint 3 — Admin (Week 3)
- Admin dashboard with stats
- User management (create, edit roles, ban)
- Conversation export (JSON, PDF)
- Room management (create, archive, assign members)

### Sprint 4 — Production (Week 4)
- PM2 process management
- Caddy reverse proxy with auto SSL
- Domain setup (oneonechat.investorhood.ro or similar)
- Notifications (browser push via Service Worker)
- Rate limiting and input sanitization
- Backup script for SQLite DB

---

## 9. Deployment

### Install dependencies on Mac Mini
```bash
export PATH="$HOME/node/bin:$PATH"
cd ~/onechat
npm install express socket.io better-sqlite3 jsonwebtoken bcryptjs multer cors helmet
npm install -g pm2
```

### Run with PM2
```bash
pm2 start server.js --name onechat
pm2 save
pm2 startup  # auto-start on reboot
```

### Caddy reverse proxy (optional, for SSL)
```
onechat.investorhood.ro {
    reverse_proxy localhost:3737
}
```

### Router port forward
- Forward port 443 (if Caddy) or 3737 (direct) TCP → 192.168.10.42

---

## 10. Design Guidelines

- **Color scheme**: Keep current dark theme (bg: #0a0a0f, surface: #13131a, accent: #6c5ce7)
- **Claude messages**: Left-aligned, warm tone color (#d4a574)
- **User messages**: Right-aligned, cool blue (#74b9ff)
- **Typography**: System font stack (-apple-system, BlinkMacSystemFont, 'Segoe UI')
- **Mobile first**: Must work well on phone screens
- **Animations**: Subtle fade-in for messages, typing bounce indicator
- **Language**: Romanian UI labels (Mesaje, Setări, Căutare, etc.)

---

## 11. Security Notes

- Hash passwords with bcrypt (12 rounds)
- JWT tokens expire in 7 days
- Agent API uses separate API key (not JWT)
- Sanitize all user input (XSS prevention)
- Rate limit: 30 messages/minute per user
- File upload: max 10MB, allowed types: images, PDFs, docs
- CORS: restrict to known origins in production
