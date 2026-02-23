require('dotenv').config();
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');

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
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
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

    CREATE INDEX IF NOT EXISTS idx_messages_room ON messages(room_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_invitations_code ON invitations(code);
    CREATE INDEX IF NOT EXISTS idx_message_reads_user ON message_reads(user_id);
    CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id);
    CREATE INDEX IF NOT EXISTS idx_room_requests_status  ON room_requests(status);
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
  safeAdd('rooms', 'is_archived', 'INTEGER NOT NULL DEFAULT 0');
  safeAdd('messages', 'file_url', 'TEXT');
  safeAdd('messages', 'file_name', 'TEXT');
  safeAdd('messages', 'is_edited', 'INTEGER NOT NULL DEFAULT 0');
  safeAdd('invitations', 'default_permissions', "TEXT DEFAULT '{}'");
  safeAdd('invitations', 'note', 'TEXT');
}

function seed(db) {
  const adminHash = bcrypt.hashSync('admin123', 12);
  const agentHash = bcrypt.hashSync('claude-agent-secret', 12);
  const claudiuHash = bcrypt.hashSync('claudiu123', 12);

  const adminResult = db.prepare(
    `INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)`
  ).run('admin', 'Victor Safta', adminHash, 'admin');

  const agentResult = db.prepare(
    `INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)`
  ).run('claude', 'Claude AI Analyst', agentHash, 'agent');

  const claudiuResult = db.prepare(
    `INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)`
  ).run('claudiu', 'Claudiu Safta', claudiuHash, 'user');

  const adminId = adminResult.lastInsertRowid;
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
  addMember.run(generalRoom.lastInsertRowid, agentId, 'member');
  addMember.run(generalRoom.lastInsertRowid, claudiuId, 'member');
  addMember.run(bizRoom.lastInsertRowid, adminId, 'owner');
  addMember.run(bizRoom.lastInsertRowid, agentId, 'member');
  addMember.run(bizRoom.lastInsertRowid, claudiuId, 'member');

  const addMsg = db.prepare(`INSERT INTO messages (room_id, sender_id, text, type) VALUES (?, ?, ?, ?)`);
  addMsg.run(bizRoom.lastInsertRowid, agentId, 'Buna ziua! Sunt Claude, AI analyst. Lucrez impreuna cu Victor la o analiza strategica pentru Investorhood.', 'text');
  addMsg.run(bizRoom.lastInsertRowid, claudiuId, 'Salut Claude! Ma bucur sa te cunosc. Da, hai sa vorbim deschis.', 'text');
  addMsg.run(bizRoom.lastInsertRowid, agentId, 'Am pregatit analiza strategica pentru Investorhood. Piata fintech din Romania are un potential semnificativ.', 'text');
  addMsg.run(generalRoom.lastInsertRowid, adminId, 'Bine ati venit pe One21!', 'text');

  console.log(`[DB] Seeded: admin, claude, claudiu, 2 rooms, invite: ${inviteCode}`);
}

module.exports = { getDb };
