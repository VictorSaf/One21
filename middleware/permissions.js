const { getDb } = require('../db/init');

const DEFAULTS = {
  can_send_files: true,
  allowed_agents: [],
  max_messages_per_day: null,
  allowed_rooms: null,
};

/**
 * Read a single permission value for a user.
 * Falls back to DEFAULTS if no row exists.
 */
function getPermission(userId, permission) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM user_permissions WHERE user_id = ? AND permission = ?').get(userId, permission);
  if (!row) return DEFAULTS[permission] ?? null;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

/**
 * Read all permissions for a user (merged with defaults).
 */
function getAllPermissions(userId) {
  const db = getDb();
  const rows = db.prepare('SELECT permission, value FROM user_permissions WHERE user_id = ?').all(userId);
  const perms = { ...DEFAULTS };
  for (const r of rows) {
    try { perms[r.permission] = JSON.parse(r.value); } catch { perms[r.permission] = r.value; }
  }
  return perms;
}

/**
 * Express middleware: blocks request if user lacks permission.
 * Usage: router.post('/', checkPermission('can_send_files'), handler)
 * Admin role always bypasses all permission checks.
 */
function checkPermission(permission, defaultAllowed = true) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role === 'admin') return next();
    const value = getPermission(req.user.id, permission);
    const allowed = value !== null ? Boolean(value) : Boolean(defaultAllowed);
    if (!allowed) return res.status(403).json({ error: `Permission denied: ${permission}` });
    next();
  };
}

module.exports = { getPermission, getAllPermissions, checkPermission, DEFAULTS };
