/**
 * Lobby records: one per game, from creation to start. See docs/gameplay.md (Session shapes).
 *
 * A record holds the choices made when the game was made (scenario, clock ratio, session type,
 * pause settings), who has said they are ready, and whether the game has started. The game itself
 * (the engine state and its actor) does not exist until the creator starts it. `MemoryLobbyStore`
 * is for tests and a server with no `DB_PATH`; `SqliteLobbyStore` shares the game database file.
 */
import { DatabaseSync } from 'node:sqlite';
import type { Role } from '@kriegsspiel/engine';
import type { UmpireSettings } from '@kriegsspiel/protocol';

export type SessionType = 'team_vs_team' | 'co_op_vs_ai' | 'hot_seat';

export const SESSION_TYPES: readonly SessionType[] = ['team_vs_team', 'co_op_vs_ai', 'hot_seat'];

/** Pause voting rules chosen for a game; see `PauseConfig`. Unset on a record: players cannot vote to pause. */
export interface PauseSettings {
  rule: 'unanimous' | 'majority';
  voteTimeoutMs?: number;
  maxPauseMs?: number;
  holdMs?: number;
  holdsPerPlayer?: number;
  holdsPerGame?: number;
}

/**
 * A player who joined a side's table in a role other than commander. The account that holds the
 * side's seat is its commander; everyone else on the side is listed here. See docs/gameplay.md.
 */
export interface RoleSeat {
  userId: string;
  side: string;
  role: Exclude<Role, 'commander'>;
  /** Subordinate only: the ids of the units they command. */
  units?: string[];
  /**
   * Set when the player took the role after the game started (D6e): the accounts that held the
   * same seat before, whose journal is the briefing. Empty if no one did.
   */
  succeeds?: string[];
}

/** Someone who gave up a role after the game started. Their seat's journal briefs the next holder. */
export interface PastHolder {
  userId: string;
  side: string;
  role: RoleSeat['role'];
  units?: string[];
  leftAtMs: number;
}

/** A paper HQ passed on to the subordinate commanding `unit`: an id from HQ's own view. */
export interface Forward {
  side: string;
  dispatchId: string;
  unit: string;
  /** `down` (the default, for records made before reports could go up) or `up` to HQ. */
  direction?: 'down' | 'up';
  /** Game time it was sent and when it arrives; absent on older records, which arrived at once. */
  sentAt?: number;
  deliverAt?: number;
}

export interface LobbyGame {
  id: string;
  scenario: string;
  /** Game seconds per wall second. */
  rate: number;
  sessionType: SessionType;
  pause?: PauseSettings;
  /** The rigid-to-free dial and the umpire's persona chosen at creation (3.11). Absent: the defaults. */
  umpire?: UmpireSettings;
  /** The account that made the game; only they may start it. In hot-seat they play every side. */
  creator: string;
  status: 'lobby' | 'started';
  /** Accounts that have said they are ready to start. */
  ready: string[];
  /** Accounts the creator removed from the room; they cannot take a seat again. */
  removed?: string[];
  /** Players holding a staff or subordinate role beside the side's commander. None: shared HQ. */
  roles?: RoleSeat[];
  /** Papers passed along the chain (HQ to a subordinate, or a subordinate's report up to HQ). */
  forwards?: Forward[];
  /** Players who gave up a role after the start, oldest first (D6e). */
  past?: PastHolder[];
  /** How the humans of a side are organised. Unset: shared HQ, so forwarding takes no time. */
  hierarchy?: 'shared' | 'chain';
  /**
   * The game's seed (#534), drawn when the record is made (or given in the request) and used when
   * the game starts; the input-log header keeps it from then on. Absent on a record made before it.
   * Master state: never sent to a player.
   */
  seed?: number;
  createdAtMs: number;
}

export interface LobbyStore {
  put(game: LobbyGame): void;
  get(id: string): LobbyGame | undefined;
  /** Games made by this account, newest first. */
  byCreator(userId: string): LobbyGame[];
  /** Games in which this account holds a role beside the commander, newest first. */
  byRoleHolder(userId: string): LobbyGame[];
  /** The games with these ids, newest first. */
  many(ids: readonly string[]): LobbyGame[];
  /** Forgets the games this account made that have not started, and removes it from ready lists and role seats. */
  forgetUser(userId: string): void;
  /** Hands everything `from` made or holds (creator, ready, role seats) to `to`; used when a guest signs in. */
  reassignUser(from: string, to: string): void;
  close(): void;
}

const moveUser = (g: LobbyGame, from: string, to: string): LobbyGame => ({
  ...g,
  creator: g.creator === from ? to : g.creator,
  ready: [...new Set(g.ready.map((u) => (u === from ? to : u)))],
  ...(g.roles ? { roles: g.roles.map((r) => (r.userId === from ? { ...r, userId: to } : r)) } : {}),
});

const newestFirst = (a: LobbyGame, b: LobbyGame) => b.createdAtMs - a.createdAtMs;

export class MemoryLobbyStore implements LobbyStore {
  private readonly games = new Map<string, LobbyGame>();

  put(game: LobbyGame): void {
    this.games.set(game.id, structuredClone(game));
  }

  get(id: string): LobbyGame | undefined {
    const g = this.games.get(id);
    return g && structuredClone(g);
  }

  byCreator(userId: string): LobbyGame[] {
    return [...this.games.values()]
      .filter((g) => g.creator === userId)
      .map((g) => structuredClone(g))
      .sort(newestFirst);
  }

  byRoleHolder(userId: string): LobbyGame[] {
    return [...this.games.values()]
      .filter((g) => g.roles?.some((r) => r.userId === userId))
      .map((g) => structuredClone(g))
      .sort(newestFirst);
  }

  many(ids: readonly string[]): LobbyGame[] {
    return ids
      .map((id) => this.get(id))
      .filter((g): g is LobbyGame => g !== undefined)
      .sort(newestFirst);
  }

  reassignUser(from: string, to: string): void {
    for (const [id, g] of this.games) this.games.set(id, moveUser(g, from, to));
  }

  forgetUser(userId: string): void {
    for (const [id, g] of this.games) {
      if (g.creator === userId && g.status === 'lobby') this.games.delete(id);
      else {
        g.ready = g.ready.filter((u) => u !== userId);
        if (g.roles) g.roles = g.roles.filter((r) => r.userId !== userId);
      }
    }
  }

  close(): void {}
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS lobby_games (
    id TEXT PRIMARY KEY,
    creator TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    body TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS lobby_games_creator ON lobby_games (creator);
`;

interface Row {
  [column: string]: string | number;
}

const parse = (r: Row): LobbyGame => JSON.parse(String(r.body)) as LobbyGame;

/** Lobby records in the same SQLite file as the games (own `lobby_` table, created if missing). */
export class SqliteLobbyStore implements LobbyStore {
  private readonly db: DatabaseSync;
  private readonly ownsDatabase: boolean;

  /** A borrowed handle allows a caller-owned transaction across account and lobby tables. */
  constructor(database: string | DatabaseSync) {
    this.ownsDatabase = typeof database === 'string';
    this.db = typeof database === 'string' ? new DatabaseSync(database) : database;
    if (this.ownsDatabase) this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.db.exec(SCHEMA);
  }

  put(game: LobbyGame): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO lobby_games (id, creator, created_at_ms, body) VALUES (?, ?, ?, ?)',
      )
      .run(game.id, game.creator, game.createdAtMs, JSON.stringify(game));
  }

  get(id: string): LobbyGame | undefined {
    const row = this.db.prepare('SELECT body FROM lobby_games WHERE id = ?').get(id) as
      Row | undefined;
    return row && parse(row);
  }

  byCreator(userId: string): LobbyGame[] {
    return (
      this.db
        .prepare('SELECT body FROM lobby_games WHERE creator = ? ORDER BY created_at_ms DESC')
        .all(userId) as Row[]
    ).map(parse);
  }

  byRoleHolder(userId: string): LobbyGame[] {
    return (this.db.prepare('SELECT body FROM lobby_games').all() as Row[])
      .map(parse)
      .filter((g) => g.roles?.some((r) => r.userId === userId))
      .sort(newestFirst);
  }

  many(ids: readonly string[]): LobbyGame[] {
    return ids
      .map((id) => this.get(id))
      .filter((g): g is LobbyGame => g !== undefined)
      .sort(newestFirst);
  }

  reassignUser(from: string, to: string): void {
    for (const row of this.db.prepare('SELECT body FROM lobby_games').all() as Row[]) {
      const g = parse(row);
      const moved = moveUser(g, from, to);
      if (JSON.stringify(moved) !== JSON.stringify(g)) this.put(moved);
    }
  }

  forgetUser(userId: string): void {
    for (const row of this.db.prepare('SELECT body FROM lobby_games').all() as Row[]) {
      const g = parse(row);
      if (g.creator === userId && g.status === 'lobby') {
        this.db.prepare('DELETE FROM lobby_games WHERE id = ?').run(g.id);
      } else if (g.ready.includes(userId) || g.roles?.some((r) => r.userId === userId)) {
        this.put({
          ...g,
          ready: g.ready.filter((u) => u !== userId),
          ...(g.roles ? { roles: g.roles.filter((r) => r.userId !== userId) } : {}),
        });
      }
    }
  }

  close(): void {
    if (this.ownsDatabase) this.db.close();
  }
}
