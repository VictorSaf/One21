const express = require('express');
const webpush = require('web-push');
const { getDb } = require('../db/init');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_MAILTO || 'mailto:admin@one21.local',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// GET /api/push/vapid-public-key — client needs this to subscribe
router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

// POST /api/push/subscribe — save push subscription for this user
router.post('/subscribe', (req, res) => {
  const { subscription } = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription' });
  }

  const db = getDb();
  const endpoint = subscription.endpoint;
  const keys = JSON.stringify(subscription.keys || {});

  // Upsert subscription (one per user per endpoint)
  db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, keys)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, endpoint) DO UPDATE SET keys = excluded.keys, updated_at = datetime('now')
  `).run(req.user.id, endpoint, keys);

  res.json({ ok: true });
});

// POST /api/push/unsubscribe — remove subscription
router.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });

  const db = getDb();
  db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
    .run(req.user.id, endpoint);
  res.json({ ok: true });
});

// Internal helper — called from socket handler when a message arrives
async function notifyUser(userId, payload) {
  if (!process.env.VAPID_PUBLIC_KEY) return;

  const db = getDb();
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);

  for (const sub of subs) {
    const subscription = {
      endpoint: sub.endpoint,
      keys: JSON.parse(sub.keys || '{}'),
    };
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
    } catch (err) {
      // Remove expired/invalid subscriptions
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
      }
    }
  }
}

module.exports = router;
module.exports.notifyUser = notifyUser;
