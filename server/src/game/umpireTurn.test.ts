import {
  advanceTo,
  createState,
  holdTheBridge,
  loadScenario,
  positionAt,
  type EngineState,
  type GameState,
  type TurnRuling,
} from '@kriegsspiel/engine';
import type { TurnOrder, TurnProposal, UmpireSettings } from '@kriegsspiel/protocol';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { OrderParser } from '../orders/index.js';
import { ADJUDICATE_PROMPT_VERSION, adjudicateSystem } from '../umpire/adjudicate.js';
import { umpireConfigFromEnv } from '../umpire/config.js';
import { createUmpireClient } from '../umpire/createUmpireClient.js';
import { TURN_CASES, type TurnCase } from '../umpire/eval/turnCases.js';
import { caseWorld, turnEndMs, turnStartMs } from '../umpire/eval/turnInput.js';
import { PlaybackUmpireClient } from '../umpire/playbackUmpireClient.js';
import { ScriptedModel } from '../umpire/leakKit.testkit.js';
import { withPersona } from '../umpire/persona.js';
import { testReply } from '../umpire/providers/test.js';
import {
  UmpireError,
  type UmpireCallRecord,
  type UmpireClient,
  type UmpireRequest,
} from '../umpire/umpireClient.js';
import { EngineTurnResolver } from './engineTurn.js';
import { GameHost, MemoryGameStore, createRegistry, startingState } from './index.js';
import { replayLog } from './replay.js';
import type { TurnRecord } from './store.js';
import { FakeTime } from './testing.js';
import { applyTurn, type TurnInput } from './turns.js';
import { UmpireTurnResolver, type UmpireTurnOutput } from './umpireTurn.js';

const MINUTE = 60_000;
const turnRulings = (w: GameState) =>
  w.rulings.filter((r): r is TurnRuling => 'kind' in r && r.kind === 'turn');

/** No order is parsed by a model in turn mode. */
const parser: OrderParser = {
  parse: async () => {
    throw new Error('turn mode parses no order with a model');
  },
};

const PLAN: Record<string, Record<number, TurnOrder[]>> = {
  blue: {
    1: [
      { orderId: 'b1', to: 'blue-1', text: '1st Battalion, march to the bridge and hold it' },
      { orderId: 'b2', to: 'blue-2', text: 'Hold the southern wood', courier: 'safe' },
    ],
    3: [{ orderId: 'b4', to: 'blue-2', text: 'Advance to the bridge' }],
  },
  red: {
    1: [
      { orderId: 'r1', to: 'red-1', text: 'Vanguard Battalion, advance to the bridge' },
      { orderId: 'r2', to: 'red-3', text: 'Hussars, push to the bridge', courier: 'fast' },
    ],
    2: [{ orderId: 'r3', to: 'red-2', text: 'Line Battalion, march to the bridge' }],
  },
};

/** The canned umpire (the `test` provider), as `UMPIRE_PROVIDER=test` builds it. */
const cannedClient = () =>
  createUmpireClient({ config: umpireConfigFromEnv({ UMPIRE_PROVIDER: 'test' }), env: {} });

/** A client that answers like the canned umpire, with `edit` applied to each reply. */
function editing(
  edit: (p: TurnProposal, call: number, request: UmpireRequest) => unknown,
): ScriptedModel {
  let call = 0;
  return new ScriptedModel({
    adjudicate: (req) =>
      edit(
        testReply(req.schema as Record<string, unknown>, req.input as never) as TurnProposal,
        ++call,
        req,
      ),
  });
}

let host: GameHost | undefined;
afterEach(async () => {
  await host?.shutdown();
  host = undefined;
});

async function play(opts: { dial: UmpireSettings['dial']; client: UmpireClient; seed?: number }) {
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
      settings.dial === 'rigid'
        ? undefined
        : new UmpireTurnResolver({ registry, client: opts.client, dial: settings.dial }),
  });
  const settings: UmpireSettings = {
    dial: opts.dial,
    persona: 'dry',
    mode: 'turns',
    turnMinutes: 20,
  };
  const scenario = { ...loadScenario(holdTheBridge), seed: opts.seed ?? 1815 };
  const game = await host.create('g1', scenario, { settings });
  for (let guard = 0; guard < 20 && !game.state.world.outcome; guard++) {
    const turn = game.turnStateFor('blue')!.turn;
    for (const side of ['blue', 'red']) {
      for (const order of PLAN[side]![turn] ?? []) {
        expect(await game.submit({ kind: 'turnOrder', side, turn: 0, order })).toMatchObject({
          ok: true,
        });
      }
      await game.submit({ kind: 'sendTurn', side, turn: 0, orders: [] });
    }
    await time.flush();
  }
  const log = await store.inputLog('g1');
  // Replay has no resolver and no umpire client: everything it needs is in the log.
  const replayed = replayLog(
    (await store.logHeader('g1'))!,
    scenario,
    log,
    createRegistry(),
    undefined,
    startingState,
  );
  return { game, log, replayed };
}

describe('the umpire adjudicator (D39, 11.6) with the canned umpire', () => {
  it.each(['standard', 'free'] as const)(
    'plays Hold the Bridge to an outcome at %s, and the log replays with no model call',
    async (dial) => {
      const run = await play({ dial, client: cannedClient() });
      expect(run.game.state.world.outcome).toBeTruthy();
      const turns = run.log.filter((e) => e.command.kind === 'resolveTurn');
      expect(turns.length).toBeGreaterThan(1);
      for (const e of turns) {
        expect(e.error).toBeUndefined();
        expect(e.turn!.fallback).toBeUndefined();
        expect(e.turn!.adjudicator).toBe('umpire');
        // One canned call per turn, logged for the record.
        expect(e.calls).toHaveLength(1);
        expect(e.calls![0]).toMatchObject({
          stage: 'adjudicate',
          promptVersion: ADJUDICATE_PROMPT_VERSION,
          canned: true,
        });
        const out = e.turn!.output as UmpireTurnOutput;
        expect(out.proposal.turn).toBe(e.turn!.n);
        expect(out.context.dial).toBe(dial);
      }
      expect(JSON.stringify(run.replayed.state.world)).toBe(JSON.stringify(run.game.state.world));
    },
  );

  it('stays on the engine at rigid: no adjudicate call', async () => {
    const model = new ScriptedModel({});
    const run = await play({ dial: 'rigid', client: model });
    expect(run.game.state.world.outcome).toBeTruthy();
    expect(model.requests).toHaveLength(0);
    for (const e of run.log.filter((x) => x.command.kind === 'resolveTurn')) {
      expect(e.turn!.adjudicator).toBe('engine');
    }
  });

  it('ends a turn where the projection does, since the canned proposal is the projection', async () => {
    const registry = createRegistry();
    const { state, input } = firstTurn();
    const engine = await new EngineTurnResolver(registry).resolve(state, input);
    const umpire = await new UmpireTurnResolver({
      registry,
      client: cannedClient(),
      dial: 'standard',
    }).resolve(state, input);
    expect(umpire.adjudicator).toBe('umpire');
    const end = (r: { adjudicator: string; output?: unknown }) =>
      advanceTo(
        applyTurn(state, record(input, r), { gameId: 'g', registry }),
        input.endMs,
        registry,
      ).state.world;
    const a = end(engine);
    const b = end(umpire);
    for (const u of a.units) {
      const v = b.units.find((x) => x.id === u.id)!;
      const p = positionAt(a.map, u, input.endMs);
      const q = positionAt(b.map, v, input.endMs);
      // Within 2 m: the proposal is in whole metres.
      expect(Math.abs(p.x - q.x) + Math.abs(p.y - q.y)).toBeLessThan(2_000);
      expect(Math.round(v.strength)).toBe(Math.round(u.strength));
      expect(v.status).toBe(u.status);
    }
    // The canned proposal needs no clamp.
    expect(turnRulings(b)).toEqual([]);
    // The orders that arrived are carried out; each side saw what the engine's rules saw.
    const out = umpire.output as UmpireTurnOutput;
    const b1 = out.proposal.units.find((u) => u.unitId === 'blue-1')!;
    expect(b1.orders).toEqual([{ orderId: 'blue-b1', result: 'carried-out' }]);
    expect(out.proposal.observations.length).toBeGreaterThan(0);
  });
});

/** A world at the start of turn 1 with Blue's and Red's first orders sent. */
function firstTurn(): { state: EngineState<GameState>; input: TurnInput } {
  const world: GameState = { ...loadScenario(holdTheBridge), seed: 1815, dial: 'standard' };
  const state = startingState(createState(world.seed, world, 0));
  const input: TurnInput = {
    gameId: 'g',
    n: 1,
    startMs: 0,
    endMs: 20 * MINUTE,
    cause: 'all-sent',
    orders: [
      ...PLAN.blue![1]!.map((o) => ({ ...o, side: 'blue' })),
      ...PLAN.red![1]!.map((o) => ({ ...o, side: 'red' })),
    ],
    sent: ['blue', 'red'],
  };
  return { state, input };
}

const record = (input: TurnInput, r: { adjudicator: string; output?: unknown }): TurnRecord =>
  JSON.parse(
    JSON.stringify({
      n: input.n,
      startMs: input.startMs,
      endMs: input.endMs,
      cause: input.cause,
      orders: input.orders,
      sent: input.sent,
      adjudicator: r.adjudicator,
      output: r.output,
    }),
  ) as TurnRecord;

describe('the adjudicate pipeline: checks, one resend, clamp or fall back', () => {
  const registry = createRegistry();
  const resolver = (client: UmpireClient, dial: 'standard' | 'free' = 'standard') =>
    new UmpireTurnResolver({ registry, client, dial });

  it('sends a march beyond the limit back once with the problem listed, then clamps it', async () => {
    const { state, input } = firstTurn();
    // Blue's hussars ride 12 km in a turn, with a reason, both times.
    const model = editing((p) => ({
      ...p,
      units: p.units.map((u) =>
        u.unitId === 'blue-3' ? { ...u, x: u.x + 9_000, y: u.y - 8_000, departure: 'galloped' } : u,
      ),
    }));
    const r = await resolver(model).resolve(state, input);
    expect(model.requests).toHaveLength(2);
    const resend = model.requests[1]!.input as { rejected: { problems: string[] } };
    expect(resend.rejected.problems).toContain(
      'limits: blue-3: end position (11050, -7300) fails the march check (footprint extends off the map; a position is off the map)',
    );
    expect(r.adjudicator).toBe('umpire');
    expect(r.fallback).toBeUndefined();
    expect(r.calls).toHaveLength(2);
    expect((r.output as UmpireTurnOutput).resent).toEqual(resend.rejected.problems);
    const end = advanceTo(
      applyTurn(state, record(input, r), { gameId: 'g', registry }),
      input.endMs,
      registry,
    ).state.world;
    const ruling = turnRulings(end).find((x) => x.unitId === 'blue-3');
    expect(ruling).toMatchObject({ field: 'position' });
  });

  it('applies a reply fixed after the resend with no clamp', async () => {
    const { state, input } = firstTurn();
    const model = editing((p, call) =>
      call === 1
        ? {
            ...p,
            units: p.units.map((u) => (u.unitId === 'red-1' ? { ...u, strength: 99_999 } : u)),
          }
        : p,
    );
    const r = await resolver(model).resolve(state, input);
    expect(model.requests).toHaveLength(2);
    expect(r.adjudicator).toBe('umpire');
    const out = r.output as UmpireTurnOutput;
    expect(out.resent!.some((p) => p.includes('red-1'))).toBe(true);
    const end = advanceTo(
      applyTurn(state, record(input, r), { gameId: 'g', registry }),
      input.endMs,
      registry,
    ).state.world;
    expect(turnRulings(end)).toEqual([]);
  });

  it('falls back to the engine when the call fails twice, and says why', async () => {
    const { state, input } = firstTurn();
    let calls = 0;
    const failing: UmpireClient = {
      call: async () => {
        calls++;
        throw new UmpireError('output failed schema validation: not JSON', 'schema', 3);
      },
    };
    const reasons: string[] = [];
    const r = await new UmpireTurnResolver({
      registry,
      client: failing,
      dial: 'standard',
      onFallback: (_n, why) => reasons.push(why),
    }).resolve(state, input);
    const engine = await new EngineTurnResolver(registry).resolve(state, input);
    expect(calls).toBe(2);
    expect(r.adjudicator).toBe('engine');
    expect(r.output).toEqual(engine.output);
    expect(r.fallback).toEqual({
      error: expect.stringMatching(/fell back to the engine: .*schema/),
      attempts: 6,
    });
    expect(reasons).toEqual([r.fallback!.error]);
  });

  it('falls back when the reply never fits the schema', async () => {
    const { state, input } = firstTurn();
    const model = new ScriptedModel({ adjudicate: () => ({ turn: 1, units: 'none' }) });
    const r = await resolver(model).resolve(state, input);
    expect(model.requests).toHaveLength(2);
    expect(r.adjudicator).toBe('engine');
    expect(r.fallback!.error).toMatch(/schema/);
    // The answers that came back are logged even so.
    expect(r.calls).toHaveLength(2);
  });

  it('does not retry a call the game’s budget refused', async () => {
    const { state, input } = firstTurn();
    let calls = 0;
    const capped: UmpireClient = {
      call: async () => {
        calls++;
        throw new UmpireError('game budget spent', 'budget', 0);
      },
    };
    const r = await resolver(capped).resolve(state, input);
    expect(calls).toBe(1);
    expect(r.adjudicator).toBe('engine');
    expect(r.fallback!.error).toMatch(/budget/);
  });

  it('falls back when more than half the units would be clamped after the resend', async () => {
    const { state, input } = firstTurn();
    const model = editing((p) => ({
      ...p,
      units: p.units.map((u) => ({ ...u, x: u.x + 20_000 })),
    }));
    const r = await resolver(model, 'free').resolve(state, input);
    expect(model.requests).toHaveLength(2);
    expect(r.adjudicator).toBe('engine');
    expect(r.fallback!.error).toMatch(/would clamp \d+ of \d+ units/);
  });

  it('falls back when the proposal is for another turn', async () => {
    const { state, input } = firstTurn();
    const model = editing((p) => ({ ...p, turn: 2 }));
    const r = await resolver(model).resolve(state, input);
    expect(r.adjudicator).toBe('engine');
    expect(r.fallback!.error).toMatch(/turn 2, not turn 1/);
  });

  it('falls back when the turn takes longer than its time limit', async () => {
    const { state, input } = firstTurn();
    const never: UmpireClient = { call: () => new Promise(() => {}) };
    const r = await new UmpireTurnResolver({
      registry,
      client: never,
      dial: 'standard',
      turnTimeoutMs: 20,
    }).resolve(state, input);
    expect(r.adjudicator).toBe('engine');
    expect(r.fallback!.error).toMatch(/longer than/);
  });

  it('puts an unexplained departure back to the projection under standard, but not under free', async () => {
    const { state, input } = firstTurn();
    // Blue's second battalion loses 100 men with no reason given.
    const lose = (p: TurnProposal) => ({
      ...p,
      units: p.units.map((u) => (u.unitId === 'blue-2' ? { ...u, strength: u.strength - 100 } : u)),
    });
    const strengthAfter = async (dial: 'standard' | 'free') => {
      const r = await resolver(editing(lose), dial).resolve(state, input);
      expect(r.adjudicator).toBe('umpire');
      const end = advanceTo(
        applyTurn(state, record(input, r), { gameId: 'g', registry }),
        input.endMs,
        registry,
      ).state.world;
      return end.units.find((u) => u.id === 'blue-2')!.strength;
    };
    const canned = (await resolver(cannedClient()).resolve(state, input))
      .output as UmpireTurnOutput;
    const projected = canned.proposal.units.find((u) => u.unitId === 'blue-2')!.strength;
    expect(Math.round(await strengthAfter('standard'))).toBe(projected);
    expect(Math.round(await strengthAfter('free'))).toBe(projected - 100);
  });
});

describe('the umpire’s prompt', () => {
  it('is the stage’s own constant with the persona, whatever the orders say', async () => {
    const { state, input } = firstTurn();
    const model = editing((p) => p);
    await new UmpireTurnResolver({
      registry: createRegistry(),
      client: model,
      dial: 'free',
      persona: 'dramatic',
    }).resolve(state, input);
    expect(model.requests[0]!.system).toBe(withPersona(adjudicateSystem('free'), 'dramatic'));
    expect(model.requests[0]!.system).toContain('"free"');
    const shown = model.requests[0]!.input as { orders: { orderId: string; text: string }[] };
    expect(shown.orders.map((o) => o.orderId)).toEqual(['blue-b1', 'blue-b2', 'red-r1', 'red-r2']);
  });
});

describe('replay of a recorded umpire turn', () => {
  it('serves the logged call through playback and ends in the same state', async () => {
    const registry = createRegistry();
    const { state, input } = firstTurn();
    const model = editing((p) => ({
      ...p,
      units: p.units.map((u) =>
        u.unitId === 'blue-1'
          ? { ...u, x: u.x - 50, account: 'We halted short of the bridge.' }
          : u,
      ),
    }));
    const live = await new UmpireTurnResolver({
      registry,
      client: model,
      dial: 'standard',
    }).resolve(state, input);
    expect(live.adjudicator).toBe('umpire');
    const played = await new UmpireTurnResolver({
      registry,
      client: new PlaybackUmpireClient(live.calls as UmpireCallRecord[]),
      dial: 'standard',
    }).resolve(state, input);
    expect(played).toEqual(live);
    const end = (r: { adjudicator: string; output?: unknown }) =>
      JSON.stringify(
        advanceTo(
          applyTurn(state, record(input, r), { gameId: 'g', registry }),
          input.endMs,
          registry,
        ).state,
      );
    expect(end(played)).toBe(end(live));
  });
});

describe('a recorded real-model turn (the benchmark’s Opus answers, #398)', () => {
  const dir = new URL('../../bench/umpire/claude-code-opus/', import.meta.url);

  /** A benchmark case as a live turn: its world at `T0` and the orders sent in it. */
  function caseTurn(c: TurnCase): { state: EngineState<GameState>; input: TurnInput } {
    const world: GameState = { ...caseWorld(c), dial: 'standard' };
    const startMs = turnStartMs(c);
    const state = startingState(createState(world.seed, world, startMs));
    const sent = c.orders.filter((o) => (o.sentTurn ?? c.turn) === c.turn);
    return {
      state,
      input: {
        gameId: 'bench',
        n: c.turn,
        startMs,
        endMs: turnEndMs(c),
        cause: 'all-sent',
        orders: sent.map((o) => ({
          orderId: o.orderId,
          side: o.side,
          to: o.to,
          text: o.text,
          courier: o.courier === 'fast' ? 'fast' : 'safe',
        })),
        sent: [...new Set(sent.map((o) => o.side))],
      },
    };
  }

  it.each(TURN_CASES.map((c) => c.id))(
    '%s: the recorded answer replays through playback to the same state',
    async (id) => {
      const c = TURN_CASES.find((x) => x.id === id)!;
      const raw = JSON.parse(readFileSync(new URL(`${id}.json`, dir), 'utf8')).raw as string;
      const recorded = JSON.parse(raw) as TurnProposal;
      // The live game names an order `<side>-<desk id>`; the benchmark named it by its desk id.
      const sideOf = new Map(c.orders.map((o) => [o.orderId, o.side]));
      const answer: TurnProposal = {
        ...recorded,
        units: recorded.units.map((u) => ({
          ...u,
          orders: u.orders.map((o) => ({ ...o, orderId: `${sideOf.get(o.orderId)}-${o.orderId}` })),
        })),
      };
      const registry = createRegistry();
      const { state, input } = caseTurn(c);
      const live = await new UmpireTurnResolver({
        registry,
        client: new ScriptedModel({ adjudicate: () => answer }),
        dial: 'standard',
      }).resolve(state, input);
      const played = await new UmpireTurnResolver({
        registry,
        client: new PlaybackUmpireClient((live.calls ?? []) as UmpireCallRecord[]),
        dial: 'standard',
      }).resolve(state, input);
      expect(played).toEqual(live);
      const end = (r: { adjudicator: string; output?: unknown }) =>
        JSON.stringify(
          advanceTo(
            applyTurn(state, record(input, r), { gameId: 'g', registry }),
            input.endMs,
            registry,
          ).state,
        );
      expect(end(played)).toBe(end(live));
      // Opus's answers pass the gate (some after clamps): each is an umpire turn, not a fallback.
      expect(live.adjudicator).toBe('umpire');
    },
  );
});
