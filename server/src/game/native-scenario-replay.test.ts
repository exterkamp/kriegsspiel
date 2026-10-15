import { createState, type EmittedEvent } from '@kriegsspiel/engine';
import { describe, expect, it } from 'vitest';
import type { ParseResult } from '../orders/index.js';
import {
  createNativeScenarioPin,
  decodeNativeScenarioPin,
  type NativeScenarioPinV1,
} from './native-scenario-pin.js';
import { defaultBridgeV1Input } from './native-scenarios/default-bridge-v1.js';
import { openBridgeV1Input } from './native-scenarios/open-bridge-v1.js';
import { createRegistry, startingState } from './registry.js';
import { advanceUntilOver, applyLoggedOrder, replayLog } from './replay.js';
import type { InputLogEntry, InputLogHeader } from './store.js';

type LoggedIntent = Extract<ParseResult, { kind: 'intents' }>;
type LoggedOrder = InputLogEntry & {
  command: Extract<InputLogEntry['command'], { kind: 'order' }>;
  parse: LoggedIntent;
};

/** Accepted parse results in memory, not a parser/model call or a persisted log. */
function loggedOrders(): LoggedOrder[] {
  const commands: Array<{ side: 'blue' | 'red'; parse: LoggedIntent }> = [
    {
      side: 'blue',
      parse: {
        kind: 'intents',
        unitId: 'blue-1',
        text: 'Hold the bridge',
        intents: [{ kind: 'hold', at: { x: 2_050_000, y: 1_500_000 } }],
      },
    },
    {
      side: 'red',
      parse: {
        kind: 'intents',
        unitId: 'red-1',
        text: 'Hold the bridge',
        intents: [{ kind: 'hold', at: { x: 2_050_000, y: 1_500_000 } }],
      },
    },
    {
      side: 'blue',
      parse: {
        kind: 'intents',
        unitId: 'blue-3',
        text: 'Move to the north-west approaches',
        intents: [{ kind: 'move', to: { x: 1_000_000, y: 600_000 } }],
      },
    },
  ];
  return commands.map(({ side, parse }, index) => ({
    seq: index + 1,
    wallMs: 0,
    gameMs: 0,
    command: { kind: 'order', side, text: parse.text },
    parse,
  }));
}

const definitions = [
  {
    label: 'retained default',
    input: defaultBridgeV1Input,
    pairingId: 'hold-the-bridge:default',
    name: 'The bridge battlefield',
    isDefault: true,
  },
  {
    label: 'Open bridge v1',
    input: openBridgeV1Input,
    pairingId: 'hold-the-bridge:open-v1',
    name: 'Open bridge approaches',
    isDefault: false,
  },
];

// Pure scenario/engine calculations only: no GameHost, actor, HTTP, DB, log file
// or live game. Detached seed variants are never registered or made available.
describe.each(definitions)('$label logged-order durable-pin replay (R7-N1)', (definition) => {
  it.each([1815, 17, 97])('replays delivery, movement, combat and outcome at seed %i', (seed) => {
    const retained = definition.input() as NativeScenarioPinV1['rawScenario'];
    const authoredBefore = structuredClone(retained);
    expect(retained.seed).toBe(1815);
    const raw = structuredClone(retained);
    raw.seed = seed;
    const pin = createNativeScenarioPin({
      rawScenario: raw,
      scenarioId: 'hold-the-bridge',
      pairingId: definition.pairingId,
      name: definition.name,
      isDefault: definition.isDefault,
    });
    const durableJson = JSON.stringify(pin);
    // Both paths start with durable decode, before runtime initialization. Each
    // owns a separate decoded world, not a shared possibly mutated state.
    const directPin = decodeNativeScenarioPin(JSON.parse(durableJson));
    const replayPin = decodeNativeScenarioPin(JSON.parse(durableJson));
    expect(directPin).toEqual(replayPin);
    expect(directPin).not.toBe(replayPin);
    expect(directPin.initialWorld).not.toBe(replayPin.initialWorld);
    expect(directPin.initialWorld.time).toBe(0);
    expect(directPin.initialWorld.seed).toBe(seed);
    expect(directPin.initialWorld.outcome).toBeNull();

    const header: InputLogHeader = {
      gameId: `native-orders-${definition.isDefault ? 'default' : 'open'}-${seed}`,
      scenarioId: replayPin.battlefield.pairing.resolvedScenarioId,
      seed,
    };
    const entries = loggedOrders();
    const until = 60 * 60_000;
    const registry = createRegistry();
    let state = startingState(createState(seed, directPin.initialWorld, 0));
    const emitted: EmittedEvent[] = [];
    for (const entry of entries) {
      const before = advanceUntilOver(state, entry.gameMs, registry);
      state = before.state;
      emitted.push(...before.emitted);
      const applied = applyLoggedOrder(
        state,
        header.gameId,
        entry.seq,
        entry.command.side,
        entry.parse,
      );
      if ('reason' in applied) throw new Error(`Logged test order was rejected: ${applied.reason}`);
      expect(applied.orderId).toBe(`${header.gameId}-o${entry.seq}`);
      state = applied.state;
    }
    const direct = advanceUntilOver(state, until, registry);
    emitted.push(...direct.emitted);

    // Equality with an empty/idle run would be vacuous: establish that all
    // couriers delivered, units really arrived, and combat actually fired.
    const delivered = emitted.filter((event) => event.type === 'order_delivered');
    const arrivals = emitted.filter((event) => event.type === 'unit.arrived');
    const fire = emitted.filter((event) => event.type === 'combat.fire');
    expect(delivered).toHaveLength(3);
    expect(delivered.map((event) => event.payload)).toEqual(
      expect.arrayContaining(
        entries.map((entry) =>
          expect.objectContaining({
            orderId: `${header.gameId}-o${entry.seq}`,
            unitId: entry.parse.unitId,
          }),
        ),
      ),
    );
    expect(delivered.every((event) => event.time > 0)).toBe(true);
    expect(arrivals.length).toBeGreaterThan(0);
    expect(arrivals.some((event) => event.time > 0)).toBe(true);
    expect(fire.length).toBeGreaterThan(0);
    expect(fire.some((event) => event.time > 0)).toBe(true);
    expect(direct.state.time).toBe(50 * 60_000);
    expect(direct.state.world.outcome).toMatchObject({ winner: 'blue', time: 50 * 60_000 });
    expect(direct.state.time).toBeLessThanOrEqual(until);

    const replay = replayLog(
      header,
      replayPin.initialWorld,
      entries,
      createRegistry(),
      until,
      startingState,
    );
    expect(replay.state).toEqual(direct.state);
    expect(replay.emitted).toEqual(emitted);
    expect(retained).toEqual(authoredBefore);
    expect(definition.input()).toEqual(authoredBefore);
  });
});
