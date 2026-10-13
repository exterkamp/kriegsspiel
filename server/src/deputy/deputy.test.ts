import {
  EventRegistry,
  holdTheBridge,
  loadScenario,
  registerCombat,
  registerMovement,
  registerOrders,
  registerVisibility,
  viewFor,
  type EngineSideView,
  type GameState,
} from '@kriegsspiel/engine';
import { afterEach, describe, expect, it } from 'vitest';
import { sideViewOf } from '../api/sideView.js';
import { GameHost, MemoryGameStore, replayLog } from '../game/index.js';
import { deputiesFromLog } from '../game/host.js';
import { FakeTime } from '../game/testing.js';
import type { OrderParser, ParseResult } from '../orders/index.js';
import type { UmpireClient, UmpireRequest, UmpireResponse } from '../umpire/umpireClient.js';
import { DeputyAgent, DEPUTY_INTERVAL_MS, DEPUTY_PROMPT_VERSION } from './deputy.js';

const BRIDGE = { x: 2_050_000, y: 1_500_000 };

/** "<unit id> hold" holds where the unit stands; "<unit id> march" goes to the bridge, far away. */
function makeParser(world: GameState): OrderParser {
  return {
    async parse(text: string): Promise<ParseResult> {
      const unitId = text.split(' ')[0]!;
      const unit = world.units.find((u) => u.id === unitId);
      if (!unit) return { kind: 'rejection', text, reason: 'not a unit' };
      return {
        kind: 'intents',
        text,
        unitId,
        intents: text.includes('hold')
          ? [{ kind: 'hold', at: unit.center }]
          : [{ kind: 'move', to: BRIDGE }],
      };
    },
  };
}

class FakeModel implements UmpireClient {
  readonly requests: UmpireRequest[] = [];
  constructor(private readonly reply: (req: UmpireRequest) => unknown) {}
  async call<T>(request: UmpireRequest): Promise<UmpireResponse<T>> {
    this.requests.push(request);
    const output = this.reply(request);
    return {
      output: output as T,
      record: {
        stage: request.stage,
        model: 'fake',
        promptVersion: request.promptVersion,
        system: request.system,
        input: request.input,
        rawOutput: JSON.stringify(output),
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        costUsd: 0,
        attempts: 1,
      },
    };
  }
}

const proposal = {
  orders: [
    { unit: 'blue-1', text: 'blue-1 hold here' },
    { unit: 'blue-2', text: 'blue-2 march to the bridge' },
  ],
  report: 'Sir, I held the left and was refused a march on the bridge.',
};

function registry() {
  const r = new EventRegistry<GameState>();
  registerMovement(r);
  registerCombat(r);
  registerOrders(r);
  registerVisibility(r);
  return r;
}

/** The deputy's calls: the same client also serves narration. */
const deputyCalls = (m: FakeModel) =>
  m.requests.filter((r) => r.promptVersion === DEPUTY_PROMPT_VERSION);

let host: GameHost | undefined;
afterEach(async () => {
  await host?.shutdown();
  host = undefined;
});

async function start(opts: { model?: UmpireClient; away?: () => boolean } = {}) {
  const world = loadScenario(holdTheBridge);
  const time = new FakeTime();
  const store = new MemoryGameStore();
  host = new GameHost({
    store,
    parser: makeParser(world),
    registry: registry(),
    wallNow: time.now,
    timers: time,
    narrator: opts.model ? () => opts.model : undefined,
    deputyAway: opts.away ? () => opts.away!() : undefined,
  });
  const game = await host.create('g1', world, { rate: 12 });
  return { game, store, time, world };
}

const settings = (discretion: 'hold' | 'adjust' | 'act') => ({
  enabled: true,
  discretion,
  intent: 'Hold the river line.',
});

/** Wall ms for one deputy interval at rate 12, plus slack for the call to settle. */
const ONE_TURN_MS = DEPUTY_INTERVAL_MS / 12 + 5_000;

describe('deputy mode', () => {
  it('refuses actions beyond its discretion, signs the rest as deputy orders, and says so', async () => {
    const model = new FakeModel(() => proposal);
    const { game, store, time, world } = await start({ model });
    expect(await game.setDeputy('blue', undefined, settings('hold'))).toEqual({ ok: true });
    await time.advance(ONE_TURN_MS);

    const log = await store.inputLog('g1');
    const orders = log.filter((e) => e.deputy);
    expect(orders.map((e) => e.command)).toEqual([
      expect.objectContaining({ kind: 'order', side: 'blue', text: 'blue-1 hold here' }),
    ]);
    expect(orders[0]!).toMatchObject({ agent: true, deputy: { discretion: 'hold' } });
    // The march was never sent: nothing in the log addresses blue-2.
    expect(log.some((e) => e.command.kind === 'order' && /blue-2/.test(e.command.text))).toBe(
      false,
    );

    const account = game.deputyFor('blue')!.account;
    expect(account).toHaveLength(1);
    expect(account[0]!.issued).toEqual([
      { unitId: 'blue-1', unit: expect.any(String), text: 'blue-1 hold here' },
    ]);
    expect(account[0]!.refused).toEqual([
      expect.objectContaining({
        unitId: 'blue-2',
        reasons: [expect.stringMatching(/told to hold/)],
      }),
    ]);
    expect(account[0]!.report).toBe(proposal.report);

    // The player sees the whole account, as a paper in the in-tray and as structured data.
    const view = sideViewOf(
      game.state,
      'blue',
      game.gameClock.snapshot(),
      undefined,
      [],
      undefined,
      [],
      undefined,
      game.deputyFor('blue'),
    );
    expect(view.deputy?.settings.discretion).toBe('hold');
    const paper = view.dispatches.find((d) => d.id === account[0]!.id)!;
    expect(paper.text).toMatch(/Ordered .*blue-1 hold here/);
    expect(paper.text).toMatch(/Refused .*blue-2 march/);
    expect(paper.text).toContain(proposal.report);

    // Replay rebuilds the same world from the log alone, deputy order included.
    const header = (await store.logHeader('g1'))!;
    const replayed = replayLog(header, world, log, registry(), game.state.time);
    expect(replayed.state.world).toEqual(game.state.world);
    expect(deputiesFromLog(log).get('blue')?.account).toEqual(account);
  });

  it('with wider discretion the same proposal goes through', async () => {
    const model = new FakeModel(() => proposal);
    const { game, store, time } = await start({ model });
    await game.setDeputy('blue', undefined, settings('act'));
    await time.advance(ONE_TURN_MS);
    const orders = (await store.inputLog('g1')).filter((e) => e.deputy);
    expect(orders).toHaveLength(2);
    expect(game.deputyFor('blue')!.account[0]!.refused).toEqual([]);
  });

  it('does nothing while the player is at the table, and when switched off', async () => {
    let away = false;
    const model = new FakeModel(() => proposal);
    const { game, store, time } = await start({ model, away: () => away });
    await game.setDeputy('blue', undefined, settings('act'));
    await time.advance(ONE_TURN_MS);
    expect(deputyCalls(model)).toHaveLength(0);
    expect((await store.inputLog('g1')).filter((e) => e.deputy)).toHaveLength(0);

    away = true;
    game.noteDeputyPresence();
    await time.advance(ONE_TURN_MS);
    expect(deputyCalls(model).length).toBeGreaterThan(0);

    await game.setDeputy('blue', undefined, { ...settings('act'), enabled: false });
    const asked = deputyCalls(model).length;
    await time.advance(3 * ONE_TURN_MS);
    expect(deputyCalls(model)).toHaveLength(asked);
  });

  it('refuses to appoint a deputy in a game with no staff', async () => {
    const { game } = await start();
    expect(await game.setDeputy('blue', undefined, settings('hold'))).toMatchObject({
      ok: false,
    });
    expect(game.deputyFor('blue')).toBeUndefined();
  });

  it('is shown only what Blue knows', async () => {
    const model = new FakeModel(() => ({ orders: [], report: '' }));
    const { game, time, world } = await start({ model });
    await game.setDeputy('blue', undefined, settings('hold'));
    await time.advance(ONE_TURN_MS);
    const sent = JSON.stringify(deputyCalls(model)[0]!.input);
    for (const u of world.units.filter((x) => x.side === 'red')) {
      expect(sent).not.toContain(`"${u.id}"`);
      expect(sent).not.toContain(u.name);
    }
    expect(deputyCalls(model)[0]!.stage).toBe('staff');
    expect((deputyCalls(model)[0]!.input as { view: EngineSideView }).view.side).toBe('blue');
  });

  it('drops an order that names an enemy it has not seen, and one to a unit that is not ours', async () => {
    const world = loadScenario(holdTheBridge);
    const red = world.units.find((u) => u.side === 'red')!;
    const model = new FakeModel(() => ({
      orders: [
        { unit: 'x', text: `blue-1 hold and watch ${red.name}` },
        { unit: 'x', text: 'red-1 hold' },
      ],
      report: `Sir, ${red.name} is coming.`,
    }));
    const agent = new DeputyAgent({
      side: 'blue',
      seat: { role: 'commander' },
      discretion: 'act',
      intent: '',
      client: model,
      parser: makeParser(world),
      world: () => world,
      away: () => true,
      hidden: () => [red.name, red.id],
    });
    expect(await agent.decide(viewFor(world, 'blue', 0))).toEqual([]);
    const turn = agent.takeTurn()!;
    expect(turn.refused).toHaveLength(2);
    expect(turn.report).toBe('');
  });

  it('a subordinate seat’s deputy cannot order a formation the seat does not command', async () => {
    const world = loadScenario(holdTheBridge);
    const model = new FakeModel(() => ({
      orders: [{ unit: 'x', text: 'blue-1 hold here' }],
      report: '',
    }));
    const agent = new DeputyAgent({
      side: 'blue',
      seat: { role: 'subordinate', units: ['blue-2'] },
      discretion: 'act',
      intent: '',
      client: model,
      parser: makeParser(world),
      world: () => world,
      away: () => true,
    });
    expect(await agent.decide(viewFor(world, 'blue', 0))).toEqual([]);
    expect(agent.takeTurn()!.refused[0]!.reasons[0]).toMatch(/could not sign/);
  });
});
