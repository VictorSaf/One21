const { getDb, getDbDriver, getPgPool } = require('../db');
const { ingestDocumentPostgres, ingestDocumentSqlite } = require('./cult-ingest');

function makeWorkerId() {
  return `cult-worker-${process.pid}`;
}

function getWorkerSettings(options = {}) {
  const maxAttempts = Number(options.maxAttempts || process.env.CULT_WORKER_MAX_ATTEMPTS || 3);
  const lockTtlSeconds = Number(options.lockTtlSeconds || process.env.CULT_WORKER_LOCK_TTL_SECONDS || 10 * 60);
  return {
    maxAttempts: Number.isFinite(maxAttempts) && maxAttempts > 0 ? Math.floor(maxAttempts) : 3,
    lockTtlSeconds: Number.isFinite(lockTtlSeconds) && lockTtlSeconds > 0 ? Math.floor(lockTtlSeconds) : 10 * 60,
  };
}

async function recoverStuckJobsPostgres(client, { lockTtlSeconds, maxAttempts }) {
  await client.query(
    `
    UPDATE cult_document_jobs
    SET status = CASE WHEN attempts >= $2 THEN 'failed' ELSE 'queued' END,
        locked_at = NULL,
        locked_by = NULL,
        updated_at = now(),
        last_error = COALESCE(last_error, 'Recovered from stale lock')
    WHERE status = 'running'
      AND locked_at IS NOT NULL
      AND locked_at < (now() - ($1 * interval '1 second'))
    `,
    [Number(lockTtlSeconds), Number(maxAttempts)]
  );
}

function recoverStuckJobsSqlite(db, { lockTtlSeconds, maxAttempts }) {
  const ttlExpr = `-${Number(lockTtlSeconds)} seconds`;
  db.prepare(
    `
    UPDATE cult_document_jobs
    SET status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'queued' END,
        locked_at = NULL,
        locked_by = NULL,
        updated_at = datetime('now'),
        last_error = COALESCE(last_error, 'Recovered from stale lock')
    WHERE status = 'running'
      AND locked_at IS NOT NULL
      AND locked_at < datetime('now', ?)
    `
  ).run(Number(maxAttempts), ttlExpr);
}

async function claimNextJobPostgres(client, workerId, { maxAttempts }) {
  const row = (await client.query(
    `
    WITH next_job AS (
      SELECT id
      FROM cult_document_jobs
      WHERE status = 'queued'
        AND attempts < $2
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE cult_document_jobs j
    SET status = 'running',
        locked_at = now(),
        locked_by = $1,
        attempts = attempts + 1,
        updated_at = now(),
        last_error = NULL
    FROM next_job
    WHERE j.id = next_job.id
    RETURNING j.*
    `,
    [workerId, Number(maxAttempts)]
  )).rows[0];

  return row || null;
}

async function runJobPostgres({ pool, job, workerId, maxAttempts }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const doc = (await client.query('SELECT * FROM cult_documents WHERE id = $1 FOR UPDATE', [Number(job.doc_id)])).rows[0];
    if (!doc) throw new Error('Document not found');

    await client.query("UPDATE cult_documents SET status = 'processing', error = NULL WHERE id = $1", [Number(doc.id)]);

    await ingestDocumentPostgres({
      client,
      docId: Number(doc.id),
      roomId: Number(doc.room_id),
      storageKey: doc.storage_key,
      mime: doc.mime,
    });

    await client.query(
      "UPDATE cult_documents SET status = 'processed', processed_at = now(), error = NULL WHERE id = $1",
      [Number(doc.id)]
    );
    await client.query(
      "UPDATE cult_document_jobs SET status = 'done', updated_at = now() WHERE id = $1",
      [Number(job.id)]
    );

    await client.query('COMMIT');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    try {
      await client.query(
        "UPDATE cult_documents SET status = 'failed', error = $2 WHERE id = $1",
        [Number(job.doc_id), err.message]
      );
    } catch {}
    try {
      const shouldRetry = Number(job.attempts) < Number(maxAttempts);
      await client.query(
        `
        UPDATE cult_document_jobs
        SET status = $2,
            updated_at = now(),
            locked_at = NULL,
            locked_by = NULL,
            last_error = $3
        WHERE id = $1
        `,
        [Number(job.id), shouldRetry ? 'queued' : 'failed', err.message]
      );
    } catch {}
  } finally {
    client.release();
  }
}

function claimNextJobSqlite(db, workerId, { maxAttempts }) {
  return db.transaction(() => {
    const job = db.prepare(
      "SELECT * FROM cult_document_jobs WHERE status = 'queued' AND attempts < ? ORDER BY created_at ASC LIMIT 1"
    ).get();
    if (!job) return null;

    const attempts = Number(job.attempts) || 0;
    if (attempts >= Number(maxAttempts)) return null;

    db.prepare(
      "UPDATE cult_document_jobs SET status = 'running', locked_at = datetime('now'), locked_by = ?, attempts = attempts + 1, updated_at = datetime('now'), last_error = NULL WHERE id = ?"
    ).run(workerId, job.id);

    return { ...job, status: 'running', locked_by: workerId };
  })();
}

async function runJobSqlite({ db, job, maxAttempts }) {
  try {
    const doc = db.prepare('SELECT * FROM cult_documents WHERE id = ?').get(job.doc_id);
    if (!doc) throw new Error('Document not found');

    db.prepare("UPDATE cult_documents SET status = 'processing', error = NULL WHERE id = ?").run(doc.id);

    await ingestDocumentSqlite({
      db,
      docId: doc.id,
      roomId: doc.room_id,
      storageKey: doc.storage_key,
      mime: doc.mime,
    });

    db.prepare("UPDATE cult_documents SET status = 'processed', processed_at = datetime('now'), error = NULL WHERE id = ?")
      .run(doc.id);
    db.prepare("UPDATE cult_document_jobs SET status = 'done', updated_at = datetime('now') WHERE id = ?")
      .run(job.id);
  } catch (err) {
    try {
      db.prepare("UPDATE cult_documents SET status = 'failed', error = ? WHERE id = ?").run(err.message, job.doc_id);
    } catch {}
    try {
      const shouldRetry = Number(job.attempts) < Number(maxAttempts);
      db.prepare(
        "UPDATE cult_document_jobs SET status = ?, updated_at = datetime('now'), locked_at = NULL, locked_by = NULL, last_error = ? WHERE id = ?"
      ).run(shouldRetry ? 'queued' : 'failed', err.message, job.id);
    } catch {}
  }
}

function startCultWorker(options = {}) {
  const enabled = options.enabled !== undefined ? options.enabled : (process.env.CULT_WORKER !== '0');
  if (!enabled) return { stop: () => {} };

  const intervalMs = Number(options.intervalMs || process.env.CULT_WORKER_INTERVAL_MS || 1500);
  const workerId = makeWorkerId();
  const driver = getDbDriver();
  const settings = getWorkerSettings(options);

  let running = false;
  let timer = null;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      if (driver === 'postgres') {
        const pool = getPgPool();
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await recoverStuckJobsPostgres(client, settings);
          const job = await claimNextJobPostgres(client, workerId, settings);
          await client.query('COMMIT');
          if (job) await runJobPostgres({ pool, job, workerId, maxAttempts: settings.maxAttempts });
        } catch (e) {
          try { await client.query('ROLLBACK'); } catch {}
        } finally {
          client.release();
        }
      } else {
        const db = getDb();
        recoverStuckJobsSqlite(db, settings);
        const job = claimNextJobSqlite(db, workerId, settings);
        if (job) await runJobSqlite({ db, job, maxAttempts: settings.maxAttempts });
      }
    } finally {
      running = false;
    }
  };

  timer = setInterval(() => {
    tick().catch(() => {});
  }, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  return {
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = {
  startCultWorker,
};
