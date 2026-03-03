#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function requirePg() {
  try {
    return require('pg');
  } catch {
    throw new Error('Missing dependency: pg. Run: npm i pg');
  }
}

function getPgUrl() {
  return process.env.PG_URL || process.env.DATABASE_URL || '';
}

function listMigrations(dir) {
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.map((f) => ({
    filename: f,
    fullPath: path.join(dir, f),
    sql: fs.readFileSync(path.join(dir, f), 'utf8'),
  }));
}

async function main() {
  const url = getPgUrl();
  if (!url) {
    throw new Error('PG_URL (or DATABASE_URL) must be set. Example: PG_URL=postgres://<user>@localhost:5432/one21');
  }

  const migrationsDir = path.join(__dirname, '..', 'db', 'pg', 'migrations');
  const migrations = listMigrations(migrationsDir);

  const { Pool } = requirePg();
  const pool = new Pool({ connectionString: url });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id         bigserial PRIMARY KEY,
        filename   text NOT NULL UNIQUE,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    const appliedRows = await client.query('SELECT filename FROM schema_migrations');
    const applied = new Set(appliedRows.rows.map((r) => r.filename));

    for (const m of migrations) {
      if (applied.has(m.filename)) {
        continue;
      }

      process.stdout.write(`[pg:migrate] applying ${m.filename}... `);
      await client.query(m.sql);
      await client.query('INSERT INTO schema_migrations(filename) VALUES ($1)', [m.filename]);
      process.stdout.write('ok\n');
    }

    await client.query('COMMIT');
    console.log('[pg:migrate] done');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[pg:migrate] error:', err.message);
  process.exit(1);
});
