# Project Map — One21 (OneChat)

> Auto-generated overview of the codebase. Last updated: 2026-02-21

## Tech Stack

- **Runtime:** Node.js v22.15.0
- **Backend:** Express.js 5.2.1 + Socket.IO 4.8.3
- **Database:** SQLite via better-sqlite3 12.6.2 (WAL mode)
- **Auth:** JWT (jsonwebtoken 9.0.3) + bcryptjs 3.0.3
- **Frontend:** Vanilla JS (no framework), CSS-only design system
- **Real-time:** Socket.IO (WebSocket + polling fallback)
- **Planned infra:** PM2 (process mgr), Caddy (reverse proxy + SSL)

## Project Structure

```
/
├── server.js              # Express + Socket.IO server (128 lines)
├── package.json           # Dependencies & metadata
├── OneChat_Platform_Spec.md  # Full platform specification
├── conversation.json      # Seed conversation data
│
├── db/
│   ├── init.js            # Schema creation, pragmas, seed data (142 lines)
│   └── chat.db            # SQLite database + WAL files
│
├── middleware/
│   └── auth.js            # JWT verification + role-based access (29 lines)
│
├── routes/
│   ├── auth.js            # Login/register/me endpoints (117 lines)
│   ├── rooms.js           # Room CRUD + membership (94 lines)
│   ├── messages.js        # Message CRUD + pagination (85 lines)
│   └── admin.js           # Invite codes + user management (49 lines)
│
├── public/
│   ├── login.html         # Login/register page (312 lines)
│   ├── chat.html          # Main 3-panel chat interface (200+ lines)
│   ├── showcase.html      # Component gallery
│   ├── css/
│   │   ├── theme.css      # Design tokens (218 lines)
│   │   └── components.css # 15+ reusable components (1228 lines)
│   └── js/
│       ├── auth.js        # Auth module, token storage (44 lines)
│       └── chat.js        # Chat client, Socket.IO, UI (307 lines)
│
├── concepts/              # 12 UI design concepts (HTML prototypes)
│
└── docs/plans/            # Design system planning docs
```

## API Surface

### Authentication
- `POST /api/auth/login` — Login with username/password, returns JWT (7-day expiry)
- `POST /api/auth/register` — Register with invite code, returns JWT
- `GET  /api/auth/me` — Current user info (requires auth)

### Rooms
- `GET  /api/rooms` — List user's rooms (with last message, member count)
- `POST /api/rooms` — Create room (type: direct/group/channel)
- `GET  /api/rooms/:id` — Room details + member list (requires membership)

### Messages
- `GET  /api/rooms/:id/messages?before=ID&limit=50` — Paginated messages
- `POST /api/rooms/:id/messages` — Send message (text/file/system)

### Admin (requires admin role)
- `POST /api/admin/invites` — Generate invite code (8-char uppercase)
- `GET  /api/admin/invites` — List all invitations
- `GET  /api/admin/users` — List all users

### Socket.IO Events
| Direction | Event | Payload | Description |
|-----------|-------|---------|-------------|
| Client→Server | `join_room` | `{ roomId }` | Join a room |
| Client→Server | `message` | `{ room_id, text, type, reply_to }` | Send message |
| Client→Server | `typing` | `{ room_id }` | Typing indicator |
| Server→Client | `message` | Full message object | New message broadcast |
| Server→Client | `typing` | `{ user_id, username }` | Typing notification |

## Database Schema

**5 tables** in SQLite with WAL mode + foreign keys:

- **users** — id, username, display_name, password_hash, role (admin/user/agent), is_online, last_seen
- **invitations** — code (8-char), created_by, used_by, expires_at
- **rooms** — id, name, description, type (direct/group/channel), created_by
- **room_members** — room_id, user_id, role (owner/member), PK(room_id, user_id)
- **messages** — id, room_id, sender_id, text, type (text/file/system), reply_to

**Indexes:** messages(room_id, created_at), room_members(user_id), invitations(code)

**Seed data:** admin user, Claude AI agent, 2 rooms, 3 messages, 1 invite code

## Frontend Architecture

**Design:** Navy glassmorphism theme with emerald (#10b981) accent + cyan (#00ccff) brand color

**Pages:**
- `/login.html` — Login/register with invite code (glassmorphism card)
- `/chat.html` — 3-panel layout: nav (72px) + sidebar (320px) + main + info panel (300px)

**JS Architecture (Vanilla, IIFE pattern):**
- `Auth` module — Token management, API wrapper, auto-logout on 401
- `Chat` client — Socket.IO connection, room/message management, typing indicators

**Design System (CSS-only, token-first):**
- 218 lines of design tokens (colors, spacing, typography, radii)
- 15+ components: Avatar, Badge, Button, Input, ChatItem, MessageBubble, Nav, Sidebar, etc.
- Effects: Aurora glow background, fade-in animations, typing bounce, glassmorphism

## Infrastructure

### Local Development
```bash
npm install
node server.js
# Server runs on http://localhost:3737
```

### Default Credentials
| User | Password | Role |
|------|----------|------|
| admin | admin123 | admin |
| claude | claude-agent-secret | agent |

### Environment Variables
| Variable | Purpose | Required | Default |
|----------|---------|----------|---------|
| JWT_SECRET | Token signing key | Yes (prod) | `one21-dev-secret-change-in-prod` |
| PORT | Server port | No | 3737 |

### Target Deployment
- Mac Mini at 192.168.10.42
- Public IP: 31.153.116.47 (needs port forwarding)
- PM2 for process management
- Caddy for reverse proxy + automatic SSL

## Testing

- **Framework:** None configured
- **Run tests:** `npm test` (currently exits with error — no tests written)

## Current Features (Implemented)

- SQLite database with full relational schema
- JWT authentication with invite-code registration
- Multi-room real-time chat via Socket.IO
- Message persistence with cursor-based pagination
- Role system: admin, user, agent
- User online/offline presence tracking
- Typing indicators (3-dot animation)
- Complete CSS design system (15+ components)
- Login page with glassmorphism UI
- 3-panel chat interface
- Room member management
- Admin invite code generation

## Planned Features (Not Yet Implemented)

- File upload/download (multer)
- Message editing & deletion
- In-room search
- Read receipts tracking (DB + UI)
- Admin dashboard
- Conversation export (JSON/PDF)
- PM2 process management
- Caddy reverse proxy + SSL
- Browser push notifications
- Rate limiting (30 msgs/min)
- Backup automation
- Claude AI agent specialized API

## Known Limitations

- No .env file — JWT secret hardcoded for dev
- CORS set to `*` (open to all origins)
- No rate limiting on any endpoint
- No input validation library (manual checks only)
- No test suite
- No CI/CD pipeline
- bcrypt rounds: 10 in auth routes vs spec says 12
- No message editing/deletion endpoints
- No file upload support
- Socket.IO auto-joins ALL rooms on connect (no lazy loading)
- localStorage for auth tokens (vulnerable to XSS)
