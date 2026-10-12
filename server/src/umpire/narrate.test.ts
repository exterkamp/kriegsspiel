import { describe, expect, it } from 'vitest';
import { MS_PER_MINUTE } from '@kriegsspiel/engine';
import type { ViewReport } from '@kriegsspiel/engine';
import { MockUmpireClient } from './mockUmpireClient.js';
import type { UmpireFixture } from './mockUmpireClient.js';
import {
  NARRATE_PROMPT_VERSION,
  NARRATE_WINDOW_BASE_MS,
  NARRATE_WINDOW_MAX_MS,
  checkNarration,
  checkProse,
  narrateInput,
  narrateReports,
  narrateWindowMs,
  reportsDueForNarration,
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
      text: 'Sir, the 2nd Hussars report perhaps 400 men near the mill, east of the Albrecht road, some 6 minutes since.',
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
      many
        .slice(2)
        .map((r) => one(r.id, 'Sir, the 2nd Hussars report about 400 men near the mill.')),
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
      one('blue-r3', 'Sir, the 2nd Hussars report about 400 men near the mill.'),
      one('blue-r4', 'Sir, the 2nd Hussars report about 400 men near the mill.'),
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
