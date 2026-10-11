import {
  holdTheBridge,
  loadScenario,
  type GameState,
  type Report,
  type SideId,
} from '@kriegsspiel/engine';
import { describe, expect, it } from 'vitest';
import type { GameActor } from '../game/index.js';
import { baseline, detect } from './detect.js';
import { Notifier } from './notifier.js';

interface Fake {
  world: GameState;
  status: 'running' | 'paused';
  pause?: { id: string; by: string; votes: Record<string, boolean> };
  ratio?: { id: string; by: string; votes: Record<string, boolean> };
}

/** Just enough of a GameActor for the notifier: the fields `detect` reads. */
function actorOf(f: Fake): GameActor {
  return {
    id: 'g1',
    state: { world: f.world, time: f.world.time },
    gameClock: { snapshot: () => ({ status: f.status }) },
    pauseState: f.pause && { phase: 'idle', proposal: { ...f.pause, deadlineMs: 0 } },
    ratioState: f.ratio && { proposal: { ...f.ratio, deadlineMs: 0 } },
  } as unknown as GameActor;
}

const fresh = (): Fake => ({ world: loadScenario(holdTheBridge), status: 'running' });

let n = 0;
function withReport(f: Fake, side: SideId, kind: Report['kind']): Fake {
  const report: Report = {
    id: `${side}-test-${++n}`,
    kind,
    observedAt: f.world.time,
    deliverAt: f.world.time,
    from: 'x',
    location: { x: 0, y: 0 },
    confidence: 'high',
    place: 'the ford',
    uncertainty: 0,
  };
  const intel = {
    ...f.world.intel,
    [side]: { ...f.world.intel[side]!, reports: [...f.world.intel[side]!.reports, report] },
  };
  return { ...f, world: { ...f.world, intel } };
}

function events(before: Fake, after: Fake) {
  const prev = baseline(actorOf(before));
  return detect(prev, actorOf(after)).events;
}

describe('detect', () => {
  it('reports nothing when nothing changed', () => {
    expect(events(fresh(), fresh())).toEqual([]);
  });

  it('turns contact and unit-lost reports into their own kinds, for the side that has them', () => {
    const base = fresh();
    expect(events(base, withReport(base, 'blue', 'contact'))).toEqual([
      { side: 'blue', event: 'contact' },
    ]);
    expect(events(base, withReport(base, 'red', 'unitLost'))).toEqual([
      { side: 'red', event: 'unitLost' },
    ]);
    expect(events(base, withReport(base, 'blue', 'lowAmmo'))).toEqual([
      { side: 'blue', event: 'dispatch' },
    ]);
  });

  it('asks the other sides to vote on a pause, but not the proposer or a side that has voted', () => {
    const base = fresh();
    const open = { ...base, pause: { id: 'p1', by: 'blue', votes: { blue: true } } };
    expect(events(base, open)).toEqual([{ side: 'red', event: 'pauseProposed' }]);
    const voted = { ...base, pause: { id: 'p1', by: 'blue', votes: { blue: true, red: true } } };
    expect(events(base, voted)).toEqual([]);
    // The same proposal seen again is not news.
    expect(events(open, open)).toEqual([]);
  });

  it('asks for a decision on a ratio vote, but not the proposer or a side that has voted', () => {
    const base = fresh();
    const open = { ...base, ratio: { id: 'r1', by: 'red', votes: { red: true } } };
    expect(events(base, open)).toEqual([{ side: 'blue', event: 'decision' }]);
    const voted = { ...base, ratio: { id: 'r1', by: 'red', votes: { red: true, blue: false } } };
    expect(events(base, voted)).toEqual([]);
  });

  it('announces a pause and a resume to every side', () => {
    const base = fresh();
    const paused = { ...base, status: 'paused' as const };
    expect(events(base, paused).map((e) => e.event)).toEqual(['paused', 'paused']);
    expect(events(paused, base).map((e) => e.event)).toEqual(['resumed', 'resumed']);
  });

  it('announces game over once, to every side, and not for a game that is still on', () => {
    const base = fresh();
    expect(base.world.outcome).toBeNull();
    const over = {
      ...base,
      world: { ...base.world, outcome: { winner: 'blue', reason: 'timeout', time: 0 } },
    } as unknown as Fake;
    expect(events(base, over).map((e) => e.event)).toEqual(['gameOver', 'gameOver']);
    expect(events(over, over)).toEqual([]);
  });
});

describe('Notifier', () => {
  it('delivers one notice per side and kind in a look, however many reports arrived', async () => {
    let current = fresh();
    const sent: string[] = [];
    const notifier = new Notifier({
      auth: { seatsOf: () => [{ side: 'blue', userId: 'u1' }] },
      store: { getPrefs: () => ({ threshold: 'all', push: true, email: true }) },
      mailer: {},
      publicUrl: 'http://x.test',
      lookup: () => actorOf(current),
      sendToUser: (_g: string, _u: string, m: { event: string }) => (sent.push(m.event), 1),
      wallNow: () => 0,
      onError: (_g: string, e: unknown) => {
        throw e;
      },
    } as unknown as ConstructorParameters<typeof Notifier>[0]);
    notifier.observe('g1');
    current = withReport(
      withReport(withReport(current, 'blue', 'contact'), 'blue', 'contact'),
      'blue',
      'unitLost',
    );
    notifier.observe('g1');
    await notifier.flush();
    expect(sent).toEqual(['contact', 'unitLost']);
  });
});
