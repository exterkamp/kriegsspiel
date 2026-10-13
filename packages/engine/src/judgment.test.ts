import { describe, expect, it } from 'vitest';
import {
  DIALS,
  DIAL_CAPS,
  JUDGMENT_CAP,
  judgmentCap,
  advanceTo,
  caseLaw,
  clampModifier,
  createState,
  holdTheBridge,
  issueJudgment,
  judgmentModifier,
  loadScenario,
  type JudgmentRuling,
  type JudgmentRequest,
} from './index.js';
import { EventRegistry } from './events.js';
import { registerJudgment } from './judgment.js';
import type { GameState } from './types.js';

const request: JudgmentRequest = {
  key: 'ford-crossing-under-fire',
  situation: 'Can the column cross the ford under fire?',
  unitId: 'blue-1',
};

function rule(modifier: number, extra: { fallback?: boolean } = {}, key = request.key) {
  const registry = new EventRegistry<GameState>();
  registerJudgment(registry);
  const world = loadScenario(holdTheBridge);
  const state = issueJudgment(
    createState(world.seed, world, 0),
    { request: { ...request, key }, modifier, rationale: 'because', narrative: 'so', ...extra },
    0,
  );
  return advanceTo(state, 0, registry).state.world;
}

describe('judgment rulings', () => {
  it('applies a modifier inside the cap as asked', () => {
    const r = rule(0.1).rulings[0] as JudgmentRuling;
    expect(r).toMatchObject({ kind: 'judgment', requested: 0.1, modifier: 0.1, clamped: false });
  });

  it.each([
    [5, JUDGMENT_CAP],
    [-5, -JUDGMENT_CAP],
    [Infinity, 0],
    [NaN, 0],
  ])('clamps %s to %s and logs that it did', (asked, kept) => {
    const r = rule(asked).rulings[0] as JudgmentRuling;
    expect(r.modifier).toBe(kept);
    expect(r.clamped).toBe(true);
    expect(clampModifier(asked).modifier).toBe(kept);
  });

  it('keeps case law from real rulings only, and the first ruling on a key stands', () => {
    const world = rule(0.2);
    expect(judgmentModifier(world, request.key)).toBe(0.2);
    expect(judgmentModifier(world, 'other')).toBe(0);
    expect(caseLaw(world)).toHaveLength(1);
    expect(caseLaw(rule(0, { fallback: true }))).toHaveLength(0);
  });
});

describe('the rigid-to-free dial', () => {
  it('sets only the cap: rigid 0, standard 0.25, free 0.4, absent means standard', () => {
    expect(DIALS.map((d) => DIAL_CAPS[d])).toEqual([0, 0.25, 0.4]);
    expect(judgmentCap({})).toBe(JUDGMENT_CAP);
    expect(judgmentCap({ dial: 'free' })).toBe(0.4);
    expect(clampModifier(0.3, 0.4).modifier).toBe(0.3);
    expect(clampModifier(-0.3, 0).modifier).toBe(0);
    expect(Object.is(clampModifier(-0.3, 0).modifier, 0)).toBe(true);
  });

  it('a game’s dial clamps its rulings', () => {
    const registry = new EventRegistry<GameState>();
    registerJudgment(registry);
    for (const [dial, kept] of [
      ['rigid', 0],
      ['standard', 0.25],
      ['free', 0.4],
    ] as const) {
      const world = { ...loadScenario(holdTheBridge), dial };
      const state = issueJudgment(
        createState(world.seed, world, 0),
        { request, modifier: 5, rationale: 'r', narrative: 'n' },
        0,
      );
      const r = advanceTo(state, 0, registry).state.world.rulings[0] as JudgmentRuling;
      expect(r.modifier).toBe(kept);
    }
  });
});
