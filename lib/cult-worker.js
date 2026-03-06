const { getDb, getDbDriver, getPgPool } = require('../db');
const { ingestDocumentPostgres, ingestDocumentSqlite } = require('./cult-ingest');

function makeWorkerId() {
  return `cult-worker-${process.pid}`;
}

function getWorkerSettings(options = {}) {
  const maxAttempts = Number(options.maxAttempts || process.env.CULT_WORKER_MAX_ATTEMPTS || 3);
  const lockTtlSeconds = Number(options.lockTtlSeconds || process.env.CULT_WORKER_LOCK_TTL_SECONDS || 10 * 60);
  const baseBackoffSeconds = Number(options.baseBackoffSeconds || process.env.CULT_WORKER_BASE_BACKOFF_SECONDS || 5);
  return {
    maxAttempts: Number.isFinite(maxAttempts) && maxAttempts > 0 ? Math.floor(maxAttempts) : 3,
    lockTtlSeconds: Number.isFinite(lockTtlSeconds) && lockTtlSeconds > 0 ? Math.floor(lockTtlSeconds) : 10 * 60,
    baseBackoffSeconds: Number.isFinite(baseBackoffSeconds) && baseBackoffSeconds > 0 ? Math.floor(baseBackoffSeconds) : 5,
  };
}

function computeBackoffSeconds(attempts, baseBackoffSeconds) {
  const a = Math.max(1, Number(attempts) || 1);
  const base = Math.max(1, Number(baseBackoffSeconds) || 5);
  const exp = Math.min(8, a - 1);
  return base * (2 ** exp);
}

async function recoverStuckJobsPostgres(client, { lockTtlSeconds, maxAttempts }) {
  await client.query(
    `
    UPDATE cult_document_jobs
    SET status = CASE WHEN attempts >= $2 THEN 'failed' ELSE 'queued' END,
        locked_at = NULL,
        locked_by = NULL,
        updated_at = now(),
        last_error = COALESCE(last_error, 'Recovered from stale lock'),
        next_run_at = COALESCE(next_run_at, now())
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
        last_error = COALESCE(last_error, 'Recovered from stale lock'),
        next_run_at = COALESCE(next_run_at, datetime('now'))
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
        AND (next_run_at IS NULL OR next_run_at <= now())
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
        last_error = NULL,
        next_run_at = NULL
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
      const delaySeconds = computeBackoffSeconds(Number(job.attempts) + 1, getWorkerSettings().baseBackoffSeconds);
      await client.query(
        `
        UPDATE cult_document_jobs
        SET status = $2,
            updated_at = now(),
            locked_at = NULL,
            locked_by = NULL,
            last_error = $3,
            next_run_at = CASE WHEN $2 = 'queued' THEN (now() + ($4 * interval '1 second')) ELSE NULL END
        WHERE id = $1
        `,
        [Number(job.id), shouldRetry ? 'queued' : 'failed', err.message, Number(delaySeconds)]
      );
    } catch {}
  } finally {
    client.release();
  }
}

function claimNextJobSqlite(db, workerId, { maxAttempts }) {
  return db.transaction(() => {
    const job = db.prepare(
      "SELECT * FROM cult_document_jobs WHERE status = 'queued' AND attempts < ? AND (next_run_at IS NULL OR next_run_at <= datetime('now')) ORDER BY created_at ASC LIMIT 1"
    ).get(Number(maxAttempts));
    if (!job) return null;

    const attempts = Number(job.attempts) || 0;
    if (attempts >= Number(maxAttempts)) return null;

    db.prepare(
      "UPDATE cult_document_jobs SET status = 'running', locked_at = datetime('now'), locked_by = ?, attempts = attempts + 1, updated_at = datetime('now'), last_error = NULL, next_run_at = NULL WHERE id = ?"
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
      const delaySeconds = computeBackoffSeconds(Number(job.attempts) + 1, getWorkerSettings().baseBackoffSeconds);
      db.prepare(
        "UPDATE cult_document_jobs SET status = ?, updated_at = datetime('now'), locked_at = NULL, locked_by = NULL, last_error = ?, next_run_at = CASE WHEN ? = 'queued' THEN datetime('now', ?) ELSE NULL END WHERE id = ?"
      ).run(shouldRetry ? 'queued' : 'failed', err.message, shouldRetry ? 'queued' : 'failed', `+${Number(delaySeconds)} seconds`, job.id);
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
