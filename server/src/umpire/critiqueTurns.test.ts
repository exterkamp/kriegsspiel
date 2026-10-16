/**
 * The critique of a turn-mode game (D39, #506): its facts cite each turn's decision, the engine's
 * corrections, the fallback, the dice and the journal's precedents, and the critique rests on
 * them under the same checks as in real time.
 */
import { holdTheBridge, loadScenario, type TurnRuling } from '@kriegsspiel/engine';
import { Critique, type TurnOrder, type TurnProposal } from '@kriegsspiel/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { loadReplayInput, type ReplayInput } from '../admin/replayView.js';
import { replayTurns } from '../admin/turnView.js';
import { GameHost, MemoryGameStore, createRegistry, startingState } from '../game/index.js';
import { FakeTime } from '../game/testing.js';
import { UmpireTurnResolver } from '../game/umpireTurn.js';
import type { OrderParser } from '../orders/index.js';
import {
  CRITIQUE_PROMPT_VERSION,
  CRITIQUE_SCHEMA,
  checkCritique,
  critiqueInput,
  templateCritique,
  writeCritique,
  type CritiqueOutput,
} from './critique.js';
import { critiqueFacts } from './critiqueFacts.js';
import { ScriptedModel } from './leakKit.testkit.js';
import { testReply } from './providers/test.js';
import { UmpireError } from './umpireClient.js';

const parser: OrderParser = {
  parse: async () => {
    throw new Error('turn mode parses no order with a model');
  },
};

const PLAN: Record<string, Record<number, TurnOrder[]>> = {
  blue: {
    1: [{ orderId: 'b1', to: 'blue-1', text: '1st Battalion, march to the bridge and hold it' }],
  },
  red: {
    1: [{ orderId: 'r1', to: 'red-1', text: 'Vanguard Battalion, advance to the bridge' }],
  },
};

const CHARGE = 'Does the Red hussars charge go home?';

/**
 * Turn 1 gallops Blue's hussars off the map (corrected), turn 2 asks for a roll, turn 3 fails
 * (the tables decide), later turns are the canned proposal. Each turn sets one precedent.
 */
function storyUmpire(): ScriptedModel {
  return new ScriptedModel({
    narrate: (req) => testReply(req.schema as Record<string, unknown>, req.input as never),
    adjudicate: (req) => {
      const base = testReply(
        req.schema as Record<string, unknown>,
        req.input as never,
      ) as TurnProposal;
      const p: TurnProposal = {
        ...base,
        summary: `The bridge held through turn ${base.turn}.`,
        precedents: [`Hussars may not cross the river at the ford in turn ${base.turn}.`],
      };
      if (p.turn === 1) {
        return {
          ...p,
          units: p.units.map((u) =>
            u.unitId === 'blue-3'
              ? { ...u, x: u.x + 9_000, y: u.y - 8_000, departure: 'galloped' }
              : u,
          ),
        };
      }
      if (p.turn === 2) {
        if ((req.input as { rolls?: unknown[] }).rolls) {
          return {
            ...p,
            units: p.units.map((u) => (u.unitId === 'red-3' ? { ...u, rollIds: ['c1'] } : u)),
          };
        }
        return { ...p, rolls: [{ id: 'c1', why: CHARGE, chance: 0.4 }] };
      }
      if (p.turn === 3) throw new UmpireError('the model is down', 'transport', 1);
      return p;
    },
  });
}

let host: GameHost | undefined;
afterEach(async () => {
  await host?.shutdown();
  host = undefined;
});

/** A standard-dial, 10-minute-turn Hold the Bridge game played to its end under `storyUmpire`. */
async function turnGame(): Promise<ReplayInput> {
  const time = new FakeTime();
  const store = new MemoryGameStore();
  const registry = createRegistry();
  const client = storyUmpire();
  host = new GameHost({
    store,
    parser,
    registry,
    wallNow: time.now,
    timers: time,
    init: startingState,
    turnResolver: () =>
      new UmpireTurnResolver({ registry, client, reporter: client, dial: 'standard' }),
  });
  const game = await host.create(
    'g1',
    { ...loadScenario(holdTheBridge), seed: 1815 },
    { settings: { dial: 'standard', persona: 'dry', mode: 'turns', turnMinutes: 10 } },
  );
  for (let guard = 0; guard < 20 && !game.state.world.outcome; guard++) {
    const turn = game.turnStateFor('blue')!.turn;
    for (const side of ['blue', 'red']) {
      for (const order of PLAN[side]![turn] ?? []) {
        await game.submit({ kind: 'turnOrder', side, turn: 0, order });
      }
      await game.submit({ kind: 'sendTurn', side, turn: 0, orders: [] });
    }
    await time.flush();
  }
  expect(game.state.world.outcome).toBeTruthy();
  return (await loadReplayInput(store, 'g1'))!;
}

const MIN = 60_000;

describe('the critique of a turn-mode game (D39, #506)', () => {
  it('cites every turn, its corrections with their reasons, the fallback, the dice and the precedents', async () => {
    const input = await turnGame();
    const digest = critiqueFacts(input);
    const turns = replayTurns(input);
    const of = (kind: string) => digest.facts.filter((f) => f.kind === kind);
    const byTurn = (n: number) => (f: { text: string }) => f.text.startsWith(`Turn ${n} (`);

    // One fact per turn: the umpire's or the tables' decision, the fallback for turn 3.
    expect(turns.length).toBeGreaterThanOrEqual(4);
    for (const r of turns) {
      const end = Math.floor((r.entry.endGameMs ?? r.turn.endMs) / MIN);
      const facts = [...of('turn'), ...of('fallback')].filter(byTurn(r.turn.n));
      expect(facts, `turn ${r.turn.n}`).toHaveLength(1);
      expect(facts[0]!.minute).toBe(end);
    }
    const t1 = of('turn').find(byTurn(1))!;
    expect(t1.text).toMatch(
      /^Turn 1 \(minutes 0 to 10\) was decided by the umpire, and the engine made \d+ corrections? to its proposal\. Its account: "The bridge held through turn 1\."$/,
    );
    const fallback = of('fallback');
    expect(fallback).toHaveLength(1);
    expect(fallback[0]!.text).toMatch(
      /^Turn 3 \(minutes 20 to 30\) was worked out by the tables: the umpire could not decide it after \d+ attempts? \(.*the model is down.*\)\.$/,
    );

    // Every correction of turn 1, each with the limit it broke and the unit's side.
    const rulings = turns[0]!.after.world.rulings.filter(
      (x): x is TurnRuling => 'kind' in x && x.kind === 'turn' && x.turn === 1,
    );
    expect(rulings.length).toBeGreaterThan(0);
    const clamps = of('clamp');
    expect(clamps).toHaveLength(rulings.length);
    for (const [i, c] of clamps.entries()) {
      expect(c.text).toContain(`the engine corrected the umpire's ${rulings[i]!.field}`);
      expect(c.text).toContain(rulings[i]!.reason.slice(0, 40));
      expect(c.side).toBe('blue');
      expect(c.minute).toBe(10);
    }
    // Turn mode's corrections are cited as clamps, not again as plain rulings.
    expect(of('ruling').some((f) => f.text.includes(rulings[0]!.narrative))).toBe(false);

    // The dice of turn 2: the question, the odds and the result (seeded, so fixed).
    expect(of('roll').map((f) => [f.minute, f.text])).toEqual([
      [
        20,
        `In turn 2 the umpire asked the dice "${CHARGE}" at a 40 in 100 chance, and the roll failed.`,
      ],
    ]);

    // The journal's precedents, each at the end of the turn that set it; turn 3 set none.
    const precedents = of('precedent');
    expect(precedents.length).toBeGreaterThanOrEqual(3);
    expect(precedents[0]!.text).toBe(
      'In turn 1 the umpire set a precedent: Hussars may not cross the river at the ford in turn 1.',
    );
    expect(precedents.some((f) => f.text.startsWith('In turn 3 '))).toBe(false);

    // The orders each side sent for the turn.
    expect(of('order').map((f) => [f.minute, f.side, f.text])).toEqual(
      expect.arrayContaining([
        [
          0,
          'blue',
          expect.stringMatching(
            /^Blue sent the order "1st Battalion, march to the bridge and hold it" to .*\(blue-1\) for turn 1\.$/,
          ),
        ],
      ]),
    );

    // Still ids in order, dated in order, and deterministic.
    expect(digest.facts.map((f) => f.id)).toEqual(digest.facts.map((_, i) => `fact-${i + 1}`));
    const minutes = digest.facts.map((f) => f.minute);
    expect(minutes).toEqual([...minutes].sort((a, b) => a - b));
    expect(critiqueFacts(input)).toEqual(digest);
  });

  it('writes a critique that cites them, deterministically, under the same checks', async () => {
    const digest = critiqueFacts(await turnGame());
    const out = testReply(CRITIQUE_SCHEMA, critiqueInput(digest)) as CritiqueOutput;
    expect(out).toEqual(testReply(CRITIQUE_SCHEMA, critiqueInput(digest)));
    expect(checkCritique(out, digest)).toEqual([]);

    const client = new ScriptedModel({
      critique: (req) => testReply(req.schema as Record<string, unknown>, req.input as never),
    });
    const run = await writeCritique(client, digest);
    expect(run.critique.source).toBe('model');
    expect(client.requests[0]!.promptVersion).toBe(CRITIQUE_PROMPT_VERSION);
    expect(Critique.safeParse(run.critique).success).toBe(true);
    const byId = new Map(digest.facts.map((f) => [f.id, f]));
    const cited = run.critique.points.flatMap((p) => p.cites.map((c) => byId.get(c.id)!.kind));
    for (const kind of ['outcome', 'turn', 'fallback', 'clamp', 'roll', 'precedent']) {
      expect(cited, kind).toContain(kind);
    }
    expect(run.critique.points.length).toBeLessThanOrEqual(12);
    for (const p of run.critique.points) {
      expect(p.cites.map((c) => c.minute)).toContain(p.minute);
    }

    // The log's own wording cites them too.
    const template = templateCritique(digest);
    const quoted = template.points.flatMap((p) => p.cites.map((c) => byId.get(c.id)!.kind));
    for (const kind of ['outcome', 'turn', 'fallback', 'clamp']) {
      expect(quoted, kind).toContain(kind);
    }

    // A point that names a correction no fact holds is still refused.
    const invented = {
      summary: digest.result,
      points: [
        {
          kind: 'decision' as const,
          side: 'blue',
          minute: digest.facts.find((f) => f.kind === 'clamp')!.minute,
          text: 'The engine corrected 4321 men of Marshal Davout.',
          cites: [digest.facts.find((f) => f.kind === 'clamp')!.id],
        },
      ],
    };
    expect(checkCritique(invented, digest).join()).toMatch(/unknown number 4321|Davout/);
  });
});
