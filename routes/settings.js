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
