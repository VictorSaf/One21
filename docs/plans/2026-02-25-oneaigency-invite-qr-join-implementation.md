# ONE21 — Invitații QR + join oneaigency.com — Implementation Plan

> **Goal:** Invite flow with token, nume, prenume; QR in admin; join at /one21/join (upload QR → Who are you? → register). One domain only: oneaigency.com.

**Design doc:** `docs/plans/2026-02-25-oneaigency-invite-qr-join-design.md`

---

## Task 1: DB — token, nume, prenume on invitations

- Add columns to `invitations`: `token TEXT UNIQUE`, `nume TEXT`, `prenume TEXT`. Migrate in `db/init.js` (safeAdd or CREATE TABLE IF NOT EXISTS in migrate). New installs: add columns in initial CREATE TABLE.
- When creating invite (POST /api/admin/invites), if `nume` or `prenume` provided, generate token (e.g. 8 chars alphanumeric, url-safe), store it; return token in response.

---

## Task 2: API — GET /api/join/:token, POST /api/join/verify

- **GET /api/join/:token:** No auth. Look up invite by token where used_by IS NULL. Return `{ nume, prenume }` or 404.
- **POST /api/join/verify:** Body `{ token, answer }`. Compare answer (trim, case-insensitive) to invite.prenume. Return `{ ok: true }` or 400. No session; client stores token and uses it for register.

---

## Task 3: Register by token

- In `routes/auth.js`, register: accept optional `token` in body. If `token` present, find invite by token, use that invite’s `code` (and id) for the rest of the flow; set user’s display_name from invite.nume + ' ' + invite.prenume if present. If `invite_code` present, keep current behavior.

---

## Task 4: Admin — nume, prenume, QR

- Invite modal: add fields Nume, Prenume (optional). On create, send in body; backend generates token when nume/prenume set, returns token.
- After create, if token returned: show QR code image (encode `https://oneaigency.com/one21/join/<token>`). Use npm `qrcode` (server) or client-side lib to generate QR in admin UI; prefer client (e.g. `qrcode` or `qrcodejs`) so we don’t store image. Display + optional download.

---

## Task 5: Join pages — /one21/join and /one21/join/:token

- Serve join app: ensure `GET /one21/join` and `GET /one21/join/:token` serve the same HTML (e.g. `public/one21/join.html` or a single SPA). Express: add route(s) that send join.html for these paths so client can read pathname and get token.
- **join.html (or join app):**  
  - If path is `/one21/join` and no token in path: show “Upload QR code” (file input); on file selected, decode with jsQR (or similar), get URL, extract token from path, redirect to `/one21/join/<token>`.  
  - If path is `/one21/join/:token`: fetch GET /api/join/:token; show “Who are you? (ONE/name only)”; on submit, POST /api/join/verify; if ok, show form username + password; on submit, POST /api/auth/register with token + username + password (display_name from invite); then redirect to /one21/ or /one21/login.
- Use design-system CSS; minimal layout.

---

## Task 6: Base path and redirects

- Ensure login and app work under /one21 when accessed via oneaigency.com (or always under /one21). If app is currently at root, add config or base tag so that join redirects to same base (e.g. /one21/). Document: oneaigency.com DNS → this server; Caddy/Node serves /one21 for the app.

---

## Order

1. Task 1 (DB)  
2. Task 2 (API join)  
3. Task 3 (Register by token)  
4. Task 4 (Admin QR)  
5. Task 5 (Join pages)  
6. Task 6 (Base path)
