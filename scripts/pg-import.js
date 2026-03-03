#!/usr/bin/env node

const path = require('path');

function requirePg() {
  try {
    return require('pg');
  } catch {
    throw new Error('Missing dependency: pg. Run: npm i pg');
  }
}

function requireSqlite() {
  try {
    return require('better-sqlite3');
  } catch {
    throw new Error('Missing dependency: better-sqlite3');
  }
}

function getPgUrl() {
  return process.env.PG_URL || process.env.DATABASE_URL || '';
}

function toBool(v) {
  return v === 1 || v === true || v === '1' || v === 'true';
}

function toJson(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(String(v));
  } catch {
    return fallback;
  }
}

function jsonText(v, fallback) {
  const normalized = toJson(v, fallback);
  return JSON.stringify(normalized);
}

async function setSequence(client, table, col = 'id') {
  const { rows } = await client.query(`SELECT COALESCE(MAX(${col}), 0) AS max_id FROM ${table}`);
  const maxId = Number(rows[0]?.max_id || 0);
  // serial sequence name convention: <table>_<col>_seq
  const seq = `${table}_${col}_seq`;
  if (maxId > 0) {
    await client.query('SELECT setval($1, $2, $3)', [seq, maxId, true]);
  } else {
    // Empty table: set sequence to 1 and mark as not-called so nextval() returns 1
    await client.query('SELECT setval($1, $2, $3)', [seq, 1, false]);
  }
}

async function assertPgEmptyOrReset(client, reset) {
  const checks = ['users', 'rooms', 'messages'];
  for (const t of checks) {
    const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
    if (rows[0].n > 0 && !reset) {
      throw new Error(
        `Postgres DB is not empty (table ${t} has ${rows[0].n} rows). Re-run with --reset to TRUNCATE before import.`
      );
    }
  }

  if (reset) {
    await client.query(`
      TRUNCATE TABLE
        message_reads,
        message_reactions,
        push_subscriptions,
        user_permissions,
        room_members,
        room_requests,
        private_requests,
        messages,
        invitations,
        rooms,
        themes,
        hub_cards,
        app_settings,
        users
      RESTART IDENTITY CASCADE;
    `);
    await client.query('DELETE FROM schema_migrations WHERE filename = $1', ['_sqlite_import']);
  }
}

async function main() {
  const reset = process.argv.includes('--reset');

  const url = getPgUrl();
  if (!url) {
    throw new Error('PG_URL (or DATABASE_URL) must be set. Example: PG_URL=postgres://<user>@localhost:5432/one21');
  }

  const sqlitePath = process.env.SQLITE_PATH || path.join(__dirname, '..', 'db', 'chat.db');

  const Sqlite = requireSqlite();
  const sqlite = new Sqlite(sqlitePath, { readonly: true, fileMustExist: true });

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

    const already = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', ['_sqlite_import']);
    if (already.rowCount > 0 && !reset) {
      throw new Error('SQLite import already recorded. Re-run with --reset if you want to re-import.');
    }

    await assertPgEmptyOrReset(client, reset);

    // Import order: users -> invitations -> rooms -> room_members -> messages -> dependent tables

    const users = sqlite.prepare('SELECT * FROM users ORDER BY id').all();
    for (const u of users) {
      await client.query(
        `INSERT INTO users (id, username, display_name, password_hash, role, avatar_url, invited_by, invite_code, is_online, last_seen, chat_color_index, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO NOTHING`,
        [
          u.id,
          u.username,
          u.display_name,
          u.password_hash,
          u.role,
          u.avatar_url,
          u.invited_by,
          u.invite_code,
          toBool(u.is_online),
          u.last_seen ? new Date(u.last_seen) : null,
          u.chat_color_index ?? null,
          u.created_at ? new Date(u.created_at) : new Date(),
        ]
      );
    }

    const invitations = sqlite.prepare('SELECT * FROM invitations ORDER BY id').all();
    for (const inv of invitations) {
      await client.query(
        `INSERT INTO invitations (id, code, created_by, used_by, expires_at, created_at, token, nume, prenume, default_permissions, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
         ON CONFLICT (id) DO NOTHING`,
        [
          inv.id,
          inv.code,
          inv.created_by,
          inv.used_by,
          inv.expires_at ? new Date(inv.expires_at) : null,
          inv.created_at ? new Date(inv.created_at) : new Date(),
          inv.token,
          inv.nume,
          inv.prenume,
          jsonText(inv.default_permissions, {}),
          inv.note,
        ]
      );
    }

    const rooms = sqlite.prepare('SELECT * FROM rooms ORDER BY id').all();
    for (const r of rooms) {
      await client.query(
        `INSERT INTO rooms (id, name, description, type, is_archived, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO NOTHING`,
        [
          r.id,
          r.name,
          r.description,
          r.type,
          toBool(r.is_archived),
          r.created_by,
          r.created_at ? new Date(r.created_at) : new Date(),
        ]
      );
    }

    const roomMembers = sqlite.prepare('SELECT * FROM room_members ORDER BY room_id, user_id').all();
    for (const rm of roomMembers) {
      await client.query(
        `INSERT INTO room_members (room_id, user_id, role, access_level, color_index, joined_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (room_id, user_id) DO NOTHING`,
        [
          rm.room_id,
          rm.user_id,
          rm.role,
          rm.access_level,
          rm.color_index ?? null,
          rm.joined_at ? new Date(rm.joined_at) : new Date(),
        ]
      );
    }

    const messages = sqlite.prepare('SELECT * FROM messages ORDER BY id').all();
    for (const m of messages) {
      await client.query(
        `INSERT INTO messages (id, room_id, sender_id, recipient_id, text, type, file_url, file_name, reply_to, is_edited, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO NOTHING`,
        [
          m.id,
          m.room_id,
          m.sender_id,
          m.recipient_id ?? null,
          m.text,
          m.type,
          m.file_url,
          m.file_name,
          m.reply_to ?? null,
          toBool(m.is_edited),
          m.created_at ? new Date(m.created_at) : new Date(),
        ]
      );
    }

    const messageReads = sqlite.prepare('SELECT * FROM message_reads').all();
    for (const mr of messageReads) {
      await client.query(
        `INSERT INTO message_reads (message_id, user_id, read_at)
         VALUES ($1,$2,$3)
         ON CONFLICT (message_id, user_id) DO NOTHING`,
        [
          mr.message_id,
          mr.user_id,
          mr.read_at ? new Date(mr.read_at) : new Date(),
        ]
      );
    }

    const pushSubs = sqlite.prepare('SELECT * FROM push_subscriptions ORDER BY id').all();
    for (const ps of pushSubs) {
      await client.query(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, keys, created_at, updated_at)
         VALUES ($1,$2,$3,$4::jsonb,$5,$6)
         ON CONFLICT (id) DO NOTHING`,
        [
          ps.id,
          ps.user_id,
          ps.endpoint,
          jsonText(ps.keys, {}),
          ps.created_at ? new Date(ps.created_at) : new Date(),
          ps.updated_at ? new Date(ps.updated_at) : new Date(),
        ]
      );
    }

    const userPerms = sqlite.prepare('SELECT * FROM user_permissions').all();
    for (const up of userPerms) {
      await client.query(
        `INSERT INTO user_permissions (user_id, permission, value, granted_by, granted_at)
         VALUES ($1,$2,$3::jsonb,$4,$5)
         ON CONFLICT (user_id, permission) DO NOTHING`,
        [
          up.user_id,
          up.permission,
          jsonText(up.value, true),
          up.granted_by,
          up.granted_at ? new Date(up.granted_at) : new Date(),
        ]
      );
    }

    const roomRequests = sqlite.prepare('SELECT * FROM room_requests ORDER BY id').all();
    for (const rr of roomRequests) {
      await client.query(
        `INSERT INTO room_requests (id, requested_by, name, description, requested_members, status, reviewed_by, reviewed_at, admin_note, created_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO NOTHING`,
        [
          rr.id,
          rr.requested_by,
          rr.name,
          rr.description,
          jsonText(rr.requested_members, []),
          rr.status,
          rr.reviewed_by,
          rr.reviewed_at ? new Date(rr.reviewed_at) : null,
          rr.admin_note,
          rr.created_at ? new Date(rr.created_at) : new Date(),
        ]
      );
    }

    const themes = sqlite.prepare('SELECT * FROM themes ORDER BY id').all();
    for (const t of themes) {
      await client.query(
        `INSERT INTO themes (id, name, tokens, is_active, created_at, updated_at)
         VALUES ($1,$2,$3::jsonb,$4,$5,$6)
         ON CONFLICT (id) DO NOTHING`,
        [
          t.id,
          t.name,
          jsonText(t.tokens, {}),
          toBool(t.is_active),
          t.created_at ? new Date(t.created_at) : new Date(),
          t.updated_at ? new Date(t.updated_at) : new Date(),
        ]
      );
    }

    const hubCards = sqlite.prepare('SELECT * FROM hub_cards ORDER BY id').all();
    for (const hc of hubCards) {
      await client.query(
        `INSERT INTO hub_cards (id, title, description, icon, image_url, accent_color, action_type, action_payload, sort_order, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
         ON CONFLICT (id) DO NOTHING`,
        [
          hc.id,
          hc.title,
          hc.description,
          hc.icon,
          hc.image_url,
          hc.accent_color,
          hc.action_type,
          jsonText(hc.action_payload, {}),
          hc.sort_order ?? 0,
          hc.created_at ? new Date(hc.created_at) : new Date(),
        ]
      );
    }

    const appSettings = sqlite.prepare('SELECT * FROM app_settings ORDER BY key').all();
    for (const s of appSettings) {
      await client.query(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ($1,$2::jsonb,$3)
         ON CONFLICT (key) DO NOTHING`,
        [
          s.key,
          jsonText(s.value, s.value),
          s.updated_at ? new Date(s.updated_at) : new Date(),
        ]
      );
    }

    const reactions = sqlite.prepare('SELECT * FROM message_reactions').all();
    for (const r of reactions) {
      await client.query(
        `INSERT INTO message_reactions (message_id, user_id, emoji)
         VALUES ($1,$2,$3)
         ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
        [r.message_id, r.user_id, r.emoji]
      );
    }

    const privateReqs = sqlite.prepare('SELECT * FROM private_requests ORDER BY id').all();
    for (const pr of privateReqs) {
      await client.query(
        `INSERT INTO private_requests (id, from_user_id, to_user_id, initial_message, status, created_at, responded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id) DO NOTHING`,
        [
          pr.id,
          pr.from_user_id,
          pr.to_user_id,
          pr.initial_message,
          pr.status,
          pr.created_at ? new Date(pr.created_at) : new Date(),
          pr.responded_at ? new Date(pr.responded_at) : null,
        ]
      );
    }

    // Fix sequences
    await setSequence(client, 'users');
    await setSequence(client, 'invitations');
    await setSequence(client, 'rooms');
    await setSequence(client, 'messages');
    await setSequence(client, 'push_subscriptions');
    await setSequence(client, 'room_requests');
    await setSequence(client, 'themes');
    await setSequence(client, 'hub_cards');
    await setSequence(client, 'private_requests');

    await client.query('INSERT INTO schema_migrations(filename) VALUES ($1) ON CONFLICT DO NOTHING', ['_sqlite_import']);

    await client.query('COMMIT');
    console.log('[pg:import] done');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
    await pool.end();
    try { sqlite.close(); } catch {}
  }
}

main().catch((err) => {
  console.error('[pg:import] error:', err.message);
  process.exit(1);
});
