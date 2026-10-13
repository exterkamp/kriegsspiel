import { describe, expect, it } from 'vitest';
import {
  FORWARD_HANDLING_MS,
  arrivedForwards,
  forwardDelayMs,
  sendForward,
  viewForRole,
  type ChainOfCommand,
  type GameState,
  type Seat,
} from './index.js';
import { miniWorld } from './scenario.testkit.js';
import { fileReport } from './visibility.js';

const at = (n: number) => n * 100 + 50;

function world(): GameState {
  const w = miniWorld({
    units: [
      { id: 'b1', side: 'blue', x: at(5), y: at(5) },
      { id: 'b2', side: 'blue', x: at(20), y: at(14) },
      { id: 'r-near', side: 'red', x: at(8), y: at(5) },
    ],
  });
  // b1 files a supply report that HQ would normally read at once; b2 is a subordinate's formation.
  const b2 = w.units.find((u) => u.id === 'b2')!;
  const b1 = w.units.find((u) => u.id === 'b1')!;
  return fileReport(fileReport(w, 'lowAmmo', b2, 0, 0), 'exhausted', b1, 0, 0);
}

const chain = (deliveredUp: string[] = []): ChainOfCommand => ({
  subordinateUnits: ['b2'],
  deliveredUp,
});

describe('chain-of-command reports', () => {
  const w = world();
  const fromB2 = viewForRole(w, 'blue', { role: 'commander' }, 1).reports.find(
    (r) => r.kind === 'lowAmmo',
  )!;

  it('shows the commander a subordinate formation report in shared HQ', () => {
    expect(fromB2).toBeDefined();
  });

  it('keeps an unforwarded report out of every HQ role view', () => {
    for (const role of ['commander', 'chiefOfStaff', 'intelligence', 'quartermaster'] as const) {
      const v = viewForRole(w, 'blue', { role }, 1, [], chain());
      expect(v.reports.map((r) => r.id)).not.toContain(fromB2.id);
    }
  });

  it('still shows HQ the reports of formations no subordinate commands', () => {
    const v = viewForRole(w, 'blue', { role: 'commander' }, 1, [], chain());
    expect(v.reports.map((r) => r.kind)).toEqual(['exhausted']);
  });

  it('shows the report once it is forwarded and has arrived', () => {
    const v = viewForRole(w, 'blue', { role: 'commander' }, 1, [], chain([fromB2.id]));
    expect(v.reports.map((r) => r.id)).toContain(fromB2.id);
  });

  it('leaves the subordinate seeing their own formation reports', () => {
    const seat: Seat = { role: 'subordinate', units: ['b2'] };
    expect(viewForRole(w, 'blue', seat, 1, [], chain()).reports.map((r) => r.id)).toEqual([
      fromB2.id,
    ]);
  });

  it('never lets a forwarded id reveal a report HQ would not otherwise have', () => {
    const v = viewForRole(w, 'blue', { role: 'commander' }, 1, [], chain(['blue-r99']));
    expect(v.reports.map((r) => r.kind)).toEqual(['exhausted']);
  });
});

describe('forwarding delay', () => {
  const w = world();
  it('is zero in shared HQ', () => {
    expect(forwardDelayMs(w, 'blue', 'shared', 'b2')).toBe(0);
  });

  it('takes handling time plus a ride in a chain of command, longer for a farther unit', () => {
    const near = forwardDelayMs(w, 'blue', 'chain', 'b1');
    const far = forwardDelayMs(w, 'blue', 'chain', 'b2');
    expect(near).toBeGreaterThan(FORWARD_HANDLING_MS - 1);
    expect(far).toBeGreaterThan(near);
  });

  it('is zero for a unit of the other side or one that does not exist', () => {
    expect(forwardDelayMs(w, 'blue', 'chain', 'r-near')).toBe(0);
    expect(forwardDelayMs(w, 'blue', 'chain', 'nobody')).toBe(0);
  });

  it('is deterministic: the same world gives the same delay', () => {
    expect(forwardDelayMs(w, 'blue', 'chain', 'b2')).toBe(
      forwardDelayMs(world(), 'blue', 'chain', 'b2'),
    );
  });

  it('delivers only once its time has come', () => {
    const p = sendForward(
      w,
      'blue',
      'chain',
      { dispatchId: 'x', unit: 'b2', direction: 'up' },
      1000,
    );
    expect(p.deliverAt).toBe(1000 + forwardDelayMs(w, 'blue', 'chain', 'b2'));
    expect(arrivedForwards([p], 'blue', 'up', p.deliverAt - 1)).toEqual([]);
    expect(arrivedForwards([p], 'blue', 'up', p.deliverAt)).toEqual(['x']);
    expect(arrivedForwards([p], 'blue', 'down', p.deliverAt)).toEqual([]);
    expect(arrivedForwards([p], 'red', 'up', p.deliverAt)).toEqual([]);
    expect(arrivedForwards([p], 'blue', 'up', p.deliverAt, ['b1'])).toEqual([]);
  });

  it('delivers at once in shared HQ', () => {
    const p = sendForward(
      w,
      'blue',
      'shared',
      { dispatchId: 'x', unit: 'b2', direction: 'down' },
      500,
    );
    expect(p.deliverAt).toBe(500);
  });
});
