// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TurnsPanel, turnLabel, type AdminTurn, type AdminTurns } from './turns.js';

const umpireTurn: AdminTurn = {
  n: 1,
  startMs: 0,
  endMs: 600_000,
  endedAtMs: 600_000,
  cause: 'all-sent',
  adjudicator: 'umpire',
  sent: ['blue', 'red'],
  orders: [{ orderId: 'b1', side: 'blue', to: 'blue-1', text: 'March to the bridge' }],
  unsent: {},
  read: [{ orderId: 'b1', side: 'blue', engineId: 'blue-b1', intents: [{ kind: 'move' }] }],
  couriers: [{ orderId: 'blue-b1', outcome: 'delivered', atMs: 120_000 }],
  projection: { events: ['2: 1st Battalion receives its order'], units: [{ id: 'blue-1' }] },
  calls: [
    {
      stage: 'adjudicate',
      model: 'claude-x',
      promptVersion: 'adjudicate-v3',
      input: { turn: { n: 1 }, journal: { notes: [] } },
      rawOutput: '{"turn":1,"summary":"The umpire saw it"}',
      attempts: 1,
      costUsd: 0.0123,
    },
  ],
  reports: [
    {
      side: 'blue',
      calls: [
        {
          stage: 'narrate',
          model: 'claude-x',
          promptVersion: 'turn-reports-v1',
          input: { side: 'blue' },
          rawOutput: '{"notes":[]}',
          attempts: 1,
          costUsd: 0.001,
        },
      ],
      narrated: [{ reportId: 'blue-r4', text: '1st Battalion here: we hold the bridge.' }],
    },
  ],
  proposal: { turn: 1, summary: 'The umpire saw it' },
  resent: ['limits: blue-3: end position fails the march check'],
  rolls: [{ id: 'r1', why: 'Does the charge go home?', chance: 0.4, roll: 0.25, success: true }],
  refusedRolls: ['r9: chance 0.99 is outside 0.05..0.95'],
  rulings: [
    {
      id: 'ruling-1',
      unitId: 'blue-3',
      field: 'position',
      proposed: { x: 11050, y: -6150 },
      applied: { x: 2050, y: 1850 },
      reason: 'refused: a position is off the map',
    },
  ],
  clampedUnits: 1,
  journal: {
    notes: [{ turn: 1, note: 'The umpire saw it' }],
    precedents: [{ turn: 1, ruling: 'Hussars do not swim.' }],
  },
};

const fallbackTurn: AdminTurn = {
  ...umpireTurn,
  n: 2,
  startMs: 600_000,
  endMs: 1_200_000,
  endedAtMs: 1_200_000,
  cause: 'deadline',
  adjudicator: 'engine',
  sent: ['red'],
  orders: [],
  unsent: { blue: [{ orderId: 'b2', to: 'blue-2', text: 'Hold the wood' }] },
  calls: [],
  reports: [],
  proposal: undefined,
  resent: undefined,
  rolls: undefined,
  refusedRolls: undefined,
  rulings: [],
  clampedUnits: undefined,
  fallback: { error: 'umpire fell back to the engine: the model is down', attempts: 2 },
};

const body: AdminTurns = {
  mode: 'turns',
  turns: [umpireTurn, fallbackTurn],
  open: {
    n: 3,
    startMs: 1_200_000,
    endMs: 1_800_000,
    held: { blue: [{ orderId: 'b3', to: 'blue-1', text: 'Fall back' }], red: [] },
    sent: [],
  },
};

afterEach(() => {
  document.body.innerHTML = '';
});

function setup(answer: () => unknown = () => body, ok = true) {
  const urls: string[] = [];
  const fetchFn = vi.fn(async (url: string) => {
    urls.push(url);
    return { ok, status: ok ? 200 : 422, json: async () => answer() };
  });
  const root = document.createElement('section');
  document.body.append(root);
  const panel = new TurnsPanel(root, () => 'tok', fetchFn as never);
  return { root, panel, urls };
}

const text = (root: HTMLElement) => root.textContent ?? '';
const pick = (root: HTMLElement, turn: string) =>
  root.querySelector<HTMLButtonElement>(`button[data-turn="${turn}"]`)!.click();

describe('TurnsPanel', () => {
  it('reads the turns from the read-only admin API and opens on the latest', async () => {
    const { root, panel, urls } = setup();
    await panel.setGame('g1');
    expect(urls).toEqual(['/admin/api/games/g1/turns?token=tok']);
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.turn-picker button')];
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Turn 1 · 0:00–10:00 · umpire · 1 ruling · 1 roll',
      'Turn 2 · 10:00–20:00 · tables (fallback)',
      'Turn 3 · open',
    ]);
    expect(buttons[1]!.getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1]!.dataset.adjudicator).toBe('fallback');
    // The fallback, and the orders a side held but never sent.
    const fb = root.querySelector<HTMLElement>('.turn-fallback')!;
    expect(fb.dataset.state).toBe('fell-back');
    expect(fb.textContent).toContain('the model is down');
    expect(text(root)).toContain('blue b2 → blue-2: Hold the wood (held, not sent)');
    expect(text(root)).toContain('No model call: the tables decided.');
    expect(text(root)).toContain('No report call: the papers are the engine’s own.');
  });

  it('shows an umpire turn whole: orders, projection, calls, rolls, every clamp and the journal', async () => {
    const { root, panel } = setup();
    await panel.setGame('g1');
    pick(root, '1');
    const t = text(root);
    expect(t).toContain('blue b1 → blue-1: March to the bridge');
    expect(t).toContain('rules: [{"kind":"move"}]');
    expect(t).toContain('blue-b1: delivered at 2:00');
    expect(t).toContain('2: 1st Battalion receives its order');
    // The adjudicate input and output, the final proposal and the resend's problems.
    const call = root.querySelector<HTMLDetailsElement>('.turn-call')!;
    expect(call.querySelector('summary')!.textContent).toBe(
      '1. adjudicate · claude-x · adjudicate-v3 · 1 attempt · $0.0123',
    );
    const [input, output] = [...call.querySelectorAll('pre')].map((p) => p.textContent);
    expect(JSON.parse(input!)).toEqual(umpireTurn.calls[0]!.input);
    expect(JSON.parse(output!)).toEqual({ turn: 1, summary: 'The umpire saw it' });
    expect(t).toContain('limits: blue-3: end position fails the march check');
    // Each side's turn reports: the report call and the notes it wrote.
    const reports = root.querySelector<HTMLElement>('.turn-reports')!;
    expect(reports.querySelector('summary')!.textContent).toContain(
      '1. narrate · claude-x · turn-reports-v1',
    );
    expect(reports.textContent).toContain('blue-r4: 1st Battalion here: we hold the bridge.');
    // Rolls made and refused.
    expect(t).toContain('r1: Does the charge go home? — 40% asked, drew 0.250: success');
    expect(t).toContain('r9: chance 0.99 is outside 0.05..0.95');
    // Every clamp with its reason.
    const row = root.querySelector<HTMLTableRowElement>('tr[data-ruling="ruling-1"]')!;
    expect([...row.cells].map((c) => c.textContent)).toEqual([
      'blue-3',
      'position',
      '{"x":11050,"y":-6150}',
      '{"x":2050,"y":1850}',
      'refused: a position is off the map',
    ]);
    expect(t).toContain('units clamped1');
    // The journal after the turn.
    expect(root.querySelector('.journal-notes')!.textContent).toBe('Turn 1: The umpire saw it');
    expect(root.querySelector('.journal-precedents')!.textContent).toBe(
      'Turn 1: Hussars do not swim.',
    );
    // Marked as master state.
    expect(root.querySelector('.state-badge')!.textContent).toBe('master only');
  });

  it('shows the open turn’s held orders, and keeps the choice and open details across a reload', async () => {
    const { root, panel, urls } = setup();
    await panel.setGame('g1');
    pick(root, 'open');
    expect(text(root)).toContain('blue b3 → blue-1: Fall back');
    pick(root, '1');
    root.querySelector<HTMLDetailsElement>('.turn-call')!.open = true;
    await panel.setGame('g1', true);
    expect(urls).toHaveLength(2);
    expect(root.querySelector('button[aria-pressed="true"]')!.getAttribute('data-turn')).toBe('1');
    expect(root.querySelector<HTMLDetailsElement>('.turn-call')!.open).toBe(true);
  });

  it('says so for a real-time game, and when the turns cannot be read', async () => {
    const realtime = setup(() => ({ mode: 'realtime', turns: [] }));
    await realtime.panel.setGame('g1');
    expect(text(realtime.root)).toContain('A real-time game has no turns.');
    document.body.innerHTML = '';
    const broken = setup(() => ({}), false);
    await broken.panel.setGame('g1');
    expect(text(broken.root)).toContain('The turns of this game cannot be read.');
    expect(broken.root.querySelector('.turn-detail')!.childElementCount).toBe(0);
  });

  it('labels a turn that could not be applied', () => {
    expect(turnLabel({ ...fallbackTurn, error: 'boom' })).toBe(
      'Turn 2 · 10:00–20:00 · tables (fallback) · not applied',
    );
  });
});
