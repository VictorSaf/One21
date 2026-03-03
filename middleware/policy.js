const { getDb, getDbDriver, getPgPool } = require('../db');
const { getPermission, DEFAULTS } = require('./permissions');

const ACCESS_LEVELS = new Set(['readonly', 'readandwrite', 'post_docs']);
function normalizeAccessLevel(value) {
  return ACCESS_LEVELS.has(value) ? value : 'readandwrite';
}

function parsePermissionValue(raw, fallback) {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'number') return Boolean(raw);
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

async function getUserPermission(driver, pool, userId, permission) {
  if (driver === 'postgres') {
    const row = (await pool.query(
      'SELECT value FROM user_permissions WHERE user_id = $1 AND permission = $2',
      [userId, permission]
    )).rows[0];
    if (!row) return DEFAULTS[permission] ?? null;
    return parsePermissionValue(row.value, DEFAULTS[permission] ?? null);
  }

  return getPermission(userId, permission);
}

async function getRoomMembership(driver, pool, roomId, userId) {
  if (driver === 'postgres') {
    const row = (await pool.query(
      'SELECT role, access_level FROM room_members WHERE room_id = $1 AND user_id = $2',
      [roomId, userId]
    )).rows[0];
    if (!row) return null;
    return { role: row.role, access_level: normalizeAccessLevel(row.access_level) };
  }

  const db = getDb();
  const row = db.prepare('SELECT role, access_level FROM room_members WHERE room_id = ? AND user_id = ?').get(roomId, userId);
  if (!row) return null;
  return { role: row.role, access_level: normalizeAccessLevel(row.access_level) };
}

async function getRoomType(driver, pool, roomId) {
  if (driver === 'postgres') {
    const row = (await pool.query('SELECT type FROM rooms WHERE id = $1', [roomId])).rows[0];
    return row ? row.type : null;
  }

  const db = getDb();
  const row = db.prepare('SELECT type FROM rooms WHERE id = ?').get(roomId);
  return row ? row.type : null;
}

async function getAgentMemberIds(driver, pool, roomId) {
  if (driver === 'postgres') {
    const rows = (await pool.query(
      "SELECT u.id FROM room_members rm JOIN users u ON rm.user_id = u.id WHERE rm.room_id = $1 AND u.role = 'agent'",
      [roomId]
    )).rows;
    return rows.map((r) => Number(r.id));
  }

  const db = getDb();
  const rows = db.prepare(
    "SELECT u.id FROM room_members rm JOIN users u ON rm.user_id = u.id WHERE rm.room_id = ? AND u.role = 'agent'"
  ).all(roomId);
  return rows.map((r) => r.id);
}

async function getTodayMessageCount(driver, pool, userId) {
  if (driver === 'postgres') {
    const row = (await pool.query(
      "SELECT COUNT(*)::int as n FROM messages WHERE sender_id = $1 AND created_at >= date_trunc('day', now())",
      [userId]
    )).rows[0];
    return Number(row?.n || 0);
  }

  const db = getDb();
  return db.prepare(
    "SELECT COUNT(*) as n FROM messages WHERE sender_id = ? AND created_at >= date('now')"
  ).get(userId).n;
}

async function assertCanSendFiles({ roomId, user }) {
  if (!user) return { ok: false, status: 401, error: 'Unauthorized' };
  if (user.role === 'admin') return { ok: true };

  const driver = getDbDriver();
  const pool = driver === 'postgres' ? getPgPool() : null;
  const val = await getUserPermission(driver, pool, Number(user.id), 'can_send_files');
  const allowed = val !== null ? Boolean(val) : true;
  if (!allowed) return { ok: false, status: 403, error: 'Permission denied: can_send_files' };

  const membership = await getRoomMembership(driver, pool, Number(roomId), Number(user.id));
  if (!membership) return { ok: false, status: 403, error: 'Not a member of this room' };
  if (membership.access_level === 'readonly') {
    return { ok: false, status: 403, error: 'This room is read-only for your account.' };
  }

  return { ok: true, membership };
}

async function assertCanWhisper({ roomId, user }) {
  if (!user) return { ok: false, status: 401, error: 'Unauthorized' };

  const driver = getDbDriver();
  const pool = driver === 'postgres' ? getPgPool() : null;

  const membership = await getRoomMembership(driver, pool, Number(roomId), Number(user.id));
  if (!membership) return { ok: false, status: 403, error: 'Not a member of this room' };

  if (user.role !== 'admin') {
    if (membership.access_level === 'readonly') {
      return { ok: false, status: 403, error: 'This room is read-only for your account.' };
    }
    if (membership.access_level === 'post_docs') {
      return { ok: false, status: 403, error: 'You can only post documents in this room.' };
    }

    const maxPerDay = await getUserPermission(driver, pool, Number(user.id), 'max_messages_per_day');
    const max = (maxPerDay === null || maxPerDay === undefined) ? null : Number(maxPerDay);
    if (Number.isFinite(max) && max !== null) {
      const todayCount = await getTodayMessageCount(driver, pool, Number(user.id));
      if (todayCount >= max) {
        return { ok: false, status: 429, error: `Daily message limit of ${max} reached.` };
      }
    }
  }

  return { ok: true, membership };
}

async function assertCanPostMessage({ roomId, user, messageType }) {
  if (!user) return { ok: false, status: 401, error: 'Unauthorized' };

  const driver = getDbDriver();
  const pool = driver === 'postgres' ? getPgPool() : null;

  const membership = await getRoomMembership(driver, pool, Number(roomId), Number(user.id));
  if (!membership) return { ok: false, status: 403, error: 'Not a member of this room' };

  if (user.role !== 'admin') {
    if (membership.access_level === 'readonly') {
      return { ok: false, status: 403, error: 'This room is read-only for your account.' };
    }
    if (membership.access_level === 'post_docs' && messageType !== 'file') {
      return { ok: false, status: 403, error: 'You can only post documents in this room.' };
    }

    const roomType = await getRoomType(driver, pool, Number(roomId));
    if (roomType === 'channel') {
      return { ok: false, status: 403, error: 'Folosește @username în aplicație pentru mesaje private în acest canal.' };
    }

    const maxPerDay = await getUserPermission(driver, pool, Number(user.id), 'max_messages_per_day');
    const max = (maxPerDay === null || maxPerDay === undefined) ? null : Number(maxPerDay);
    if (Number.isFinite(max) && max !== null) {
      const todayCount = await getTodayMessageCount(driver, pool, Number(user.id));
      if (todayCount >= max) {
        return { ok: false, status: 429, error: `Daily message limit of ${max} reached.` };
      }
    }

    const agentIds = await getAgentMemberIds(driver, pool, Number(roomId));
    if (agentIds.length) {
      const allowedAgents = await getUserPermission(driver, pool, Number(user.id), 'allowed_agents');
      const allowed = Array.isArray(allowedAgents) ? allowedAgents.map(Number) : [];
      const hasAccess = agentIds.some((id) => allowed.includes(id));
      if (!hasAccess) {
        return { ok: false, status: 403, error: 'You do not have access to AI agents in this room.' };
      }
    }
  }

  return { ok: true, membership };
}

module.exports = {
  normalizeAccessLevel,
  assertCanPostMessage,
  assertCanSendFiles,
  assertCanWhisper,
};
