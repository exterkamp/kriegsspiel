/**
 * Persistence seam for games. See docs/architecture.md (Single writer per game).
 *
 * The actor is the only writer for its game. A store keeps the latest snapshot (engine state
 * plus clock) and an append-only input log: every player command and every parser result, so a
 * game can be replayed with no model calls. `SqliteGameStore` (sqlite.ts) is the durable implementation.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DraftSnapshot, Mark } from '@kriegsspiel/protocol';
import type { ClockChange, ClockMode, ClockState } from '../clock.js';
import type { ParseResult } from '../orders/index.js';
import type { PauseTransition } from '../pause.js';
import type { RatioTransition } from '../ratioVote.js';

/** Everything needed to resume a game: serialised engine state and the clock's anchor. */
export interface GameSnapshot {
  /** Seq of the last input log entry this snapshot includes. Recovery replays the entries after it. */
  seq: number;
  /** `serialize(engineState)` from the engine. */
  engine: string;
  clock: ClockState & { mode: ClockMode };
}

/** Commands a player or the host can send to a game. Plain JSON so they can be logged. */
export type GameCommand =
  | { kind: 'order'; side: string; text: string; courier?: 'fast' | 'safe' }
  | { kind: 'setRate'; rate: number }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'setMode'; mode: ClockMode }
  /** Manual and fast-forward modes: move game time to this point. */
  | { kind: 'advanceTo'; gameMs: number }
  /** Pause voting (docs/architecture.md). `by` is a voter's player id. */
  | { kind: 'proposePause'; by: string; reason?: string }
  | { kind: 'proposeResume'; by: string }
  | { kind: 'vote'; by: string; proposal: string; yes: boolean }
  /** A vote or the maximum pause length ran out. Issued by the actor's own timer. */
  | { kind: 'pauseExpire' }
  /** Ratio voting (docs/gameplay.md, Changing the ratio): same voters and rules as the pause vote. */
  | { kind: 'proposeRate'; by: string; rate: number }
  | { kind: 'rateVote'; by: string; proposal: string; yes: boolean }
  /** A ratio vote ran out of time. Issued by the actor's own timer. */
  | { kind: 'rateExpire' }
  /**
   * The server came back after being down for `downMs` of wall time (an estimate, from the last
   * heartbeat). Journal only: the game was reopened paused, so no game time passed.
   */
  | { kind: 'restart'; downMs: number };

/** First record of a game's input log: what replay needs to rebuild the starting state. */
export interface InputLogHeader {
  gameId: string;
  scenarioId: string;
  /** Seed of the game's RNG. */
  seed: number;
}

export interface InputLogEntry {
  /** Per-game counter, from 1. */
  seq: number;
  /** Wall time the command was applied, for the record only. The engine never reads it. */
  wallMs: number;
  /** Game time the world had been advanced to when the command was applied. */
  gameMs: number;
  command: GameCommand;
  /** Game time after the command was applied and the world caught up. Replay runs to here. */
  endGameMs?: number;
  /** For `order` commands: the parser's result, so replay needs no model call. */
  parse?: ParseResult;
  /** The parser failed on every attempt and the conservative fallback was used instead. */
  fallback?: { attempts: number; error: string };
  /** Issued by a scripted side's agent, not a player. Replay applies it at `gameMs` before any command at the same instant. */
  agent?: boolean;
  /** Pause-voting steps this command caused, for the journal. */
  pause?: PauseTransition[];
  /** Ratio-vote steps this command caused. A `passed` step carries the new ratio. */
  ratio?: RatioTransition[];
  /** The command was refused or failed; the reason. */
  error?: string;
}

/** What one side was shown at a point in the game: `viewFor` output, keyed by side id. */
export interface SideViews {
  /** Seq of the last input the views include. */
  seq: number;
  gameMs: number;
  views: Record<string, unknown>;
}

export interface GameStore {
  /** Create or replace the snapshot. */
  saveSnapshot(gameId: string, snapshot: GameSnapshot): Promise<void>;
  loadSnapshot(gameId: string): Promise<GameSnapshot | undefined>;
  /** Record what the game started from. Called once, when the game is created. */
  saveLogHeader(header: InputLogHeader): Promise<void>;
  logHeader(gameId: string): Promise<InputLogHeader | undefined>;
  appendInput(gameId: string, entry: InputLogEntry): Promise<void>;
  /** The log in `seq` order. With `afterSeq`, only the entries after it. */
  inputLog(gameId: string, afterSeq?: number): Promise<readonly InputLogEntry[]>;
  /**
   * Remember how far game time has run, which the scheduler moves without any input. Recovery
   * advances the replayed state to it, so a restart loses no game time. Never goes backwards.
   */
  saveProgress(gameId: string, gameMs: number): Promise<void>;
  loadProgress(gameId: string): Promise<number | undefined>;
  /** Remember the last wall time the server was seen alive for this game, so a restart can measure downtime. */
  saveHeartbeat(gameId: string, wallMs: number): Promise<void>;
  loadHeartbeat(gameId: string): Promise<number | undefined>;
  /** Append clock changes (rate, pause, mode) to the game's clock history. */
  appendClockHistory(gameId: string, changes: readonly ClockChange[]): Promise<void>;
  clockHistory(gameId: string): Promise<readonly ClockChange[]>;
  /** Keep the latest per-side views, as of a snapshot. */
  saveViews(gameId: string, views: SideViews): Promise<void>;
  loadViews(gameId: string): Promise<SideViews | undefined>;
  /** A side's marks (player drawings). Not game input: they are not logged or replayed. */
  saveMarks(gameId: string, side: string, marks: readonly Mark[]): Promise<void>;
  loadMarks(gameId: string, side: string): Promise<Mark[]>;
  /** A side's shared order drafts, with their full history. Not game input: not logged or replayed. */
  saveDrafts(gameId: string, side: string, drafts: readonly DraftSnapshot[]): Promise<void>;
  loadDrafts(gameId: string, side: string): Promise<DraftSnapshot[]>;
  /** Game time a side last saw the game at, set when its last connection closes. Never goes backwards. */
  saveSeen(gameId: string, side: string, gameMs: number): Promise<void>;
  loadSeen(gameId: string, side: string): Promise<number | undefined>;
  listGames(): Promise<string[]>;
}

export class MemoryGameStore implements GameStore {
  private readonly snapshots = new Map<string, GameSnapshot>();
  private readonly logs = new Map<string, InputLogEntry[]>();
  private readonly headers = new Map<string, InputLogHeader>();
  private readonly progress = new Map<string, number>();
  private readonly clockLogs = new Map<string, ClockChange[]>();
  private readonly views = new Map<string, SideViews>();
  private readonly marks = new Map<string, Mark[]>();
  private readonly drafts = new Map<string, DraftSnapshot[]>();

  private readonly seen = new Map<string, number>();

  async saveSeen(gameId: string, side: string, gameMs: number): Promise<void> {
    const key = `${gameId}\0${side}`;
    this.seen.set(key, Math.max(gameMs, this.seen.get(key) ?? gameMs));
  }

  async loadSeen(gameId: string, side: string): Promise<number | undefined> {
    return this.seen.get(`${gameId}\0${side}`);
  }

  async saveMarks(gameId: string, side: string, marks: readonly Mark[]): Promise<void> {
    this.marks.set(`${gameId}\0${side}`, structuredClone([...marks]));
  }

  async saveDrafts(gameId: string, side: string, drafts: readonly DraftSnapshot[]): Promise<void> {
    this.drafts.set(`${gameId}\0${side}`, structuredClone([...drafts]));
  }

  async loadDrafts(gameId: string, side: string): Promise<DraftSnapshot[]> {
    return structuredClone(this.drafts.get(`${gameId}\0${side}`) ?? []);
  }

  async loadMarks(gameId: string, side: string): Promise<Mark[]> {
    return structuredClone(this.marks.get(`${gameId}\0${side}`) ?? []);
  }

  async saveProgress(gameId: string, gameMs: number): Promise<void> {
    this.progress.set(gameId, Math.max(gameMs, this.progress.get(gameId) ?? gameMs));
  }

  async loadProgress(gameId: string): Promise<number | undefined> {
    return this.progress.get(gameId);
  }

  private readonly heartbeats = new Map<string, number>();

  async saveHeartbeat(gameId: string, wallMs: number): Promise<void> {
    this.heartbeats.set(gameId, Math.max(wallMs, this.heartbeats.get(gameId) ?? wallMs));
  }

  async loadHeartbeat(gameId: string): Promise<number | undefined> {
    return this.heartbeats.get(gameId);
  }

  async appendClockHistory(gameId: string, changes: readonly ClockChange[]): Promise<void> {
    const log = this.clockLogs.get(gameId) ?? [];
    log.push(...structuredClone(changes));
    this.clockLogs.set(gameId, log);
  }

  async clockHistory(gameId: string): Promise<readonly ClockChange[]> {
    return structuredClone(this.clockLogs.get(gameId) ?? []);
  }

  async saveViews(gameId: string, views: SideViews): Promise<void> {
    this.views.set(gameId, structuredClone(views));
  }

  async loadViews(gameId: string): Promise<SideViews | undefined> {
    const v = this.views.get(gameId);
    return v && structuredClone(v);
  }

  async saveLogHeader(header: InputLogHeader): Promise<void> {
    this.headers.set(header.gameId, { ...header });
  }

  async logHeader(gameId: string): Promise<InputLogHeader | undefined> {
    const h = this.headers.get(gameId);
    return h && { ...h };
  }

  async saveSnapshot(gameId: string, snapshot: GameSnapshot): Promise<void> {
    this.snapshots.set(gameId, structuredClone(snapshot));
  }

  async loadSnapshot(gameId: string): Promise<GameSnapshot | undefined> {
    const s = this.snapshots.get(gameId);
    return s && structuredClone(s);
  }

  async appendInput(gameId: string, entry: InputLogEntry): Promise<void> {
    const log = this.logs.get(gameId) ?? [];
    log.push(structuredClone(entry));
    this.logs.set(gameId, log);
  }

  async inputLog(gameId: string, afterSeq = 0): Promise<readonly InputLogEntry[]> {
    return structuredClone((this.logs.get(gameId) ?? []).filter((e) => e.seq > afterSeq));
  }

  async listGames(): Promise<string[]> {
    return [...this.snapshots.keys()];
  }
}

/**
 * Snapshots in memory (use `SqliteGameStore` for durable ones), input log on disk: one JSON-lines file per game,
 * `<dir>/<gameId>.jsonl`. The first line is the `InputLogHeader`, every later line is an
 * `InputLogEntry`. Lines are only ever appended, so a crash loses at most a trailing partial line.
 */
export class FileGameStore extends MemoryGameStore {
  constructor(private readonly dir: string) {
    super();
  }

  logPath(gameId: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(gameId)) {
      throw new Error(`game id is not usable as a file name: ${gameId}`);
    }
    return join(this.dir, `${gameId}.jsonl`);
  }

  override async saveLogHeader(header: InputLogHeader): Promise<void> {
    const path = this.logPath(header.gameId);
    await mkdir(this.dir, { recursive: true });
    // 'wx': never overwrite the record of an existing game.
    await writeFile(path, `${JSON.stringify(header)}\n`, { flag: 'wx' });
  }

  override async logHeader(gameId: string): Promise<InputLogHeader | undefined> {
    return (await this.readLog(gameId))?.header;
  }

  override async appendInput(gameId: string, entry: InputLogEntry): Promise<void> {
    await appendFile(this.logPath(gameId), `${JSON.stringify(entry)}\n`);
  }

  override async inputLog(gameId: string, afterSeq = 0): Promise<readonly InputLogEntry[]> {
    return ((await this.readLog(gameId))?.entries ?? []).filter((e) => e.seq > afterSeq);
  }

  private async readLog(gameId: string) {
    try {
      return parseInputLog(await readFile(this.logPath(gameId), 'utf8'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw e;
    }
  }
}

/** Parse the text of a `.jsonl` input log. A final line cut short by a crash is ignored. */
export function parseInputLog(text: string): { header: InputLogHeader; entries: InputLogEntry[] } {
  const lines = text.split('\n');
  const complete = lines.at(-1) === '' ? lines.slice(0, -1) : lines;
  const records = complete.map((line, i) => {
    try {
      return JSON.parse(line) as unknown;
    } catch {
      if (i === complete.length - 1 && i > 0) return undefined; // truncated tail
      throw new Error(`input log line ${i + 1} is not valid JSON`);
    }
  });
  const header = records[0] as InputLogHeader | undefined;
  if (!header || typeof header.scenarioId !== 'string' || typeof header.seed !== 'number') {
    throw new Error('input log must start with a header line {gameId, scenarioId, seed}');
  }
  return { header, entries: records.slice(1).filter((r) => r !== undefined) as InputLogEntry[] };
}
