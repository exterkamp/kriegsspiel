/**
 * SqliteGameStore: the durable `GameStore`. See docs/architecture.md (Persistence).
 *
 * One SQLite file in WAL mode holds every game: the log header, the append-only input log,
 * snapshots, how far game time has run, the clock history and the latest per-side views. The
 * event queue is part of the engine state inside each snapshot. Uses `node:sqlite`, which is
 * built into Node 22, so there is no native dependency. Calls are synchronous underneath and
 * return promises to fit the `GameStore` seam; each write is one statement or one transaction,
 * so a `kill -9` leaves either the old row or the new one, never half of one.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Mark } from '@kriegsspiel/protocol';
import type { ClockChange } from '../clock.js';
import type { GameSnapshot, GameStore, InputLogEntry, InputLogHeader, SideViews } from './store.js';

/**
 * Schema migrations, applied in order. `PRAGMA user_version` is the count applied. Never edit
 * an entry once released: add a new one.
 */
export const MIGRATIONS: readonly string[] = [
  // input_log keeps its rowid: the log is read in insertion order, which is not always seq order
  // (an order takes its seq at signing but is appended when its parse completes).
  `CREATE TABLE games (
     game_id TEXT PRIMARY KEY,
     scenario_id TEXT NOT NULL,
     seed INTEGER NOT NULL,
     progress_ms REAL
   );
   CREATE TABLE input_log (
     game_id TEXT NOT NULL,
     seq INTEGER NOT NULL,
     entry TEXT NOT NULL,
     PRIMARY KEY (game_id, seq)
   );
   CREATE TABLE snapshots (
     game_id TEXT NOT NULL,
     seq INTEGER NOT NULL,
     engine TEXT NOT NULL,
     clock TEXT NOT NULL,
     PRIMARY KEY (game_id, seq)
   ) WITHOUT ROWID;
   CREATE TABLE clock_history (
     game_id TEXT NOT NULL,
     n INTEGER NOT NULL,
     change TEXT NOT NULL,
     PRIMARY KEY (game_id, n)
   ) WITHOUT ROWID;
   CREATE TABLE side_views (
     game_id TEXT PRIMARY KEY,
     seq INTEGER NOT NULL,
     game_ms REAL NOT NULL,
     views TEXT NOT NULL
   );`,
  `CREATE TABLE side_marks (
     game_id TEXT NOT NULL,
     side TEXT NOT NULL,
     marks TEXT NOT NULL,
     PRIMARY KEY (game_id, side)
   ) WITHOUT ROWID;`,
];

/** Older snapshots kept besides the newest (not yet used as a fallback: recovery reads the newest). */
const KEEP_OLD_SNAPSHOTS = 2;

export class SqliteGameStore implements GameStore {
  private readonly db: DatabaseSync;

  /** `path` is a file path (parent directories are created) or `:memory:`. */
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
    this.migrate();
  }

  private migrate(): void {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (row.user_version > MIGRATIONS.length) {
      throw new Error(
        `database schema is version ${row.user_version}, newer than this server (${MIGRATIONS.length})`,
      );
    }
    for (let v = row.user_version; v < MIGRATIONS.length; v++) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(MIGRATIONS[v]!);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    }
  }

  /** Schema version of the open database. */
  get schemaVersion(): number {
    return (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  }

  close(): void {
    this.db.close();
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  async saveLogHeader(header: InputLogHeader): Promise<void> {
    // Plain INSERT: never overwrite the record of an existing game.
    this.db
      .prepare('INSERT INTO games (game_id, scenario_id, seed) VALUES (?, ?, ?)')
      .run(header.gameId, header.scenarioId, header.seed);
  }

  async logHeader(gameId: string): Promise<InputLogHeader | undefined> {
    const r = this.db
      .prepare('SELECT scenario_id, seed FROM games WHERE game_id = ?')
      .get(gameId) as { scenario_id: string; seed: number } | undefined;
    return r && { gameId, scenarioId: r.scenario_id, seed: r.seed };
  }

  async appendInput(gameId: string, entry: InputLogEntry): Promise<void> {
    this.db
      .prepare('INSERT INTO input_log (game_id, seq, entry) VALUES (?, ?, ?)')
      .run(gameId, entry.seq, JSON.stringify(entry));
  }

  async inputLog(gameId: string, afterSeq = 0): Promise<readonly InputLogEntry[]> {
    const rows = this.db
      .prepare('SELECT entry FROM input_log WHERE game_id = ? AND seq > ? ORDER BY rowid')
      .all(gameId, afterSeq) as { entry: string }[];
    return rows.map((r) => JSON.parse(r.entry) as InputLogEntry);
  }

  async saveSnapshot(gameId: string, snapshot: GameSnapshot): Promise<void> {
    this.transaction(() => {
      this.db
        .prepare(
          'INSERT OR REPLACE INTO snapshots (game_id, seq, engine, clock) VALUES (?, ?, ?, ?)',
        )
        .run(gameId, snapshot.seq, snapshot.engine, JSON.stringify(snapshot.clock));
      this.db
        .prepare(
          `DELETE FROM snapshots WHERE game_id = ? AND seq NOT IN
             (SELECT seq FROM snapshots WHERE game_id = ? ORDER BY seq DESC LIMIT ?)`,
        )
        .run(gameId, gameId, KEEP_OLD_SNAPSHOTS + 1);
    });
  }

  async loadSnapshot(gameId: string): Promise<GameSnapshot | undefined> {
    const r = this.db
      .prepare(
        'SELECT seq, engine, clock FROM snapshots WHERE game_id = ? ORDER BY seq DESC LIMIT 1',
      )
      .get(gameId) as { seq: number; engine: string; clock: string } | undefined;
    return r && { seq: r.seq, engine: r.engine, clock: JSON.parse(r.clock) };
  }

  async saveProgress(gameId: string, gameMs: number): Promise<void> {
    this.db
      .prepare(
        'UPDATE games SET progress_ms = max(coalesce(progress_ms, ?1), ?1) WHERE game_id = ?2',
      )
      .run(gameMs, gameId);
  }

  async loadProgress(gameId: string): Promise<number | undefined> {
    const r = this.db.prepare('SELECT progress_ms FROM games WHERE game_id = ?').get(gameId) as
      { progress_ms: number | null } | undefined;
    return r?.progress_ms ?? undefined;
  }

  async appendClockHistory(gameId: string, changes: readonly ClockChange[]): Promise<void> {
    if (changes.length === 0) return;
    this.transaction(() => {
      const row = this.db
        .prepare('SELECT coalesce(max(n), 0) AS n FROM clock_history WHERE game_id = ?')
        .get(gameId) as { n: number };
      const insert = this.db.prepare(
        'INSERT INTO clock_history (game_id, n, change) VALUES (?, ?, ?)',
      );
      changes.forEach((c, i) => insert.run(gameId, row.n + i + 1, JSON.stringify(c)));
    });
  }

  async clockHistory(gameId: string): Promise<readonly ClockChange[]> {
    const rows = this.db
      .prepare('SELECT change FROM clock_history WHERE game_id = ? ORDER BY n')
      .all(gameId) as { change: string }[];
    return rows.map((r) => JSON.parse(r.change) as ClockChange);
  }

  async saveViews(gameId: string, views: SideViews): Promise<void> {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO side_views (game_id, seq, game_ms, views) VALUES (?, ?, ?, ?)',
      )
      .run(gameId, views.seq, views.gameMs, JSON.stringify(views.views));
  }

  async loadViews(gameId: string): Promise<SideViews | undefined> {
    const r = this.db
      .prepare('SELECT seq, game_ms, views FROM side_views WHERE game_id = ?')
      .get(gameId) as { seq: number; game_ms: number; views: string } | undefined;
    return r && { seq: r.seq, gameMs: r.game_ms, views: JSON.parse(r.views) };
  }

  async saveMarks(gameId: string, side: string, marks: readonly Mark[]): Promise<void> {
    this.db
      .prepare('INSERT OR REPLACE INTO side_marks (game_id, side, marks) VALUES (?, ?, ?)')
      .run(gameId, side, JSON.stringify(marks));
  }

  async loadMarks(gameId: string, side: string): Promise<Mark[]> {
    const r = this.db
      .prepare('SELECT marks FROM side_marks WHERE game_id = ? AND side = ?')
      .get(gameId, side) as { marks: string } | undefined;
    return r ? (JSON.parse(r.marks) as Mark[]) : [];
  }

  async listGames(): Promise<string[]> {
    const rows = this.db
      .prepare('SELECT DISTINCT game_id FROM snapshots ORDER BY game_id')
      .all() as { game_id: string }[];
    return rows.map((r) => r.game_id);
  }
}
