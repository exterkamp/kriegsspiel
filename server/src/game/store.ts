/**
 * Persistence seam for games. See docs/architecture.md (Single writer per game).
 *
 * The actor is the only writer for its game. A store keeps the latest snapshot (engine state
 * plus clock) and an append-only input log: every player command and every parser result, so a
 * game can be replayed with no model calls. SQLite replaces `MemoryGameStore` in Epic #2.
 */
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

export interface InputLogEntry {
  /** Per-game counter, from 1. */
  seq: number;
  /** Wall time the command was applied, for the record only. The engine never reads it. */
  wallMs: number;
  /** Game time the world had been advanced to when the command was applied. */
  gameMs: number;
  command: GameCommand;
  /** For `order` commands: the parser's result, so replay needs no model call. */
  parse?: ParseResult;
  /** The parser failed on every attempt and the conservative fallback was used instead. */
  fallback?: { attempts: number; error: string };
  /** The command was refused or failed; the reason. */
  error?: string;
}

export interface GameStore {
  /** Create or replace the snapshot. */
  saveSnapshot(gameId: string, snapshot: GameSnapshot): Promise<void>;
  loadSnapshot(gameId: string): Promise<GameSnapshot | undefined>;
  appendInput(gameId: string, entry: InputLogEntry): Promise<void>;
  inputLog(gameId: string): Promise<readonly InputLogEntry[]>;
  listGames(): Promise<string[]>;
}

export class MemoryGameStore implements GameStore {
  private readonly snapshots = new Map<string, GameSnapshot>();
  private readonly logs = new Map<string, InputLogEntry[]>();

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
