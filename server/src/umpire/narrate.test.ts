import { describe, expect, it } from 'vitest';
import { LOW_AMMO, MS_PER_MINUTE, fieldNote } from '@kriegsspiel/engine';
import type { ViewReport, ViewUnit } from '@kriegsspiel/engine';
import { MockUmpireClient } from './mockUmpireClient.js';
import type { UmpireFixture } from './mockUmpireClient.js';
import {
  NARRATE_PROMPT_VERSION,
  NARRATE_WINDOW_BASE_MS,
  NARRATE_WINDOW_MAX_MS,
  checkFieldNote,
  checkNarration,
  checkProse,
  narrateInput,
  narrateReports,
  narrateWindowMs,
  reportsDueForNarration,
  unitCondition,
} from './narrate.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- a fake model reads raw call inputs */
function report(over: Partial<ViewReport> = {}): ViewReport {
  return {
    id: 'blue-r1',
    kind: 'contact',
    observedAt: 8 * MS_PER_MINUTE,
    deliveredAt: 14 * MS_PER_MINUTE,
    ageMs: 6 * MS_PER_MINUTE,
    from: '2nd Hussars',
    location: { x: 2100, y: 900 },
    place: 'near the mill, east of the Albrecht road',
    uncertaintyRadius: 120,
    sizeEstimate: 'about 400 men',
    confidence: 'medium',
    text: '2nd Hussars sighted about 400 men near the mill, 6 min ago (medium confidence).',
    ...over,
  };
}

const reports = [
  report(),
  report({ id: 'blue-r2', kind: 'unitLost', from: '1st Jaegers', sizeEstimate: undefined }),
];
const input = narrateInput('blue', reports);

const fixture = (output: unknown, name = 'f'): UmpireFixture => ({
  name,
  stage: 'narrate',
  promptVersion: NARRATE_PROMPT_VERSION,
  output,
});

const good = {
  dispatches: [
    {
      reportIds: ['blue-r1'],
      text: 'Sir, we see perhaps 400 men near the mill, east of the Albrecht road, some 6 minutes since.',
    },
    { reportIds: ['blue-r2'], text: 'The 1st Jaegers are lost to us; I cannot say more.' },
  ],
};

describe('narrate input', () => {
  it('carries only the side report fields', () => {
    expect(input.reports[0]).toEqual({
      id: 'blue-r1',
      kind: 'contact',
      from: '2nd Hussars',
      place: 'near the mill, east of the Albrecht road',
      minutesAgo: 6,
      sizeEstimate: 'about 400 men',
      confidence: 'medium',
      radiusM: 120,
    });
    expect(JSON.stringify(input)).not.toMatch(/red-|location|"x"/);
  });
});

describe('narrate input: the sender (#390)', () => {
  const hussars = {
    id: 'blue-2',
    name: '2nd Hussars',
    commander: 'Maj. von Reiter',
    trait: 'bold and impatient; apt to charge early',
    strength: 300,
    morale: 35,
    fatigue: 80,
    ammo: 15,
  } as ViewUnit;
  const withSender = narrateInput('blue', reports, [hussars]);

  it('gives the sending officer, his manner and his unit’s condition in words', () => {
    expect(withSender.reports[0]).toMatchObject({
      commander: 'Maj. von Reiter',
      trait: 'bold and impatient; apt to charge early',
      condition: 'wavering, spent, ammunition nearly gone',
    });
    expect(JSON.stringify(withSender.reports[0])).not.toMatch(/"(morale|fatigue|ammo|strength)"/);
  });

  it('adds nothing for a sender that is not one of the side’s units, or is destroyed', () => {
    expect(withSender.reports[1]).toEqual(input.reports[1]);
    const gone = narrateInput('blue', reports, [{ ...hussars, strength: 0 }]);
    expect(gone.reports[0]).toEqual(input.reports[0]);
  });

  it('puts condition in coarse words', () => {
    expect(unitCondition({ morale: 90, fatigue: 10, ammo: 100 })).toBe(
      'steady, fresh, well supplied',
    );
    expect(unitCondition({ morale: 50, fatigue: 50, ammo: 40 })).toBe(
      'shaken, tiring, ammunition running low',
    );
    // A unit that has just filed its lowAmmo report reads as nearly gone.
    expect(unitCondition({ morale: 90, fatigue: 10, ammo: LOW_AMMO })).toBe(
      'steady, fresh, ammunition nearly gone',
    );
    expect(unitCondition({ morale: 90, fatigue: 10, ammo: LOW_AMMO + 1 })).toBe(
      'steady, fresh, ammunition running low',
    );
  });

  it('lets the note name its commander and ask the general a question', () => {
    expect(
      checkProse(
        'Sir, the 2nd Hussars have sighted perhaps 400 men near the mill. My men are spent. Shall we fall back? Should we hold? Maj. von Reiter',
        withSender,
      ),
    ).toEqual([]);
    expect(checkProse('Must we hold? May I pursue? Request orders.', input)).toEqual([]);
    // A question is still no place to invent a name.
    expect(checkProse('Shall we fall back on Hohenau?', withSender)).toEqual([
      'unknown name "Hohenau"',
    ]);
  });

  it('gives no sender for the kinds headquarters writes: a lost unit or a lost courier', () => {
    const staff = narrateInput(
      'blue',
      [
        report({ id: 'blue-r4', kind: 'courierLost', sizeEstimate: undefined }),
        report({ id: 'blue-r5', kind: 'unitLost', sizeEstimate: undefined }),
      ],
      [hussars],
    );
    for (const r of staff.reports) {
      expect(r).not.toHaveProperty('commander');
      expect(r).not.toHaveProperty('trait');
      expect(r).not.toHaveProperty('condition');
    }
  });

  it('passes the field notes the prompt asks for, in the officer’s own words', () => {
    const engaged = narrateInput(
      'blue',
      [report({ id: 'blue-r3', kind: 'engaged', place: 'at the bridge on the High road' })],
      [hussars],
    );
    const notes = [
      'Sir, we are engaged at the bridge. Spent as we are, I doubt we can hold. Shall we fall back?',
      'Sir, we are engaged at the bridge. Pursue them or hold? Your orders, sir.',
      'Ammunition is nearly gone. Hold or fall back?',
      'Engaged at the bridge on the High road. Men are spent and wavering. Request relief.',
      'The enemy presses us at the bridge. Wavering men will not stand long. Send help, I beg you.',
      'We hold the bridge for now. Is the reserve coming? Advise, sir.',
      'Sir, we hold the bridge for now. Unless relieved within the hour we must give way. Orders?',
      'Sir, we hold. Nothing more can be asked of these men. Shall I withdraw? Yours, Maj. von Reiter',
      'Sir, we are hotly engaged at the bridge. Our powder is nearly gone. Can we be relieved?',
    ];
    for (const note of notes) expect(checkProse(note, engaged), note).toEqual([]);
    expect(checkProse('Advance on Hohenau?', engaged)).toEqual(['unknown name "Hohenau"']);
  });

  it('passes the side’s units through to each call', async () => {
    const client = fakeModel([one('blue-r1', good.dispatches[0]!.text)]);
    await narrateReports(client as never, 'blue', [reports[0]!], { ownUnits: [hussars] });
    expect(client.calls[0]).toEqual(narrateInput('blue', [reports[0]!], [hussars]));
  });
});

describe('prose check', () => {
  it('passes prose built from the reports', () => {
    expect(checkNarration(good, input)).toEqual([]);
  });

  it('catches an invented unit id', () => {
    expect(checkProse('Sir, red-7 is at the mill.', input)).toEqual(['unknown entity "red-7"']);
  });

  it('catches an invented place or officer', () => {
    expect(checkProse('We saw them near the Hohenau ford.', input)).toEqual([
      'unknown name "Hohenau"',
    ]);
    expect(checkProse('Colonel Berthier reports it.', input)).toContain('unknown name "Berthier"');
    expect(checkProse('I sent Colonel Berthier forward.', input)).toContain(
      'unknown name "Colonel"',
    );
  });

  it('catches an invented name at the start of a sentence, or after a quote or bracket', () => {
    expect(checkProse('Hohenau has fallen to the enemy.', input)).toEqual([
      'unknown name "Hohenau"',
    ]);
    expect(checkProse('Sir. Berthier holds the ford.', input)).toEqual(['unknown name "Berthier"']);
    expect(checkProse('Near the "Hohenau" ford.', input)).toEqual(['unknown name "Hohenau"']);
    expect(checkProse('All quiet. (Berthier is ill.)', input)).toEqual(['unknown name "Berthier"']);
  });

  it('lets ordinary words and known names open a sentence', () => {
    expect(checkProse('The mill is held. We wait. 2nd Hussars hold. Hussars hold.', input)).toEqual(
      [],
    );
    expect(
      checkProse('The enemy is near. They number about 400.\nOur scouts watch.', input),
    ).toEqual([]);
  });

  it('catches an invented number, in digits or words', () => {
    expect(checkProse('About 900 men at the mill.', input)).toEqual(['unknown number 900']);
    expect(checkProse('I count seven squadrons.', input)).toEqual(['unknown number "seven"']);
    expect(checkProse('Six minutes ago, 400 men.', input)).toEqual([]);
  });

  it('catches large and compound number words, and accepts a spelled-out known number', () => {
    expect(checkProse('The Hussars see a thousand men.', input)).toEqual([
      'unknown number "thousand"',
    ]);
    expect(checkProse('Thirty squadrons at the mill.', input)).toEqual(['unknown number "thirty"']);
    expect(checkProse('Perhaps a hundred men.', input)).toEqual(['unknown number "hundred"']);
    expect(checkProse('Twenty guns.', input)).toEqual(['unknown number "twenty"']);
    expect(checkProse('Four hundred men at the mill.', input)).toEqual([]);
  });

  it('does not take ids or JSON keys as facts', () => {
    expect(checkProse('About 3 men at the mill.', input)).toEqual(['unknown number 3']);
    expect(checkProse('We hold the mill. Reports say Contact.', input)).toEqual([
      'unknown name "Reports"',
      'unknown name "Contact"',
    ]);
  });

  it('rejects unknown and missing report ids and empty text', () => {
    expect(checkNarration({ dispatches: [{ reportIds: ['red-r9'], text: ' ' }] }, input)).toEqual(
      expect.arrayContaining([
        'unknown report "red-r9"',
        'empty dispatch',
        'report "blue-r1" not narrated',
        'report "blue-r2" not narrated',
      ]),
    );
  });
});

/** A fake model that answers each single-report call with the next scripted reply (or a function of the input). */
function fakeModel(replies: Array<unknown | ((input: any) => unknown)>) {
  const calls: any[] = [];
  const client = {
    calls,
    async call(req: { input: unknown }) {
      calls.push(req.input);
      const next = replies.shift();
      const output = typeof next === 'function' ? next(req.input) : next;
      return { output, record: {} as never };
    },
  };
  return client;
}

const one = (id: string, text: string) => ({ dispatches: [{ reportIds: [id], text }] });

describe('narrateReports', () => {
  it('makes one call per report and keeps the model’s text for each (#359)', async () => {
    const client = fakeModel([
      one('blue-r1', good.dispatches[0]!.text),
      one('blue-r2', good.dispatches[1]!.text),
    ]);
    const r = await narrateReports(client as never, 'blue', reports);
    expect(client.calls).toHaveLength(2);
    expect(client.calls.map((c) => c.reports.map((x: { id: string }) => x.id))).toEqual([
      ['blue-r1'],
      ['blue-r2'],
    ]);
    expect(client.calls[0]).toEqual(narrateInput('blue', [reports[0]!]));
    expect(r).toMatchObject({ fellBack: false, calls: 2, rejections: [], fallbacks: [] });
    expect(r.dispatches).toEqual([
      { reportIds: ['blue-r1'], text: good.dispatches[0]!.text },
      { reportIds: ['blue-r2'], text: good.dispatches[1]!.text },
    ]);
  });

  it('keeps the model’s text for the reports that pass when another falls back, saying why (#359)', async () => {
    const bad = one('blue-r1', 'Red-9 attacks the Cuirassiers of Lindau.');
    const client = fakeModel([bad, bad, one('blue-r2', good.dispatches[1]!.text)]);
    const r = await narrateReports(client as never, 'blue', reports);
    expect(client.calls).toHaveLength(3);
    expect(r.fellBack).toBe(true);
    expect(r.dispatches[0]).toEqual({ reportIds: ['blue-r1'], text: reports[0]!.text });
    expect(r.dispatches[1]!.text).toBe(good.dispatches[1]!.text);
    expect(r.fallbacks).toHaveLength(1);
    expect(r.fallbacks[0]).toMatchObject({ reportId: 'blue-r1' });
    expect(r.fallbacks[0]!.reason).toMatch(/reply 2 rejected .*unknown entity "red-9"/i);
  });

  it('narrates only the newest reports of a long window, the rest keep their text', async () => {
    const many = Array.from({ length: 4 }, (_, i) => report({ id: `blue-r${i + 1}` }));
    const client = fakeModel(
      many.slice(2).map((r) => one(r.id, 'Sir, we see about 400 men near the mill.')),
    );
    const r = await narrateReports(client as never, 'blue', many, { maxReports: 2 });
    expect(client.calls).toHaveLength(2);
    expect(r.dispatches.map((d) => d.reportIds[0])).toEqual(many.map((x) => x.id));
    expect(r.fallbacks.map((f) => f.reportId)).toEqual(['blue-r1', 'blue-r2']);
    expect(r.dispatches[0]!.text).toBe(many[0]!.text);
  });

  it('takes the newest reports by delivery time, whatever order the view lists them in', async () => {
    const many = [3, 1, 4, 2].map((n) => report({ id: `blue-r${n}`, deliveredAt: n * 1000 }));
    const client = fakeModel([
      one('blue-r3', 'Sir, we see about 400 men near the mill.'),
      one('blue-r4', 'Sir, we see about 400 men near the mill.'),
    ]);
    const r = await narrateReports(client as never, 'blue', many, { maxReports: 2 });
    expect(client.calls.map((c) => c.reports[0].id)).toEqual(['blue-r3', 'blue-r4']);
    expect(r.fallbacks.map((f) => f.reportId)).toEqual(['blue-r1', 'blue-r2']);
  });

  it('keeps the prose of the reports done when time runs out, and the rest keep their text (#359)', async () => {
    const abort = new AbortController();
    let n = 0;
    const client = {
      async call(req: { input: unknown }) {
        if (++n === 1) {
          const id = (req.input as { reports: { id: string }[] }).reports[0]!.id;
          return { output: one(id, good.dispatches[0]!.text), record: {} as never };
        }
        return new Promise<never>(() => undefined); // hangs until the deadline
      },
    };
    const run = narrateReports(client as never, 'blue', reports, { signal: abort.signal });
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    abort.abort();
    const r = await run;
    expect(r.dispatches).toEqual([
      { reportIds: ['blue-r1'], text: good.dispatches[0]!.text },
      { reportIds: ['blue-r2'], text: reports[1]!.text },
    ]);
    expect(r.fallbacks).toEqual([{ reportId: 'blue-r2', reason: 'timed out' }]);
    expect(r.fellBack).toBe(true);
  });

  it('leaves the umpire’s ruling in its own words, out of the model’s hands (#320)', async () => {
    const ruling = report({
      id: 'blue-r3',
      kind: 'battle',
      from: 'Dispatch from the field',
      text: 'Red’s attack at the bridge has been broken; Blue holds the field.',
    });
    const client = fakeModel([
      one('blue-r1', good.dispatches[0]!.text),
      one('blue-r2', good.dispatches[1]!.text),
    ]);
    const r = await narrateReports(client as never, 'blue', [...reports, ruling]);
    expect(JSON.stringify(client.calls)).not.toContain('blue-r3');
    expect(r.dispatches.flatMap((d) => d.reportIds)).not.toContain('blue-r3');
    const only = await narrateReports(new MockUmpireClient([]), 'blue', [ruling]);
    expect(only).toMatchObject({ dispatches: [], calls: 0 });
  });

  it('makes no call for an empty window', async () => {
    const client = new MockUmpireClient([]);
    expect(await narrateReports(client, 'blue', [])).toMatchObject({ dispatches: [], calls: 0 });
    expect(client.calls).toHaveLength(0);
  });

  it('rejects an invented unit and regenerates, telling the model why', async () => {
    const bad = one('blue-r1', 'Sir, red-4 and the Cuirassiers of Lindau hold the mill.');
    const client = fakeModel([bad, one('blue-r1', good.dispatches[0]!.text)]);
    const r = await narrateReports(client as never, 'blue', [reports[0]!]);
    expect(r.fellBack).toBe(false);
    expect(r.calls).toBe(2);
    expect(r.rejections[0]).toEqual(
      expect.arrayContaining(['unknown entity "red-4"', 'unknown name "Cuirassiers"']),
    );
    expect(client.calls[1]).toMatchObject({ rejected: r.rejections[0] });
    expect(r.dispatches[0]!.text).toMatch(/400 men/);
  });

  it('falls back to the template text when every reply invents something', async () => {
    const bad = { dispatches: [{ reportIds: ['blue-r1'], text: 'Red-9 attacks.' }] };
    const client = new MockUmpireClient([fixture(bad)]);
    const r = await narrateReports(client, 'blue', reports, { maxCalls: 2 });
    expect(client.calls).toHaveLength(4);
    expect(r.fellBack).toBe(true);
    expect(r.dispatches).toEqual(reports.map((x) => ({ reportIds: [x.id], text: x.text })));
  });

  it('falls back to the template text for every report when the model call fails', async () => {
    const client = new MockUmpireClient([{ stage: 'narrate', failure: { kind: 'transport' } }]);
    const r = await narrateReports(client, 'blue', reports);
    expect(r).toMatchObject({ fellBack: true, calls: 1 });
    expect(r.dispatches.map((d) => d.text)).toEqual(reports.map((x) => x.text));
    expect(r.fallbacks).toHaveLength(2);
    expect(r.fallbacks[0]!.reason).toMatch(/model call failed/);
  });
});

describe('field-note checks (#419)', () => {
  /** A report as the narrate input has it, with its sender. */
  function sent(over: Partial<ViewReport>, unit: Partial<ViewUnit>) {
    const r = report({ sizeEstimate: undefined, confidence: 'high', ...over });
    const u = { id: 'u', strength: 500, morale: 80, fatigue: 10, ammo: 90, ...unit } as ViewUnit;
    return narrateInput(r.id.startsWith('red') ? 'red' : 'blue', [r], [u]);
  }
  const reply = (id: string, text: string) => ({ dispatches: [{ reportIds: [id], text }] });

  // The model-written dispatch from the QA run (game f9689f9b), exactly as quoted in #419.
  const aubry = sent(
    {
      id: 'blue-r4',
      kind: 'engaged',
      from: '1st Battalion',
      place: 'near the bridge',
      observedAt: 0,
      deliveredAt: 10 * MS_PER_MINUTE,
    },
    { name: '1st Battalion', commander: 'Col. Aubry', morale: 30, fatigue: 10, ammo: 90 },
  );
  const AUBRY =
    'The 1st Battalion, under the command of Col. Aubry, held its position near the bridge ... for 10 minutes. The battalion was well supplied, with a strong line under fire ... The battalion is wavering, fresh, and well supplied.';
  // The raw red reply from the same run.
  const hartmann = sent(
    {
      id: 'red-r7',
      kind: 'orderDelivered',
      from: 'Line Battalion',
      place: 'east of the High road',
    },
    { name: 'Line Battalion', commander: 'Col. Hartmann' },
  );
  const HARTMANN =
    'The order to deliver the goods to the east of the High Road was delivered by Col. Hartmann, who is steady, fresh ...';

  it('rejects the model-written dispatch from QA, saying why', () => {
    expect(aubry.reports[0]!.condition).toBe('wavering, fresh, well supplied');
    // Every name and number in it is in the report: the fact check alone passed it.
    expect(checkProse(AUBRY, aubry)).toEqual([]);
    const problems = checkNarration(reply('blue-r4', AUBRY), aubry);
    expect(problems).toEqual(
      expect.arrayContaining([
        'not in the first person: names "1st Battalion" as someone else would',
        'invented duration "for 10 minutes"',
        'invented strength "strong line"',
        'recites the unit’s condition instead of judging it',
      ]),
    );
  });

  it('rejects the red reply from QA, saying why', () => {
    expect(checkProse(HARTMANN, hartmann)).toEqual([]);
    expect(checkNarration(reply('red-r7', HARTMANN), hartmann)).toEqual([
      'not in the first person: names "Col. Hartmann" as someone else would',
    ]);
  });

  it('passes good field notes on the same reports', () => {
    for (const note of [
      'Sir, we are engaged near the bridge. The men are wavering; I cannot promise we will hold. Shall we fall back?',
      'Sir, hotly engaged near the bridge. My lads are fresh but wavering under the fire. Send the reserve if you can.',
      'Sir, we hold near the bridge. Orders? Col. Aubry',
    ]) {
      expect(checkNarration(reply('blue-r4', note), aubry), note).toEqual([]);
    }
    for (const note of [
      'Sir, your orders reached us east of the High road. We march at once. Col. Hartmann',
      'Orders received, sir. We are steady and shall carry them out.',
    ]) {
      expect(checkNarration(reply('red-r7', note), hartmann), note).toEqual([]);
    }
  });

  it('rejects contradictory and invented condition words', () => {
    expect(
      checkFieldNote(
        'Sir, we are engaged; the men are steady, though wavering.',
        aubry.reports[0]!,
      ),
    ).toContain('contradictory condition "steady" and "wavering"');
    expect(checkFieldNote('Sir, we are engaged, and my men are spent.', aubry.reports[0]!)).toEqual(
      ['condition "spent" is not the unit’s'],
    );
  });

  it('reads "fresh troops" and "a steady fire" as not the men’s condition', () => {
    const worn = sent(
      {
        id: 'blue-r8',
        kind: 'engaged',
        from: '1st Battalion',
        place: 'at the bridge',
      },
      { name: '1st Battalion', morale: 30, fatigue: 60, ammo: 10 },
    );
    expect(worn.reports[0]!.condition).toBe('wavering, tiring, ammunition nearly gone');
    for (const note of [
      'Sir, we are engaged at the bridge. The enemy brings up fresh troops. Shall we fall back?',
      'Sir, we are engaged at the bridge and keep up a steady fire. Send cartridges.',
    ]) {
      expect(checkFieldNote(note, worn.reports[0]!), note).toEqual([]);
    }
    expect(
      checkFieldNote('Sir, we are engaged at the bridge. My men are fresh.', worn.reports[0]!),
    ).toEqual(['condition "fresh" is not the unit’s']);
  });

  it('lets the report’s kind supply its condition word', () => {
    const tired = sent(
      { id: 'blue-r5', kind: 'exhausted', from: '1st Battalion', place: 'near the bridge' },
      { name: '1st Battalion', fatigue: 10 },
    );
    expect(checkFieldNote('Sir, my men are spent. We must rest.', tired.reports[0]!)).toEqual([]);
  });

  it('rejects a note that does not say what happened', () => {
    expect(
      checkFieldNote('Sir, I await your pleasure near the bridge.', hartmann.reports[0]!),
    ).toEqual(['does not say what happened (orderDelivered)']);
  });

  it('rejects fire on a report that is not a fight', () => {
    expect(
      checkFieldNote('Sir, we have your orders, though we are under fire.', hartmann.reports[0]!),
    ).toEqual(['invented event "under fire": the report is not of a fight']);
  });

  it('caps the length', () => {
    const long = `Sir, we have your orders. ${'We march at once. '.repeat(30)}`;
    expect(checkFieldNote(long, hartmann.reports[0]!).join()).toMatch(/too long \(\d+ characters/);
    expect(
      checkFieldNote('Orders, sir. We go. We march. We halt. We wait.', hartmann.reports[0]!),
    ).toEqual(['too long (5 sentences, at most 4)']);
    // An abbreviated rank does not end a sentence.
    expect(
      checkFieldNote(
        'Sir, we are engaged at the bridge. Lt. Col. Aubry asks: may we fall back? We hold.',
        aubry.reports[0]!,
      ),
    ).toEqual([]);
  });

  it('lets headquarters write a lost unit in the third person', () => {
    const lost = narrateInput('blue', [
      report({ id: 'blue-r6', kind: 'unitLost', from: '1st Battalion', sizeEstimate: undefined }),
    ]);
    expect(checkFieldNote('The 1st Battalion is lost, sir.', lost.reports[0]!)).toEqual([]);
  });
});

describe('the engine’s field notes as fallback (#419)', () => {
  it('pass the same checks a model’s note must, for every kind, wording and manner', () => {
    const kinds = [
      'situation',
      'contact',
      'unitLost',
      'courierLost',
      'orderDelivered',
      'lowAmmo',
      'exhausted',
      'destroyed',
      'engaged',
      'heavyLosses',
      'broke',
    ] as const;
    // Fresh and well supplied, worn and short of cartridges, and spent with almost none.
    const states = [
      [80, 10, 90],
      [30, 60, 10],
      [50, 90, 5],
    ] as const;
    for (const [morale, fatigue, ammo] of states) {
      const unit = {
        id: 'blue-1',
        name: '1st Battalion',
        strength: 500,
        morale,
        fatigue,
        ammo,
      } as ViewUnit;
      sweep(unit);
    }
    function sweep(unit: ViewUnit) {
      for (const kind of kinds) {
        for (const trait of [undefined, 'bold', 'cautious', 'steady and methodical']) {
          for (let i = 0; i < 30; i++) {
            const r = report({
              id: `blue-r${i}`,
              kind,
              from: '1st Battalion',
              place: 'at the bridge, on the High road',
              observedAt: 0,
              deliveredAt: 3 * MS_PER_MINUTE,
              ...(kind === 'contact' || kind === 'destroyed' ? {} : { sizeEstimate: undefined }),
            });
            const text = fieldNote(
              { ...r, deliverAt: r.deliveredAt, uncertainty: 0 },
              3 * MS_PER_MINUTE,
              false,
              trait === undefined ? {} : { trait },
              11,
            );
            const input = narrateInput('blue', [r], [{ ...unit, ...(trait ? { trait } : {}) }]);
            expect(
              checkNarration({ dispatches: [{ reportIds: [r.id], text }] }, input),
              text,
            ).toEqual([]);
          }
        }
      }
    }
  });
});

describe('narrateReports with a circuit breaker (#419)', () => {
  it('tells the breaker each outcome and stops calling once it opens', async () => {
    const outcomes: boolean[] = [];
    let open = false;
    const breaker = {
      allows: () => !open,
      reason: () => 'model narration paused: 3 of 3 failed',
      record: (ok: boolean) => {
        outcomes.push(ok);
        open = outcomes.filter((o) => !o).length >= 3;
      },
    };
    const bad = { dispatches: [{ reportIds: ['blue-r1'], text: 'Red-9 attacks.' }] };
    const client = new MockUmpireClient([fixture(bad)]);
    const three = [...reports, report({ id: 'blue-r3', from: '1st Jaegers' })];
    const r = await narrateReports(client, 'blue', three, { breaker });
    // Two rejected replies for the first report, one for the second, then nothing more.
    expect(client.calls).toHaveLength(3);
    expect(outcomes).toEqual([false, false, false]);
    expect(r.dispatches.map((d) => d.text)).toEqual(three.map((x) => x.text));
    expect(r.fallbacks.map((f) => f.reason).slice(1)).toEqual([
      'model narration paused: 3 of 3 failed',
      'model narration paused: 3 of 3 failed',
    ]);
  });

  it('counts a failed call as a failure and a passing reply as a success', async () => {
    const outcomes: boolean[] = [];
    const breaker = {
      allows: () => true,
      reason: () => '',
      record: (ok: boolean) => outcomes.push(ok),
    };
    await narrateReports(
      fakeModel([
        one('blue-r1', good.dispatches[0]!.text),
        one('blue-r2', good.dispatches[1]!.text),
      ]) as never,
      'blue',
      reports,
      { breaker },
    );
    await narrateReports(
      new MockUmpireClient([{ stage: 'narrate', failure: { kind: 'transport' } }]),
      'blue',
      reports,
      { breaker },
    );
    expect(outcomes).toEqual([true, true, false]);
  });
});

describe('narration windows', () => {
  it('scales the window with the clock rate', () => {
    expect(narrateWindowMs(1)).toBe(NARRATE_WINDOW_BASE_MS);
    expect(narrateWindowMs(2)).toBe(2 * NARRATE_WINDOW_BASE_MS);
    expect(narrateWindowMs(4)).toBe(4 * NARRATE_WINDOW_BASE_MS);
    // Capped in game time: at 12:1 a 50-minute game still gets windows (#342).
    expect(narrateWindowMs(12)).toBe(NARRATE_WINDOW_MAX_MS);
    expect(narrateWindowMs(12)).toBeLessThan(50 * MS_PER_MINUTE);
    expect(() => narrateWindowMs(0)).toThrow(RangeError);
  });

  it('holds reports until the window closes, then hands over the whole burst once', () => {
    const rs = [
      report({ id: 'a', deliveredAt: 1 * MS_PER_MINUTE }),
      report({ id: 'b', deliveredAt: 2 * MS_PER_MINUTE }),
      report({ id: 'c', deliveredAt: 7 * MS_PER_MINUTE }),
    ];
    expect(reportsDueForNarration(rs, 0, 4 * MS_PER_MINUTE, 1)).toEqual([]);
    expect(reportsDueForNarration(rs, 0, 5 * MS_PER_MINUTE, 1).map((r) => r.id)).toEqual([
      'a',
      'b',
    ]);
    expect(
      reportsDueForNarration(rs, 5 * MS_PER_MINUTE, 10 * MS_PER_MINUTE, 1).map((r) => r.id),
    ).toEqual(['c']);
    // At rates 4 and 12 the same five minutes is not yet a window, but twenty game minutes is.
    expect(reportsDueForNarration(rs, 0, 5 * MS_PER_MINUTE, 4)).toEqual([]);
    expect(reportsDueForNarration(rs, 0, 5 * MS_PER_MINUTE, 12)).toEqual([]);
    expect(reportsDueForNarration(rs, 0, 20 * MS_PER_MINUTE, 4)).toHaveLength(3);
    expect(reportsDueForNarration(rs, 0, 20 * MS_PER_MINUTE, 12)).toHaveLength(3);
  });
});
