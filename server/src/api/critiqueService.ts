/**
 * Serves the post-game critique (docs/gameplay.md, After the game). The first request after a game
 * ends has the umpire write it from the input log (`writeCritique`); the result goes back into the
 * log as a journal-only `critique` entry, so every later request and every restart serves the
 * same text with no model call. Concurrent first requests share one run.
 *
 * It reads and appends the log only. It never touches a live game, and the caller has already
 * checked that the game is over and the requester holds a seat.
 */
import { Critique } from '@kriegsspiel/protocol';
import type { ReplayInput } from '../admin/replayView.js';
import type { GameStore } from '../game/store.js';
import { critiqueFacts } from '../umpire/critiqueFacts.js';
import { templateCritique, writeCritique } from '../umpire/critique.js';
import type { UmpireClient } from '../umpire/umpireClient.js';

/** How long a request waits for the umpire before the log's own wording is served (and the run carries on). */
export const CRITIQUE_WAIT_MS = 120_000;

/** Fallback reasons worth remembering: asking again would give the same answer or cost the same. */
const SETTLED = new Set([undefined, 'rejected', 'schema', 'refusal']);

export interface CritiqueServiceOptions {
  store: GameStore;
  /** The game's umpire client; absent when no umpire is configured, and the template is served. */
  client?: (gameId: string) => UmpireClient | undefined;
  wallNow: () => number;
  waitMs?: number;
  onNote?: (gameId: string, note: string) => void;
}

export class CritiqueService {
  private readonly running = new Map<string, Promise<Critique>>();

  constructor(private readonly o: CritiqueServiceOptions) {}

  async get(gameId: string, input: ReplayInput, endMs: number): Promise<Critique> {
    const stored = this.storedIn(input);
    if (stored) return stored;
    let run = this.running.get(gameId);
    if (!run) {
      run = this.write(gameId, input, endMs).finally(() => this.running.delete(gameId));
      this.running.set(gameId, run);
    }
    const waitMs = this.o.waitMs ?? CRITIQUE_WAIT_MS;
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), waitMs);
    });
    try {
      const done = await Promise.race([run, late]);
      if (done) return done;
      this.o.onNote?.(
        gameId,
        `critique not ready after ${waitMs} ms; serving the log's own wording`,
      );
      return templateCritique(critiqueFacts(input));
    } finally {
      clearTimeout(timer);
    }
  }

  private storedIn(input: ReplayInput): Critique | undefined {
    for (let i = input.entries.length - 1; i >= 0; i--) {
      const c = input.entries[i]!.command;
      if (c.kind !== 'critique') continue;
      const parsed = Critique.safeParse(c.critique);
      if (parsed.success) return parsed.data;
    }
    return undefined;
  }

  private async write(gameId: string, input: ReplayInput, endMs: number): Promise<Critique> {
    const digest = critiqueFacts(input);
    const run = await writeCritique(this.o.client?.(gameId), digest);
    if (run.fallback) this.o.onNote?.(gameId, `critique template used: ${run.fallback}`);
    if (SETTLED.has(run.fallback)) {
      const seq = input.entries.reduce((m, e) => Math.max(m, e.seq), 0) + 1;
      try {
        await this.o.store.appendInput(gameId, {
          seq,
          wallMs: this.o.wallNow(),
          gameMs: endMs,
          command: { kind: 'critique', critique: run.critique },
          calls: run.records,
        });
      } catch (e) {
        this.o.onNote?.(
          gameId,
          `critique not saved: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    return run.critique;
  }
}
