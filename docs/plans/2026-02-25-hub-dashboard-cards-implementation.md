# ONE21 — Hub dashboard cards — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add dynamic hub cards to the admin dashboard: DB table, CRUD API, Overview grid of cards with click actions, and Hub admin page to add/edit/delete cards.

**Architecture:** New table `hub_cards`; admin API in existing `routes/admin.js`; Overview loads cards and renders a grid; new nav item and page "Hub" for CRUD; styles in `pages/admin.css`.

**Tech Stack:** Node.js, Express 5, better-sqlite3, vanilla JS, CSS layers (design system).

**Design doc:** `docs/plans/2026-02-25-hub-dashboard-cards-design.md`

---

## Task 1: Database — table hub_cards

**Files:**
- Modify: `db/init.js`

**Step 1:** In the `migrate(db)` function, add a block that runs:

```js
db.exec(`CREATE TABLE IF NOT EXISTS hub_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  image_url TEXT,
  accent_color TEXT,
  action_type TEXT NOT NULL CHECK(action_type IN ('url','room','script','internal_app')),
  action_payload TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_hub_cards_sort ON hub_cards(sort_order)`);
```

Use the same pattern as for `app_settings`/`themes` (try/catch or separate exec). Ensure this runs for existing DBs (migrate) and for new DBs (add the same CREATE TABLE in the initial `db.exec` block so new installs have the table).

**Step 2:** In the initial `db.exec` block (where other CREATE TABLEs are), add the same `CREATE TABLE IF NOT EXISTS hub_cards (...)` and the index so fresh DBs get the table without relying only on migrate.

**Step 3:** Restart server or run a small script that calls `getDb()` to ensure DB initializes. Verify: `sqlite3 db/chat.db "SELECT name FROM sqlite_master WHERE name='hub_cards';"` → `hub_cards`.

**Step 4:** Commit with message: `feat(hub): add hub_cards table`

---

## Task 2: API — hub-cards CRUD

**Files:**
- Modify: `routes/admin.js`

**Step 1: GET /api/admin/hub-cards**

Return all cards ordered by `sort_order ASC`, then `id ASC`. Response: `{ cards: [...] }`.

**Step 2: POST /api/admin/hub-cards**

Validate body: `title` (string, non-empty), `action_type` (one of url, room, script, internal_app), `action_payload` (string, non-empty). Optional: description, icon, image_url, accent_color, sort_order (default: max(sort_order)+1 or 0). Insert and return `{ card: { ...row } }`. Use Zod if project uses it, or manual checks.

**Step 3: PUT /api/admin/hub-cards/:id**

Parse id from params; validate body same as POST (all fields optional except at least one present for update). Update row; return 404 if not found; return `{ card: updatedRow }`.

**Step 4: DELETE /api/admin/hub-cards/:id**

Delete by id; return 404 if not found; return `{ ok: true }`.

**Step 5:** Verify with curl (replace with your JWT and base URL):

```bash
# List (empty at first)
curl -s -H "Authorization: Bearer YOUR_JWT" http://localhost:3737/api/admin/hub-cards

# Create
curl -s -X POST -H "Authorization: Bearer YOUR_JWT" -H "Content-Type: application/json" -d '{"title":"Test","action_type":"url","action_payload":"https://example.com"}' http://localhost:3737/api/admin/hub-cards

# List again, then PUT, then DELETE
```

**Step 6:** Commit: `feat(hub): add hub-cards CRUD API`

---

## Task 3: Overview — hub cards grid and click actions

**Files:**
- Modify: `public/admin.html`

**Step 1:** In the Overview page block (`#page-overview`), after the stats grid and before the "Recent_Activity" section, add a section:

```html
<div class="admin-section hub-section" id="hubSection">
  <div class="admin-section__header">
    <span class="admin-section__title">Hub</span>
  </div>
  <div class="hub-cards-grid" id="hubCardsGrid"></div>
  <div class="hub-cards-empty u-dim" id="hubCardsEmpty" style="display:none;">No hub cards yet. Add them in Hub.</div>
</div>
```

**Step 2:** In the admin JS, add a function `loadHubCards()` that:
- Calls `GET /api/admin/hub-cards` (with auth).
- If `cards.length === 0`, show `#hubCardsEmpty`, hide grid content or leave grid empty.
- Else, for each card build a DOM element (e.g. a `<a>` or `<button>` with class `hub-card`), set data attributes or properties for `action_type` and `action_payload`, set title, description, icon/image, accent color (e.g. style for border-left or a CSS variable), and append to `#hubCardsGrid`. Attach click handler: for `url` open `action_payload` in new tab; for `room` set `window.location.href = '/chat.html?room=' + action_payload`; for `internal_app` set `window.location.href = action_payload`; for `script` optionally show a toast "Not implemented" or no-op.

**Step 3:** Call `loadHubCards()` when Overview page is shown (e.g. when switching to `data-page="overview"` or on initial load if overview is default). Reuse existing admin API helper (e.g. `Auth.api` or fetch with Bearer token).

**Step 4:** Commit: `feat(hub): Overview hub cards grid and click actions`

---

## Task 4: Admin Hub page — list and CRUD UI

**Files:**
- Modify: `public/admin.html`

**Step 1:** In the sidebar nav, add a new button after Overview (or after a suitable item):

```html
<button class="admin-nav__item" data-page="hub">
  <svg viewBox="0 0 24 24">...</svg>
  Hub
</button>
```

Use a simple grid or link icon from existing SVGs in the file.

**Step 2:** Add a new admin-page block:

```html
<div class="admin-page" id="page-hub">
  <div class="admin-page-header">
    <div class="admin-page-label">Portal</div>
    <div class="admin-page-title">Hub</div>
  </div>
  <div class="admin-section">
    <div class="admin-section__header">
      <span class="admin-section__title">Cards</span>
      <button class="btn btn--primary btn--sm" onclick="openHubCardForm()">Add card</button>
    </div>
    <div id="hubCardsList"></div>
  </div>
</div>
```

**Step 3:** Add a modal or inline form for Add/Edit card: fields title, description, icon, image_url, accent_color, action_type (select: url, room, script, internal_app), action_payload (text input). Buttons Save, Cancel. On Save: if editing, PUT `/api/admin/hub-cards/:id`; else POST `/api/admin/hub-cards`. Then refresh hub list and Overview grid. Use existing modal pattern (e.g. `.modal`) if present.

**Step 4:** Implement `loadHubCardsList()` for the Hub page: GET hub-cards, render a table or list with title, action_type, sort_order, and Edit / Delete buttons. Delete: confirm then DELETE `/api/admin/hub-cards/:id`, then refresh.

**Step 5:** When switching to `data-page="hub"`, call `loadHubCardsList()`. Wire `openHubCardForm()` and edit/delete handlers.

**Step 6:** Commit: `feat(hub): Hub admin page and card CRUD form`

---

## Task 5: Styles for hub cards

**Files:**
- Modify: `public/css/layers/pages/admin.css`

**Step 1:** Add a grid layout for the hub cards on Overview:

```css
.hub-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: var(--sp-4);
}
```

**Step 2:** Style `.hub-card`: use design tokens for background, border, padding, border-radius; support an accent (e.g. `border-left: 4px solid var(--hub-card-accent, var(--accent))`). Card can be a link or button: cursor pointer, hover state. Title and description typography with existing tokens.

**Step 3:** If accent_color is stored per card, apply it via inline style on the element: `style="--hub-card-accent: #xxxxxx"` (only the variable; no other inline styles) so the CSS rule above uses it. For token names (e.g. "accent"), use something like `var(--accent)` when rendering.

**Step 4:** Run `bash scripts/audit-css.sh` and fix any violations (no hex in pages if audit forbids; use variable only).

**Step 5:** Commit: `feat(hub): hub card grid and card styles in admin.css`

---

## Execution summary

| Task | Summary |
|------|---------|
| 1 | DB: hub_cards table in init + migrate |
| 2 | API: GET/POST/PUT/DELETE hub-cards in admin routes |
| 3 | Overview: hub section, load cards, click handlers (url, room, internal_app, script placeholder) |
| 4 | Hub page: nav, list cards, Add/Edit form, Delete |
| 5 | CSS: hub-cards-grid, hub-card, accent variable |

After all tasks, the admin dashboard shows dynamic hub cards on Overview and allows full CRUD from the Hub page.
