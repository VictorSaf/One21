const { getDb, getDbDriver, getPgPool } = require('../db');
const { ingestDocumentPostgres, ingestDocumentSqlite } = require('./cult-ingest');

function makeWorkerId() {
  return `cult-worker-${process.pid}`;
}

async function claimNextJobPostgres(client, workerId) {
  const row = (await client.query(
    `
    WITH next_job AS (
      SELECT id
      FROM cult_document_jobs
      WHERE status = 'queued'
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
    [workerId]
  )).rows[0];

  return row || null;
}

async function runJobPostgres({ pool, job, workerId }) {
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
      await client.query(
        "UPDATE cult_document_jobs SET status = 'failed', updated_at = now(), last_error = $2 WHERE id = $1",
        [Number(job.id), err.message]
      );
    } catch {}
  } finally {
    client.release();
  }
}

function claimNextJobSqlite(db, workerId) {
  return db.transaction(() => {
    const job = db.prepare(
      "SELECT * FROM cult_document_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1"
    ).get();
    if (!job) return null;

    db.prepare(
      "UPDATE cult_document_jobs SET status = 'running', locked_at = datetime('now'), locked_by = ?, attempts = attempts + 1, updated_at = datetime('now'), last_error = NULL WHERE id = ?"
    ).run(workerId, job.id);

    return { ...job, status: 'running', locked_by: workerId };
  })();
}

async function runJobSqlite({ db, job }) {
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
      db.prepare("UPDATE cult_document_jobs SET status = 'failed', updated_at = datetime('now'), last_error = ? WHERE id = ?")
        .run(err.message, job.id);
    } catch {}
  }
}

function startCultWorker(options = {}) {
  const enabled = options.enabled !== undefined ? options.enabled : (process.env.CULT_WORKER !== '0');
  if (!enabled) return { stop: () => {} };

  const intervalMs = Number(options.intervalMs || process.env.CULT_WORKER_INTERVAL_MS || 1500);
  const workerId = makeWorkerId();
  const driver = getDbDriver();

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
          const job = await claimNextJobPostgres(client, workerId);
          await client.query('COMMIT');
          if (job) await runJobPostgres({ pool, job, workerId });
        } catch (e) {
          try { await client.query('ROLLBACK'); } catch {}
        } finally {
          client.release();
        }
      } else {
        const db = getDb();
        const job = claimNextJobSqlite(db, workerId);
        if (job) await runJobSqlite({ db, job });
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
