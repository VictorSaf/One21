const { getDb } = require('./init');
const { getPgPool, closePgPool } = require('./postgres');

function getDbDriver() {
  const v = String(process.env.DB_DRIVER || 'sqlite').trim().toLowerCase();
  return v === 'postgres' ? 'postgres' : 'sqlite';
}

module.exports = {
  getDb,
  getDbDriver,
  getPgPool,
  closePgPool,
};
