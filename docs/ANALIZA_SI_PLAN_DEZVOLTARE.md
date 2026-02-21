# One21 (OneChat) — Analiza Completă & Plan de Dezvoltare

> Document generat: 2026-02-21
> Scop: Analiza detaliată a stadiului actual + planificarea dezvoltării până la producție

---

## Partea I: Stadiul Actual al Dezvoltării

### 1. Ce Avem Implementat (Funcțional)

#### Backend (server.js + routes/)

| Componenta | Status | Fișier | Linii | Observații |
|------------|--------|--------|-------|------------|
| Express server | **Complet** | server.js | 128 | Port 3737, static files, JSON parsing |
| Socket.IO | **Complet** | server.js | 70 linii | Auth, rooms, mesaje, typing |
| DB Schema | **Complet** | db/init.js | 142 | 5 tabele, indexuri, seed data |
| Auth (login) | **Complet** | routes/auth.js | 34 linii | JWT 7d, bcrypt, online status |
| Auth (register) | **Complet** | routes/auth.js | 54 linii | Invite code, tranzacție |
| Auth (me) | **Complet** | routes/auth.js | 12 linii | Current user info |
| Room list | **Complet** | routes/rooms.js | 14 linii | Cu last_message, member_count |
| Room create | **Complet** | routes/rooms.js | 35 linii | Tranzacție, membri inițiali |
| Room details | **Complet** | routes/rooms.js | 22 linii | Cu membri + online status |
| Messages (get) | **Complet** | routes/messages.js | 39 linii | Paginare cursor-based |
| Messages (send) | **Complet** | routes/messages.js | 28 linii | Cu reply_to support |
| Admin invites | **Complet** | routes/admin.js | 49 linii | Generate + list |
| Admin users | **Complet** | routes/admin.js | 8 linii | List all users |
| JWT Middleware | **Complet** | middleware/auth.js | 29 | Auth + role check |

#### Frontend (public/)

| Componenta | Status | Fișier | Observații |
|------------|--------|--------|------------|
| Login page | **Complet** | login.html | Glassmorphism, login/register toggle |
| Chat layout | **Complet** | chat.html | 3 panouri: nav + sidebar + main + info |
| Auth module | **Complet** | js/auth.js | Token management, API wrapper |
| Chat client | **Complet** | js/chat.js | Socket.IO, rooms, messages, typing |
| Design system | **Complet** | css/theme.css + components.css | 1446 linii CSS, 15+ componente |
| Showcase | **Complet** | showcase.html | Component gallery |

#### Design System

| Token/Component | Status |
|-----------------|--------|
| Color palette (navy glassmorphism) | **Complet** |
| Typography (Inter + system fonts) | **Complet** |
| Spacing scale (4-48px) | **Complet** |
| Avatar (sm/md/lg + status dot) | **Complet** |
| Badges (4 variante) | **Complet** |
| Buttons (5 stiluri) | **Complet** |
| Input fields (focus/error) | **Complet** |
| Chat items (sidebar rows) | **Complet** |
| Message bubbles (sent/received/system) | **Complet** |
| Navigation bar | **Complet** |
| Sidebar panel | **Complet** |
| Compose bar | **Complet** |
| Typing indicator | **Complet** |
| File card | **Complet** |
| Media grid | **Complet** |
| Aurora glow effects | **Complet** |

---

### 2. Ce NU Avem Implementat (Gap Analysis vs Spec)

Am comparat codul actual cu `OneChat_Platform_Spec.md`. Iată diferențele:

#### 2.1 Scheme DB Lipsă

| Tabel/Coloană din Spec | Status | Impact |
|-------------------------|--------|--------|
| `users.avatar_url` | **Lipsă** | Nu se pot seta avatare custom |
| `rooms.is_archived` | **Lipsă** | Nu se pot arhiva camerele |
| `messages.file_url` | **Lipsă** | Nu se pot atașa fișiere |
| `messages.file_name` | **Lipsă** | Nu se pot afișa numele fișierelor |
| `messages.is_edited` | **Lipsă** | Nu se poate ști dacă mesajul a fost editat |
| `message_reads` (tabel) | **Lipsă total** | Read receipts nu funcționează real |
| User `claudiu` din seed | **Lipsă** | Spec cere 3 useri, avem doar 2 |

#### 2.2 API Endpoints Lipsă

| Endpoint din Spec | Prioritate | Complexitate |
|-------------------|-----------|--------------|
| `POST /api/rooms/:id/members` — Add member | **Medie** | Mică |
| `DELETE /api/rooms/:id/members/:userId` — Remove member | **Medie** | Mică |
| `PUT /api/messages/:id` — Edit message | **Mare** | Medie |
| `DELETE /api/messages/:id` — Delete message | **Mare** | Medie |
| `GET /api/rooms/:id/search?q=text` — Search | **Medie** | Medie |
| `POST /api/rooms/:id/upload` — File upload | **Mare** | Mare |
| `GET /api/files/:filename` — File download | **Mare** | Medie |
| `GET /api/agent/messages` — Agent read | **Mare** | Mică |
| `POST /api/agent/send` — Agent send | **Mare** | Mică |
| `GET /api/agent/rooms` — Agent rooms | **Mare** | Mică |
| `GET /api/admin/stats` — Dashboard stats | **Medie** | Mică |
| `PUT /api/admin/users/:id` — Edit user | **Medie** | Mică |
| `GET /api/admin/conversations` — All rooms | **Mică** | Mică |
| `GET /api/admin/export/:roomId` — Export | **Mică** | Mare |

#### 2.3 Socket.IO Events Lipsă

| Event din Spec | Prioritate |
|----------------|-----------|
| `leave_room` (client→server) | Mică |
| `mark_read` (client→server) | Mare |
| `user_online` (server→client) | Mare |
| `user_offline` (server→client) | Mare |
| `message_read` (server→client) | Mare |

#### 2.4 Frontend Lipsă

| Pagina/Feature | Prioritate | Complexitate |
|---------------|-----------|--------------|
| Admin dashboard (`/admin`) | **Mare** | Mare |
| Message editing UI | **Mare** | Medie |
| Message deletion UI | **Mare** | Mică |
| Message search UI | **Medie** | Medie |
| File upload/preview UI | **Mare** | Mare |
| Read receipts reale (nu fake checkmarks) | **Mare** | Medie |
| Reply thread UI | **Medie** | Mare |
| Online/offline broadcast live | **Mare** | Mică |
| Dark/light mode toggle | **Mică** | Medie |
| Mobile responsive (swipe sidebar) | **Medie** | Mare |
| Infinite scroll (load more on scroll up) | **Mare** | Medie |

#### 2.5 Infrastructură Lipsă

| Componentă | Prioritate |
|-----------|-----------|
| .env file + environment config | **Critică** |
| PM2 config (ecosystem.config.js) | **Mare** |
| Caddy reverse proxy config | **Mare** |
| SSL/HTTPS setup | **Mare** |
| Rate limiting | **Mare** |
| Input sanitization library | **Mare** |
| Error handling global | **Mare** |
| Logging structurat | **Medie** |
| Test suite | **Medie** |
| CI/CD pipeline | **Mică** |
| Backup script | **Medie** |
| uploads/ directory setup | **Mare** |

---

### 3. Probleme Tehnice Identificate

#### 3.1 Securitate

| Problema | Severitate | Locație | Soluție |
|----------|-----------|---------|---------|
| JWT secret hardcodat | **Critică** | middleware/auth.js:3 | .env file |
| SSH password in spec file | **Critică** | OneChat_Platform_Spec.md:9 | Șterge din repo |
| CORS `*` (open) | **Mare** | server.js:19 | Restrict la domeniu |
| bcrypt 10 rounds (spec zice 12) | **Medie** | routes/auth.js:39, db/init.js:83 | Crește la 12 |
| localStorage pentru JWT | **Medie** | public/js/auth.js | Adaugă httpOnly cookie alternativ |
| Lipsă rate limiting | **Mare** | - | express-rate-limit |
| Lipsă input validation | **Mare** | routes/ | joi/zod |
| Lipsă helmet headers | **Mare** | - | helmet middleware |
| Default admin password `admin123` | **Mare** | db/init.js:83 | Force change on first login |

#### 3.2 Performanță

| Problema | Severitate | Locație |
|----------|-----------|---------|
| Auto-join ALL rooms on connect | **Medie** | server.js:61-65 |
| Room list query cu 3 subqueries corelate | **Medie** | routes/rooms.js:11-20 |
| Re-render sidebar complet la fiecare mesaj | **Medie** | public/js/chat.js:278 |
| Nu există caching | **Mică** | - |

#### 3.3 Bugs & Inconsistențe

| Problema | Locație |
|----------|---------|
| Read receipts fake (checkmarks hardcodate) | chat.js:172 — afișează mereu `✓✓` |
| Typing indicator nu arată cine scrie | chat.js:203 — nu afișează username |
| Mesajele de tip `file` nu au UI de rendering | chat.js:158-187 |
| Timestamps stocate UTC dar afișate fără timezone handling | chat.js:283-293 |
| No error handling pe Socket.IO events | server.js:80-113 |
| Room create nu validează `type` | routes/rooms.js:34 |

---

## Partea II: Plan Detaliat de Dezvoltare

### Filozofie

Dezvoltarea se bazează pe principiul **incremental delivery**: fiecare sprint livrează funcționalitate completă și testabilă. Ordinea este aleasă ca fiecare sprint să construiască pe baza precedentului.

---

### Sprint 1: Securitate & Stabilitate (Fundația)

**Obiectiv:** Fix toate problemele de securitate și stabilizare înainte de a adăuga features noi.

| # | Task | Fișiere | Efort | Detalii |
|---|------|---------|-------|---------|
| 1.1 | Creare `.env` + `dotenv` | `.env`, `server.js`, `middleware/auth.js` | 30min | JWT_SECRET, PORT, NODE_ENV |
| 1.2 | `.gitignore` update | `.gitignore` | 5min | Adaugă `.env`, `uploads/`, `*.db*` |
| 1.3 | Șterge credențiale din spec | `OneChat_Platform_Spec.md` | 5min | Elimină SSH password |
| 1.4 | Adaugă `helmet` middleware | `server.js` | 15min | Security headers |
| 1.5 | Adaugă `express-rate-limit` | `server.js`, `routes/auth.js` | 30min | 30 msg/min, 10 login attempts/15min |
| 1.6 | Restrict CORS | `server.js` | 15min | Doar domeniul de producție + localhost |
| 1.7 | Input validation cu `zod` | `routes/*.js` | 2h | Validare pe toate endpointurile |
| 1.8 | Crește bcrypt la 12 rounds | `routes/auth.js`, `db/init.js` | 10min | Conform spec |
| 1.9 | Global error handler | `server.js` | 30min | Try/catch + middleware |
| 1.10 | Logging structurat | `server.js` | 1h | Winston/pino, request logging |

**Estimare:** ~6 ore
**Dependențe:** Niciuna
**Livrabil:** Aplicație securizată, fără credențiale expuse

---

### Sprint 2: Schema DB Completă + Read Receipts + Online Status

**Obiectiv:** Alinierea DB-ului cu specificația și implementare funcționalități realtime reale.

| # | Task | Fișiere | Efort | Detalii |
|---|------|---------|-------|---------|
| 2.1 | Migrație DB: adaugă coloane lipsă | `db/init.js` (sau nou `db/migrate.js`) | 1h | avatar_url, is_archived, file_url, file_name, is_edited |
| 2.2 | Creare tabel `message_reads` | `db/init.js` | 30min | PK(message_id, user_id) + read_at |
| 2.3 | Adaugă user `claudiu` în seed | `db/init.js` | 15min | Conform spec |
| 2.4 | Socket.IO: `user_online`/`user_offline` broadcast | `server.js` | 1h | Emit la connect/disconnect |
| 2.5 | Socket.IO: `mark_read` event | `server.js` | 1h | Insert în message_reads, broadcast |
| 2.6 | Socket.IO: `leave_room` event | `server.js` | 15min | Socket.leave() |
| 2.7 | Frontend: afișare online/offline live | `public/js/chat.js` | 1h | Actualizare avatar status dots |
| 2.8 | Frontend: read receipts reale | `public/js/chat.js` | 2h | Mark-as-read on scroll, update checkmarks |
| 2.9 | Frontend: typing cu username | `public/js/chat.js` | 30min | Afișează "Victor scrie..." |

**Estimare:** ~8 ore
**Dependențe:** Sprint 1 completat
**Livrabil:** Chat cu prezență reală și read receipts funcționale

---

### Sprint 3: Mesaje — Edit, Delete, Search

**Obiectiv:** Completarea CRUD-ului pe mesaje + căutare.

| # | Task | Fișiere | Efort | Detalii |
|---|------|---------|-------|---------|
| 3.1 | API: `PUT /api/messages/:id` — edit | `routes/messages.js` | 1h | Verificare owner, set is_edited=1 |
| 3.2 | API: `DELETE /api/messages/:id` — delete | `routes/messages.js` | 1h | Owner sau admin |
| 3.3 | API: `GET /api/rooms/:id/search?q=text` | `routes/messages.js` | 1h | FTS5 sau LIKE search |
| 3.4 | Socket.IO: broadcast `message_edited` | `server.js` | 30min | Emit la edit |
| 3.5 | Socket.IO: broadcast `message_deleted` | `server.js` | 30min | Emit la delete |
| 3.6 | Frontend: edit message UI | `public/js/chat.js` | 2h | Context menu, edit mode, save |
| 3.7 | Frontend: delete message UI | `public/js/chat.js` | 1h | Context menu, confirm, remove DOM |
| 3.8 | Frontend: search UI | `public/js/chat.js`, `chat.html` | 2h | Search bar, results list, navigate to message |
| 3.9 | Frontend: infinite scroll (load older) | `public/js/chat.js` | 2h | Scroll up → load messages before |

**Estimare:** ~11 ore
**Dependențe:** Sprint 2 (tabelul messages cu is_edited)
**Livrabil:** Mesaje editabile, ștergibile, căutabile + infinite scroll

---

### Sprint 4: Room Management + Members

**Obiectiv:** Completarea funcționalității de room management.

| # | Task | Fișiere | Efort | Detalii |
|---|------|---------|-------|---------|
| 4.1 | API: `POST /api/rooms/:id/members` | `routes/rooms.js` | 1h | Adaugă membru (admin/owner) |
| 4.2 | API: `DELETE /api/rooms/:id/members/:userId` | `routes/rooms.js` | 1h | Elimină membru |
| 4.3 | API: `PUT /api/rooms/:id` — edit room | `routes/rooms.js` | 30min | Nume, descriere, arhivare |
| 4.4 | Frontend: create room modal | `public/js/chat.js`, `chat.html` | 2h | Form cu nume, tip, selectare membri |
| 4.5 | Frontend: manage members UI | `public/js/chat.js` | 2h | Add/remove din info panel |
| 4.6 | Frontend: room settings | `chat.html`, `chat.js` | 1h | Edit name/description |
| 4.7 | Direct messages (1:1) | `routes/rooms.js`, `chat.js` | 2h | Create DM, detectare existing |

**Estimare:** ~10 ore
**Dependențe:** Sprint 3
**Livrabil:** Management complet al camerelor și membrilor

---

### Sprint 5: File Upload & Media

**Obiectiv:** Upload, download, preview de fișiere.

| # | Task | Fișiere | Efort | Detalii |
|---|------|---------|-------|---------|
| 5.1 | Setup multer + uploads/ dir | `server.js`, `routes/files.js` | 1h | Max 10MB, whitelist types |
| 5.2 | API: `POST /api/rooms/:id/upload` | `routes/files.js` | 2h | Multer, store, create message type=file |
| 5.3 | API: `GET /api/files/:filename` | `routes/files.js` | 30min | Serve static + auth check |
| 5.4 | Frontend: upload button + drag&drop | `chat.html`, `chat.js` | 3h | Input file, drag area, progress bar |
| 5.5 | Frontend: image preview in messages | `chat.js`, `components.css` | 2h | Inline thumbnail, click to expand |
| 5.6 | Frontend: file card rendering | `chat.js` | 1h | Icon + name + size + download |
| 5.7 | Frontend: PDF/doc preview | `chat.js` | 1h | Icon preview, download link |

**Estimare:** ~11 ore
**Dependențe:** Sprint 4 (room membership checks)
**Livrabil:** Upload/download/preview complet

---

### Sprint 6: Claude Agent API

**Obiectiv:** API dedicat pentru agentul Claude AI.

| # | Task | Fișiere | Efort | Detalii |
|---|------|---------|-------|---------|
| 6.1 | Agent API key middleware | `middleware/agent.js` | 1h | Header: X-Agent-Key, separate from JWT |
| 6.2 | `GET /api/agent/rooms` — list rooms | `routes/agent.js` | 30min | Camerele unde e membru |
| 6.3 | `GET /api/agent/messages?room=ID&since=N` | `routes/agent.js` | 1h | Mesaje noi dintr-un room |
| 6.4 | `POST /api/agent/send` — send message | `routes/agent.js` | 1h | Trimite + emit via Socket.IO |
| 6.5 | Agent presence management | `server.js` | 30min | Claude apare online când e activ |
| 6.6 | Webhook/polling strategy | `routes/agent.js` | 1h | Opțiuni: polling interval sau webhook notify |

**Estimare:** ~5 ore
**Dependențe:** Sprint 2 (Socket.IO events)
**Livrabil:** Claude poate citi și trimite mesaje programatic

---

### Sprint 7: Admin Dashboard

**Obiectiv:** Pagina de administrare completă.

| # | Task | Fișiere | Efort | Detalii |
|---|------|---------|-------|---------|
| 7.1 | `GET /api/admin/stats` — dashboard stats | `routes/admin.js` | 1h | Users, messages, rooms, active today |
| 7.2 | `PUT /api/admin/users/:id` — edit user | `routes/admin.js` | 1h | Role, ban, display_name |
| 7.3 | `GET /api/admin/conversations` — all rooms | `routes/admin.js` | 30min | Cu last_message |
| 7.4 | `GET /api/admin/export/:roomId` — export | `routes/admin.js` | 2h | JSON + PDF (pdfkit) |
| 7.5 | admin.html — layout & navigation | `public/admin.html` | 2h | Dashboard layout cu sidebar |
| 7.6 | Admin: stats cards | `public/js/admin.js` | 1h | Users, messages, rooms, active |
| 7.7 | Admin: user management table | `public/js/admin.js` | 2h | CRUD table, role edit, ban |
| 7.8 | Admin: invite management | `public/js/admin.js` | 1h | Generate, list, copy link |
| 7.9 | Admin: room browser | `public/js/admin.js` | 1h | View all rooms, archive |
| 7.10 | Admin: export conversations | `public/js/admin.js` | 1h | Download JSON/PDF |

**Estimare:** ~13 ore
**Dependențe:** Sprint 4 (room management)
**Livrabil:** Dashboard admin complet

---

### Sprint 8: UX Polish & Mobile

**Obiectiv:** Experiență completă pe desktop și mobil.

| # | Task | Fișiere | Efort | Detalii |
|---|------|---------|-------|---------|
| 8.1 | Reply threads UI | `chat.js`, `components.css` | 3h | Quote reply, thread view |
| 8.2 | Dark/light mode toggle | `theme.css`, `chat.js` | 2h | CSS variables swap |
| 8.3 | Mobile responsive layout | `components.css` | 3h | Swipe sidebar, full-width messages |
| 8.4 | Notification badges (unread count) | `chat.js` | 2h | Per-room unread, based on message_reads |
| 8.5 | Emoji picker | `chat.js` | 2h | Basic emoji selection |
| 8.6 | Link preview / URL detection | `chat.js` | 1h | Auto-linkify URLs |
| 8.7 | User profile page | `profile.html`, `chat.js` | 2h | Avatar upload, display name edit |
| 8.8 | Notification sounds | `chat.js` | 30min | Audio on new message |

**Estimare:** ~16 ore
**Dependențe:** Sprint 5, 6, 7
**Livrabil:** App polished, mobile-ready

---

### Sprint 9: Producție

**Obiectiv:** Deploy stabil pe Mac Mini cu SSL.

| # | Task | Fișiere | Efort | Detalii |
|---|------|---------|-------|---------|
| 9.1 | ecosystem.config.js (PM2) | `ecosystem.config.js` | 30min | Cluster, env vars, log rotate |
| 9.2 | Caddyfile | `Caddyfile` | 30min | Reverse proxy, auto SSL |
| 9.3 | .env.production | `.env.production` | 15min | Credentials de producție |
| 9.4 | Backup script (cron) | `scripts/backup.sh` | 1h | SQLite backup + uploads/ |
| 9.5 | Browser push notifications | `public/sw.js`, `chat.js` | 3h | Service Worker, VAPID keys |
| 9.6 | Health check endpoint | `server.js` | 15min | GET /health |
| 9.7 | Port forwarding documentation | `docs/DEPLOY.md` | 30min | Router setup guide |
| 9.8 | Domain setup | - | 1h | DNS + Caddy config |
| 9.9 | Smoke testing | - | 2h | Manual QA pe toate funcțiile |

**Estimare:** ~9 ore
**Dependențe:** Toate sprinturile anterioare
**Livrabil:** App live pe internet cu SSL

---

## Partea III: Sumar Vizual

### Progres Global

```
Spec Requirements:        ████████████████████████████████ 100%

IMPLEMENTAT:              ████████████░░░░░░░░░░░░░░░░░░░░  38%
  - Backend core:         ██████████████████████████░░░░░░  80%
  - Frontend core:        ████████████████████░░░░░░░░░░░░  60%
  - Design system:        ██████████████████████████████░░  95%
  - Security:             ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░  15%
  - Admin:                ████████░░░░░░░░░░░░░░░░░░░░░░░░  25%
  - Agent API:            ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0%
  - File handling:        ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0%
  - Producție:            ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0%
```

### Dependențe între Sprinturi

```
Sprint 1 (Securitate)
  └── Sprint 2 (DB + Realtime)
        ├── Sprint 3 (Mesaje CRUD)
        │     └── Sprint 4 (Rooms)
        │           ├── Sprint 5 (Files)
        │           └── Sprint 7 (Admin)
        └── Sprint 6 (Agent API)
              │
              └── Sprint 8 (UX Polish)
                    └── Sprint 9 (Producție)
```

### Efort Total Estimat

| Sprint | Ore | Acumulat |
|--------|-----|----------|
| 1. Securitate | 6h | 6h |
| 2. DB + Realtime | 8h | 14h |
| 3. Mesaje | 11h | 25h |
| 4. Rooms | 10h | 35h |
| 5. Files | 11h | 46h |
| 6. Agent API | 5h | 51h |
| 7. Admin | 13h | 64h |
| 8. UX Polish | 16h | 80h |
| 9. Producție | 9h | **89h** |

**Total: ~89 ore de dezvoltare**

---

## Partea IV: Recomandări de Prioritizare

### Dacă avem timp limitat, ordinea critică este:

1. **Sprint 1** — Securitate (obligatoriu înainte de orice deploy)
2. **Sprint 2** — Realtime real (read receipts, online status)
3. **Sprint 3** — Edit/delete mesaje (funcționalitate de bază)
4. **Sprint 6** — Agent API (diferențiatorul produsului — Claude integration)
5. **Sprint 5** — Files (necesar pentru chat complet)
6. **Sprint 4** — Room management (nice to have)
7. **Sprint 7** — Admin (poate fi ulterior)
8. **Sprint 8** — Polish (iterativ)
9. **Sprint 9** — Producție (când totul e gata)

### Features care pot fi tăiate (MVP minimal):

- Dark/light toggle (Sprint 8.2)
- Emoji picker (Sprint 8.5)
- PDF export (Sprint 7.4)
- Reply threads complet (Sprint 8.1) — păstrăm doar reply simplu
- Profile page (Sprint 8.7)

### Cu aceste tăieri, MVP = ~60 ore

---

## Partea V: Decizii Tehnice Necesare

Înainte de a începe, trebuie clarificate:

1. **Validare input:** `zod` vs `joi` vs manual? (Recomandare: `zod` — lightweight, TypeScript-friendly)
2. **Logging:** `pino` vs `winston`? (Recomandare: `pino` — mai rapid, JSON native)
3. **Search:** SQLite FTS5 vs simple LIKE? (Recomandare: FTS5 pentru scalabilitate)
4. **File storage:** Local filesystem vs S3-compatible? (Recomandare: local pentru MVP, migrare ulterior)
5. **Agent communication:** Polling vs WebSocket vs webhook? (Recomandare: polling simplu + opțional WebSocket)
6. **PDF export:** `pdfkit` vs `puppeteer`? (Recomandare: `pdfkit` — lighter, no browser needed)
7. **Migration strategy:** Schema evolution in init.js vs separate migration tool? (Recomandare: `better-sqlite3-migrations` sau manual `ALTER TABLE`)
