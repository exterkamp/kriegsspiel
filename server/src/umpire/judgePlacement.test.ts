import { describe, expect, it } from 'vitest';
import {
  MS_PER_MINUTE,
  advanceTo,
  createState,
  holdTheBridgeFarStart,
  issuePlacement,
  loadScenario,
  mm,
  type Ruling,
} from '@kriegsspiel/engine';
import { createRegistry } from '../game/registry.js';
import { judgePlacementInput, judgePlacements } from './judgePlacement.js';
import { MockUmpireClient, loadFixtures } from './mockUmpireClient.js';
import { UmpireError } from './umpireClient.js';
import type { UmpireFixture } from './mockUmpireClient.js';

const fixtures = loadFixtures(new URL('./fixtures', import.meta.url).pathname);
const THREE_MIN = 3 * MS_PER_MINUTE;

/** Judge, then queue every proposal and let the engine rule on it. */
async function judgeAndApply(client: MockUmpireClient, elapsedMs = THREE_MIN) {
  const world = loadScenario(holdTheBridgeFarStart);
  const rulings = await judgePlacements(
    client,
    world,
    'Blue deploys to meet the attack.',
    elapsedMs,
  );
  let state = createState(world.seed, world, 0);
  for (const r of rulings) state = issuePlacement(state, r, 0);
  return advanceTo(state, 0, createRegistry()).state.world;
}

describe('judge placement', () => {
  it('describes the map as vector features in metres', () => {
    const world = loadScenario(holdTheBridgeFarStart);
    const input = judgePlacementInput(world, 'x', THREE_MIN);
    expect(input.map).toMatchObject({ widthM: 4000, heightM: 3000 });
    const bridge = input.map.features.find((f) => f.id === 'bridge')!;
    expect(bridge.geometry).toEqual({ shape: 'point', at: { x: 2050, y: 1500 }, radius: 110 });
    const u = input.units.find((x) => x.id === 'blue-1')!;
    expect(u).toMatchObject({ x: 1850, y: 2450, formation: expect.any(String) });
  });

  it('places a battalion in an irregular arc and the engine applies it exactly', async () => {
    const world = await judgeAndApply(new MockUmpireClient(fixtures));
    const u = world.units.find((x) => x.id === 'blue-1')!;
    expect(u.center).toEqual({ x: mm(1850), y: mm(2300) });
    expect(u.formation).toBe('skirmish');
    expect(u.shape).toEqual([
      { x: mm(-60), y: mm(-4) },
      { x: mm(-30), y: mm(6) },
      { x: 0, y: mm(10) },
      { x: mm(35), y: mm(3) },
      { x: mm(70), y: mm(-8) },
    ]);
    expect(u.facing).toBeCloseTo((20 * Math.PI) / 180);
    expect(world.units.find((x) => x.id === 'blue-2')!.shape).toHaveLength(4);
    expect((world.rulings as Ruling[]).map((r) => r.verdict.verdict)).toEqual(['accept', 'accept']);
    expect((world.rulings as Ruling[])[0]!.rationale).toMatch(/screen/);
    expect((world.rulings as Ruling[])[0]!.narrative).toMatch(/skirmishers/);
  });

  it('clamps or rejects implausible proposals and logs the reasons', async () => {
    const wild: UmpireFixture = {
      stage: 'judge',
      output: {
        placements: [
          // Across the map in three minutes.
          { unitId: 'blue-1', x: 1950, y: 400, rationale: 'r', narrative: 'n' },
          // Standing in the river.
          { unitId: 'blue-2', x: 2250, y: 1400, rationale: 'r', narrative: 'n' },
          { unitId: 'ghost', x: 1, y: 1, rationale: 'r', narrative: 'n' },
        ],
      },
    };
    const before = loadScenario(holdTheBridgeFarStart);
    const world = await judgeAndApply(new MockUmpireClient([wild]));
    const [far, wet, ghost] = world.rulings as Ruling[];
    expect(far!.verdict.verdict).toBe('clamp');
    expect(far!.verdict.reasons.join()).toMatch(/too far/);
    const moved = world.units.find((x) => x.id === 'blue-1')!;
    // Started at y=2450 m; three minutes of infantry march is about 300 m, not 2000.
    expect(moved.center.y).toBeLessThan(mm(2450));
    expect(moved.center.y).toBeGreaterThan(mm(2100));
    expect(wet!.verdict).toMatchObject({ verdict: 'reject' });
    expect(world.units.find((x) => x.id === 'blue-2')!.center).toEqual(
      before.units.find((x) => x.id === 'blue-2')!.center,
    );
    expect(ghost!.verdict).toEqual({ verdict: 'reject', reasons: ['unknown unit'] });
    expect((world.rulings as Ruling[]).every((r) => r.rationale === 'r')).toBe(true);
  });

  it('rejects a reply that breaks the schema, leaving the units alone', async () => {
    const bad: UmpireFixture = { stage: 'judge', output: { placements: [{ unitId: 'blue-1' }] } };
    await expect(judgeAndApply(new MockUmpireClient([bad]))).rejects.toBeInstanceOf(UmpireError);
  });

  it('replays from the logged rulings with no model call', async () => {
    const client = new MockUmpireClient(fixtures);
    const live = await judgeAndApply(client);
    expect(client.calls).toHaveLength(1);
    // Replay: queue the logged proposals again, with no client at all.
    const world = loadScenario(holdTheBridgeFarStart);
    let state = createState(world.seed, world, 0);
    for (const r of live.rulings as Ruling[]) {
      state = issuePlacement(
        state,
        { proposal: r.proposal, rationale: r.rationale, narrative: r.narrative },
        r.time,
      );
    }
    const replayed = advanceTo(state, 0, createRegistry()).state.world;
    expect(replayed).toEqual(live);
  });

  it('returns no rulings when the game budget or rate limit refuses the call', async () => {
    const world = loadScenario(holdTheBridgeFarStart);
    for (const kind of ['budget', 'rate-limit'] as const) {
      const refuse = {
        call: async () => {
          throw new UmpireError('capped', kind, 0);
        },
      };
      await expect(judgePlacements(refuse, world, 'x', THREE_MIN)).resolves.toEqual([]);
    }
    const broken = {
      call: async () => {
        throw new UmpireError('down', 'transport', 1);
      },
    };
    await expect(judgePlacements(broken, world, 'x', THREE_MIN)).rejects.toBeInstanceOf(
      UmpireError,
    );
  });
});
