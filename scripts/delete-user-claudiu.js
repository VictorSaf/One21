#!/usr/bin/env node
/**
 * One-off script: șterge userul "claudiu" din baza de date.
 * Rulează: node scripts/delete-user-claudiu.js
 */
const { getDb } = require('../db/init');

const db = getDb();
const row = db.prepare('SELECT id, username FROM users WHERE username = ?').get('claudiu');
if (!row) {
  console.log('User "claudiu" nu există în baza de date.');
  process.exit(0);
  return;
}
const userId = row.id;

db.transaction(() => {
  db.prepare('DELETE FROM message_reads WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM message_reads WHERE message_id IN (SELECT id FROM messages WHERE sender_id = ?)').run(userId);
  db.prepare('DELETE FROM messages WHERE sender_id = ?').run(userId);
  db.prepare('DELETE FROM room_members WHERE user_id = ?').run(userId);
  db.prepare('UPDATE invitations SET used_by = NULL WHERE used_by = ?').run(userId);
  db.prepare('UPDATE room_requests SET reviewed_by = NULL WHERE reviewed_by = ?').run(userId);
  db.prepare('DELETE FROM room_requests WHERE requested_by = ?').run(userId);
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
})();

console.log('User "claudiu" a fost șters din baza de date.');
