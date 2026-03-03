const { getDb, getDbDriver, getPgPool } = require('../db');

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
  const driver = getDbDriver();
  if (driver === 'postgres') {
    const pool = getPgPool();
    const run = async () => {
      const row = (await pool.query(
        'SELECT value FROM user_permissions WHERE user_id = $1 AND permission = $2',
        [Number(userId), permission]
      )).rows[0];
      if (!row) return DEFAULTS[permission] ?? null;
      try { return JSON.parse(row.value); } catch { return row.value; }
    };
    return run();
  }

  const db = getDb();
  const row = db.prepare('SELECT value FROM user_permissions WHERE user_id = ? AND permission = ?').get(userId, permission);
  if (!row) return DEFAULTS[permission] ?? null;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

/**
 * Read all permissions for a user (merged with defaults).
 */
function getAllPermissions(userId) {
  const driver = getDbDriver();
  if (driver === 'postgres') {
    const pool = getPgPool();
    const run = async () => {
      const rows = (await pool.query(
        'SELECT permission, value FROM user_permissions WHERE user_id = $1',
        [Number(userId)]
      )).rows;
      const perms = { ...DEFAULTS };
      for (const r of rows) {
        try { perms[r.permission] = JSON.parse(r.value); } catch { perms[r.permission] = r.value; }
      }
      return perms;
    };
    return run();
  }

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
    Promise.resolve(getPermission(req.user.id, permission)).then((value) => {
      const allowed = value !== null ? Boolean(value) : Boolean(defaultAllowed);
      if (!allowed) return res.status(403).json({ error: `Permission denied: ${permission}` });
      next();
    }).catch((err) => {
      res.status(500).json({ error: err.message || 'Permission check failed' });
    });
  };
}

module.exports = { getPermission, getAllPermissions, checkPermission, DEFAULTS };
