# Admin Theme Settings — Design Document

**Date:** 2026-02-24
**Status:** Approved — ready for implementation

---

## Overview

Adminul poate gestiona teme vizuale ale aplicației dintr-o secțiune dedicată în Settings. Temele sunt stocate în DB, servite runtime ca CSS, și pot fi create/editate printr-un chat cu Claude AI.

---

## Database Schema

```sql
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE themes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  tokens     TEXT NOT NULL,  -- JSON cu toți tokenii CSS
  is_active  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- `app_settings` stochează `claude_api_key` criptat AES-256-GCM (cheia din `.env`)
- `themes.tokens` = JSON complet al tokenilor, structură identică cu `:root {}` din `tokens.css`
- Seed: tema curentă din `tokens.css` inserată ca temă default activă
- Un singur `is_active = 1` enforced în route logic

---

## API Endpoints

### Settings (`routes/settings.js`, admin only)
- `GET  /api/admin/settings` → `{ claude_api_key: "sk-...***" }` (masked)
- `PUT  /api/admin/settings` → salvează API key criptat

### Themes (`routes/theme.js`)
- `GET  /api/admin/themes` → lista temelor (admin only)
- `POST /api/admin/themes` → creare temă nouă (admin only)
- `PUT  /api/admin/themes/:id` → editare (admin only)
- `DELETE /api/admin/themes/:id` → șterge — nu poate șterge tema activă (admin only)
- `POST /api/admin/themes/:id/activate` → activează (admin only)
- `POST /api/admin/themes/chat` → chat Claude pentru editare tokeni (admin only)
- `GET  /api/theme/active.css` → **public**, fără auth, returnează CSS tema activă

### CSS Response Format
```css
@layer tokens {
  :root {
    --accent: #00e676;
    --bg-base: #040404;
    /* ... toți tokenii temei active */
  }
}
```

---

## Admin UI

### Settings → Tab: API Keys
- Input `type="password"` pentru `claude_api_key`
- Buton Save, mesaj confirmare
- La load: valoare mascată dacă există

### Settings → Tab: UI Themes
- Lista temelor cu status activ/inactiv
- Butoane: Activate / Edit / Delete (delete disabled pe tema activă)
- Buton `+ New Theme`

### Modal Editor Temă (fullscreen)
- **Stânga:** chat cu Claude — conversație liberă pentru modificare tokeni
- **Dreapta sus:** iframe preview live cu tokenii aplicați (pagina de login)
- **Dreapta jos:** lista tokenilor curenți, editabili manual
- **Header:** nume temă (editabil) + Save + Cancel

---

## Claude Chat Integration

**System prompt trimis la fiecare mesaj:**
```
Ești un expert CSS design systems. Lucrezi cu tokenii CSS ai aplicației ONE21.
Tokenii standardizați curenți sunt: {JSON tokens}
Regulă: păstrează TOATE cheile existente. Poți modifica valori și adăuga tokeni noi.
Răspunde cu JSON: { "tokens": {...}, "explanation": "..." }
```

**Flow:**
1. Admin scrie mesaj în chat
2. `POST /api/admin/themes/chat` cu `{ message, current_tokens }`
3. Server apelează Claude API cu API key din `app_settings`
4. Claude returnează `{ tokens, explanation }`
5. Frontend actualizează preview iframe + lista tokenilor
6. Admin salvează când e mulțumit

---

## CSS Runtime Integration

Fiecare pagină HTML primește un `<link>` suplimentar:

```html
<link rel="stylesheet" href="/css/design-system.css">
<link rel="stylesheet" href="/api/theme/active.css">          ← nou
<link rel="stylesheet" href="/css/layers/pages/[pagina].css">
```

`/api/theme/active.css` folosește același `@layer tokens` — suprascrie `tokens.css` fără conflicte.

**Cache:** `Cache-Control: no-cache` pe endpoint-ul public — schimbarea e vizibilă la refresh.

---

## Files to Create/Modify

| Acțiune | Fișier |
|---------|--------|
| Creare | `routes/settings.js` |
| Creare | `routes/theme.js` |
| Modificare | `db/init.js` — schema + seed temă default |
| Modificare | `server.js` — înregistrare routes noi |
| Modificare | `public/admin.html` — secțiune Settings |
| Modificare | `public/css/layers/pages/admin.css` — stiluri editor |
| Modificare | `public/chat.html` — +1 link CSS |
| Modificare | `public/login.html` — +1 link CSS |
| Modificare | `public/admin.html` — +1 link CSS |
