#!/usr/bin/env bash
# One21 — Backup Script
# Backs up SQLite database and uploads directory.
# Usage: ./scripts/backup.sh
# Cron (daily at 3am): 0 3 * * * /path/to/one21/scripts/backup.sh
#
# Retention: keeps last 30 daily backups, last 4 weekly backups.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
DB_PATH="$APP_DIR/db/one21.db"
UPLOADS_DIR="$APP_DIR/uploads"
DATE=$(date +%Y%m%d-%H%M%S)
DAY_OF_WEEK=$(date +%u) # 1=Monday … 7=Sunday

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"

# ── DB Backup (hot backup using SQLite .backup command) ──────────────────────
DB_BACKUP="$BACKUP_DIR/daily/one21-db-$DATE.sqlite3"
if [ -f "$DB_PATH" ]; then
  sqlite3 "$DB_PATH" ".backup '$DB_BACKUP'"
  gzip "$DB_BACKUP"
  echo "[backup] DB backed up → ${DB_BACKUP}.gz"
else
  echo "[backup] WARNING: DB not found at $DB_PATH"
fi

# ── Uploads Backup ───────────────────────────────────────────────────────────
if [ -d "$UPLOADS_DIR" ] && [ "$(ls -A "$UPLOADS_DIR" 2>/dev/null)" ]; then
  UPL_BACKUP="$BACKUP_DIR/daily/one21-uploads-$DATE.tar.gz"
  tar -czf "$UPL_BACKUP" -C "$APP_DIR" uploads/
  echo "[backup] Uploads backed up → $UPL_BACKUP"
fi

# ── Weekly snapshot (every Sunday) ──────────────────────────────────────────
if [ "$DAY_OF_WEEK" = "7" ]; then
  WEEK=$(date +%Y-W%V)
  cp "${DB_BACKUP}.gz" "$BACKUP_DIR/weekly/one21-db-$WEEK.sqlite3.gz" 2>/dev/null || true
  echo "[backup] Weekly snapshot saved for week $WEEK"
fi

# ── Rotate: keep last 30 daily backups ──────────────────────────────────────
find "$BACKUP_DIR/daily" -name "*.gz" -mtime +30 -delete
find "$BACKUP_DIR/weekly" -name "*.gz" -mtime +28 -delete

echo "[backup] Done — $(date)"
