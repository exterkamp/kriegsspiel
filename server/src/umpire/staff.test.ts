import { describe, expect, it } from 'vitest';
import { holdTheBridge, loadScenario, mm, viewForRole } from '@kriegsspiel/engine';
import type { GameState, Seat } from '@kriegsspiel/engine';
import { MockUmpireClient } from './mockUmpireClient.js';
import type { UmpireFixture } from './mockUmpireClient.js';
import {
  STAFF_PROMPT_VERSION,
  STAFF_SCHEMA,
  STAFF_TEXT_MAX_LENGTH,
  StaffRoster,
  checkStaffOutput,
  runStaff,
  staffInput,
  staffOfficer,
} from './staff.js';
import { UmpireError } from './umpireClient.js';

/** Blue's first battalion with a red battalion close enough to see, so roles have something to differ on. */
function world(): GameState {
  const w = loadScenario(holdTheBridge);
  const blue = w.units.find((u) => u.id === 'blue-1')!;
  const units = w.units.map((u) =>
    u.id === 'red-1' ? { ...u, center: { x: blue.center.x + mm(300), y: blue.center.y } } : u,
  );
  return { ...w, units };
}

const note = (kind: string, text: string, unitId?: string) => ({
  kind,
  text,
  ...(unitId ? { unitId } : {}),
});
const fixture = (output: unknown, name = 'f'): UmpireFixture => ({
  name,
  stage: 'staff',
  promptVersion: STAFF_PROMPT_VERSION,
  output,
});

describe('staff officers', () => {
  it('are the same for the same game and role, and have traits', () => {
    const a = staffOfficer(1815, 'blue', 'intelligence');
    expect(staffOfficer(1815, 'blue', 'intelligence')).toEqual(a);
    expect(a.traits).toHaveLength(3);
    expect(staffOfficer(1815, 'blue', 'quartermaster').role).toBe('quartermaster');
  });
});

describe('StaffRoster', () => {
  it('leaves every seat but the human one to the staff', () => {
    const roster = new StaffRoster('blue');
    expect(roster.vacant()).toHaveLength(4);
    expect(roster.claim('commander', 'ann')).toBe(true);
    expect(roster.vacant().map((s) => s.role)).toEqual([
      'chiefOfStaff',
      'intelligence',
      'quartermaster',
    ]);
    expect(roster.claim('commander', 'bob')).toBe(false);
    expect(roster.release('commander', 'bob')).toBe(false);
    expect(roster.release('commander', 'ann')).toBe(true);
    expect(roster.vacant()).toHaveLength(4);
  });

  it('finds a subordinate seat by the units it commands', () => {
    const roster = new StaffRoster('blue', [
      { role: 'subordinate', units: ['blue-2'] },
      { role: 'subordinate', units: ['blue-3'] },
    ]);
    expect(roster.claim('subordinate', 'cy', ['blue-3'])).toBe(true);
    expect(roster.vacant().map((s) => s.units)).toEqual([['blue-2']]);
  });
});

describe('runStaff', () => {
  it('gives a one-human side a full, working staff', async () => {
    const w = world();
    const roster = new StaffRoster('blue', [
      { role: 'commander' },
      { role: 'chiefOfStaff' },
      { role: 'intelligence' },
      { role: 'quartermaster' },
      { role: 'subordinate', units: ['blue-2'] },
    ]);
    roster.claim('commander', 'ann');
    const client = new MockUmpireClient([
      fixture({
        messages: [
          note('report', 'All quiet on my front.'),
          note('suggestion', 'Hold the bridge with the reserve.', 'blue-2'),
          note('advice', 'Mind the ammunition, sir.'),
        ],
      }),
    ]);
    const turns = await runStaff(client, w, roster);
    expect(turns.map((t) => t.role)).toEqual([
      'chiefOfStaff',
      'intelligence',
      'quartermaster',
      'subordinate',
    ]);
    for (const t of turns) {
      expect(t.silent).toBe(false);
      expect(t.messages.map((m) => m.kind)).toEqual(['report', 'suggestion', 'advice']);
      expect(t.messages.every((m) => m.from === t.officer.name && m.role === t.role)).toBe(true);
    }
    expect(client.calls.every((c) => c.stage === 'staff')).toBe(true);
  });

  it('returns the call record of every attempt, and a replay of them needs no model', async () => {
    const roster = new StaffRoster('blue', [{ role: 'intelligence' }]);
    const client = new MockUmpireClient([fixture({ messages: [note('report', 'See blue-99.')] })]);
    const [turn] = await runStaff(client, world(), roster);
    expect(turn!.calls).toBe(2);
    expect(turn!.records).toHaveLength(2);
    expect(turn!.records.every((r) => r.stage === 'staff')).toBe(true);
    expect(turn!.records[0]!.rawOutput).toContain('blue-99');
  });

  it('rejects text over the length bound, and the schema states it', () => {
    const w = world();
    const seat: Seat = { role: 'intelligence' };
    const input = staffInput(
      staffOfficer(w.seed, 'blue', 'intelligence'),
      viewForRole(w, 'blue', seat),
      0,
    );
    const long = 'x'.repeat(STAFF_TEXT_MAX_LENGTH + 1);
    expect(
      checkStaffOutput({ messages: [{ kind: 'report', text: long }] }, w, 'blue', seat, input),
    ).toEqual([`message over ${STAFF_TEXT_MAX_LENGTH} characters`]);
    const props = (
      STAFF_SCHEMA as {
        properties: { messages: { items: { properties: Record<string, { maxLength?: number }> } } };
      }
    ).properties.messages.items.properties;
    expect(props.text!.maxLength).toBe(STAFF_TEXT_MAX_LENGTH);
  });

  it('shows each officer only their role view', async () => {
    const w = world();
    const roster = new StaffRoster('blue', [
      { role: 'intelligence' },
      { role: 'quartermaster' },
      { role: 'subordinate', units: ['blue-3'] },
    ]);
    const client = new MockUmpireClient([fixture({ messages: [] })]);
    await runStaff(client, w, roster);
    const seen = (role: string) =>
      client.calls.find((c) => (c.input as { officer: { role: string } }).officer.role === role)!
        .input as ReturnType<typeof staffInput>;
    const full = viewForRole(w, 'blue', { role: 'quartermaster' });
    const qm = seen('quartermaster');
    expect(qm.view.visibleEnemies).toEqual([]);
    expect(JSON.stringify(qm)).not.toContain('red-1');
    expect(qm.view.ownUnits).toEqual(JSON.parse(JSON.stringify(full.ownUnits)));
    const intel = seen('intelligence');
    expect(JSON.stringify(intel.view.ownUnits)).not.toContain('"strength"');
    expect(JSON.stringify(intel.view.visibleEnemies)).toContain('red-1');
    const sub = seen('subordinate');
    expect(sub.view.ownUnits.map((u) => u.id)).toEqual(['blue-3']);
    expect(JSON.stringify(sub)).not.toContain('blue-1');
    expect(sub.view.lastKnownContacts).toEqual([]);
  });

  it('does not call an officer for a seat a human holds', async () => {
    const roster = new StaffRoster('blue', [{ role: 'intelligence' }]);
    roster.claim('intelligence', 'dee');
    const client = new MockUmpireClient([fixture({ messages: [] })]);
    expect(await runStaff(client, world(), roster)).toEqual([]);
    expect(client.calls).toHaveLength(0);
  });

  it('lets a human take over mid-call, and drops the officer reply', async () => {
    const roster = new StaffRoster('blue', [{ role: 'intelligence' }]);
    const client = new MockUmpireClient(
      [{ ...fixture({ messages: [note('advice', 'Sir.')] }), latencyMs: 5 }],
      {
        sleep: async () => {
          roster.claim('intelligence', 'dee');
        },
      },
    );
    const [turn] = await runStaff(client, world(), roster);
    expect(client.calls).toHaveLength(1);
    expect(turn!.messages).toEqual([]);
  });

  it('speaks again once the officer is due, and after a human leaves', async () => {
    const w = world();
    const roster = new StaffRoster('blue', [{ role: 'chiefOfStaff' }]);
    const client = new MockUmpireClient([fixture({ messages: [] })]);
    expect(await runStaff(client, w, roster, { now: 0 })).toHaveLength(1);
    expect(await runStaff(client, w, roster, { now: 60_000 })).toHaveLength(0);
    expect(await runStaff(client, w, roster, { now: 10 * 60_000 })).toHaveLength(1);
    // A faster clock widens the interval.
    expect(await runStaff(client, w, roster, { now: 20 * 60_000, rate: 12 })).toHaveLength(0);
  });

  it('rejects invention and asks again, then stays silent', async () => {
    const w = world();
    const roster = new StaffRoster('blue', [{ role: 'chiefOfStaff' }]);
    const bad = fixture({ messages: [note('advice', 'Send word to red-9 at once.')] });
    const client = new MockUmpireClient([bad]);
    const [turn] = await runStaff(client, w, roster);
    expect(turn).toMatchObject({ silent: true, calls: 2, messages: [] });
    expect(turn!.rejections[0]).toEqual(['unknown entity "red-9"']);
    expect(client.calls[1]!.input).toMatchObject({ rejected: ['unknown entity "red-9"'] });
  });

  it('stays silent when the umpire fails', async () => {
    const roster = new StaffRoster('blue', [{ role: 'chiefOfStaff' }]);
    const client = new MockUmpireClient([{ stage: 'staff', failure: { kind: 'transport' } }]);
    const [turn] = await runStaff(client, world(), roster);
    expect(turn).toMatchObject({ silent: true, messages: [] });
  });

  it('rethrows an error that is not an umpire failure', async () => {
    const roster = new StaffRoster('blue', [{ role: 'chiefOfStaff' }]);
    const client = {
      call: async () => {
        throw new TypeError('boom');
      },
    };
    await expect(runStaff(client, world(), roster)).rejects.toThrow('boom');
    expect(UmpireError).toBeDefined();
  });
});

describe('checkStaffOutput', () => {
  const w = world();
  const seat: Seat = { role: 'subordinate', units: ['blue-2'] };
  const input = staffInput(staffOfficer(1, 'blue', 'subordinate'), viewForRole(w, 'blue', seat), 0);
  const check = (m: object) => checkStaffOutput({ messages: [m as never] }, w, 'blue', seat, input);

  it('lets a suggestion name only a unit the seat may draft for', () => {
    expect(check(note('suggestion', 'Advance.', 'blue-2'))).toEqual([]);
    expect(check(note('suggestion', 'Advance.', 'blue-1'))).toEqual(['cannot draft for "blue-1"']);
    expect(check(note('suggestion', 'Advance.'))).toEqual(['suggestion without a unitId']);
    expect(check(note('advice', 'Wait.', 'blue-2'))).toEqual(['advice must not name a unitId']);
  });

  it('rejects empty text and ids outside the view', () => {
    expect(check(note('report', ' '))).toEqual(['empty message']);
    expect(check(note('report', 'blue-1 is lost.'))).toEqual(['unknown entity "blue-1"']);
  });

  it('does not treat ordinary hyphenated words as ids', () => {
    expect(check(note('report', 'A counter-attack on the south-west flank.'))).toEqual([]);
  });
});
