// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { StatePanel, masterOnlyFields, unitExposure, type AdminState } from './state.js';

const unit = (id: string, side: string, extra: Record<string, unknown> = {}) => ({
  id,
  side,
  name: id,
  center: { x: 1000, y: 2000 },
  facing: 0,
  formation: 'line',
  footprint: { frontage: 1, depth: 1 },
  strength: 500,
  morale: 80,
  intent: { kind: 'hold', at: { x: 1, y: 1 } },
  home: { x: 0, y: 0 },
  status: 'active',
  ...extra,
});

const view = (side: string, own: string[], enemies: string[]) => ({
  side,
  atGame: 5000,
  ownUnits: own.map((id) => ({
    id,
    name: id,
    position: {},
    facing: 0,
    formation: 'line',
    footprint: {},
    strength: 500,
    morale: 0.8,
  })),
  visibleEnemies: enemies.map((id) => ({
    id,
    position: {},
    facing: 0,
    formation: 'line',
    footprint: {},
  })),
});

const state = (): AdminState => ({
  id: 'g1',
  clock: { rate: 4, status: 'running' },
  staffAtWork: { working: true, needAtMs: 9000 },
  engine: {
    time: 5000,
    rng: 123,
    nextSeq: 7,
    queue: [{ time: 6000, seq: 6, type: 'unit.step', payload: { unitId: 'b1' } }],
    world: {
      seed: 42,
      outcome: null,
      units: [unit('b1', 'blue'), unit('r1', 'red', { secretPlan: 'flank' })],
    },
  },
  sideViews: { blue: view('blue', ['b1'], []), red: view('red', ['r1'], []) },
});

describe('unitExposure', () => {
  it('marks fields with no wire form as master only, and fields a view carries as seen', () => {
    const s = state();
    const x = unitExposure(s.engine.world.units[1]!, s.sideViews);
    // Red sees its own unit's position; blue has no entry for r1 at all.
    expect(x.fields.find((f) => f.field === 'center')!.visibleTo).toEqual(['red']);
    expect(x.unseenBy).toEqual(['blue']);
    // A known hidden field, and the ones the engine never puts on the wire.
    expect(masterOnlyFields(x)).toEqual(
      expect.arrayContaining(['secretPlan', 'intent', 'home', 'status']),
    );
    expect(masterOnlyFields(x)).not.toContain('center');
  });

  it('flags a field that appears in no view even when the unit is visible to both', () => {
    const s = state();
    s.sideViews.blue = view('blue', ['b1'], ['r1']);
    const x = unitExposure(s.engine.world.units[1]!, s.sideViews);
    expect(x.unseenBy).toEqual([]);
    // The enemy view omits strength, so only the owner carries it.
    expect(x.fields.find((f) => f.field === 'strength')!.visibleTo).toEqual(['red']);
    expect(masterOnlyFields(x)).toContain('secretPlan');
  });
});

describe('StatePanel', () => {
  function mount() {
    document.body.innerHTML = '<section></section>';
    return new StatePanel(document.querySelector('section')!);
  }

  it('renders master state, both views and marks the hidden field', () => {
    const panel = mount();
    panel.update(state());
    const root = document.querySelector('section')!;
    expect(root.textContent).toContain('held at 9000 ms');
    expect(root.textContent).toContain('next seq');
    expect(root.textContent).toContain('unit.step');
    expect(root.querySelectorAll('.col')).toHaveLength(2);
    const hidden = root.querySelector('.unit[data-side="red"] .field[data-field="secretPlan"]')!;
    expect(hidden.classList.contains('master-only')).toBe(true);
    expect(hidden.textContent).toContain('master only');
    const shown = root.querySelector('.unit[data-side="red"] .field[data-field="center"]')!;
    expect(shown.classList.contains('master-only')).toBe(false);
  });

  it('updates live, keeps open units open and applies the filter', () => {
    const panel = mount();
    panel.update(state());
    const root = document.querySelector('section')!;
    root.querySelector<HTMLDetailsElement>('details[data-key="unit:b1"]')!.open = true;
    const next = state();
    next.engine.time = 6000;
    next.engine.rng = 999;
    panel.update(next);
    expect(root.textContent).toContain('6000 ms');
    expect(root.querySelector<HTMLDetailsElement>('details[data-key="unit:b1"]')!.open).toBe(true);
    panel.setFilter('r1');
    expect(root.querySelector<HTMLElement>('.unit[data-side="blue"]')!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('.unit[data-side="red"]')!.hidden).toBe(false);
  });

  it("shows the umpire's journal of a turn game as master only, and nothing when there is none", () => {
    const panel = mount();
    panel.update(state());
    const root = document.querySelector('section')!;
    expect(root.querySelector('.journal')).toBeNull();
    const next = state();
    next.engine.world.journal = {
      notes: [
        { turn: 1, note: 'Blue held the bridge.', condensed: true },
        { turn: 2, note: 'Red’s hussars were checked at the ford. The guns came up.' },
      ],
      dropped: 3,
      precedents: [{ turn: 1, ruling: 'Cavalry cannot cross the river except at the bridge.' }],
    };
    panel.update(next);
    const block = root.querySelector('.journal')!;
    expect(block.textContent).toContain('master only');
    expect(block.textContent).toContain('3 older notes dropped');
    expect([...block.querySelectorAll('.journal-notes li')].map((li) => li.textContent)).toEqual([
      'Turn 1 (condensed): Blue held the bridge.',
      'Turn 2: Red’s hussars were checked at the ford. The guns came up.',
    ]);
    expect(block.querySelector('.journal-precedents li')!.textContent).toBe(
      'Turn 1: Cavalry cannot cross the river except at the bridge.',
    );
  });
});
