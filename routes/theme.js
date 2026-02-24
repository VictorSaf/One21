const express = require('express');
const { getDb } = require('../db/init');
const { authMiddleware, requireAdmin } = require('../middleware/auth');
const { decrypt } = require('../lib/crypto');

const router = express.Router();

// ── PUBLIC ──────────────────────────────────────────
// GET /api/theme/active.css
router.get('/theme/active.css', (req, res) => {
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

// POST /api/admin/themes/chat  — MUST be before /:id to avoid dynamic param capture
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

// GET /api/admin/themes/:id
adminRouter.get('/:id', (req, res) => {
  const db = getDb();
  const theme = db.prepare('SELECT * FROM themes WHERE id = ?').get(req.params.id);
  if (!theme) return res.status(404).json({ error: 'Theme not found' });
  theme.tokens = JSON.parse(theme.tokens);
  res.json({ theme });
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

router.use('/admin/themes', adminRouter);

module.exports = router;
