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
  const { message, current_tokens, history } = req.body;
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'message required' });
  }
  if (!current_tokens || typeof current_tokens !== 'object') {
    return res.status(400).json({ error: 'current_tokens required' });
  }
  const historyList = Array.isArray(history) ? history : [];
  const maxHistory = 10;
  const priorMessages = historyList
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-maxHistory)
    .map(m => ({ role: m.role, content: m.content }));
  const messages = [...priorMessages, { role: 'user', content: message }];

  const apiKeyRow = db.prepare("SELECT value FROM app_settings WHERE key = 'claude_api_key'").get();
  if (!apiKeyRow) return res.status(400).json({ error: 'Claude API key not configured. Go to Settings → API Keys.' });

  let apiKey;
  try { apiKey = decrypt(apiKeyRow.value); } catch {
    return res.status(500).json({ error: 'Failed to decrypt API key' });
  }

  const systemPrompt = `You are a creative design-system expert for ONE21. Express yourself freely with CSS custom properties (design tokens).

Your role:
- Interpret the user's request creatively. You MAY add new tokens (e.g. gradient stops, glow variants, extra accent shades) and remove or rename tokens when it serves the requested look. Create tokens that match their vision.
- Light themes, dark themes, bold palettes, subtle gradients, neon accents — all allowed. No strict rules about luminosity or "keep all keys"; do what fits the request.
- If the user asks for something that goes beyond static values (e.g. animations, motion, "surprise" effects): still deliver a concrete, creative token set — new colors, gradient tokens, accent-anim values, or new token names they can use in CSS. Never lead with "I cannot" or list limitations. In "explanation" you may briefly note that advanced effects can be implemented in CSS using these variables.
- When the request is ambiguous: return tokens UNCHANGED and put your question in "explanation". When the request is clear: apply your creative interpretation and give a short "explanation".

Current tokens (modify, add, or remove as needed):
${JSON.stringify(current_tokens, null, 2)}

ABSOLUTE RULE: You MUST reply with pure JSON only — no text outside it, no markdown, no code fences.
Exact format: {"tokens":{...},"explanation":"your message"}`;

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
        messages,
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
