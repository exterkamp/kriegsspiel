import { holdTheBridge, loadScenario } from '@kriegsspiel/engine';
import { Critique } from '@kriegsspiel/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { loadReplayInput, type ReplayInput } from '../admin/replayView.js';
import { GameHost, MemoryGameStore, replayLog } from '../game/index.js';
import { createRegistry, startingState } from '../game/registry.js';
import { FakeTime } from '../game/testing.js';
import type { OrderParser, ParseResult } from '../orders/index.js';
import {
  CRITIQUE_SCHEMA,
  checkCritique,
  critiqueInput,
  templateCritique,
  writeCritique,
  type CritiqueOutput,
} from './critique.js';
import { critiqueFacts, type CritiqueDigest } from './critiqueFacts.js';
import { testReply } from './providers/test.js';
import {
  UmpireError,
  type UmpireCallRecord,
  type UmpireClient,
  type UmpireRequest,
} from './umpireClient.js';

const MIN = 60_000;
const BRIDGE = { x: 2_050_000, y: 1_500_000 };

const parser: OrderParser = {
  async parse(text: string): Promise<ParseResult> {
    const unitId = text.split(' ')[0]!;
    return {
      kind: 'intents',
      text,
      unitId,
      intents: [{ kind: 'move', to: BRIDGE }],
    } as ParseResult;
  },
};

let host: GameHost | undefined;
afterEach(async () => {
  await host?.shutdown();
  host = undefined;
});

/** A whole game of "Hold the Bridge" against the scripted Red, played in fast-forward and read back from its log. */
async function playedGame(): Promise<ReplayInput> {
  const time = new FakeTime();
  const store = new MemoryGameStore();
  host = new GameHost({
    store,
    parser,
    registry: createRegistry(),
    wallNow: time.now,
    timers: time,
    init: startingState,
    scriptedOpponents: true,
  });
  const game = await host.create('g1', loadScenario(holdTheBridge), { rate: 1 });
  await game.submit({ kind: 'setMode', mode: 'fast-forward' });
  await game.submit({ kind: 'advanceTo', gameMs: 0 });
  await game.submit({ kind: 'order', side: 'blue', text: 'blue-1 march to the bridge' });
  await game.submit({ kind: 'order', side: 'blue', text: 'blue-2 march to the bridge' });
  await game.submit({ kind: 'advanceTo', gameMs: 10 * MIN });
  await game.submit({ kind: 'order', side: 'blue', text: 'blue-3 hold the bridge' });
  await game.submit({ kind: 'advanceTo', gameMs: 200 * MIN });
  expect(game.state.world.outcome).toBeTruthy();
  return (await loadReplayInput(store, 'g1'))!;
}

const record = (output: unknown): UmpireCallRecord => ({
  stage: 'critique',
  model: 'scripted',
  promptVersion: 'critique-v1',
  system: '',
  input: {},
  rawOutput: JSON.stringify(output),
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  costUsd: 0,
  attempts: 1,
});

/** A client that answers each call with the next reply (the last repeats): an output, or an error to throw. */
function scripted(
  ...replies: Array<unknown | Error>
): UmpireClient & { requests: UmpireRequest[] } {
  const requests: UmpireRequest[] = [];
  return {
    requests,
    async call<T>(request: UmpireRequest) {
      requests.push(request);
      const next = replies[Math.min(requests.length - 1, replies.length - 1)];
      if (next instanceof Error) throw next;
      return { output: next as T, record: record(next) };
    },
  };
}

describe('critique facts', () => {
  it('lists the game in order, with sequential ids, from the log alone', async () => {
    const digest = critiqueFacts(await playedGame());
    expect(digest.facts.length).toBeGreaterThan(3);
    expect(digest.facts.map((f) => f.id)).toEqual(digest.facts.map((_, i) => `fact-${i + 1}`));
    const minutes = digest.facts.map((f) => f.minute);
    expect(minutes).toEqual([...minutes].sort((a, b) => a - b));
    expect(minutes.every((m) => m >= 0 && m <= digest.endMinute)).toBe(true);
    expect(digest.facts.filter((f) => f.kind === 'outcome')).toHaveLength(1);
    expect([...digest.sides].sort()).toEqual(['blue', 'red']);
  });

  it('is deterministic: the same log gives the same facts', async () => {
    const input = await playedGame();
    expect(critiqueFacts(input)).toEqual(critiqueFacts(input));
  });

  it('dates every order at the minute it was logged, and every delivery at an order_delivered event', async () => {
    const input = await playedGame();
    const digest = critiqueFacts(input);
    const logged = input.entries
      .filter((e) => e.command.kind === 'order' && !e.error)
      .map((e) => Math.floor(e.gameMs / MIN));
    const orders = digest.facts.filter((f) => f.kind === 'order');
    expect(orders.map((f) => f.minute)).toEqual(logged);
    expect(orders[0]!.text).toContain('blue-1 march to the bridge');

    const { emitted } = replayLog(
      input.header,
      input.world,
      input.entries,
      input.registry,
      undefined,
      input.init,
    );
    const delivered = emitted
      .filter((e) => e.type === 'order_delivered')
      .map((e) => Math.floor(e.time / MIN));
    const deliveries = digest.facts.filter((x) => x.kind === 'delivery');
    expect(deliveries.length).toBeGreaterThan(0);
    for (const f of deliveries) expect(delivered).toContain(f.minute);
  });

  it('records pauses, failed votes and ratio changes from the log, without naming a voter', async () => {
    const input = await playedGame();
    const base = input.entries.at(-1)!;
    const entry = (n: number, gameMs: number, extra: object) => ({
      ...base,
      seq: base.seq + n,
      gameMs,
      endGameMs: gameMs,
      command: { kind: 'proposePause' as const, by: 'user-secret-1' },
      ...extra,
    });
    const withPauses: ReplayInput = {
      ...input,
      entries: [
        ...input.entries,
        entry(1, 5 * MIN, {
          pause: [
            { from: 'running', to: 'pause_proposed', cause: 'proposed', by: 'user-secret-1' },
          ],
        }),
        entry(2, 6 * MIN, { pause: [{ from: 'pause_proposed', to: 'paused', cause: 'all-yes' }] }),
        entry(3, 6 * MIN, {
          pause: [
            { from: 'paused', to: 'resume_proposed', cause: 'proposed', by: 'user-secret-1' },
          ],
        }),
        entry(4, 7 * MIN, { pause: [{ from: 'resume_proposed', to: 'paused', cause: 'no-vote' }] }),
        entry(5, 9 * MIN, { pause: [{ from: 'paused', to: 'running', cause: 'all-yes' }] }),
        entry(6, 9 * MIN, {
          ratio: [{ outcome: 'passed', proposal: 'p1', rate: 4, by: 'user-secret-1' }],
        }),
      ],
    };
    const pauses = critiqueFacts(withPauses).facts.filter((f) => f.kind === 'pause');
    expect(pauses.map((f) => [f.minute, f.text])).toEqual([
      [5, 'A vote to pause the game was called.'],
      [6, 'The game was paused (all-yes).'],
      [6, 'A vote to resume the game was called.'],
      [7, 'A vote to resume the game failed.'],
      [9, 'The game resumed (all-yes).'],
      [9, 'The players voted to change the clock ratio to 4.'],
    ]);
    expect(JSON.stringify(pauses)).not.toContain('user-secret');
  });

  it('refuses a game that has no outcome', async () => {
    const input = await playedGame();
    expect(() => critiqueFacts({ ...input, entries: input.entries.slice(0, 1) })).toThrow(
      /finished/,
    );
  });
});

describe('checkCritique', () => {
  const point = (digest: CritiqueDigest, over: Partial<CritiqueOutput['points'][number]> = {}) => {
    const f = digest.facts.find((x) => x.kind === 'outcome')!;
    return {
      kind: 'outcome' as const,
      side: 'both',
      minute: f.minute,
      text: f.text,
      cites: [f.id],
      ...over,
    };
  };
  const reply = (digest: CritiqueDigest, ...points: CritiqueOutput['points']): CritiqueOutput => ({
    summary: digest.result,
    points,
  });

  it('passes the test provider quotation of the facts, and a point that restates a fact', async () => {
    const digest = critiqueFacts(await playedGame());
    const out = testReply(CRITIQUE_SCHEMA, critiqueInput(digest)) as CritiqueOutput;
    expect(out.points.length).toBeGreaterThan(0);
    expect(checkCritique(out, digest)).toEqual([]);
    expect(checkCritique(reply(digest, point(digest)), digest)).toEqual([]);
  });

  it('rejects an event that is not in the log', async () => {
    const digest = critiqueFacts(await playedGame());
    const out = (p: object) => checkCritique(reply(digest, point(digest, p)), digest);
    expect(out({ cites: ['fact-9999'] })).toContain(
      'point 1: cites "fact-9999", which is not a fact',
    );
    expect(out({ cites: [] })).toContain('point 1: cites no fact');
    expect(out({ minute: digest.endMinute + 40 }).join()).toMatch(/not the minute of any fact/);
    expect(out({ side: 'green' }).join()).toMatch(/unknown side/);
    expect(out({ kind: 'misreading' }).join()).toMatch(/must cite a misreading fact/);
  });

  it('rejects prose that names an entity, unit, figure or place the facts do not hold', async () => {
    const digest = critiqueFacts(await playedGame());
    const bad = (text: string) => checkCritique(reply(digest, point(digest, { text })), digest);
    expect(bad('The blue-9 column was caught on the road.').join()).toMatch(
      /unknown entity "blue-9"/,
    );
    expect(bad('Marshal Davout lost 4000 men at minute 7.').join()).toMatch(
      /Davout|unknown number/,
    );
    expect(bad(`${digest.result} Then fact-9999 happened.`).join()).toMatch(
      /unknown entity "fact-9999"/,
    );
    expect(bad('').join()).toMatch(/empty/);
    expect(checkCritique({ summary: digest.result, points: [] }, digest)).toContain('no points');
  });
});

describe('writeCritique', () => {
  const invented = (digest: CritiqueDigest) => ({
    summary: digest.result,
    points: [
      { kind: 'decision', side: 'blue', minute: 3, text: 'Blue lost.', cites: ['fact-9999'] },
    ],
  });

  it('serves the umpire critique when it passes the checks, citing resolved facts', async () => {
    const digest = critiqueFacts(await playedGame());
    const client = scripted(testReply(CRITIQUE_SCHEMA, critiqueInput(digest)));
    const run = await writeCritique(client, digest);
    expect(run.critique.source).toBe('model');
    expect(run.calls).toBe(1);
    expect(run.records).toHaveLength(1);
    expect(Critique.safeParse(run.critique).success).toBe(true);
    const byId = new Map(digest.facts.map((f) => [f.id, f]));
    for (const p of run.critique.points) {
      for (const c of p.cites) expect(byId.get(c.id)?.minute).toBe(c.minute);
      expect(p.cites.some((c) => c.minute === p.minute)).toBe(true);
    }
    expect(client.requests[0]!.stage).toBe('critique');
    expect(JSON.stringify(client.requests[0]!.input)).not.toContain('rejected');
  });

  it('asks again with the problems listed, then accepts a correct reply', async () => {
    const digest = critiqueFacts(await playedGame());
    const client = scripted(invented(digest), testReply(CRITIQUE_SCHEMA, critiqueInput(digest)));
    const run = await writeCritique(client, digest);
    expect(run.critique.source).toBe('model');
    expect(run.calls).toBe(2);
    expect(run.rejections[0]!.join()).toMatch(/fact-9999/);
    expect((client.requests[1]!.input as { rejected: string[] }).rejected.join()).toMatch(
      /fact-9999/,
    );
  });

  it('falls back to the log own wording when every reply cites what is not there', async () => {
    const digest = critiqueFacts(await playedGame());
    const run = await writeCritique(scripted(invented(digest)), digest);
    expect(run.critique.source).toBe('template');
    expect(run.fallback).toBe('rejected');
    expect(run.calls).toBe(2);
    expect(run.critique).toEqual(templateCritique(digest));
  });

  it('falls back when the umpire fails or there is none', async () => {
    const digest = critiqueFacts(await playedGame());
    const failed = await writeCritique(scripted(new UmpireError('down', 'transport', 1)), digest);
    expect(failed.critique.source).toBe('template');
    expect(failed.fallback).toBe('transport');
    const none = await writeCritique(undefined, digest);
    expect(none.critique).toEqual(templateCritique(digest));
    expect(none.fallback).toBe('no umpire');
  });
});

describe('templateCritique', () => {
  it('cites only facts of the digest, each dated at its own minute', async () => {
    const digest = critiqueFacts(await playedGame());
    const critique = templateCritique(digest);
    expect(Critique.safeParse(critique).success).toBe(true);
    expect(critique.points.length).toBeGreaterThan(0);
    expect(critique.points.length).toBeLessThanOrEqual(12);
    const byId = new Map(digest.facts.map((f) => [f.id, f]));
    for (const p of critique.points) {
      for (const c of p.cites) expect(byId.get(c.id)?.minute).toBe(c.minute);
      expect(p.cites.map((c) => c.minute)).toContain(p.minute);
    }
    expect(critique.points.some((p) => p.kind === 'outcome')).toBe(true);
  });
});
