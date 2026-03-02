# Project Map — ONE21

> Auto-generated overview. Last updated: 2026-03-02

## Tech Stack

| Layer | Tehnologie |
|-------|-----------|
| **Runtime** | Node.js v25.6.1 |
| **Framework** | Express.js v5 |
| **Real-time** | Socket.IO v4 |
| **Database** | SQLite (`better-sqlite3`) · WAL mode |
| **Auth** | JWT (`jsonwebtoken`) + `bcryptjs` |
| **File upload** | `multer` → `uploads/` |
| **Push notif** | `web-push` (VAPID) |
| **Vector search** | `hnswlib-node` + `@xenova/transformers` + LanceDB |
| **Input validation** | `zod` v4 (parțial — auth + rooms + messages) |
| **Process manager** | PM2 (`ecosystem.config.js`) |
| **Reverse proxy** | Caddy (`Caddyfile`) |
| **Frontend** | Vanilla JS + CSS @layer cascade system |
| **AI integration** | Claude API prin route `/api/agent` |

---

## Project Structure

```
onechat/
├── server.js              # Entry point: Express + HTTP + Socket.IO (~300 linii)
├── db/
│   └── init.js            # Schema SQLite, migrations inline, seed
├── routes/
│   ├── auth.js            # POST /login, /register, GET /me
│   ├── rooms.js           # CRUD rooms + members
│   ├── messages.js        # CRUD messages + search
│   ├── files.js           # Upload/download fișiere
│   ├── admin.js           # Panel admin (users, invite, hub cards, agent memory)
│   ├── agent.js           # API pentru agentul AI (fără JWT, cu agent token)
│   ├── join.js            # Flow invite/join cu token
│   ├── push.js            # Web Push subscriptions
│   ├── settings.js        # App settings (admin only, criptate)
│   └── theme.js           # CSS theme dinamic (tokens din DB)
├── middleware/
│   ├── auth.js            # JWT verify, requireAdmin
│   ├── agent.js           # Agent token verify
│   └── permissions.js     # Per-user permission checks granulare
├── lib/
│   ├── vectorstore.js     # Semantic search (HNSWLib + LanceDB + embeddings)
│   ├── events.js          # Event log helper
│   └── crypto.js          # Encrypt/decrypt pentru settings
├── public/
│   ├── index.html         # Home / Hub cards dashboard  → /one21
│   ├── chat.html          # Chat principal              → /one21/hey
│   ├── login.html         # Login                       → /one21/login
│   ├── admin.html         # Admin panel                 → /admin.html
│   ├── one21/
│   │   └── join.html      # Invite flow                 → /one21/join/:token
│   ├── css/
│   │   ├── design-system.css        # Import central — singurul import necesar
│   │   └── layers/
│   │       ├── tokens.css           # @layer tokens — toate variabilele CSS
│   │       ├── base.css             # @layer base — reset + tipografie
│   │       ├── components.css       # @layer components — butoane, input, modal etc.
│   │       └── pages/
│   │           ├── chat.css         # Stiluri specifice chat
│   │           ├── admin.css        # Admin panel
│   │           ├── login.css        # Login page
│   │           ├── join.css         # Join flow
│   │           └── index.css        # Home dashboard
│   ├── js/
│   │   ├── chat.js        # Logic chat UI (774 linii — monolitic)
│   │   ├── rooms.js       # Sidebar rooms + DM (234 linii)
│   │   ├── auth.js        # Token management, logout (51 linii)
│   │   └── system-dialogs.js  # Confirm dialogs custom
│   └── themes/
│       └── test3-tokens.json  # Token set alternativ
├── uploads/               # Fișiere uploadate (MD5 hash ca filename)
├── data/vectorstore/      # Index HNSWLib + LanceDB persistat pe disk
├── scripts/
│   ├── audit-css.sh       # Verifică CSS: fără hex hardcodat, fără inline style
│   └── backup.sh          # Backup DB
├── docs/                  # Documente planificare + deploy
├── concepts/              # Prototipuri UI HTML (nu sunt în producție)
├── ecosystem.config.js    # PM2 config
├── Caddyfile              # Reverse proxy config
└── OneChat_Platform_Spec.md  # Specificații originale platformă
```

---

## API Surface

**Auth:** `Authorization: Bearer <JWT>` pe toate rutele `/api/*`
*(excepție: `/api/join/*` — public, `/api/agent/*` — `X-Agent-Token`)*

### Auth
| Method | Path | Descriere |
|--------|------|-----------|
| POST | `/api/auth/register` | Înregistrare cu invite code |
| POST | `/api/auth/login` | Login → JWT |
| GET | `/api/auth/me` | Profil user curent |

### Rooms
| Method | Path | Descriere |
|--------|------|-----------|
| GET | `/api/rooms` | Lista rooms ale userului |
| POST | `/api/rooms` | Creare room nou |
| GET | `/api/rooms/:id` | Detalii room |
| PUT | `/api/rooms/:id` | Editare room |
| DELETE | `/api/rooms/:id` | Arhivare room |
| POST | `/api/rooms/:id/members` | Adaugă member |
| PUT | `/api/rooms/:id/members/:userId/access-level` | Schimbă access level |
| DELETE | `/api/rooms/:id/members/:userId` | Elimină member |
| GET | `/api/rooms/users/list` | Lista useri pentru member picker |

### Messages
| Method | Path | Descriere |
|--------|------|-----------|
| GET | `/api/rooms/:id/messages` | Paginare mesaje (cursor-based) |
| POST | `/api/rooms/:id/messages` | Trimite mesaj (HTTP fallback) |
| PUT | `/api/messages/:id` | Editare mesaj (owner only) |
| DELETE | `/api/messages/:id` | Ștergere mesaj (owner sau admin) |
| GET | `/api/rooms/:id/search` | Semantic search în room |

### Files
| Method | Path | Descriere |
|--------|------|-----------|
| POST | `/api/rooms/:id/upload` | Upload fișier în room |
| GET | `/api/files/:filename` | Download fișier (auth required) |

### Agent — `X-Agent-Token` header
| Method | Path | Descriere |
|--------|------|-----------|
| GET | `/api/agent/rooms` | Rooms cu agent membership |
| GET | `/api/agent/messages` | Mesaje recente |
| GET | `/api/agent/memory` | Căutare semantică în agent memory |
| POST | `/api/agent/send` | Trimite mesaj ca agent |
| GET | `/api/agent/users` | Lista useri |

### Admin — rol `admin` required
| Method | Path | Descriere |
|--------|------|-----------|
| GET | `/api/admin/stats` | Statistici platformă |
| GET/PUT/DELETE | `/api/admin/users/:id` | Management useri |
| PUT | `/api/admin/users/:id/password` | Reset parolă |
| GET/PUT | `/api/admin/users/:id/permissions` | Permisiuni per user |
| GET/POST/DELETE | `/api/admin/invites` | Management invite-uri |
| GET | `/api/admin/invites/qr` | QR code invite |
| GET | `/api/admin/conversations` | Lista conversații |
| GET | `/api/admin/export/:roomId` | Export room (JSON) |
| GET | `/api/admin/search` | Semantic search global |
| GET | `/api/admin/agent-memory/stats` | Statistici memory agent |
| POST | `/api/admin/agent-memory/prune` | Curățare memory agent |
| GET/POST/PUT/DELETE | `/api/admin/hub-cards` | CRUD hub cards |
| GET/PUT | `/api/admin/settings` | App settings (encrypted) |

### Theme + Join
| Method | Path | Descriere |
|--------|------|-----------|
| GET | `/api/theme/active.css` | Token CSS activi (din DB) — public |
| GET | `/api/join/:token` | Verificare token invitație — public |
| POST | `/api/join/verify` | Activare join cu token — public |

### WebSocket Events (Socket.IO)
**Client → Server:**
`message`, `typing`, `join_room`, `leave_room`, `message_edit`, `message_delete`, `mark_read`, `upload_progress`, `room_updated`, `member_added`, `member_removed`

**Server → Client:**
`message`, `message_edited`, `message_deleted`, `message_read`, `typing`, `upload_progress`, `user_online`, `user_offline`, `member_added`, `member_removed`, `room_updated`, `joined_room`, `error`

---

## Database Schema

**Engine:** SQLite · WAL mode · FK enabled · `db/chat.db`

| Tabel | Câmpuri cheie |
|-------|--------------|
| `users` | `id, username, display_name, role(admin/user/agent), is_online, avatar_url, invited_by` |
| `rooms` | `id, name, type(direct/group/channel), is_archived, created_by` |
| `room_members` | `role(owner/member), access_level(readonly/readandwrite/post_docs)` |
| `messages` | `text, type(text/file/system), reply_to, is_edited, file_url, file_name` |
| `message_reads` | `(message_id, user_id)` — read receipts |
| `invitations` | `code, token, expires_at, used_by, nume, prenume, default_permissions` |
| `push_subscriptions` | VAPID endpoint + keys per user |
| `user_permissions` | KV: `max_messages_per_day, can_send_files, allowed_agents` |
| `room_requests` | Cereri room de la useri: `status(pending/approved/rejected)` |
| `app_settings` | KV store criptat (AES) pentru config platformă |
| `themes` | JSON token sets — unul `is_active=1` la un moment dat |
| `hub_cards` | `action_type(url/room/script/internal_app), action_payload, sort_order` |

**Migrări:** inline în `db/init.js → migrate()` cu `safeAdd` idempotent (fără versioning)

---

## Frontend Architecture

### Pagini
| URL | Fișier sursă | Descriere |
|-----|-------------|-----------|
| `/` sau `/one21` | `index.html` | Home dashboard cu hub cards |
| `/one21/login` | `login.html` | Login form |
| `/one21/join/:token` | `one21/join.html` | Flow invitație |
| `/one21/hey` | `chat.html` | Interfața de chat |
| `/admin.html` | `admin.html` | Panel administrare |

### CSS — @layer Cascade
```
@layer tokens < base < components < pages < overrides
```
- Schimbarea temei = doar `tokens.css` sau `/api/theme/active.css` din DB
- Fiecare pagină importă **exact 2 fișiere**: `design-system.css` + `pages/[pagina].css`
- Audit: `bash scripts/audit-css.sh`

---

## Infrastructure

### Rulare locală
```bash
npm install
npm run dev          # node --watch server.js
# http://localhost:3737
```

### Producție
```bash
npm run pm2:start    # PM2 cu ecosystem.config.js
npm run pm2:logs     # Logs live
```

### Environment Variables
| Variabilă | Scop | Obligatoriu |
|-----------|------|------------|
| `PORT` | Port server (default: 3737) | Nu |
| `JWT_SECRET` | Semnare JWT | **Da** în prod |
| `NODE_ENV` | `production` / `development` | Recomandat |
| `ALLOWED_ORIGINS` | CORS whitelist (virgulă-separated) | Da |
| `JOIN_BASE_URL` | URL bază pentru link-uri invite | Da |
| `AGENT_SECRET` | Token autentificare agent AI | Da |
| `VAPID_PUBLIC_KEY` | Web Push public key | Opțional |
| `VAPID_PRIVATE_KEY` | Web Push private key | Opțional |

---

## Funcționalități implementate

- Auth JWT cu invite-only onboarding (coduri + link-uri token + QR)
- Camere `direct`, `group`, `channel` (channel = broadcast unidirecțional admin→membri)
- Mesagerie real-time Socket.IO: edit, delete, reply, read receipts, typing, reactions
- Upload/download fișiere (multer, acces autentificat, Socket.IO broadcast)
- Client-side image compression (Canvas API, max 1280px, JPEG 0.82)
- Live upload progress bar (socket broadcast to room members)
- DM auto-redirect (incoming DM switches to that conversation)
- Agent AI integrat — trimite mesaje, citește rooms, memory semantică
- Semantic search cu embeddings locale + HNSWLib
- Agent memory (LanceDB) — context persistent per agent
- Web Push notifications pentru useri offline
- Teme dinamice — tokens JSON stocați în DB, aplicați ca CSS vars
- Hub cards dashboard — linkuri/rooms/acțiuni configurabile din admin
- Permisiuni granulare per user
- Admin panel complet: useri, invite-uri, rooms, export, settings criptat
- CSS @layer architecture

---

## Probleme de arhitectură identificate

### Prioritate înaltă
| # | Problemă | Fișier | Impact |
|---|----------|--------|--------|
| 1 | **`server.js` monolitic** — Socket.IO handlers already extracted to `socket/handlers/` but server.js still ~107 lines | `server.js` | Moderate |
| 2 | **`chat.js` monolitic** — ~850 linii fără module (grew with compression + upload progress) | `public/js/chat.js` | Scalabilitate zero |
| 3 | **Agent route fără JWT** — dacă `AGENT_SECRET` nu e setat în `.env`, `/api/agent/*` e deschis | `routes/agent.js` | **Securitate** |
| 4 | **Migrări fără versioning** — `migrate()` e un bloc de ALTER TABLE, fără rollback | `db/init.js` | Risc la deploy |

### Prioritate medie
| # | Problemă | Detaliu |
|---|----------|---------|
| 5 | **Routing suprapus** — `messageRoutes` și `roomRoutes` mount-ate ambele pe `/api/rooms` | `server.js:101-106` |
| 6 | **Validare Zod incompletă** — lipsește în `admin.js`, `agent.js`, `files.js` | Inconsistență (Zod v4 `.issues` fix applied to existing routes) |
| 7 | **No profile page** — userul nu poate edita display name, avatar, parolă proprie | UX gap |

### Prioritate scăzută
| # | Problemă |
|---|----------|
| 8 | Rate limiting **doar pe REST** — Socket.IO events nu sunt limitate |
| 9 | **Zero teste automate** |

---

## Structură recomandată (refactoring)

```
onechat/
├── server.js                    # SLIM — bootstrap, mount routes, mount socket (~40 linii)
├── socket/
│   ├── index.js                 # Socket.IO setup + auth middleware
│   └── handlers/
│       ├── messages.js          # on('message'), on('message_edit'), on('message_delete')
│       ├── presence.js          # on('connect'), on('disconnect')
│       └── rooms.js             # on('join_room'), on('member_added') etc.
├── db/
│   ├── init.js                  # getDb() — schema + seed
│   └── migrations/
│       ├── 001_initial.sql
│       ├── 002_hub_cards.sql
│       └── runner.js            # Versioning cu tabel `schema_version`
├── routes/                      # (neschimbat + validare Zod completă)
├── middleware/                  # (neschimbat)
├── lib/                         # (neschimbat)
├── public/
│   └── js/
│       ├── chat/
│       │   ├── index.js         # Entry point + init
│       │   ├── socket.js        # Conexiune + event handlers
│       │   ├── messages.js      # Render + edit + delete
│       │   ├── upload.js        # File upload
│       │   └── reply.js         # Reply thread
│       ├── rooms.js
│       ├── auth.js
│       └── system-dialogs.js
│   └── css/                     # (neschimbat — arhitectura @layer e solidă)
└── tests/
    ├── api/                     # REST tests (supertest)
    └── socket/                  # Socket.IO event tests
```
