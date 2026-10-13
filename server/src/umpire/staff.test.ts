import { describe, expect, it } from 'vitest';
import { holdTheBridge, loadScenario, mm, viewForRole } from '@kriegsspiel/engine';
import type { GameState, Seat } from '@kriegsspiel/engine';
import { MockUmpireClient } from './mockUmpireClient.js';
import type { UmpireFixture } from './mockUmpireClient.js';
import {
  STAFF_ANSWER_PROMPT_VERSION,
  STAFF_PROMPT_VERSION,
  STAFF_SCHEMA,
  STAFF_TEXT_MAX_LENGTH,
  StaffRoster,
  CONFERENCE_ROLES,
  answerStaffQuestion,
  cannedAnswer,
  checkAnswerText,
  conferenceOfficers,
  checkStaffOutput,
  runStaff,
  staffInput,
  staffOfficer,
  staffOfficerFor,
  writeStaffAnswer,
} from './staff.js';
import { UmpireError } from './umpireClient.js';
import type { UmpireClient, UmpireRequest } from './umpireClient.js';

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

describe('conference officers (#418)', () => {
  it('are one officer per role, no two alike, and the one every caller names', () => {
    for (let seed = 0; seed < 200; seed++) {
      for (const side of ['blue', 'red'] as const) {
        const officers = conferenceOfficers(seed, side);
        const names = CONFERENCE_ROLES.map((r) => officers[r].name);
        expect(new Set(names).size).toBe(CONFERENCE_ROLES.length);
        for (const r of CONFERENCE_ROLES)
          expect(staffOfficerFor(seed, side, r)).toEqual(officers[r]);
      }
    }
  });

  it('are the officers who speak unprompted from the same posts', async () => {
    const w = world();
    const client = new MockUmpireClient([fixture({ messages: [] })]);
    const turns = await runStaff(client, w, new StaffRoster('blue'));
    const officers = conferenceOfficers(w.seed, 'blue');
    for (const role of ['chiefOfStaff', 'intelligence', 'quartermaster'] as const)
      expect(turns.find((t) => t.role === role)?.officer).toEqual(officers[role]);
  });
});

describe('cannedAnswer (#418)', () => {
  const w = world();
  const view = viewForRole(w, 'blue', { role: 'intelligence' }, w.time);
  const officer = (traits: string[]) => ({
    name: 'Captain Evrard',
    role: 'intelligence' as const,
    traits,
  });

  it('differs by trait: terse is short, long-winded is long and signs by name', () => {
    const terse = cannedAnswer(officer(['cautious', 'meticulous', 'terse']), 'intelligence', view);
    const long = cannedAnswer(
      officer(['cautious', 'meticulous', 'long-winded']),
      'intelligence',
      view,
    );
    const bold = cannedAnswer(officer(['bold', 'hasty', 'long-winded']), 'intelligence', view);
    expect(terse).not.toBe(long);
    expect(terse.length).toBeLessThan(long.length);
    expect(long).toContain('Captain Evrard');
    expect(terse).not.toContain('Captain Evrard');
    expect(long).toMatch(/Old sightings/);
    expect(bold).toMatch(/I would not wait on it/);
    // Both say what is in view: one red battalion in sight.
    expect(terse).toMatch(/1 enemy unit is in sight/);
  });

  it('says only what the seat can see', () => {
    const qm = viewForRole(w, 'blue', { role: 'quartermaster' }, w.time);
    const text = cannedAnswer(officer(['long-winded']), 'quartermaster', qm);
    expect(text).not.toMatch(/enemy|red-/i);
    for (const u of w.units.filter((u) => u.side === 'red')) expect(text).not.toContain(u.name);
  });

  it('is what writeStaffAnswer gives with no model, signed by the conference officer', async () => {
    const a = await writeStaffAnswer(undefined, w, 'blue', 'intelligence', 'Where?', w.time);
    expect(a.canned).toBe(true);
    expect(a.records).toEqual([]);
    expect(a.officer).toEqual(staffOfficerFor(w.seed, 'blue', 'intelligence'));
    expect(a.text).toBe(cannedAnswer(a.officer, 'intelligence', view));
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

const answerFixture = (output: unknown): UmpireFixture => ({
  ...fixture(output, 'answer'),
  promptVersion: STAFF_ANSWER_PROMPT_VERSION,
});

describe('checkAnswerText', () => {
  it('passes a complete answer', () => {
    expect(checkAnswerText('Sir, the bridge holds. Watch the mill.', 'intelligence')).toEqual([]);
    expect(checkAnswerText('"Hold the bridge," he said.”', 'intelligence')).toEqual([]);
  });

  it('rejects the fragments seen from the small model (#342)', () => {
    expect(checkAnswerText('Sir, we should consider moving a', 'chiefOfStaff')).toEqual([
      'answer is cut off before the end',
    ]);
    expect(
      checkAnswerText('Sir, the commander has put you a question, in', 'intelligence'),
    ).toHaveLength(1);
    expect(checkAnswerText('Hold.', 'quartermaster')).toEqual(['answer is a fragment']);
  });

  it('rejects an officer who sends the commander to his own post', () => {
    const text = 'Sir, you should report to the chief of staff for the latest.';
    expect(checkAnswerText(text, 'chiefOfStaff')).toHaveLength(1);
    expect(checkAnswerText(text, 'intelligence')).toEqual([]);
  });
});

describe('checkAnswerText quality (#359)', () => {
  const facts = ['1st Battalion', 'blue-1'];
  it('wants a unit, place or count from the view', () => {
    const t = 'Sir, nothing more is known at present.';
    expect(checkAnswerText(t, 'intelligence', facts)).toEqual([
      'answer names no unit, place or count from your view; cite one',
    ]);
    expect(checkAnswerText('Sir, the 1st Battalion reports calm.', 'intelligence', facts)).toEqual(
      [],
    );
    expect(checkAnswerText('Sir, about 400 men are in sight.', 'intelligence', facts)).toEqual([]);
    // A clock time is not a count.
    expect(checkAnswerText('Sir, we last heard at 00:40.', 'intelligence', facts)).toHaveLength(1);
  });
  it('flags stock filler and repeats', () => {
    expect(
      checkAnswerText(
        "Sir, 1st Battalion is observing the enemy's movements.",
        'intelligence',
        facts,
      ),
    ).toEqual(['answer is generic filler']);
    expect(
      checkAnswerText(
        'Sir, 1st Battalion holds. Keep the reserve near the road. Keep the reserve near the road.',
        'intelligence',
        facts,
      ),
    ).toEqual(['answer repeats itself']);
  });
});

describe('answerStaffQuestion', () => {
  it('retries a fragment once, then gives up so the canned answer is used (#342)', async () => {
    const frag = answerFixture({
      messages: [note('advice', 'Sir, the 1st Battalion should consider moving a')],
    });
    const client = new MockUmpireClient([frag, frag, frag]);
    const a = await answerStaffQuestion(client, world(), 'blue', 'chiefOfStaff', 'Status?', 0);
    expect(a).toBeUndefined();
    expect(client.calls).toHaveLength(2);
    expect((client.calls[1]!.input as { rejected?: string[] }).rejected).toEqual([
      'answer is cut off before the end',
    ]);
  });

  it('accepts the retry when the second reply is whole', async () => {
    const replies = [
      'Sir, the 1st Battalion should consider moving a',
      'Sir, the 1st Battalion holds the bridge for now.',
    ];
    const inner = new MockUmpireClient([answerFixture({ messages: [note('advice', 'x y z.')] })]);
    const calls: unknown[] = [];
    const client: UmpireClient = {
      call: async <T>(req: UmpireRequest) => {
        calls.push(req.input);
        const res = await inner.call<T>(req);
        const output = { messages: [note('advice', replies[calls.length - 1]!)] } as T;
        return { ...res, output };
      },
    };
    const a = await answerStaffQuestion(client, world(), 'blue', 'chiefOfStaff', 'Status?', 0);
    expect(a?.text).toBe('Sir, the 1st Battalion holds the bridge for now.');
    expect(calls).toHaveLength(2);
  });

  it('asks the staff stage with the question and the newest view, and returns the first non-suggestion', async () => {
    const w = world();
    const client = new MockUmpireClient([
      answerFixture({
        messages: [
          note('suggestion', 'Hold.', 'blue-1'),
          note('advice', ' Watch the bridge, sir; 1st Battalion is forward. '),
        ],
      }),
    ]);
    const a = await answerStaffQuestion(
      client,
      w,
      'blue',
      'intelligence',
      'Where is the enemy?',
      600_000,
    );
    expect(a?.text).toBe('Watch the bridge, sir; 1st Battalion is forward.');
    expect(a?.basedOnGame).toBe(600_000);
    expect(a?.officer.role).toBe('intelligence');
    expect(a?.records).toHaveLength(1);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]!.stage).toBe('staff');
    expect((client.calls[0]!.input as { question: string; now: number }).question).toBe(
      'Where is the enemy?',
    );
    expect((client.calls[0]!.input as { now: number }).now).toBe(10);
  });

  it('dates the answer by the newest report the side holds, not by the moment of asking (#323)', async () => {
    const w = world();
    const report = {
      id: 'blue-r1',
      kind: 'contact' as const,
      observedAt: 60_000,
      deliverAt: 180_000,
      from: 'blue-1',
      location: { x: 0, y: 0 },
      place: 'near the bridge',
      uncertainty: 0,
      confidence: 'high' as const,
    };
    const held = {
      ...w,
      intel: { ...w.intel, blue: { ...w.intel.blue, reports: [report] } },
    };
    const client = new MockUmpireClient([
      answerFixture({
        messages: [note('advice', 'Hold the bridge, sir; 1st Battalion is forward.')],
      }),
    ]);
    const a = await answerStaffQuestion(client, held, 'blue', 'intelligence', 'Status?', 600_000);
    expect(a?.basedOnGame).toBe(180_000);
  });

  it('rejects filler and a repeat, retries with the problem, and takes a good answer (#359)', async () => {
    const filler = "We are observing the enemy's movements and will report. Stay calm.";
    const repeat =
      'The 1st Battalion is forward. Be ready for any enemy action at the bridge. Be ready for any enemy action at the bridge.';
    const good = 'Sir, the 1st Battalion and the Cavalry Squadron hold the bridge.';
    const replies = [filler, repeat, good];
    const inner = new MockUmpireClient([answerFixture({ messages: [note('advice', 'x y z.')] })]);
    const seen: unknown[] = [];
    const client: UmpireClient = {
      call: async <T>(req: UmpireRequest) => {
        seen.push((req.input as { rejected?: string[] }).rejected);
        const res = await inner.call<T>(req);
        return { ...res, output: { messages: [note('advice', replies[seen.length - 1]!)] } as T };
      },
    };
    // Two calls only: filler then repeat, so the canned answer is used.
    expect(
      await answerStaffQuestion(client, world(), 'blue', 'intelligence', 'Enemy?', 0),
    ).toBeUndefined();
    expect(seen[1]).toEqual(expect.arrayContaining(['answer is generic filler']));
    // A good answer on the retry is accepted.
    seen.length = 0;
    replies.splice(0, 2, repeat, good);
    const a = await answerStaffQuestion(client, world(), 'blue', 'intelligence', 'Enemy?', 0);
    expect(seen[1]).toEqual(['answer repeats itself']);
    expect(a?.text).toBe(good);
  });

  it('is undefined when the model only cites entities outside the view', async () => {
    const client = new MockUmpireClient([
      answerFixture({ messages: [note('advice', 'See blue-99.')] }),
    ]);
    expect(await answerStaffQuestion(client, world(), 'blue', 'chiefOfStaff', 'Status?', 0)).toBe(
      undefined,
    );
  });
});
