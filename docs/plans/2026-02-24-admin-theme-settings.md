# Admin Theme Settings — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Secțiune Settings în admin cu gestionare API key Claude și teme vizuale aplicabile global, editate prin chat AI.

**Architecture:** Teme stocate în SQLite ca JSON de tokeni CSS. Tema activă servită ca `/api/theme/active.css` (public, no-cache). Editor temă = modal cu chat Claude API + iframe preview live.

**Tech Stack:** Node.js/Express, better-sqlite3, Node crypto (AES-256-GCM), fetch → Anthropic API `https://api.anthropic.com/v1/messages`

---

## Task 1: DB Schema — `app_settings` + `themes`

**Files:**
- Modify: `db/init.js`

**Step 1: Adaugă tabele în `db.exec()` existent (după `room_requests`)**

```js
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS themes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  tokens     TEXT NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_themes_active ON themes(is_active);
```

**Step 2: Adaugă seed temă default în funcția `seed(db)` (la final, înainte de `console.log`)**

```js
const defaultTokens = {
  "--bg-base": "#040404",
  "--bg-surface": "#0d0d0d",
  "--bg-elevated": "#141414",
  "--bg-active": "#1a1a1a",
  "--bg-hover": "rgba(255,255,255,0.04)",
  "--border-dim": "#1c1c1c",
  "--border-mid": "#272727",
  "--border-bright": "#383838",
  "--border-accent": "rgba(0,230,118,0.2)",
  "--border-accent-strong": "rgba(0,230,118,0.5)",
  "--accent": "#00e676",
  "--accent-dim": "#00b856",
  "--accent-muted": "rgba(0,230,118,0.07)",
  "--accent-glow": "rgba(0,230,118,0.15)",
  "--text-primary": "#c4c4c4",
  "--text-secondary": "#545454",
  "--text-tertiary": "#2c2c2c",
  "--text-accent": "#00e676",
  "--text-inverse": "#070707",
  "--online": "#00e676",
  "--offline": "#333333",
  "--busy": "#ff9c00",
  "--error": "#ff3d3d",
  "--warning": "#ffb300",
  "--info": "#00b4d8",
  "--danger": "#ff3d3d",
  "--danger-muted": "rgba(255,61,61,0.08)",
  "--danger-border": "rgba(255,61,61,0.2)",
  "--danger-border-mid": "rgba(255,61,61,0.35)",
  "--danger-hover": "rgba(255,61,61,0.07)",
  "--danger-focus": "rgba(255,61,61,0.4)",
  "--danger-focus-shadow": "rgba(255,61,61,0.08)",
  "--danger-border-25": "rgba(255,61,61,0.25)",
  "--danger-border-50": "rgba(255,61,61,0.5)",
  "--danger-bg": "rgba(255,61,61,0.06)",
  "--purple": "#8888ff",
  "--purple-muted": "rgba(100,100,220,0.12)",
  "--purple-light": "#a78bfa",
  "--purple-border": "rgba(167,139,250,0.25)",
  "--purple-bg": "rgba(167,139,250,0.06)",
  "--info-muted": "rgba(0,180,216,0.12)",
  "--info-border": "rgba(0,180,216,0.25)",
  "--info-bg": "rgba(0,180,216,0.05)",
  "--overlay-bg": "rgba(0,0,0,0.75)",
  "--shadow-overlay": "rgba(0,0,0,0.6)",
  "--overlay-bg-50": "rgba(0,0,0,0.5)",
  "--accent-anim-glow-0": "rgba(0,230,118,0)",
  "--accent-anim-glow-35": "rgba(0,230,118,0.35)",
  "--accent-anim-bg-05": "rgba(0,230,118,0.05)",
  "--accent-anim-bg-06": "rgba(0,230,118,0.06)",
  "--accent-anim-bg-08": "rgba(0,230,118,0.08)",
  "--accent-anim-bg-12": "rgba(0,230,118,0.12)",
  "--accent-anim-bg-30": "rgba(0,230,118,0.3)",
  "--accent-border-25": "rgba(0,230,118,0.25)",
  "--accent-border-40": "rgba(0,230,118,0.4)",
  "--accent-border-60": "rgba(0,230,118,0.6)",
  "--accent-bg-gradient-1": "rgba(0,230,118,0.025)",
  "--accent-bg-gradient-2": "rgba(0,230,118,0.014)",
  "--shadow-sm": "0 1px 4px rgba(0,0,0,0.6)",
  "--shadow-md": "0 4px 16px rgba(0,0,0,0.7)",
  "--shadow-lg": "0 12px 40px rgba(0,0,0,0.85)",
  "--warning-muted": "rgba(255,179,0,0.08)",
  "--scanline-color": "rgba(0,0,0,0.025)",
  "--selection-bg": "rgba(0,230,118,0.18)"
};

db.prepare(`INSERT INTO themes (name, tokens, is_active) VALUES (?, ?, 1)`)
  .run('Neural Dark', JSON.stringify(defaultTokens));
```

**Step 3: Adaugă migrare în `migrate(db)` pentru DB-uri existente**

```js
// La finalul funcției migrate(), după safeAdd-urile existente:
try {
  db.exec(`CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
} catch {}
try {
  db.exec(`CREATE TABLE IF NOT EXISTS themes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    tokens TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_themes_active ON themes(is_active)`);
  // Seed tema default dacă nu există
  const hasTheme = db.prepare('SELECT COUNT(*) as n FROM themes').get().n;
  if (hasTheme === 0) {
    // Inserează același defaultTokens din seed
    // (copiază obiectul defaultTokens de mai sus și inserează)
  }
} catch {}
```

**Step 4: Verificare manuală**

```bash
node -e "const {getDb}=require('./db/init'); const db=getDb(); console.log(db.prepare('SELECT name, is_active FROM themes').all()); console.log(db.prepare('SELECT * FROM app_settings').all());"
```
Expected: `[{ name: 'Neural Dark', is_active: 1 }]` și `[]`

**Step 5: Commit**

```bash
git add db/init.js
git commit -m "feat: add app_settings and themes tables with default theme seed"
```

---

## Task 2: Encryption Helper

**Files:**
- Create: `lib/crypto.js`

**Step 1: Verifică că `.env` are `ENCRYPTION_KEY`**

Adaugă în `.env`:
```
ENCRYPTION_KEY=your-32-char-hex-key-here-000000
```

Generează cheia:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Step 2: Creează `lib/crypto.js`**

```js
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(process.env.ENCRYPTION_KEY || '0'.repeat(64), 'hex');

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('hex'), encrypted.toString('hex'), tag.toString('hex')].join(':');
}

function decrypt(stored) {
  const [ivHex, encHex, tagHex] = stored.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
```

**Step 3: Verificare manuală**

```bash
node -e "
require('dotenv').config();
const {encrypt,decrypt}=require('./lib/crypto');
const enc=encrypt('sk-ant-test123');
console.log('encrypted:', enc);
console.log('decrypted:', decrypt(enc));
"
```
Expected: decrypted = `sk-ant-test123`

**Step 4: Commit**

```bash
git add lib/crypto.js
git commit -m "feat: add AES-256-GCM encryption helper for sensitive settings"
```

---

## Task 3: Settings Route

**Files:**
- Create: `routes/settings.js`

**Step 1: Creează `routes/settings.js`**

```js
const express = require('express');
const { getDb } = require('../db/init');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const { encrypt, decrypt } = require('../lib/crypto');

const router = express.Router();
router.use(authMiddleware, requireAdmin);

// GET /api/admin/settings
router.get('/', (req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'claude_api_key'").get();
  let masked = null;
  if (row) {
    try {
      const plain = decrypt(row.value);
      masked = plain.slice(0, 12) + '•'.repeat(Math.max(0, plain.length - 12));
    } catch {
      masked = '••••••••••••';
    }
  }
  res.json({ claude_api_key: masked, has_key: !!row });
});

// PUT /api/admin/settings
router.put('/', (req, res) => {
  const db = getDb();
  const { claude_api_key } = req.body;
  if (!claude_api_key || typeof claude_api_key !== 'string' || claude_api_key.trim().length < 10) {
    return res.status(400).json({ error: 'Invalid API key' });
  }
  const encrypted = encrypt(claude_api_key.trim());
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES ('claude_api_key', ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(encrypted);
  res.json({ ok: true });
});

module.exports = router;
```

**Step 2: Verificare manuală (după Task 6 când route e înregistrat)**

```bash
# GET settings (gol)
curl -s -H "Authorization: Bearer <token>" http://localhost:3737/api/admin/settings

# PUT settings
curl -s -X PUT -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"claude_api_key":"sk-ant-test-key-12345"}' \
  http://localhost:3737/api/admin/settings
```

**Step 3: Commit**

```bash
git add routes/settings.js
git commit -m "feat: admin settings route with encrypted Claude API key storage"
```

---

## Task 4: Theme CRUD Routes

**Files:**
- Create: `routes/theme.js`

**Step 1: Creează `routes/theme.js`**

```js
const express = require('express');
const { getDb } = require('../db/init');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const { decrypt } = require('../lib/crypto');

const router = express.Router();

// ── PUBLIC ──────────────────────────────────────────
// GET /api/theme/active.css — fără auth, servit tuturor paginilor
router.get('/active.css', (req, res) => {
  const db = getDb();
  const theme = db.prepare('SELECT tokens FROM themes WHERE is_active = 1').get();
  if (!theme) {
    return res.status(200).type('text/css').send('/* no active theme */');
  }
  let tokens;
  try { tokens = JSON.parse(theme.tokens); } catch { tokens = {}; }

  const vars = Object.entries(tokens)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n');

  res.setHeader('Content-Type', 'text/css');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.send(`@layer tokens {\n  :root {\n${vars}\n  }\n}\n`);
});

// ── ADMIN ────────────────────────────────────────────
const adminRouter = express.Router();
adminRouter.use(authMiddleware, requireAdmin);

// GET /api/admin/themes
adminRouter.get('/', (req, res) => {
  const db = getDb();
  const themes = db.prepare('SELECT id, name, is_active, created_at, updated_at FROM themes ORDER BY created_at DESC').all();
  res.json({ themes });
});

// POST /api/admin/themes
adminRouter.post('/', (req, res) => {
  const db = getDb();
  const { name, tokens } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'name required' });
  }
  if (!tokens || typeof tokens !== 'object') {
    return res.status(400).json({ error: 'tokens object required' });
  }
  const result = db.prepare(
    "INSERT INTO themes (name, tokens, is_active) VALUES (?, ?, 0)"
  ).run(name.trim(), JSON.stringify(tokens));
  const theme = db.prepare('SELECT * FROM themes WHERE id = ?').get(result.lastInsertRowid);
  res.json({ theme });
});

// PUT /api/admin/themes/:id
adminRouter.put('/:id', (req, res) => {
  const db = getDb();
  const { name, tokens } = req.body;
  const theme = db.prepare('SELECT * FROM themes WHERE id = ?').get(req.params.id);
  if (!theme) return res.status(404).json({ error: 'Theme not found' });

  const updates = [];
  const values = [];
  if (name && typeof name === 'string' && name.trim().length > 0) {
    updates.push('name = ?'); values.push(name.trim());
  }
  if (tokens && typeof tokens === 'object') {
    updates.push('tokens = ?'); values.push(JSON.stringify(tokens));
  }
  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });

  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);
  db.prepare(`UPDATE themes SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM themes WHERE id = ?').get(req.params.id);
  res.json({ theme: updated });
});

// DELETE /api/admin/themes/:id
adminRouter.delete('/:id', (req, res) => {
  const db = getDb();
  const theme = db.prepare('SELECT * FROM themes WHERE id = ?').get(req.params.id);
  if (!theme) return res.status(404).json({ error: 'Theme not found' });
  if (theme.is_active) return res.status(400).json({ error: 'Cannot delete active theme' });
  db.prepare('DELETE FROM themes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// POST /api/admin/themes/:id/activate
adminRouter.post('/:id/activate', (req, res) => {
  const db = getDb();
  const theme = db.prepare('SELECT * FROM themes WHERE id = ?').get(req.params.id);
  if (!theme) return res.status(404).json({ error: 'Theme not found' });
  db.transaction(() => {
    db.prepare('UPDATE themes SET is_active = 0').run();
    db.prepare("UPDATE themes SET is_active = 1, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  })();
  res.json({ ok: true, theme_id: parseInt(req.params.id) });
});

// POST /api/admin/themes/chat — Claude AI chat pentru editare tokeni
adminRouter.post('/chat', async (req, res) => {
  const db = getDb();
  const { message, current_tokens } = req.body;
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'message required' });
  }
  if (!current_tokens || typeof current_tokens !== 'object') {
    return res.status(400).json({ error: 'current_tokens required' });
  }

  const apiKeyRow = db.prepare("SELECT value FROM app_settings WHERE key = 'claude_api_key'").get();
  if (!apiKeyRow) return res.status(400).json({ error: 'Claude API key not configured. Go to Settings → API Keys.' });

  let apiKey;
  try { apiKey = decrypt(apiKeyRow.value); } catch {
    return res.status(500).json({ error: 'Failed to decrypt API key' });
  }

  const systemPrompt = `Ești un expert în CSS design systems. Lucrezi cu tokenii vizuali ai aplicației ONE21 (dark terminal aesthetic).
Regulile aplicației:
- Păstrează TOATE cheile existente din JSON (nu șterge tokeni)
- Poți modifica valori și adăuga tokeni noi dacă sunt necesari
- Menține coerența: variantele unui accent color (muted, dim, glow, border variants) trebuie să derivă din culoarea de bază
- Backgroundurile rămân întotdeauna dark (luminozitate sub 20%)
- Fonturile și spacing-ul NU sunt în tema ta — concentrează-te pe culori

Tokenii curenți:
${JSON.stringify(current_tokens, null, 2)}

Răspunde ÎNTOTDEAUNA cu JSON valid în formatul:
{
  "tokens": { ...toți tokenii modificați... },
  "explanation": "Ce am modificat și de ce (1-2 propoziții)"
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: message }],
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(502).json({ error: 'Claude API error', detail: err.error?.message || response.statusText });
    }

    const data = await response.json();
    const content = data.content?.[0]?.text || '';

    // Extrage JSON din răspuns (poate fi înconjurat de text)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(502).json({ error: 'Claude response not parseable', raw: content });

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.tokens || typeof parsed.tokens !== 'object') {
      return res.status(502).json({ error: 'Claude did not return tokens', raw: content });
    }

    res.json({ tokens: parsed.tokens, explanation: parsed.explanation || '' });
  } catch (err) {
    res.status(500).json({ error: 'Chat failed', detail: err.message });
  }
});

router.use('/admin/themes', adminRouter);

module.exports = router;
```

**Step 2: Commit**

```bash
git add routes/theme.js
git commit -m "feat: theme CRUD routes, public active.css endpoint, Claude chat for theme editing"
```

---

## Task 5: Înregistrare Routes în `server.js` + CSS Link în HTML Pages

**Files:**
- Modify: `server.js`
- Modify: `public/login.html`
- Modify: `public/chat.html`
- Modify: `public/admin.html`

**Step 1: Adaugă în `server.js` (după require-uri existente)**

```js
const settingsRoutes = require('./routes/settings');
const themeRoutes    = require('./routes/theme');
```

**Step 2: Înregistrează routes în `server.js` (în secțiunea `--- API Routes ---`)**

```js
app.use('/api/theme', themeRoutes);          // public active.css + admin sub-routes
app.use('/api/admin/settings', settingsRoutes);
```

Adaugă ÎNAINTE de `app.use('/api/admin', adminRoutes)`.

**Step 3: Adaugă CSS link în `public/login.html`**

Înlocuiește:
```html
<link rel="stylesheet" href="/css/design-system.css">
<link rel="stylesheet" href="/css/layers/pages/login.css">
```
Cu:
```html
<link rel="stylesheet" href="/css/design-system.css">
<link rel="stylesheet" href="/api/theme/active.css">
<link rel="stylesheet" href="/css/layers/pages/login.css">
```

**Step 4: Adaugă CSS link în `public/chat.html`** — același pattern, după `design-system.css`

**Step 5: Adaugă CSS link în `public/admin.html`** — același pattern, după `design-system.css`

**Step 6: Verificare `/api/theme/active.css`**

```bash
curl -s http://localhost:3737/api/theme/active.css | head -10
```
Expected: `@layer tokens { :root { --bg-base: #040404; ...`

**Step 7: Commit**

```bash
git add server.js public/login.html public/chat.html public/admin.html
git commit -m "feat: register settings and theme routes, inject active.css in all pages"
```

---

## Task 6: Admin UI — Nav Item + Settings Page HTML

**Files:**
- Modify: `public/admin.html`

**Step 1: Adaugă nav item Settings în sidebar (după butonul `Data_Export`)**

```html
<button class="admin-nav__item" data-page="settings">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
  Settings
</button>
```

**Step 2: Adaugă pagina Settings (după `page-export` div, înainte de `</main>`)**

```html
<!-- ── SETTINGS ── -->
<div class="admin-page" id="page-settings">

  <div class="admin-page-header">
    <div class="admin-page-label">System_Config</div>
    <div class="admin-page-title">Settings</div>
  </div>

  <!-- Tab navigation -->
  <div class="settings-tabs">
    <button class="settings-tab active" data-tab="api-keys">API_Keys</button>
    <button class="settings-tab" data-tab="themes">UI_Themes</button>
  </div>

  <!-- Tab: API Keys -->
  <div class="settings-panel active" id="settings-tab-api-keys">
    <div class="admin-section">
      <div class="admin-section__header">
        <span class="admin-section__title">Claude_API_Key</span>
      </div>
      <div class="settings-field">
        <label class="settings-field__label">CLAUDE_API_KEY</label>
        <div class="settings-field__row">
          <input type="password" id="claudeApiKeyInput" class="input" placeholder="sk-ant-••••••••••••••••">
          <button class="btn btn--primary btn--sm" onclick="saveApiKey()">Save</button>
        </div>
        <p class="settings-field__hint" id="apiKeyStatus">—</p>
      </div>
    </div>
  </div>

  <!-- Tab: UI Themes -->
  <div class="settings-panel" id="settings-tab-themes">
    <div class="admin-section">
      <div class="admin-section__header">
        <span class="admin-section__title">Themes</span>
        <button class="btn btn--primary btn--sm" onclick="openThemeEditor(null)">+ New Theme</button>
      </div>
      <div id="themesList" class="themes-list">
        <div class="themes-list__loading">Loading...</div>
      </div>
    </div>
  </div>

</div>

<!-- ── THEME EDITOR MODAL ── -->
<div class="theme-editor-overlay u-hidden" id="themeEditorOverlay">
  <div class="theme-editor">

    <div class="theme-editor__header">
      <input type="text" class="theme-editor__name" id="themeEditorName" placeholder="Theme name...">
      <div class="theme-editor__actions">
        <button class="btn btn--ghost btn--sm" onclick="closeThemeEditor()">Cancel</button>
        <button class="btn btn--primary btn--sm" onclick="saveTheme()">Save Theme</button>
      </div>
    </div>

    <div class="theme-editor__body">

      <!-- Chat panel -->
      <div class="theme-editor__chat">
        <div class="theme-editor__chat-messages" id="themeChat"></div>
        <div class="theme-editor__chat-input">
          <input type="text" id="themeChatInput" placeholder="Descrie modificarea dorita..." onkeydown="if(event.key==='Enter')sendThemeChat()">
          <button class="btn btn--primary btn--sm" onclick="sendThemeChat()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      </div>

      <!-- Preview + Tokens panel -->
      <div class="theme-editor__preview">
        <div class="theme-editor__preview-label">PREVIEW</div>
        <iframe class="theme-editor__iframe" id="themePreviewFrame" src="/login.html" sandbox="allow-same-origin allow-scripts"></iframe>
        <div class="theme-editor__tokens-label">TOKENS</div>
        <div class="theme-editor__tokens" id="themeTokensList"></div>
      </div>

    </div>
  </div>
</div>
```

**Step 3: Commit**

```bash
git add public/admin.html
git commit -m "feat: add Settings nav item and Settings page HTML with API keys and themes tabs"
```

---

## Task 7: Admin JS — Settings Logic

**Files:**
- Modify: `public/admin.html` (secțiunea `<script>`)

**Step 1: Adaugă funcțiile Settings în scriptul existent din admin.html**

Găsește locul potrivit în `<script>` (după funcțiile existente) și adaugă:

```js
// ── SETTINGS TABS ────────────────────────────────────
document.querySelectorAll('.settings-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`settings-tab-${tab.dataset.tab}`).classList.add('active');
  });
});

async function loadSettings() {
  try {
    const data = await apiGet('/api/admin/settings');
    const input = document.getElementById('claudeApiKeyInput');
    const status = document.getElementById('apiKeyStatus');
    if (data.has_key) {
      input.placeholder = data.claude_api_key;
      status.textContent = 'Key configured ✓';
      status.style.color = 'var(--online)';
    } else {
      status.textContent = 'No key configured';
    }
  } catch {}
}

async function saveApiKey() {
  const val = document.getElementById('claudeApiKeyInput').value.trim();
  if (!val) return;
  try {
    await apiPut('/api/admin/settings', { claude_api_key: val });
    document.getElementById('apiKeyStatus').textContent = 'Saved ✓';
    document.getElementById('apiKeyStatus').style.color = 'var(--online)';
    document.getElementById('claudeApiKeyInput').value = '';
    await loadSettings();
  } catch (e) {
    document.getElementById('apiKeyStatus').textContent = 'Error: ' + e.message;
    document.getElementById('apiKeyStatus').style.color = 'var(--error)';
  }
}

// ── THEMES LIST ──────────────────────────────────────
async function loadThemes() {
  const container = document.getElementById('themesList');
  try {
    const data = await apiGet('/api/admin/themes');
    if (!data.themes.length) {
      container.innerHTML = '<div class="themes-list__empty">No themes</div>';
      return;
    }
    container.innerHTML = data.themes.map(t => `
      <div class="themes-list__item ${t.is_active ? 'themes-list__item--active' : ''}">
        <div class="themes-list__info">
          <span class="themes-list__name">${t.name}</span>
          ${t.is_active ? '<span class="badge badge--accent">Active</span>' : ''}
        </div>
        <div class="themes-list__actions">
          ${!t.is_active ? `<button class="btn btn--ghost btn--sm" onclick="activateTheme(${t.id})">Activate</button>` : ''}
          <button class="btn btn--ghost btn--sm" onclick="openThemeEditor(${t.id})">Edit</button>
          ${!t.is_active ? `<button class="btn btn--danger btn--sm" onclick="deleteTheme(${t.id})">Delete</button>` : ''}
        </div>
      </div>
    `).join('');
  } catch (e) {
    container.innerHTML = '<div class="themes-list__error">Failed to load</div>';
  }
}

async function activateTheme(id) {
  try {
    await apiPost(`/api/admin/themes/${id}/activate`, {});
    await loadThemes();
  } catch (e) { alert('Error: ' + e.message); }
}

async function deleteTheme(id) {
  if (!confirm('Delete this theme?')) return;
  try {
    await apiFetch(`/api/admin/themes/${id}`, { method: 'DELETE' });
    await loadThemes();
  } catch (e) { alert('Error: ' + e.message); }
}

// ── THEME EDITOR ─────────────────────────────────────
let editorThemeId = null;
let editorTokens = {};

async function openThemeEditor(id) {
  editorThemeId = id;
  document.getElementById('themeChat').innerHTML = '';
  document.getElementById('themeChatInput').value = '';
  document.getElementById('themeEditorOverlay').classList.remove('u-hidden');

  if (id) {
    const data = await apiGet('/api/admin/themes');
    const theme = data.themes.find(t => t.id === id);
    // fetch full theme with tokens
    const full = await apiFetch(`/api/admin/themes`);
    const all = (await full.json()).themes;
    // need tokens — GET cu id
    const themeData = await apiGet(`/api/admin/themes`);
    // Workaround: fetch all and find (tokens not in list endpoint)
    // Actually we need a GET /api/admin/themes/:id — add it or use POST edit
  }

  if (id === null) {
    // New theme — start from active theme tokens
    const cssText = await fetch('/api/theme/active.css').then(r => r.text());
    editorTokens = parseCssTokens(cssText);
    document.getElementById('themeEditorName').value = 'New Theme';
  }

  renderTokens();
  updateIframePreview();

  const welcomeMsg = `Tema curentă: ${Object.keys(editorTokens).length} tokeni. Descrie ce vrei să schimbi (ex: "fă accentul roșu", "tema light cu fundal alb").`;
  appendChatMessage('claude', welcomeMsg);
}

function closeThemeEditor() {
  document.getElementById('themeEditorOverlay').classList.add('u-hidden');
  editorThemeId = null;
  editorTokens = {};
}

async function saveTheme() {
  const name = document.getElementById('themeEditorName').value.trim();
  if (!name) { alert('Theme name required'); return; }
  try {
    if (editorThemeId) {
      await apiPut(`/api/admin/themes/${editorThemeId}`, { name, tokens: editorTokens });
    } else {
      await apiPost('/api/admin/themes', { name, tokens: editorTokens });
    }
    closeThemeEditor();
    await loadThemes();
  } catch (e) { alert('Save failed: ' + e.message); }
}

async function sendThemeChat() {
  const input = document.getElementById('themeChatInput');
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  input.disabled = true;

  appendChatMessage('user', message);
  appendChatMessage('claude', '...');

  try {
    const data = await apiPost('/api/admin/themes/chat', {
      message,
      current_tokens: editorTokens,
    });
    // remove loading
    document.getElementById('themeChat').lastElementChild.remove();
    appendChatMessage('claude', data.explanation || 'Done.');
    editorTokens = data.tokens;
    renderTokens();
    updateIframePreview();
  } catch (e) {
    document.getElementById('themeChat').lastElementChild.remove();
    appendChatMessage('error', 'Error: ' + e.message);
  }
  input.disabled = false;
  input.focus();
}

function appendChatMessage(role, text) {
  const chat = document.getElementById('themeChat');
  const div = document.createElement('div');
  div.className = `theme-chat-msg theme-chat-msg--${role}`;
  div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function renderTokens() {
  const container = document.getElementById('themeTokensList');
  container.innerHTML = Object.entries(editorTokens).map(([k, v]) => `
    <div class="token-row">
      <span class="token-row__key">${k}</span>
      <span class="token-row__value">${v}</span>
    </div>
  `).join('');
}

function updateIframePreview() {
  const iframe = document.getElementById('themePreviewFrame');
  const vars = Object.entries(editorTokens).map(([k, v]) => `${k}:${v}`).join(';');
  try {
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
    let styleEl = iframeDoc.getElementById('preview-theme-override');
    if (!styleEl) {
      styleEl = iframeDoc.createElement('style');
      styleEl.id = 'preview-theme-override';
      iframeDoc.head.appendChild(styleEl);
    }
    styleEl.textContent = `:root{${vars}}`;
  } catch {}
}

function parseCssTokens(css) {
  const tokens = {};
  const matches = css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g);
  for (const [, key, value] of matches) {
    tokens[key] = value.trim();
  }
  return tokens;
}

// Helpers dacă nu există deja
async function apiFetch(path, opts = {}) {
  const token = localStorage.getItem('one21_token');
  return fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...(opts.headers || {}) },
    body: opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined,
  });
}
async function apiGet(path) { return (await apiFetch(path)).then(r => r.json()); }
async function apiPost(path, body) {
  const r = await apiFetch(path, { method: 'POST', body });
  if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'Error'); }
  return r.json();
}
async function apiPut(path, body) {
  const r = await apiFetch(path, { method: 'PUT', body });
  if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'Error'); }
  return r.json();
}
```

**Notă:** admin.html are deja funcții helper (apiGet, apiPost etc.) — dacă există deja, nu le duplica. Verifică scriptul existent înainte de a le adăuga.

**Step 2: Adaugă `loadSettings()` și `loadThemes()` în funcția `showPage(page)`**

Găsește funcția de navigație (cea cu `data-page`) și adaugă:
```js
if (page === 'settings') {
  loadSettings();
  loadThemes();
}
```

**Step 3: Adaugă GET /api/admin/themes/:id în `routes/theme.js`**

```js
adminRouter.get('/:id', (req, res) => {
  const db = getDb();
  const theme = db.prepare('SELECT * FROM themes WHERE id = ?').get(req.params.id);
  if (!theme) return res.status(404).json({ error: 'Theme not found' });
  theme.tokens = JSON.parse(theme.tokens);
  res.json({ theme });
});
```

Și actualizează `openThemeEditor(id)` să folosească acest endpoint:
```js
if (id) {
  const data = await apiGet(`/api/admin/themes/${id}`);
  editorTokens = data.theme.tokens;
  document.getElementById('themeEditorName').value = data.theme.name;
}
```

**Step 4: Commit**

```bash
git add public/admin.html routes/theme.js
git commit -m "feat: admin settings JS — API key form, themes list, theme editor with Claude chat"
```

---

## Task 8: CSS — Stiluri Settings + Theme Editor

**Files:**
- Modify: `public/css/layers/pages/admin.css`

**Step 1: Adaugă la finalul `admin.css` (în interiorul `@layer pages { }`)**

```css
/* ── Settings Tabs ─────────────────────────────── */
.settings-tabs {
  display: flex;
  gap: var(--sp-1);
  margin-bottom: var(--sp-5);
  border-bottom: 1px solid var(--border-dim);
}

.settings-tab {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: var(--font-sm);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: var(--sp-2) var(--sp-4);
  cursor: pointer;
  margin-bottom: -1px;
  transition: color var(--transition-fast), border-color var(--transition-fast);
}

.settings-tab:hover { color: var(--text-primary); }
.settings-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

.settings-panel { display: none; }
.settings-panel.active { display: block; }

/* ── Settings Fields ───────────────────────────── */
.settings-field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  max-width: 480px;
}

.settings-field__label {
  font-family: var(--font-mono);
  font-size: var(--font-xs);
  font-weight: 700;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.settings-field__row {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
}

.settings-field__row .input { flex: 1; }

.settings-field__hint {
  font-family: var(--font-mono);
  font-size: var(--font-xs);
  color: var(--text-tertiary);
}

/* ── Themes List ───────────────────────────────── */
.themes-list {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

.themes-list__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-3) var(--sp-4);
  background: var(--bg-elevated);
  border: 1px solid var(--border-dim);
  border-radius: var(--radius-md);
  transition: border-color var(--transition-fast);
}

.themes-list__item--active {
  border-color: var(--border-accent);
}

.themes-list__info {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
}

.themes-list__name {
  font-family: var(--font-mono);
  font-size: var(--font-md);
  color: var(--text-primary);
  font-weight: 600;
}

.themes-list__actions {
  display: flex;
  gap: var(--sp-2);
}

/* ── Theme Editor Overlay ──────────────────────── */
.theme-editor-overlay {
  position: fixed;
  inset: 0;
  background: var(--bg-base);
  z-index: var(--z-modal);
  display: flex;
  flex-direction: column;
}

.theme-editor-overlay.u-hidden { display: none; }

.theme-editor {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.theme-editor__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--sp-3) var(--sp-5);
  border-bottom: 1px solid var(--border-mid);
  background: var(--bg-surface);
  flex-shrink: 0;
}

.theme-editor__name {
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--border-mid);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: var(--font-lg);
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: var(--sp-1) var(--sp-2);
  outline: none;
  width: 280px;
  transition: border-color var(--transition-fast);
}

.theme-editor__name:focus { border-bottom-color: var(--accent); }

.theme-editor__actions {
  display: flex;
  gap: var(--sp-2);
}

.theme-editor__body {
  display: grid;
  grid-template-columns: 360px 1fr;
  flex: 1;
  overflow: hidden;
}

/* Chat panel */
.theme-editor__chat {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-dim);
  background: var(--bg-surface);
}

.theme-editor__chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.theme-chat-msg {
  font-family: var(--font-mono);
  font-size: var(--font-sm);
  line-height: 1.6;
  padding: var(--sp-3);
  border-radius: var(--radius-md);
  max-width: 90%;
}

.theme-chat-msg--user {
  background: var(--accent-muted);
  border: 1px solid var(--border-accent);
  color: var(--text-primary);
  align-self: flex-end;
}

.theme-chat-msg--claude {
  background: var(--bg-elevated);
  border: 1px solid var(--border-dim);
  color: var(--text-secondary);
  align-self: flex-start;
}

.theme-chat-msg--error {
  color: var(--error);
  font-size: var(--font-xs);
  align-self: flex-start;
}

.theme-editor__chat-input {
  display: flex;
  gap: var(--sp-2);
  padding: var(--sp-3);
  border-top: 1px solid var(--border-dim);
}

.theme-editor__chat-input input {
  flex: 1;
  background: var(--bg-elevated);
  border: 1px solid var(--border-mid);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: var(--font-sm);
  padding: var(--sp-2) var(--sp-3);
  outline: none;
}

.theme-editor__chat-input input:focus {
  border-color: var(--border-accent);
}

/* Preview panel */
.theme-editor__preview {
  display: grid;
  grid-template-rows: auto 1fr auto minmax(0, 200px);
  overflow: hidden;
  background: var(--bg-base);
}

.theme-editor__preview-label,
.theme-editor__tokens-label {
  font-family: var(--font-mono);
  font-size: var(--font-xs);
  font-weight: 700;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  padding: var(--sp-2) var(--sp-4);
  border-bottom: 1px solid var(--border-dim);
  background: var(--bg-surface);
}

.theme-editor__iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: var(--bg-base);
}

.theme-editor__tokens {
  overflow-y: auto;
  padding: var(--sp-3) var(--sp-4);
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}

.token-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 2px 0;
  border-bottom: 1px solid var(--border-dim);
}

.token-row__key {
  color: var(--text-secondary);
  flex-shrink: 0;
}

.token-row__value {
  color: var(--accent);
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 50%;
}
```

**Step 2: Commit**

```bash
git add public/css/layers/pages/admin.css
git commit -m "feat: CSS for settings tabs, themes list, and theme editor modal"
```

---

## Task 9: Verificare End-to-End

**Step 1: Verifică că serverul pornește fără erori**

```bash
npm run dev
# Expected: "One21 running on http://localhost:3737"
```

**Step 2: Verifică endpoint public CSS**

```bash
curl -s http://localhost:3737/api/theme/active.css | head -5
# Expected: @layer tokens { :root { --bg-base: #040404; ...
```

**Step 3: Login și deschide Settings în browser**

- Navighează la `http://localhost:3737/admin.html`
- Click Settings în sidebar
- Tab API_Keys: introdu un API key și salvează
- Tab UI_Themes: verifică că apare "Neural Dark" cu badge Active

**Step 4: Testează crearea unei teme noi**

- Click "+ New Theme"
- Scrie în chat: "fă accentul albastru"
- Verifică că preview-ul iframe se actualizează
- Salvează tema
- Activează noua temă
- Refresh `login.html` și verifică că accentul e albastru

**Step 5: Commit final**

```bash
git add -A
git commit -m "feat: complete admin theme settings with Claude AI chat editor"
```
