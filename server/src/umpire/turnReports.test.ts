import { describe, expect, it } from 'vitest';
import { MS_PER_MINUTE, fieldNote, type ViewReport, type ViewUnit } from '@kriegsspiel/engine';
import { ScriptedModel } from './leakKit.testkit.js';
import {
  TURN_REPORTS_MAX,
  TURN_REPORTS_PROMPT_VERSION,
  checkTurnNote,
  reportsOfTurn,
  screenAccount,
  turnReportsInput,
  writeTurnReports,
  type TurnReportsContext,
  type TurnReportsInput,
} from './turnReports.js';
import { UmpireError } from './umpireClient.js';

const T1 = 20 * MS_PER_MINUTE;

function report(over: Partial<ViewReport> = {}): ViewReport {
  return {
    id: 'blue-r9',
    kind: 'turn',
    observedAt: T1,
    deliveredAt: T1,
    ageMs: 0,
    from: '1st Battalion',
    location: { x: 2000, y: 1000 },
    place: 'at the bridge, on the High road',
    uncertaintyRadius: 0,
    confidence: 'high',
    text: 'Sir, we stand where we were. — 1st Battalion, just now.',
    turn: { n: 1, lost: 43, movedM: 0, orders: [{ ref: 'o1', result: 'misread' }] },
    ...over,
  };
}

const unit = (over: Partial<ViewUnit> = {}): ViewUnit =>
  ({
    id: 'blue-1',
    name: '1st Battalion',
    commander: 'Col. Hartmann',
    trait: 'cautious; slow to commit his reserve',
    kind: 'infantry',
    position: { x: 2000, y: 1000 },
    facing: 0,
    formation: 'line',
    footprint: { frontage: 150, depth: 20 },
    strength: 557,
    morale: 80,
    fatigue: 10,
    ammo: 90,
    ...over,
  }) as ViewUnit;

const second = unit({
  id: 'blue-2',
  name: '2nd Battalion',
  commander: 'Maj. Albers',
  trait: 'steady',
});

const ACCOUNT =
  'I judged the bridge too exposed under the guns, so I kept my men back in the wood and watched the road.';

const ctx = (over: Partial<TurnReportsContext> = {}): TurnReportsContext => ({
  ownUnits: [unit(), second],
  accounts: [{ unitId: 'blue-1', account: ACCOUNT }],
  orderTexts: new Map([['o1', 'March to the bridge and hold it']]),
  places: ['High road', 'Kirchberg'],
  hidden: ['Vanguard Battalion', 'Gen. Moreau'],
  ...over,
});

const reply = (dispatches: Array<{ reportIds: string[]; text: string }>) => ({ dispatches });

describe('the turn reports input (11.9)', () => {
  it('gives a unit’s own turn: its account, its orders in the side’s words and their fate, its losses', () => {
    const { input, withheld } = turnReportsInput('blue', 1, [report()], ctx());
    expect(withheld).toEqual([]);
    expect(input).toEqual({
      side: 'blue',
      turn: 1,
      reports: [
        {
          id: 'blue-r9',
          kind: 'turn',
          from: '1st Battalion',
          place: 'at the bridge, on the High road',
          minutesAgo: 0,
          confidence: 'high',
          radiusM: 0,
          commander: 'Col. Hartmann',
          trait: 'cautious; slow to commit his reserve',
          condition: 'steady, fresh, well supplied',
          turn: 1,
          moved: false,
          menLost: 43,
          orders: [{ text: 'March to the bridge and hold it', result: 'misread' }],
          account: ACCOUNT,
        },
      ],
    });
  });

  it('shows only the side’s own units’ accounts, and only to their own reports', () => {
    const { input } = turnReportsInput(
      'blue',
      1,
      [
        report({
          id: 'blue-r10',
          from: '2nd Battalion',
          turn: { n: 1, lost: 0, movedM: 0, orders: [] },
        }),
      ],
      ctx({ accounts: [{ unitId: 'red-1', account: 'We took the bridge.' }] }),
    );
    expect(input.reports[0]!.account).toBeUndefined();
  });

  it('withholds an account that names the other side, cites an unknown figure or name, or speaks of dice', () => {
    const entry = turnReportsInput('blue', 1, [report()], ctx({ accounts: [] })).input.reports[0]!;
    const h = ctx().hidden!;
    expect(screenAccount(ACCOUNT, entry, ctx().places, h)).toEqual([]);
    expect(screenAccount('We saw the Vanguard Battalion.', entry, [], h).join()).toMatch(
      /names the other side/,
    );
    expect(screenAccount('We saw 1200 men in the wood.', entry, [], h).join()).toMatch(
      /unknown number 1200/,
    );
    expect(screenAccount('We fell back past Ostwald.', entry, [], h).join()).toMatch(
      /unknown name "Ostwald"/,
    );
    expect(screenAccount('We fell back past Kirchberg.', entry, ctx().places, h)).toEqual([]);
    expect(screenAccount('The odds were against us, so I held.', entry, [], h).join()).toMatch(
      /dice/,
    );
    const { input, withheld } = turnReportsInput(
      'blue',
      1,
      [report()],
      ctx({ accounts: [{ unitId: 'blue-1', account: 'Gen. Moreau has 1200 men.' }] }),
    );
    expect(input.reports[0]!.account).toBeUndefined();
    expect(withheld[0]!.reason).toMatch(/account withheld/);
  });

  it('takes the turn’s papers only, never the umpire’s ruling or notice', () => {
    const papers = [
      report({ id: 'a', deliveredAt: 0 }),
      report({ id: 'b', deliveredAt: T1 }),
      report({ id: 'c', deliveredAt: T1, kind: 'notice' }),
      report({ id: 'd', deliveredAt: T1, kind: 'battle' }),
      report({ id: 'e', deliveredAt: 5 * MS_PER_MINUTE, kind: 'orderDelivered' }),
    ];
    expect(reportsOfTurn(papers, 0, T1).map((r) => r.id)).toEqual(['e', 'b']);
  });
});

describe('a turn note’s checks (11.9)', () => {
  const entry = turnReportsInput('blue', 1, [report()], ctx()).input.reports[0]!;

  it('passes a note in the commander’s voice that keeps to the report and its account', () => {
    const text =
      'Sir, I judged the bridge too exposed under the guns, so I kept my men back in the wood and watched the road. We lost 43 men.';
    expect(checkTurnNote(text, entry)).toEqual([]);
  });

  it('refuses dice, an invented name or figure, the other side’s names, and a third-person note', () => {
    expect(checkTurnNote('Sir, the odds of crossing were poor; we stayed.', entry).join()).toMatch(
      /dice/,
    );
    expect(checkTurnNote('Sir, we stand near Ostwald.', entry).join()).toMatch(/Ostwald/);
    expect(checkTurnNote('Sir, we lost 900 men at the bridge.', entry).join()).toMatch(/900/);
    expect(
      checkTurnNote('Sir, we hold, and the Vanguard Battalion is before us.', entry, [
        'Vanguard Battalion',
      ]).join(),
    ).toMatch(/names the other side/);
    expect(checkTurnNote('The 1st Battalion stood at the bridge.', entry).join()).toMatch(
      /first person/,
    );
  });

  it('refuses a note on one unit that carries another unit’s facts (a subordinate reads only its own)', () => {
    const { input } = turnReportsInput(
      'blue',
      1,
      [report(), report({ id: 'blue-r10', from: '2nd Battalion' })],
      ctx(),
    );
    const theirs = input.reports[1]!;
    // Maj. Albers commands the 2nd; the 1st's note may not name him.
    expect(
      checkTurnNote(
        'Sir, we stand at the bridge; Maj. Albers is with us.',
        input.reports[0]!,
      ).join(),
    ).toMatch(/Albers/);
    expect(checkTurnNote('Sir, we stand at the bridge, on the High road.', theirs)).toEqual([]);
  });

  it('passes every engine template of a turn note, in every manner', () => {
    for (const trait of [undefined, 'bold', 'cautious', 'steady and methodical']) {
      for (const facts of [
        { n: 1, lost: 0, movedM: 0, orders: [] },
        { n: 1, lost: 6, movedM: 800, orders: [{ result: 'carried-out' as const }] },
        {
          n: 1,
          lost: 143,
          movedM: 30,
          orders: [{ result: 'refused' as const }],
          broke: true as const,
        },
        {
          n: 1,
          lost: 12,
          movedM: 300,
          orders: [{ result: 'partly' as const }],
          rallied: true as const,
        },
      ]) {
        for (let i = 0; i < 30; i++) {
          const r = report({ id: `blue-r${i}`, turn: facts });
          const text = fieldNote(
            { ...r, deliverAt: r.deliveredAt, uncertainty: 0 },
            0,
            false,
            trait === undefined ? {} : { trait },
            11,
          );
          const own = [unit(trait === undefined ? { trait: undefined } : { trait }), second];
          const e = turnReportsInput('blue', 1, [r], ctx({ ownUnits: own })).input.reports[0]!;
          expect(checkTurnNote(text, e), text).toEqual([]);
        }
      }
    }
  });
});

describe('writeTurnReports (11.9)', () => {
  const papers = [
    report(),
    report({
      id: 'blue-r10',
      from: '2nd Battalion',
      turn: { n: 1, lost: 0, movedM: 0, orders: [] },
    }),
  ];
  const goodFirst =
    'Sir, I kept my men back in the wood and watched the road, as I judged the bridge too exposed under the guns.';
  const goodSecond = 'Sir, we stand at the bridge, on the High road. Orders, sir?';

  it('writes every paper of a side in one call', async () => {
    const model = new ScriptedModel({
      narrate: () =>
        reply([
          { reportIds: ['blue-r9'], text: goodFirst },
          { reportIds: ['blue-r10'], text: goodSecond },
        ]),
    });
    const r = await writeTurnReports(model, 'blue', 1, papers, ctx(), { persona: 'dry' });
    expect(r.rejections).toEqual([]);
    expect(model.requests).toHaveLength(1);
    expect(model.requests[0]!.promptVersion).toBe(TURN_REPORTS_PROMPT_VERSION);
    expect(model.requests[0]!.stage).toBe('narrate');
    expect(r.calls).toBe(1);
    expect(r.dispatches).toEqual([
      { reportIds: ['blue-r9'], text: goodFirst },
      { reportIds: ['blue-r10'], text: goodSecond },
    ]);
    expect(r.fallbacks).toEqual([]);
  });

  it('asks again only for the notes that failed, then keeps the template text', async () => {
    const model = new ScriptedModel({
      narrate: (req) => {
        const ids = (req.input as TurnReportsInput).reports.map((x) => x.id);
        return reply(
          ids.map((id) =>
            id === 'blue-r9'
              ? { reportIds: [id], text: goodFirst }
              : { reportIds: [id], text: 'Sir, the Hussars of Ostwald are upon us.' },
          ),
        );
      },
    });
    const r = await writeTurnReports(model, 'blue', 1, papers, ctx());
    expect(model.requests).toHaveLength(2);
    const resend = model.requests[1]!.input as TurnReportsInput & { rejected: string[] };
    expect(resend.reports.map((x) => x.id)).toEqual(['blue-r10']);
    expect(resend.rejected.join()).toMatch(/blue-r10: unknown name/);
    expect(r.dispatches).toEqual([{ reportIds: ['blue-r9'], text: goodFirst }]);
    expect(r.fallbacks).toEqual([
      { reportId: 'blue-r10', reason: expect.stringMatching(/^rejected \(unknown name/) },
    ]);
  });

  it('keeps every template when the call fails, is refused or never answers', async () => {
    const failing = new ScriptedModel({
      narrate: () => {
        throw new UmpireError('down', 'transport', 1);
      },
    });
    const a = await writeTurnReports(failing, 'blue', 1, papers, ctx());
    expect(a.dispatches).toEqual([]);
    expect(a.fallbacks.map((f) => f.reason)).toEqual([
      'the model call failed (transport)',
      'the model call failed (transport)',
    ]);
    const capped = new ScriptedModel({
      narrate: () => {
        throw new UmpireError('spent', 'budget', 1);
      },
    });
    const b = await writeTurnReports(capped, 'blue', 1, papers, ctx());
    expect(b.calls).toBe(0);
    expect(b.overloaded).toBeDefined();
    // Not a model error: a scripted model with no narrate stage throws a plain Error.
    const c = await writeTurnReports(new ScriptedModel({}), 'blue', 1, papers, ctx());
    expect(c.fallbacks).toHaveLength(2);
    const abort = new AbortController();
    abort.abort();
    const slow = { call: () => new Promise<never>(() => {}) };
    const d = await writeTurnReports(slow, 'blue', 1, papers, ctx(), { signal: abort.signal });
    expect(d.fallbacks.map((f) => f.reason)).toEqual(['timed out', 'timed out']);
  });

  it('narrates at most the newest papers of a turn', async () => {
    const many = Array.from({ length: TURN_REPORTS_MAX + 3 }, (_, i) =>
      report({
        id: `blue-r${i}`,
        from: '2nd Battalion',
        turn: { n: 1, lost: 0, movedM: 0, orders: [] },
      }),
    );
    const model = new ScriptedModel({ narrate: () => reply([]) });
    const r = await writeTurnReports(model, 'blue', 1, many, ctx(), { maxCalls: 1 });
    expect((model.requests[0]!.input as TurnReportsInput).reports).toHaveLength(TURN_REPORTS_MAX);
    expect(r.fallbacks.filter((f) => /limit/.test(f.reason))).toHaveLength(3);
  });
});
