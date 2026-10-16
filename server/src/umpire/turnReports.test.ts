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

  describe('the screen on the 11.12 playtest’s harmless accounts (#530)', () => {
    // Each account the playtest withheld, on the word it was withheld for; the entry is the
    // 2nd Battalion's, whose orders name neither the 1st nor any distance.
    const entry = turnReportsInput(
      'blue',
      1,
      [report({ id: 'blue-r10', from: '2nd Battalion' })],
      ctx({ accounts: [] }),
    ).input.reports[0]!;
    const own = ['1st Battalion', 'Col. Hartmann', '2nd Battalion', 'Maj. Albers'];
    const h = ctx().hidden!;
    const screen = (account: string) => screenAccount(account, entry, ctx().places, h, own);

    it.each([
      // unknown number 200: a distance in paces
      'The enemy came up to the far bank and opened fire at about 200 paces. He answered by volleys and held his ground.',
      // unknown name "Battalion": the side's own unit
      'Maj. Verneuil crossed the bridge, sighted the enemy column, and recrossed in good time. He now stands behind the 1st Battalion.',
      // unknown numbers 100 and 200
      'I gave the column a flank volley at about 100 paces. The battalion on the far bank was too far off (over 200 paces), so I held my powder.',
      // unknown entity "bridge-head"; unknown name "Battalion's"
      "The 1st Battalion's line stood in the road at the bridge-head and the enemy was thrown back.",
      // unknown entity "re-forming"
      'I drew the remnant back over the bridge to the north bank and am re-forming. We have lost heavily.',
      // unknown number 1: "the 1st", the side's own battalion
      'Verneuil kept his squadron behind the infantry, ready in case the 1st gave way.',
      // unknown entity "re-form"
      'He drew back to the north bank to re-form, short of men.',
      // unknown entity "bridge-end"
      'Swung the left wing forward and fired into the flank of the column at the bridge-end.',
      // a spelled-out distance, a metre figure and a capitalised compound
      'We opened fire at two hundred paces, then at 150 metres. Bridge-head and road are held.',
    ])('shows "%s"', (account) => {
      expect(screen(account)).toEqual([]);
    });

    it('still withholds the enemy’s names, strengths and ids, unknown figures, dice and the unknown in a compound', () => {
      const leaks: Array<[string, RegExp]> = [
        ['We saw the Vanguard Battalion at 200 paces.', /names the other side/],
        ["The Vanguard Battalion's column crossed.", /names the other side/],
        ['The Vanguard-Battalion crossed the bridge.', /unknown name "Vanguard-Battalion"/],
        ["Gen. Moreau's men came on.", /names the other side/],
        ["We saw Moreau's column at 200 paces.", /unknown name "Moreau's"/],
        ['A column of 600 men came over at 200 paces.', /unknown number 600/],
        ['The enemy had two thousand men in the wood.', /unknown number "two thousand"/],
        ['We fired on red-3 at the bridge-end.', /unknown entity "red-3"/],
        ['We fired on red-hussars at the bridge-end.', /unknown entity "red-hussars"/],
        ['We fell back past Ostwald-Mühle.', /unknown name "Ostwald-Mühle"/],
        ['The 3rd Battalion came up on our left.', /unknown number 3/],
        ['The odds were against us at 200 paces, so I held.', /dice/],
      ];
      for (const [account, problem] of leaks) {
        expect(screen(account).join('; '), account).toMatch(problem);
      }
    });

    it('takes the side’s own names from its units, not the other side’s', () => {
      const { input, withheld } = turnReportsInput(
        'blue',
        1,
        [
          report({
            id: 'blue-r10',
            from: '2nd Battalion',
            turn: { n: 1, lost: 0, movedM: 0, orders: [] },
          }),
        ],
        ctx({
          accounts: [
            {
              unitId: 'blue-2',
              account: "Maj. Albers kept behind the 1st Battalion's line at the bridge-head.",
            },
          ],
        }),
      );
      expect(withheld).toEqual([]);
      expect(input.reports[0]!.account).toMatch(/^Maj\. Albers/);
    });
  });

  it('withholds an account that describes enemies its unit could not see, and only that (#533)', () => {
    const seen =
      'I judged the bridge too exposed: infantry in line held it, so I kept my men back.';
    const withSight = (sight: TurnReportsContext['sight'], account = seen) =>
      turnReportsInput(
        'blue',
        1,
        [report()],
        ctx({ accounts: [{ unitId: 'blue-1', account }], sight }),
      );
    const none = { refused: new Set<string>(), stood: new Set<string>(), knowsEnemy: false };
    // No unit of the side could see an enemy, and it holds no contact: withheld.
    const out = withSight(none);
    expect(out.input.reports[0]!.account).toBeUndefined();
    expect(out.withheld).toEqual([
      {
        reportId: 'blue-r9',
        reason:
          'account withheld (describes the enemy ("infantry") though no unit of the side could see one)',
      },
    ]);
    // The unit's every sighting was refused: withheld, whatever the side knows.
    expect(
      withSight({ ...none, refused: new Set(['blue-1']), knowsEnemy: true }).withheld[0]!.reason,
    ).toMatch(/sight check refused every sighting of this unit/);
    // Its sighting stood, or the side knows the enemy and it proposed none refused: unchanged.
    expect(
      withSight({ ...none, stood: new Set(['blue-1']), knowsEnemy: true }).input.reports[0]!
        .account,
    ).toBe(seen);
    expect(withSight({ ...none, knowsEnemy: true }).input.reports[0]!.account).toBe(seen);
    // An account that describes no enemy is shown even to a side that saw none ("under the guns"
    // would describe one).
    const quiet = 'I kept my men back in the wood and watched the road.';
    expect(withSight(none, quiet).input.reports[0]!.account).toBe(quiet);
    expect(withSight(none, ACCOUNT).input.reports[0]!.account).toBeUndefined();
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

  it('lets a note repeat its account’s condition words and spans, and no others (#530)', () => {
    const shaken = turnReportsInput(
      'blue',
      1,
      [report()],
      ctx({
        ownUnits: [unit({ morale: 50 }), second],
        orderTexts: new Map([['o1', 'Fire on the bridge for ten minutes, then hold it']]),
        accounts: [
          {
            unitId: 'blue-1',
            account: 'I fired for ten minutes, then met a steady line at the bridge and drew back.',
          },
        ],
      }),
    ).input.reports[0]!;
    expect(
      checkTurnNote(
        'Sir, I fired for ten minutes, then met a steady line at the bridge and drew back.',
        shaken,
      ),
    ).toEqual([]);
    expect(checkTurnNote('Sir, we held for an hour at the bridge.', shaken).join()).toMatch(
      /invented duration/,
    );
    expect(checkTurnNote('Sir, we are tiring, but we held the bridge.', shaken).join()).toMatch(
      /condition "tiring" is not the unit’s/,
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
