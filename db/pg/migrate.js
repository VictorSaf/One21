const fs = require('fs');
const path = require('path');

function listMigrations(dir) {
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.map((f) => ({
    filename: f,
    sql: fs.readFileSync(path.join(dir, f), 'utf8'),
  }));
}

async function applyPgMigrations(pool, options = {}) {
  const migrationsDir = options.migrationsDir
    ? String(options.migrationsDir)
    : path.join(__dirname, 'migrations');

  const migrations = listMigrations(migrationsDir);

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
      if (applied.has(m.filename)) continue;
      await client.query(m.sql);
      await client.query('INSERT INTO schema_migrations(filename) VALUES ($1)', [m.filename]);
    }

    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  applyPgMigrations,
};
