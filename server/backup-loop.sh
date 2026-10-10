#!/bin/sh
# Back up the database once a day at BACKUP_HOUR_UTC (default 03:00 UTC), forever.
# Also runs once at start so a fresh deployment has a backup straight away.
set -u
while true; do
  if [ -f "$DB_PATH" ]; then
    node /app/server/dist/ops/backup.js backup "$DB_PATH" /backups "${BACKUP_KEEP:-14}" || echo "backup failed" >&2
  fi
  now=$(date -u +%s)
  next=$(date -u -d "today ${BACKUP_HOUR_UTC:-3}:00" +%s 2>/dev/null || echo $((now + 86400)))
  [ "$next" -le "$now" ] && next=$((next + 86400))
  sleep $((next - now))
done
