require('dotenv').config();

let pool;

function getPgUrl() {
  return process.env.PG_URL || process.env.DATABASE_URL || null;
}

function getPgPool() {
  if (pool) return pool;

  let Pool;
  try {
    ({ Pool } = require('pg'));
  } catch (err) {
    throw new Error(
      "Postgres driver not installed. Run: npm i pg (or keep DB_DRIVER=sqlite)."
    );
  }

  const url = getPgUrl();
  if (!url) {
    throw new Error('Missing PG_URL (or DATABASE_URL) env var for Postgres connection.');
  }

  pool = new Pool({
    connectionString: url,
    max: Number.parseInt(process.env.PG_POOL_MAX || '10', 10),
    idleTimeoutMillis: Number.parseInt(process.env.PG_POOL_IDLE_TIMEOUT_MS || '30000', 10),
    connectionTimeoutMillis: Number.parseInt(process.env.PG_POOL_CONN_TIMEOUT_MS || '5000', 10),
  });

  return pool;
}

async function closePgPool() {
  if (!pool) return;
  const p = pool;
  pool = undefined;
  await p.end();
}

module.exports = {
  getPgPool,
  closePgPool,
  getPgUrl,
};
