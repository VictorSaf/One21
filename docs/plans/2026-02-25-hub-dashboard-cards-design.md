# ONE21 — Hub dashboard: carduri dinamice

**Data:** 2026-02-25  
**Status:** Approved — ready for implementation

---

## 1. Scop

ONE21 funcționează ca **portal/hub**: adminul conectează userii la **resurse** diverse (agenți, documente, link-uri, aplicații, scripturi etc.). **Dashboard-ul (Overview)** este **dinamic**: afișează carduri configurate de admin, fiecare cu design propriu (icon/imagine, culoare, titlu, descriere) și acțiune la click (URL, cameră chat, script, aplicație internă). Totul flexibil, fără tipuri fixe în UI — adminul completează câmpurile per card.

---

## 2. Model date

### Tabel `hub_cards`

| Coloană         | Tip     | Descriere |
|-----------------|---------|-----------|
| id              | INTEGER PK | Auto-increment |
| title           | TEXT    | Titlul cardului |
| description     | TEXT    | Descriere scurtă (opțional) |
| icon            | TEXT    | Emoji sau URL icon (opțional) |
| image_url       | TEXT    | URL imagine pentru card (opțional; prioritate față de icon dacă e setat) |
| accent_color    | TEXT    | Culoare accent — hex (ex. `#3b82f6`) sau nume token (ex. `accent`); folosit pentru border/background card |
| action_type     | TEXT    | `url` \| `room` \| `script` \| `internal_app` |
| action_payload  | TEXT    | În funcție de tip: URL (string), room_id (integer), script id, app id/rută |
| sort_order      | INTEGER | Ordine afișare (0, 1, 2, …); mai mic = mai sus/stânga |
| created_at      | TEXT    | ISO timestamp |

- `action_type = 'url'` → `action_payload` = URL; click deschide în tab nou.
- `action_type = 'room'` → `action_payload` = id cameră; click = navigare la chat cu acea cameră (ex. `/chat.html?room=5`).
- `action_type = 'script'` → `action_payload` = identificator script; backend poate rula/lansa (implementare viitoare).
- `action_type = 'internal_app'` → `action_payload` = rută sau id aplicație internă; click = navigare în ONE21.

Validare la API: `action_type` în mulțimea cunoscută; pentru `room`, payload numeric; pentru `url`, string non-gol. Restul tipurilor acceptă string în v1.

---

## 3. API (admin, JWT)

Toate rutele protejate cu `authMiddleware` + `requireAdmin`.

- **GET /api/admin/hub-cards** — listă carduri sortate după `sort_order` ASC, apoi `id` ASC. Pentru Overview și pentru pagina Hub.
- **POST /api/admin/hub-cards** — creare card. Body: `title`, `description?`, `icon?`, `image_url?`, `accent_color?`, `action_type`, `action_payload`, `sort_order?` (default: max+1).
- **PUT /api/admin/hub-cards/:id** — update card (același set de câmpuri).
- **DELETE /api/admin/hub-cards/:id** — ștergere card.

Opțional viitor: **PATCH /api/admin/hub-cards/reorder** — body `{ order: [id1, id2, …] }` pentru reordonare drag-and-drop.

---

## 4. Overview (dashboard) — grid de carduri

- În pagina **Overview** (admin), **deasupra** sau **sub** grid-ul existent de stat cards (users, messages, rooms etc.), se adaugă o secțiune **Hub** cu un **grid de carduri**.
- La încărcarea Overview: `GET /api/admin/hub-cards`; se randează un card per element: titlu, descriere (dacă există), icon sau imagine (prioritate image_url), accent_color aplicat (border sau fundal discret).
- **Click pe card:** în funcție de `action_type`:
  - **url** — `window.open(action_payload, '_blank')`.
  - **room** — `window.location.href = '/chat.html?room=' + action_payload` (sau navigare SPA dacă există).
  - **script** — request către backend (ex. POST /api/admin/hub-cards/:id/run) sau placeholder; implementare completă mai târziu.
  - **internal_app** — `window.location.href = action_payload` (rută internă) sau navigare internă.
- Dacă nu există carduri, secțiunea Hub poate fi ascunsă sau afișează mesaj „No hub cards yet. Add them in Hub.”
- Stiluri: clase în `pages/admin.css` (ex. `.hub-cards-grid`, `.hub-card`); folosire tokeni pentru culori; `accent_color` aplicat ca `border-left` sau `background` cu opacity mică, sau `--hub-card-accent` setat inline doar pentru acea variabilă (evităm hex hardcodat în HTML dacă e posibil — alternativ, un data-attribute și CSS care citește `var(--accent)` sau override per card prin class).

---

## 5. Admin — gestionare Hub cards

- **Nav:** element nou în sidebar: **Hub** (sau „Hub_Cards”), `data-page="hub"`.
- **Pagină Hub:** listă carduri (titlu, tip acțiune, ordine); butoane **Add card**, **Edit**, **Delete** per card. La Add/Edit: formular cu câmpuri title, description, icon, image_url, accent_color, action_type (dropdown), action_payload (input; label/placeholder în funcție de action_type). La salvare: POST sau PUT către API. Opțional: reordonare prin drag-and-drop (PATCH reorder) sau câmp sort_order numeric în formular.
- Stiluri și componente: refolosire `.admin-section`, `.admin-section__header`, tabele sau listă de carduri; formular cu `.input`, `.btn` din design system.

---

## 6. Rezumat

| Ce | Unde |
|----|------|
| Tabel | `hub_cards` (db/init via migrate) |
| API | routes/admin.js — GET/POST/PUT/DELETE hub-cards |
| Overview | admin.html — secțiune Hub cu grid; JS load cards + click handlers |
| Admin Hub | admin.html — pagină nouă Hub + formular Add/Edit card |
| CSS | pages/admin.css — .hub-cards-grid, .hub-card, form |

---

**Următorul pas:** Plan de implementare (DB, API, Overview grid, pagină Hub CRUD).
