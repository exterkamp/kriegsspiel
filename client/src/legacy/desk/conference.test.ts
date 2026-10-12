// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  applyServerAnswers,
  mergeStaffHistory,
  busy,
  fixtureAnswer,
  sirFirst,
  newExchange,
  nextExchangeId,
  reconcileExchanges,
  settleTextless,
  SERVER_REPLY_TIMEOUT_MS,
  type Exchange,
  questionProblem,
  staffFor,
  FIXTURE_STAFF,
} from './conference.js';
import { fixtureView } from '../table/fixture.js';

const req = (role: Parameters<typeof staffFor>[0], at = 0) => ({
  role,
  question: 'Status?',
  askedAtGame: at,
});

describe('fixtureAnswer', () => {
  it('names only units in the view', () => {
    const a = fixtureAnswer(req('chiefOfStaff'), fixtureView);
    for (const u of fixtureView.ownUnits) expect(a.text).toContain(u.name);
    expect(a.basedOnGame).toBe(fixtureView.atGame);
  });
  it('quartermaster reports each unit supply and never invents one', () => {
    const a = fixtureAnswer(req('quartermaster'), fixtureView);
    for (const u of fixtureView.ownUnits)
      expect(a.text).toContain(`${u.name}: supply ${Math.round((u.supply ?? 0) * 100)}%`);
  });
  it('cites the newest scouting word received, even with no contact in the tables (#318)', () => {
    const empty = {
      ...fixtureView,
      visibleEnemies: [],
      lastKnownContacts: [],
      dispatches: [
        {
          id: 'd1',
          from: 'Scouts',
          writtenAtGame: 60_000,
          receivedAtGame: 480_000,
          category: 'scouts' as const,
          sizeEstimate: 'a battalion',
          text: 'Scouts sighted a battalion at the bridge.',
        },
      ],
    };
    const text = fixtureAnswer(req('intelligence'), empty).text;
    expect(text).toContain('received Day 1 00:08');
    expect(text).toContain('a battalion at the bridge');
    expect(text).not.toContain('nothing of their whereabouts');
  });
  it('admits ignorance with no view or no contacts', () => {
    expect(fixtureAnswer(req('intelligence'), undefined).text).toContain('no reports');
    const empty = { ...fixtureView, visibleEnemies: [], lastKnownContacts: [] };
    expect(fixtureAnswer(req('intelligence'), empty).text).toContain(
      'nothing of their whereabouts',
    );
  });
  it('every officer opens with "Sir," and the name, whatever the role (#325)', () => {
    for (const role of ['chiefOfStaff', 'intelligence', 'quartermaster', 'engineer'] as const) {
      const name = staffFor(role).name;
      expect(fixtureAnswer(req(role), fixtureView).text, role).toMatch(
        new RegExp(`^${name}: Sir, `),
      );
      expect(fixtureAnswer(req(role), undefined).text, role).toContain(`${name}: Sir, we have no`);
    }
  });
  it('sirFirst adds the opening once and leaves a spoken one alone (#325)', () => {
    expect(sirFirst('No enemy is in sight now.')).toBe('Sir, no enemy is in sight now.');
    expect(sirFirst('I cannot judge roads.')).toBe('Sir, I cannot judge roads.');
    expect(sirFirst('Sir, as I read it: all quiet.')).toBe('Sir, as I read it: all quiet.');
    expect(sirFirst('Our Cavalry is at the bridge.')).toBe('Sir, our Cavalry is at the bridge.');
    expect(sirFirst('Enemy Infantry sighted')).toBe('Sir, enemy Infantry sighted');
    expect(sirFirst('')).toBe('');
    expect(sirFirst('   ')).toBe('');
  });
  it('engineer does not make up terrain', () => {
    expect(fixtureAnswer(req('engineer'), fixtureView).text).toContain('cannot judge');
  });
});

describe('question cost', () => {
  it('answers cost the officer game time and keep them busy until then', () => {
    const s = staffFor('intelligence');
    const e = newExchange(1, req('intelligence', 1000));
    expect(e.answerAtGame).toBe(1000 + s.costMs);
    const log = [{ ...e, answer: { text: 'x', basedOnGame: 0 } }];
    expect(busy(log, 'intelligence', 1000 + s.costMs - 1)).toBe(true);
    expect(busy(log, 'intelligence', 1000 + s.costMs)).toBe(false);
    expect(busy(log, 'engineer', 1000)).toBe(false);
  });
  it('rejects empty, overlong and stacked questions', () => {
    expect(questionProblem('  ', 'engineer', [], 0)).toMatch(/Write/);
    expect(questionProblem('x'.repeat(401), 'engineer', [], 0)).toMatch(/under/);
    const log = [newExchange(1, req('engineer'))];
    expect(questionProblem('hi', 'engineer', log, 0)).toMatch(/still answering/);
    expect(questionProblem('hi', 'quartermaster', log, 0)).toBeUndefined();
  });
  it('has four officers with traits', () => {
    expect(FIXTURE_STAFF.map((s) => s.role)).toHaveLength(4);
    for (const s of FIXTURE_STAFF) expect(s.traits.length).toBeGreaterThan(0);
  });
});

describe('reconcileExchanges', () => {
  const waiting = (id: number, sentAtWall = 1000): Exchange => ({
    ...newExchange(id, req('engineer', 0)),
    answerAtGame: Infinity,
    questionId: `q-${id}`,
    sentAtWall,
  });
  const server = (over: Partial<Parameters<typeof reconcileExchanges>[1]> = {}) => ({
    charges: {},
    link: 'open' as const,
    nowWall: 2000,
    ...over,
  });

  it('takes the server’s answer time', () => {
    const [e] = reconcileExchanges(
      [waiting(1)],
      server({ charges: { 'q-1': { askedAtGame: 500, answerAtGame: 9000, costMs: 8500 } } }),
    );
    expect(e).toMatchObject({ askedAtGame: 500, answerAtGame: 9000 });
  });
  it('matches by the exchange’s own id, so a remount (new ids for new asks) cannot orphan it', () => {
    const log = [waiting(1)];
    expect(nextExchangeId(log)).toBe(2);
    const [e] = reconcileExchanges(
      log,
      server({ charges: { 'q-1': { askedAtGame: 1, answerAtGame: 2, costMs: 1 } } }),
    );
    expect(e!.answerAtGame).toBe(2);
  });
  it('fails a refused question', () => {
    const [e] = reconcileExchanges([waiting(1)], server({ charges: { 'q-1': 'refused' } }));
    expect(e!.failed).toBe(true);
  });
  it('fails waiting exchanges when the link is down, after an unnamed error, and on timeout', () => {
    expect(reconcileExchanges([waiting(1)], server({ link: 'closed' }))[0]!.failed).toBe(true);
    expect(reconcileExchanges([waiting(1)], server({ faultAtWall: 1500 }))[0]!.failed).toBe(true);
    expect(
      reconcileExchanges([waiting(1, 1600)], server({ faultAtWall: 1500 }))[0]!.failed,
    ).toBeUndefined();
    const late = server({ nowWall: 1000 + SERVER_REPLY_TIMEOUT_MS });
    expect(reconcileExchanges([waiting(1)], late)[0]!.failed).toBe(true);
  });
  it('leaves a healthy wait, answered exchanges and unchanged logs alone', () => {
    const log = [waiting(1), newExchange(2, req('intelligence'))];
    expect(reconcileExchanges(log, server())).toBe(log);
  });
});

describe('text-less server replies', () => {
  const ex: Exchange = {
    ...newExchange(1, req('engineer', 0)),
    answerAtGame: 600_000,
    questionId: 'q-1',
  };
  const reply = { 'q-1': { basedOnGame: 0, officer: { name: 'Major X', traits: [] } } };

  it('marks the exchange without answering it', () => {
    const [e] = applyServerAnswers([ex], reply);
    expect(e).toMatchObject({ textless: true });
    expect(e!.answer).toBeUndefined();
  });

  it('answers from the view held when the answer falls due', () => {
    const [marked] = applyServerAnswers([ex], reply);
    const early = settleTextless([marked!], 599_999, { ...fixtureView, atGame: 100 });
    expect(early[0]!.answer).toBeUndefined();
    const [done] = settleTextless([marked!], 600_000, { ...fixtureView, atGame: 555_000 });
    expect(done!.answer?.basedOnGame).toBe(555_000);
  });
});

describe('the conference the server kept (#323)', () => {
  const officer = { name: 'Major Dessau', traits: ['terse'] };
  const kept = (questionId: string, text?: string) => ({
    questionId,
    role: 'intelligence' as const,
    question: 'Where is the enemy?',
    askedAtGame: 60_000,
    answerAtGame: 960_000,
    ...(text === undefined ? {} : { text, basedOnGame: 60_000 }),
    officer,
  });

  it('restores answered and text-less exchanges after a reload, once', () => {
    const log = mergeStaffHistory(
      [],
      [kept('q1', 'At the bridge.'), { ...kept('q2'), textless: true }],
    );
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({
      role: 'intelligence',
      questionId: 'q1',
      answerAtGame: 960_000,
      officer,
      answer: { text: 'Major Dessau: Sir, at the bridge.', basedOnGame: 60_000 },
    });
    expect(log[1]).toMatchObject({ questionId: 'q2', textless: true });
    expect(log[1]!.answer).toBeUndefined();
    expect(new Set(log.map((e) => e.id)).size).toBe(2);
    // Merging again changes nothing, and an exchange already held is not doubled.
    expect(mergeStaffHistory(log, [kept('q1', 'At the bridge.')])).toBe(log);
    expect(mergeStaffHistory(log, undefined)).toBe(log);
  });

  it('keeps an exchange reloaded before it was due open, then takes the real words', () => {
    // The server withholds the words until due, so there is no text and no `textless` flag.
    const early = mergeStaffHistory([], [kept('q1')]);
    expect(early[0]).not.toHaveProperty('textless');
    expect(early[0]!.answer).toBeUndefined();
    // Nothing settles it from the client's own view in the meantime.
    expect(settleTextless(early, 960_000, fixtureView)).toBe(early);
    const due = mergeStaffHistory(early, [kept('q1', 'At the bridge.')]);
    expect(due).toHaveLength(1);
    expect(due[0]!.answer).toEqual({
      text: 'Major Dessau: Sir, at the bridge.',
      basedOnGame: 60_000,
    });
    expect(mergeStaffHistory(due, [kept('q1', 'At the bridge.')])).toBe(due);
  });

  it('marks only a stage that gave no words as text-less', () => {
    const [x] = mergeStaffHistory([], [{ ...kept('q2'), textless: true }]);
    expect(x).toMatchObject({ questionId: 'q2', textless: true });
  });
});
