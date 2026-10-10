/**
 * Backup and restore of the game database (see docs/deployment.md).
 *
 *   node dist/ops/backup.js backup  <db> <dir> [keep]   write <dir>/kriegsspiel-<stamp>.db, prune to `keep` (default 14)
 *   node dist/ops/backup.js restore <backup> <db>       replace <db> with <backup>
 *
 * A backup is `VACUUM INTO`, a consistent copy taken while the server is writing. The input log,
 * snapshots and clock history all live in that one file, so it is the whole game record.
 * Restore with the server stopped.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const PREFIX = 'kriegsspiel-';

export function backupDb(dbPath: string, dir: string, keep = 14, now = new Date()): string {
  if (!existsSync(dbPath)) throw new Error(`no database at ${dbPath}`);
  mkdirSync(dir, { recursive: true });
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  const out = join(dir, `${PREFIX}${stamp}.db`);
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA busy_timeout = 10000');
    db.prepare('VACUUM INTO ?').run(out);
  } finally {
    db.close();
  }
  const old = readdirSync(dir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith('.db'))
    .sort()
    .slice(0, -keep);
  for (const f of old) rmSync(join(dir, f));
  return out;
}

export function restoreDb(backupPath: string, dbPath: string): void {
  const check = new DatabaseSync(backupPath, { readOnly: true });
  try {
    const r = check.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (r.integrity_check !== 'ok') throw new Error(`backup is corrupt: ${r.integrity_check}`);
  } finally {
    check.close();
  }
  mkdirSync(dirname(dbPath), { recursive: true });
  // Stale WAL/SHM files from the old database must not be applied to the restored one.
  for (const ext of ['-wal', '-shm']) rmSync(dbPath + ext, { force: true });
  copyFileSync(backupPath, dbPath);
}

if (import.meta.url === new URL(process.argv[1] ?? '', 'file://').href) {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === 'backup' && a && b) {
    console.log(backupDb(a, b, c ? Number(c) : undefined));
  } else if (cmd === 'restore' && a && b) {
    restoreDb(a, b);
    console.log(`restored ${a} to ${b}`);
  } else {
    console.error('usage: backup <db> <dir> [keep] | restore <backup> <db>');
    process.exit(2);
  }
}
