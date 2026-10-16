/**
 * Turn reports (D39, 11.9, #405) in whole games: after each umpire turn every side that people play
 * is told, in one call, what its own units saw and did; the papers reach its in-tray at the turn's
 * end, are logged so a reopened game and replay show them with no model, and carry nothing a side
 * could not know (the leak test at the end plants a canary in everything it must never read).
 */
import { holdTheBridge, loadScenario, type GameState, type SideId } from '@kriegsspiel/engine';
import type { Dispatch, TurnOrder, TurnProposal, UmpireSettings } from '@kriegsspiel/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { OrderParser } from '../orders/index.js';
import { sideViewOf } from '../api/sideView.js';
import { ScriptedModel, plantCanaries } from '../umpire/leakKit.testkit.js';
import { testReply } from '../umpire/providers/test.js';
import { TURN_REPORTS_PROMPT_VERSION, type TurnReportsInput } from '../umpire/turnReports.js';
import { UmpireError, type UmpireClient, type UmpireRequest } from '../umpire/umpireClient.js';
import { TABLES_NOTICE } from './engineTurn.js';
import { GameHost, MemoryGameStore, createRegistry, startingState } from './index.js';
import { replayLog } from './replay.js';
import { FakeTime } from './testing.js';
import { turnNarrationsFromLog } from './turns.js';
import { UmpireTurnResolver } from './umpireTurn.js';

const MINUTE = 60_000;
const SIDES = ['blue', 'red'] as const;

const parser: OrderParser = {
  parse: async () => {
    throw new Error('turn mode parses no order with a model');
  },
};

const PLAN: Record<string, Record<number, TurnOrder[]>> = {
  blue: {
    1: [
      { orderId: 'b1', to: 'blue-1', text: 'March to the bridge and hold it' },
      { orderId: 'b2', to: 'blue-2', text: 'Hold the southern wood', courier: 'safe' },
    ],
  },
  red: {
    1: [{ orderId: 'r1', to: 'red-1', text: 'Advance to the bridge' }],
  },
};

/** The canned umpire (`test` provider rules) for every stage, with `edit` applied to adjudicate. */
function model(
  edit: (p: TurnProposal, req: UmpireRequest) => unknown = (p) => p,
  narrate: (req: UmpireRequest) => unknown = (req) =>
    testReply(req.schema as Record<string, unknown>, req.input as never),
): ScriptedModel {
  return new ScriptedModel({
    adjudicate: (req) =>
      edit(
        testReply(req.schema as Record<string, unknown>, req.input as never) as TurnProposal,
        req,
      ),
    narrate,
  });
}

let host: GameHost | undefined;
afterEach(async () => {
  await host?.shutdown();
  host = undefined;
});

/** Each side's in-tray as the hub would send it: its view with the narrated text in place. */
function trays(game: Awaited<ReturnType<GameHost['create']>>) {
  const clock = game.gameClock.snapshot();
  return Object.fromEntries(
    SIDES.map((side) => [
      side,
      sideViewOf(game.state, side, clock, undefined, [], game.narrationFor(side)).dispatches,
    ]),
  ) as Record<(typeof SIDES)[number], Dispatch[]>;
}

async function play(opts: {
  client: UmpireClient;
  world?: GameState;
  turns?: number;
  afterTurn?: (game: Awaited<ReturnType<GameHost['create']>>) => void;
}) {
  const time = new FakeTime();
  const store = new MemoryGameStore();
  const registry = createRegistry();
  host = new GameHost({
    store,
    parser,
    registry,
    wallNow: time.now,
    timers: time,
    init: startingState,
    turnResolver: (_id, settings) =>
      new UmpireTurnResolver({
        registry,
        client: opts.client,
        reporter: opts.client,
        dial: 'standard',
        persona: settings.persona,
      }),
  });
  const settings: UmpireSettings = {
    dial: 'standard',
    persona: 'dry',
    mode: 'turns',
    turnMinutes: 10,
  };
  const scenario = { ...(opts.world ?? loadScenario(holdTheBridge)), seed: 1815 };
  const game = await host.create('g1', scenario, { settings });
  for (let n = 0; n < (opts.turns ?? 3) && !game.state.world.outcome; n++) {
    const turn = game.turnStateFor('blue')!.turn;
    for (const side of SIDES) {
      for (const order of PLAN[side]![turn] ?? []) {
        expect(await game.submit({ kind: 'turnOrder', side, turn: 0, order })).toMatchObject({
          ok: true,
        });
      }
      await game.submit({ kind: 'sendTurn', side, turn: 0, orders: [] });
    }
    await time.flush();
    opts.afterTurn?.(game);
  }
  const log = await store.inputLog('g1');
  return { game, log, store, scenario, time };
}

const narrateCalls = (m: ScriptedModel) => m.requests.filter((r) => r.stage === 'narrate');

describe('turn reports (D39, 11.9)', () => {
  it('writes each side its papers in one call per turn, from its own view, into its in-tray at the turn end', async () => {
    const m = model();
    const seen: Array<Record<string, Dispatch[]>> = [];
    const { log, game } = await play({ client: m, afterTurn: (g) => seen.push(trays(g)) });
    const turns = log.filter((e) => e.command.kind === 'resolveTurn');
    expect(turns.length).toBe(3);
    // After the turn's adjudicate calls (one, or two with a resend), one report call per side.
    const stages = m.requests.map((r) => r.stage).join(' ');
    expect(stages).toMatch(/^((adjudicate ){1,2}narrate narrate ?){3}$/);
    for (const r of narrateCalls(m)) {
      expect(r.promptVersion).toBe(TURN_REPORTS_PROMPT_VERSION);
      const input = r.input as TurnReportsInput;
      // The side's own papers only: no other side's unit is named in what the model is shown.
      const { units } = game.state.world;
      for (const u of units.filter((x) => x.side !== input.side)) {
        expect(JSON.stringify(input)).not.toContain(u.name);
      }
    }
    const reported = log.filter((e) => e.command.kind === 'turnReports');
    expect(reported).toHaveLength(turns.length * 2);
    for (const e of reported) {
      expect(e.calls).toHaveLength(1);
      expect(e.calls![0]!.stage).toBe('narrate');
    }
    // After each turn, each side's in-tray holds a paper from each of its units, written and
    // received at the turn's end, in the narrated words (the canned narrator's "... here:").
    for (const [i, t] of turns.entries()) {
      for (const side of SIDES) {
        const own = game.state.world.units.filter((u) => u.side === side).map((u) => u.name);
        const papers = seen[i]![side]!.filter(
          (d) => d.kind === 'turn' && d.writtenAtGame === t.turn!.endMs,
        );
        expect(papers.length).toBeGreaterThan(0);
        for (const d of papers) {
          expect(own).toContain(d.from);
          expect(d.receivedAtGame).toBe(t.turn!.endMs);
          expect(d.text).toContain(`${d.from} here:`);
        }
      }
    }
  });

  it('has a commander whose manner bent the order say what he did instead, and why', async () => {
    const account =
      'I took the order to mean the wood, not the bridge, and kept my men in the wood to watch the road.';
    const m = model((p) => ({
      ...p,
      units: p.units.map((u) =>
        u.unitId === 'blue-1'
          ? {
              ...u,
              account,
              orders: u.orders.map((o) =>
                o.result === 'carried-out' ? { ...o, result: 'misread' as const } : o,
              ),
            }
          : u,
      ),
    }));
    const { game } = await play({ client: m });
    const blue1 = game.state.world.units.find((u) => u.id === 'blue-1')!.name;
    // The model was shown the order in Blue's own words, what became of it, and his account.
    const shown = narrateCalls(m)
      .map((r) => r.input as TurnReportsInput)
      .filter((i) => i.side === 'blue')
      .flatMap((i) => i.reports)
      .filter((r) => r.from === blue1 && r.orders?.some((o) => o.result === 'misread'));
    expect(shown.length).toBeGreaterThan(0);
    expect(shown[0]!.orders).toContainEqual({
      text: 'March to the bridge and hold it',
      result: 'misread',
    });
    expect(shown[0]!.account).toBe(account);
    // And Blue reads it from him: what he did, and why.
    const papers = trays(game).blue.filter((d) => d.kind === 'turn' && d.from === blue1);
    expect(papers.some((d) => d.text.includes('I acted on my orders as I understood them'))).toBe(
      true,
    );
    expect(papers.some((d) => d.text.includes('kept my men in the wood to watch the road'))).toBe(
      true,
    );
  });

  it('is deterministic, and a reopened game and a replay show the same papers with no model', async () => {
    const first = await play({ client: model() });
    const live = trays(first.game);
    await host!.shutdown();
    const again = await play({ client: model() });
    expect(trays(again.game)).toEqual(live);

    // Reopened: the papers come from the log; a model that throws is never asked.
    await host!.close('g1');
    const game = await host!.open('g1');
    expect(trays(game)).toEqual(live);

    // Replayed: no resolver, no model; the narrated text from the log's `turnReports` entries.
    const replayed = replayLog(
      (await again.store.logHeader('g1'))!,
      again.scenario,
      again.log,
      createRegistry(),
      undefined,
      startingState,
    );
    const narrations = turnNarrationsFromLog(again.log);
    const clock = again.game.gameClock.snapshot();
    for (const side of SIDES) {
      expect(
        sideViewOf(replayed.state, side, clock, undefined, [], narrations.get(side)).dispatches,
      ).toEqual(live[side]);
    }
  });

  it('gives a subordinate seat only its own formation’s papers', async () => {
    const { game } = await play({ client: model(), turns: 1 });
    const clock = game.gameClock.snapshot();
    const view = sideViewOf(
      game.state,
      'blue',
      clock,
      { role: 'subordinate', units: ['blue-1'] },
      [],
      game.narrationFor('blue'),
    );
    const name = game.state.world.units.find((u) => u.id === 'blue-1')!.name;
    const papers = view.dispatches.filter((d) => d.kind === 'turn');
    expect(papers.length).toBe(1);
    expect(papers[0]!.from).toBe(name);
    expect(papers[0]!.text).toContain(`${name} here:`);
  });

  it('tells every side in-fiction when a turn fell back to the tables, with no report call', async () => {
    const m = new ScriptedModel({
      adjudicate: () => {
        throw new UmpireError('upstream down', 'transport', 1);
      },
    });
    const { game, log } = await play({ client: m, turns: 1 });
    expect(log.find((e) => e.command.kind === 'resolveTurn')!.turn!.fallback).toBeDefined();
    expect(narrateCalls(m)).toEqual([]);
    expect(log.some((e) => e.command.kind === 'turnReports')).toBe(false);
    for (const side of SIDES) {
      const notice = trays(game)[side].filter((d) => d.kind === 'notice');
      expect(notice).toHaveLength(1);
      expect(notice[0]).toMatchObject({ text: TABLES_NOTICE, receivedAtGame: 10 * MINUTE });
    }
  });
});

describe('turn reports leak nothing (11.9)', () => {
  const SUMMARY = 'SUMMARY-CANARY';
  const JOURNAL = 'JOURNAL-CANARY';
  const ROLL = 'ROLL-CANARY';
  /** Each side's accounts carry a word only that side may read. */
  const ACCOUNT: Record<SideId, string> = { blue: 'zebrafinch', red: 'kestrelhawk' };

  it('never gives a side the hidden state, the summary, the journal, the rolls or the other side’s accounts', async () => {
    const { world, secrets } = plantCanaries();
    const words: Array<{ value: string; hiddenFrom: SideId | 'all' }> = [
      { value: SUMMARY, hiddenFrom: 'all' },
      { value: JOURNAL, hiddenFrom: 'all' },
      { value: ROLL, hiddenFrom: 'all' },
      { value: ACCOUNT.blue, hiddenFrom: 'red' },
      { value: ACCOUNT.red, hiddenFrom: 'blue' },
      ...secrets.map((s) => ({ value: s.value, hiddenFrom: s.hiddenFrom })),
    ];
    const enemyName = (side: SideId) => secrets.find((s) => s.hiddenFrom === side)!.value;
    const m = model(
      (p, req) => {
        const final = {
          ...p,
          summary: `The umpire's record of the turn ${SUMMARY}.`,
          precedents: [`Cavalry may not cross the river ${JOURNAL}.`],
          units: p.units.map((u) => ({
            ...u,
            account: `We kept our ground and the men watched the road, ${ACCOUNT[u.unitId.startsWith('red') ? 'red' : 'blue']}.`,
          })),
        };
        // The first call asks for a roll whose question carries a canary; the answer is final.
        return (req.input as { rolls?: unknown }).rolls
          ? final
          : {
              ...final,
              rolls: [{ id: 'r1', why: `Does the charge go home? ${ROLL}`, chance: 0.5 }],
            };
      },
      // An adversarial narrator: it writes the canned note, and slips the enemy's name into one.
      (req) => {
        const out = testReply(req.schema as Record<string, unknown>, req.input as never) as {
          dispatches: Array<{ reportIds: string[]; text: string }>;
        };
        const side = (req.input as TurnReportsInput).side;
        const [first, ...rest] = out.dispatches;
        return {
          dispatches: first
            ? [{ ...first, text: `${first.text}. The ${enemyName(side)} are before us` }, ...rest]
            : [],
        };
      },
    );
    const leaks: string[] = [];
    const check = (text: string, reader: SideId, where: string) => {
      for (const w of words) {
        if ((w.hiddenFrom === 'all' || w.hiddenFrom === reader) && text.includes(w.value)) {
          leaks.push(`${w.value} reached ${reader} in ${where}`);
        }
      }
    };
    const { game, log } = await play({
      client: m,
      world,
      turns: 4,
      afterTurn: (g) => {
        const clock = g.gameClock.snapshot();
        for (const side of SIDES) {
          const sent = JSON.stringify([
            sideViewOf(g.state, side, clock, undefined, [], g.narrationFor(side)),
            g.turnStateFor(side),
          ]);
          check(sent, side, `its view at ${g.state.time}`);
        }
      },
    });
    // The umpire did roll, keep a journal and get its summary logged: the canaries are in play.
    const turns = log.filter((e) => e.command.kind === 'resolveTurn');
    expect(turns.length).toBeGreaterThan(1);
    expect(JSON.stringify(turns)).toContain(ROLL);
    expect(JSON.stringify(game.state.world.journal)).toContain(JOURNAL);
    // What each side's report call was shown, first call and resend alike.
    const calls = narrateCalls(m);
    // Per side and turn, the call and the one resend its rejected note earned.
    expect(calls.length).toBe(turns.length * 2 * 2);
    for (const r of calls) {
      const side = (r.input as TurnReportsInput).side;
      const shown = JSON.stringify(r.input);
      // A resend quotes the model's own rejected words back; those are not state.
      const asked =
        'rejected' in (r.input as object)
          ? JSON.stringify({ ...(r.input as object), rejected: [] })
          : shown;
      check(asked, side, 'its report call');
      check(r.system, side, 'its report prompt');
    }
    // Each side's own accounts did reach it, so the test can see a leak if there were one.
    for (const side of SIDES) {
      expect(JSON.stringify(trays(game)[side])).toContain(ACCOUNT[side]);
    }
    // The logged papers each side reads are its own too.
    for (const e of log.filter((x) => x.command.kind === 'turnReports')) {
      check(JSON.stringify(e.narrated), (e.command as { side: SideId }).side, 'its logged papers');
    }
    expect(leaks).toEqual([]);
  });
});
