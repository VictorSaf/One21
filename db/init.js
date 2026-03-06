require('dotenv').config();
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'chat.db');

let db;

function getDb() {
  if (db) return db;

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin','user','agent')),
      avatar_url TEXT,
      invited_by INTEGER REFERENCES users(id),
      invite_code TEXT,
      is_online INTEGER NOT NULL DEFAULT 0,
      last_seen TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id),
      used_by INTEGER REFERENCES users(id),
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      token TEXT,
      nume TEXT,
      prenume TEXT
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      type TEXT NOT NULL DEFAULT 'group' CHECK(type IN ('direct','group','channel')),
      is_archived INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS room_members (
      room_id INTEGER NOT NULL REFERENCES rooms(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner','member')),
      access_level TEXT NOT NULL DEFAULT 'readandwrite' CHECK(access_level IN ('readonly','readandwrite','post_docs')),
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (room_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL REFERENCES rooms(id),
      sender_id INTEGER NOT NULL REFERENCES users(id),
      text TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'text' CHECK(type IN ('text','file','system')),
      file_url TEXT,
      file_name TEXT,
      reply_to INTEGER REFERENCES messages(id),
      is_edited INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS message_reads (
      message_id INTEGER NOT NULL REFERENCES messages(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      read_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (message_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL,
      keys TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, endpoint)
    );

    CREATE TABLE IF NOT EXISTS user_permissions (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission TEXT NOT NULL,
      value      TEXT NOT NULL DEFAULT 'true',
      granted_by INTEGER REFERENCES users(id),
      granted_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, permission)
    );

    CREATE TABLE IF NOT EXISTS room_requests (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      requested_by      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name              TEXT NOT NULL,
      description       TEXT,
      requested_members TEXT DEFAULT '[]',
      status            TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      reviewed_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at       TEXT,
      admin_note        TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS themes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      tokens     TEXT NOT NULL,
      is_active  INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hub_cards (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      title          TEXT NOT NULL,
      description    TEXT,
      icon           TEXT,
      image_url      TEXT,
      accent_color   TEXT,
      action_type    TEXT NOT NULL CHECK(action_type IN ('url','room','script','internal_app')),
      action_payload TEXT NOT NULL,
      sort_order     INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_invitations_code ON invitations(code);
    CREATE INDEX IF NOT EXISTS idx_message_reads_user ON message_reads(user_id);
    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id);
    CREATE INDEX IF NOT EXISTS idx_room_requests_status  ON room_requests(status);
    CREATE INDEX IF NOT EXISTS idx_themes_active ON themes(is_active);
    CREATE INDEX IF NOT EXISTS idx_hub_cards_sort ON hub_cards(sort_order);
  `);

  // Run migrations for existing DBs
  migrate(db);

  const userCount = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
  if (userCount.cnt === 0) seed(db);

  return db;
}

function migrate(db) {
  // Add columns that may not exist in older DBs
  const safeAdd = (table, column, definition) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      console.log(`[DB] Migrated: added ${table}.${column}`);
    } catch {}
  };

  safeAdd('users', 'avatar_url', 'TEXT');
  safeAdd('users', 'chat_color_index', 'INTEGER');
  try {
    const usersWithoutColor = db.prepare("SELECT id FROM users WHERE chat_color_index IS NULL AND role != 'admin' ORDER BY id").all();
    usersWithoutColor.forEach((u, i) => {
      db.prepare('UPDATE users SET chat_color_index = ? WHERE id = ?').run(i % 8, u.id);
    });
    if (usersWithoutColor.length > 0) {
      console.log(`[DB] Backfilled chat_color_index for ${usersWithoutColor.length} users`);
    }
  } catch {}
  safeAdd('rooms', 'is_archived', 'INTEGER NOT NULL DEFAULT 0');
  safeAdd('room_members', 'access_level', "TEXT NOT NULL DEFAULT 'readandwrite'");
  safeAdd('room_members', 'color_index', 'INTEGER');
  // Backfill: for each room, assign colors 0,1,2... to members in join order
  try {
    const membersWithoutColor = db.prepare(
      'SELECT room_id, user_id FROM room_members WHERE color_index IS NULL ORDER BY room_id, joined_at'
    ).all();

    // Group by room
    const byRoom = {};
    for (const row of membersWithoutColor) {
      if (!byRoom[row.room_id]) byRoom[row.room_id] = [];
      byRoom[row.room_id].push(row.user_id);
    }

    const update = db.prepare('UPDATE room_members SET color_index = ? WHERE room_id = ? AND user_id = ?');
    for (const [roomId, userIds] of Object.entries(byRoom)) {
      userIds.forEach((uid, i) => update.run(i % 8, roomId, uid));
    }
    if (membersWithoutColor.length > 0) {
      console.log(`[DB] Backfilled room_members.color_index for ${membersWithoutColor.length} rows`);
    }
  } catch (e) { console.error('[DB] color_index backfill error:', e.message); }
  safeAdd('messages', 'file_url', 'TEXT');
  safeAdd('messages', 'file_name', 'TEXT');
  safeAdd('messages', 'is_edited', 'INTEGER NOT NULL DEFAULT 0');
  safeAdd('messages', 'recipient_id', 'INTEGER REFERENCES users(id)');
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_id)');
  } catch {}
  // Migrate General room from group → channel (admin-only broadcasting)
  try {
    const generalRoom = db.prepare("SELECT id FROM rooms WHERE name = 'General' AND type = 'group'").get();
    if (generalRoom) {
      db.prepare("UPDATE rooms SET type = 'channel' WHERE id = ?").run(generalRoom.id);
      console.log('[DB] Migrated: General room type -> channel');
    }
  } catch {}
  // Set all non-admin General members to readonly
  try {
    const generalId = db.prepare("SELECT id FROM rooms WHERE name = 'General' AND type = 'channel'").get()?.id;
    if (generalId) {
      db.prepare(`
        UPDATE room_members SET access_level = 'readonly'
        WHERE room_id = ? AND role = 'member'
          AND user_id IN (SELECT id FROM users WHERE role != 'admin')
      `).run(generalId);
    }
  } catch {}
  safeAdd('invitations', 'default_permissions', "TEXT DEFAULT '{}'");
  safeAdd('invitations', 'note', 'TEXT');
  safeAdd('invitations', 'token', 'TEXT');
  safeAdd('invitations', 'nume', 'TEXT');
  safeAdd('invitations', 'prenume', 'TEXT');
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token) WHERE token IS NOT NULL');
  } catch {}

  safeAdd('cult_document_jobs', 'next_run_at', 'TEXT');

  try {
    db.exec(`CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS themes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      tokens TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.exec("CREATE INDEX IF NOT EXISTS idx_themes_active ON themes(is_active)");
    const hasTheme = db.prepare('SELECT COUNT(*) as n FROM themes').get().n;
    if (hasTheme === 0) {
      const defaultTokens = {"--bg-base":"#040404","--bg-surface":"#0d0d0d","--bg-elevated":"#141414","--bg-active":"#1a1a1a","--bg-hover":"rgba(255,255,255,0.04)","--border-dim":"#1c1c1c","--border-mid":"#272727","--border-bright":"#383838","--border-accent":"rgba(0,230,118,0.2)","--border-accent-strong":"rgba(0,230,118,0.5)","--accent":"#00e676","--accent-dim":"#00b856","--accent-muted":"rgba(0,230,118,0.07)","--accent-glow":"rgba(0,230,118,0.15)","--text-primary":"#c4c4c4","--text-secondary":"#545454","--text-tertiary":"#2c2c2c","--text-accent":"#00e676","--text-inverse":"#070707","--online":"#00e676","--offline":"#333333","--busy":"#ff9c00","--error":"#ff3d3d","--warning":"#ffb300","--info":"#00b4d8","--danger":"#ff3d3d","--danger-muted":"rgba(255,61,61,0.08)","--danger-border":"rgba(255,61,61,0.2)","--danger-border-mid":"rgba(255,61,61,0.35)","--danger-hover":"rgba(255,61,61,0.07)","--danger-focus":"rgba(255,61,61,0.4)","--danger-focus-shadow":"rgba(255,61,61,0.08)","--danger-border-25":"rgba(255,61,61,0.25)","--danger-border-50":"rgba(255,61,61,0.5)","--danger-bg":"rgba(255,61,61,0.06)","--purple":"#8888ff","--purple-muted":"rgba(100,100,220,0.12)","--purple-light":"#a78bfa","--purple-border":"rgba(167,139,250,0.25)","--purple-bg":"rgba(167,139,250,0.06)","--info-muted":"rgba(0,180,216,0.12)","--info-border":"rgba(0,180,216,0.25)","--info-bg":"rgba(0,180,216,0.05)","--overlay-bg":"rgba(0,0,0,0.75)","--shadow-overlay":"rgba(0,0,0,0.6)","--overlay-bg-50":"rgba(0,0,0,0.5)","--accent-anim-glow-0":"rgba(0,230,118,0)","--accent-anim-glow-35":"rgba(0,230,118,0.35)","--accent-anim-bg-05":"rgba(0,230,118,0.05)","--accent-anim-bg-06":"rgba(0,230,118,0.06)","--accent-anim-bg-08":"rgba(0,230,118,0.08)","--accent-anim-bg-12":"rgba(0,230,118,0.12)","--accent-anim-bg-30":"rgba(0,230,118,0.3)","--accent-border-25":"rgba(0,230,118,0.25)","--accent-border-40":"rgba(0,230,118,0.4)","--accent-border-60":"rgba(0,230,118,0.6)","--accent-bg-gradient-1":"rgba(0,230,118,0.025)","--accent-bg-gradient-2":"rgba(0,230,118,0.014)","--shadow-sm":"0 1px 4px rgba(0,0,0,0.6)","--shadow-md":"0 4px 16px rgba(0,0,0,0.7)","--shadow-lg":"0 12px 40px rgba(0,0,0,0.85)","--warning-muted":"rgba(255,179,0,0.08)","--scanline-color":"rgba(0,0,0,0.025)","--selection-bg":"rgba(0,230,118,0.18)"};
      db.prepare("INSERT INTO themes (name, tokens, is_active) VALUES (?, ?, 1)").run('Neural Dark', JSON.stringify(defaultTokens));
    }
    /* Theme "test3": professional, sophisticated, diversified; animated bg/borders via existing keyframes */
    const test3Exists = db.prepare("SELECT 1 FROM themes WHERE name = 'test3'").get();
    if (!test3Exists) {
      try {
        const test3Path = path.join(__dirname, '..', 'public', 'themes', 'test3-tokens.json');
        const test3Tokens = JSON.parse(fs.readFileSync(test3Path, 'utf8'));
        db.prepare("INSERT INTO themes (name, tokens, is_active) VALUES (?, ?, 0)").run('test3', JSON.stringify(test3Tokens));
        console.log('[DB] Theme "test3" inserted.');
      } catch (e) {
        console.warn('[DB] Could not insert theme test3:', e.message);
      }
    }
  } catch {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS hub_cards (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      title          TEXT NOT NULL,
      description    TEXT,
      icon           TEXT,
      image_url      TEXT,
      accent_color   TEXT,
      action_type    TEXT NOT NULL CHECK(action_type IN ('url','room','script','internal_app')),
      action_payload TEXT NOT NULL,
      sort_order     INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    db.exec('CREATE INDEX IF NOT EXISTS idx_hub_cards_sort ON hub_cards(sort_order)');
  } catch {}

  // Emoji reactions table
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS message_reactions (
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
        emoji      TEXT NOT NULL,
        PRIMARY KEY (message_id, user_id, emoji)
      )
    `);
  } catch {}

  // ── Cult Library (Wave 0) tables ───────────────────────────────────────────
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cult_documents (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id       INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        uploaded_by   INTEGER NOT NULL REFERENCES users(id),
        title         TEXT,
        original_name TEXT,
        storage_key   TEXT NOT NULL,
        mime          TEXT,
        size_bytes    INTEGER,
        status        TEXT NOT NULL DEFAULT 'uploaded'
                      CHECK(status IN ('uploaded','queued','processing','processed','failed')),
        error         TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        queued_at     TEXT,
        processed_at  TEXT
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_cult_documents_room ON cult_documents(room_id, created_at)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_cult_documents_status ON cult_documents(status)');
  } catch {}

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cult_document_jobs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id      INTEGER NOT NULL REFERENCES cult_documents(id) ON DELETE CASCADE,
        job_type    TEXT NOT NULL DEFAULT 'ingest' CHECK(job_type IN ('ingest')),
        status      TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','done','failed')),
        attempts    INTEGER NOT NULL DEFAULT 0,
        next_run_at TEXT,
        locked_at   TEXT,
        locked_by   TEXT,
        last_error  TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_cult_jobs_status ON cult_document_jobs(status, created_at)');
  } catch {}

  // ── Cult Library (Wave 1) chunks + FTS5 search ─────────────────────────────
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cult_document_chunks (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id       INTEGER NOT NULL REFERENCES cult_documents(id) ON DELETE CASCADE,
        room_id      INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        chunk_index  INTEGER NOT NULL,
        content      TEXT NOT NULL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(doc_id, chunk_index)
      )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_cult_chunks_room ON cult_document_chunks(room_id, created_at)');
  } catch {}

  try {
    // FTS5 index for chunks
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS cult_document_chunks_fts
      USING fts5(content, doc_id UNINDEXED, room_id UNINDEXED, chunk_index UNINDEXED)
    `);

    // Triggers to keep FTS index in sync
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS cult_chunks_ai
      AFTER INSERT ON cult_document_chunks
      BEGIN
        INSERT INTO cult_document_chunks_fts(rowid, content, doc_id, room_id, chunk_index)
        VALUES (new.id, new.content, new.doc_id, new.room_id, new.chunk_index);
      END;
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS cult_chunks_ad
      AFTER DELETE ON cult_document_chunks
      BEGIN
        DELETE FROM cult_document_chunks_fts WHERE rowid = old.id;
      END;
    `);
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS cult_chunks_au
      AFTER UPDATE ON cult_document_chunks
      BEGIN
        DELETE FROM cult_document_chunks_fts WHERE rowid = old.id;
        INSERT INTO cult_document_chunks_fts(rowid, content, doc_id, room_id, chunk_index)
        VALUES (new.id, new.content, new.doc_id, new.room_id, new.chunk_index);
      END;
    `);
  } catch {}

  // ── Migrate: expand rooms.type CHECK to include cult + private ──────────────
  try {
    // Test if new types are already supported (idempotent probe)
    db.exec("INSERT INTO rooms (name, type, created_by) VALUES ('__type_test', 'cult', 1)");
    db.exec("DELETE FROM rooms WHERE name = '__type_test'");
  } catch {
    // Recreate rooms with updated CHECK constraint (SQLite can't ALTER CHECK inline)
    db.pragma('foreign_keys = OFF');
    try {
      db.exec('BEGIN');
      db.exec(`
        CREATE TABLE rooms_v2 (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          name        TEXT NOT NULL,
          description TEXT,
          type        TEXT NOT NULL DEFAULT 'group'
                      CHECK(type IN ('direct','group','channel','cult','private')),
          is_archived INTEGER NOT NULL DEFAULT 0,
          created_by  INTEGER REFERENCES users(id),
          created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.exec(`INSERT INTO rooms_v2 (id, name, description, type, is_archived, created_by, created_at)
        SELECT id, name, description, type, is_archived, created_by, created_at FROM rooms`);
      db.exec(`DROP TABLE rooms`);
      db.exec(`ALTER TABLE rooms_v2 RENAME TO rooms`);
      db.exec('COMMIT');
      console.log('[DB] Migrated: rooms.type CHECK expanded (cult, private)');
    } catch (ddlErr) {
      try { db.exec('ROLLBACK'); } catch {}
      throw ddlErr;
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }

  // ── private_requests table ───────────────────────────────────────────────────
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS private_requests (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        from_user_id    INTEGER NOT NULL REFERENCES users(id),
        to_user_id      INTEGER NOT NULL REFERENCES users(id),
        initial_message TEXT    NOT NULL,
        status          TEXT    NOT NULL DEFAULT 'pending'
                        CHECK(status IN ('pending','accepted','declined')),
        created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        responded_at    TEXT
      )
    `);
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_private_req_pending
      ON private_requests(from_user_id, to_user_id) WHERE status = 'pending'
    `);
  } catch {}
}

function seed(db) {
  const adminHash = bcrypt.hashSync('admin123', 12);
  const agentHash = bcrypt.hashSync('claude-agent-secret', 12);
  const claudiuHash = bcrypt.hashSync('claudiu123', 12);

  const adminResult = db.prepare(
    `INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)`
  ).run('admin', 'Victor Safta', adminHash, 'admin');

  const vic1Hash = bcrypt.hashSync('vic1123', 12);
  const vic1Result = db.prepare(
    `INSERT INTO users (username, display_name, password_hash, role, chat_color_index) VALUES (?, ?, ?, ?, 1)`
  ).run('vic1', 'Safta Victor', vic1Hash, 'user');

  const agentResult = db.prepare(
    `INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)`
  ).run('claude', 'Claude AI Analyst', agentHash, 'agent');

  const claudiuResult = db.prepare(
    `INSERT INTO users (username, display_name, password_hash, role, chat_color_index) VALUES (?, ?, ?, ?, 2)`
  ).run('claudiu', 'Claudiu Safta', claudiuHash, 'user');

  const adminId = adminResult.lastInsertRowid;
  const vic1Id = vic1Result.lastInsertRowid;
  const agentId = agentResult.lastInsertRowid;
  const claudiuId = claudiuResult.lastInsertRowid;

  const inviteCode = crypto.randomUUID().slice(0, 8).toUpperCase();
  db.prepare(`INSERT INTO invitations (code, created_by) VALUES (?, ?)`).run(inviteCode, adminId);

  const generalRoom = db.prepare(
    `INSERT INTO rooms (name, description, type, created_by) VALUES (?, ?, ?, ?)`
  ).run('General', 'Discutii generale', 'channel', adminId);

  const bizRoom = db.prepare(
    `INSERT INTO rooms (name, description, type, created_by) VALUES (?, ?, ?, ?)`
  ).run('Interviu Business', 'Claudiu Safta, Claude AI Analyst', 'group', adminId);

  const addMember = db.prepare(`INSERT INTO room_members (room_id, user_id, role) VALUES (?, ?, ?)`);
  addMember.run(generalRoom.lastInsertRowid, adminId, 'owner');
  addMember.run(generalRoom.lastInsertRowid, vic1Id, 'member');
  addMember.run(generalRoom.lastInsertRowid, agentId, 'member');
  addMember.run(generalRoom.lastInsertRowid, claudiuId, 'member');
  addMember.run(bizRoom.lastInsertRowid, adminId, 'owner');
  addMember.run(bizRoom.lastInsertRowid, vic1Id, 'member');
  addMember.run(bizRoom.lastInsertRowid, agentId, 'member');
  addMember.run(bizRoom.lastInsertRowid, claudiuId, 'member');

  const addMsg = db.prepare(`INSERT INTO messages (room_id, sender_id, text, type) VALUES (?, ?, ?, ?)`);
  addMsg.run(bizRoom.lastInsertRowid, agentId, 'Buna ziua! Sunt Claude, AI analyst. Lucrez impreuna cu Victor la o analiza strategica pentru Investorhood.', 'text');
  addMsg.run(bizRoom.lastInsertRowid, claudiuId, 'Salut Claude! Ma bucur sa te cunosc. Da, hai sa vorbim deschis.', 'text');
  addMsg.run(bizRoom.lastInsertRowid, agentId, 'Am pregatit analiza strategica pentru Investorhood. Piata fintech din Romania are un potential semnificativ.', 'text');
  addMsg.run(generalRoom.lastInsertRowid, adminId, 'Bine ati venit pe One21!', 'text');

  const defaultTokens = {
    "--bg-base": "#040404", "--bg-surface": "#0d0d0d", "--bg-elevated": "#141414",
    "--bg-active": "#1a1a1a", "--bg-hover": "rgba(255,255,255,0.04)",
    "--border-dim": "#1c1c1c", "--border-mid": "#272727", "--border-bright": "#383838",
    "--border-accent": "rgba(0,230,118,0.2)", "--border-accent-strong": "rgba(0,230,118,0.5)",
    "--accent": "#00e676", "--accent-dim": "#00b856", "--accent-muted": "rgba(0,230,118,0.07)",
    "--accent-glow": "rgba(0,230,118,0.15)",
    "--text-primary": "#c4c4c4", "--text-secondary": "#545454", "--text-tertiary": "#2c2c2c",
    "--text-accent": "#00e676", "--text-inverse": "#070707",
    "--online": "#00e676", "--offline": "#333333", "--busy": "#ff9c00",
    "--error": "#ff3d3d", "--warning": "#ffb300", "--info": "#00b4d8",
    "--danger": "#ff3d3d", "--danger-muted": "rgba(255,61,61,0.08)",
    "--danger-border": "rgba(255,61,61,0.2)", "--danger-border-mid": "rgba(255,61,61,0.35)",
    "--danger-hover": "rgba(255,61,61,0.07)", "--danger-focus": "rgba(255,61,61,0.4)",
    "--danger-focus-shadow": "rgba(255,61,61,0.08)", "--danger-border-25": "rgba(255,61,61,0.25)",
    "--danger-border-50": "rgba(255,61,61,0.5)", "--danger-bg": "rgba(255,61,61,0.06)",
    "--purple": "#8888ff", "--purple-muted": "rgba(100,100,220,0.12)",
    "--purple-light": "#a78bfa", "--purple-border": "rgba(167,139,250,0.25)",
    "--purple-bg": "rgba(167,139,250,0.06)", "--info-muted": "rgba(0,180,216,0.12)",
    "--info-border": "rgba(0,180,216,0.25)", "--info-bg": "rgba(0,180,216,0.05)",
    "--overlay-bg": "rgba(0,0,0,0.75)", "--shadow-overlay": "rgba(0,0,0,0.6)",
    "--overlay-bg-50": "rgba(0,0,0,0.5)",
    "--accent-anim-glow-0": "rgba(0,230,118,0)", "--accent-anim-glow-35": "rgba(0,230,118,0.35)",
    "--accent-anim-bg-05": "rgba(0,230,118,0.05)", "--accent-anim-bg-06": "rgba(0,230,118,0.06)",
    "--accent-anim-bg-08": "rgba(0,230,118,0.08)", "--accent-anim-bg-12": "rgba(0,230,118,0.12)",
    "--accent-anim-bg-30": "rgba(0,230,118,0.3)", "--accent-border-25": "rgba(0,230,118,0.25)",
    "--accent-border-40": "rgba(0,230,118,0.4)", "--accent-border-60": "rgba(0,230,118,0.6)",
    "--accent-bg-gradient-1": "rgba(0,230,118,0.025)", "--accent-bg-gradient-2": "rgba(0,230,118,0.014)",
    "--shadow-sm": "0 1px 4px rgba(0,0,0,0.6)", "--shadow-md": "0 4px 16px rgba(0,0,0,0.7)",
    "--shadow-lg": "0 12px 40px rgba(0,0,0,0.85)",
    "--warning-muted": "rgba(255,179,0,0.08)", "--scanline-color": "rgba(0,0,0,0.025)",
    "--selection-bg": "rgba(0,230,118,0.18)"
  };
  const themeCount = db.prepare('SELECT COUNT(*) as n FROM themes').get().n;
  if (themeCount === 0) {
    db.prepare("INSERT INTO themes (name, tokens, is_active) VALUES (?, ?, 1)")
      .run('Neural Dark', JSON.stringify(defaultTokens));
  }

  console.log(`[DB] Seeded: admin, claude, claudiu, 2 rooms, invite: ${inviteCode}`);
}

module.exports = { getDb };
