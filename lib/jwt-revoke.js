const { getDb } = require('../db/init');

function getRevocationEpoch() {
  const row = getDb().prepare("SELECT value FROM app_settings WHERE key = ?").get('jwt_logout_all_at');
  return row ? parseFloat(row.value) : 0;
}

function setRevocationEpoch() {
  const epoch = Date.now() / 1000;
  getDb().prepare(
    `INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`
  ).run('jwt_logout_all_at', String(epoch));
  return epoch;
}

function isTokenRevoked(payload) {
  const iat = payload && payload.iat;
  if (iat == null) return false;
  return iat < getRevocationEpoch();
}

module.exports = { getRevocationEpoch, setRevocationEpoch, isTokenRevoked };
