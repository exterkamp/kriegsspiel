/**
 * Persistence seam for games. See docs/architecture.md (Single writer per game).
 *
 * The actor is the only writer for its game. A store keeps the latest snapshot (engine state
 * plus clock) and an append-only input log: every player command and every parser result, so a
 * game can be replayed with no model calls. SQLite replaces `MemoryGameStore` in Epic #2.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ClockMode, ClockState } from '../clock.js';
import type { ParseResult } from '../orders/index.js';

/** Everything needed to resume a game: serialised engine state and the clock's anchor. */
export interface GameSnapshot {
  /** `serialize(engineState)` from the engine. */
  engine: string;
  clock: ClockState & { mode: ClockMode };
}

/** Commands a player or the host can send to a game. Plain JSON so they can be logged. */
export type GameCommand =
  | { kind: 'order'; side: string; text: string }
  | { kind: 'setRate'; rate: number }
  | { kind: 'pause' }
  | { kind: 'resume' }
  | { kind: 'setMode'; mode: ClockMode }
  /** Manual and fast-forward modes: move game time to this point. */
  | { kind: 'advanceTo'; gameMs: number };

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
  /** The command was refused or failed; the reason. */
  error?: string;
}

export interface GameStore {
  /** Create or replace the snapshot. */
  saveSnapshot(gameId: string, snapshot: GameSnapshot): Promise<void>;
  loadSnapshot(gameId: string): Promise<GameSnapshot | undefined>;
  /** Record what the game started from. Called once, when the game is created. */
  saveLogHeader(header: InputLogHeader): Promise<void>;
  logHeader(gameId: string): Promise<InputLogHeader | undefined>;
  appendInput(gameId: string, entry: InputLogEntry): Promise<void>;
  inputLog(gameId: string): Promise<readonly InputLogEntry[]>;
  listGames(): Promise<string[]>;
}

export class MemoryGameStore implements GameStore {
  private readonly snapshots = new Map<string, GameSnapshot>();
  private readonly logs = new Map<string, InputLogEntry[]>();
  private readonly headers = new Map<string, InputLogHeader>();

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

  async inputLog(gameId: string): Promise<readonly InputLogEntry[]> {
    return structuredClone(this.logs.get(gameId) ?? []);
  }

  async listGames(): Promise<string[]> {
    return [...this.snapshots.keys()];
  }
}

/**
 * Snapshots in memory (until SQLite, Epic #2), input log on disk: one JSON-lines file per game,
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

  override async inputLog(gameId: string): Promise<readonly InputLogEntry[]> {
    return (await this.readLog(gameId))?.entries ?? [];
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
