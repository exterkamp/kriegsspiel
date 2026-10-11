// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import Conference from './Conference.svelte';
import { conferenceLog, gameState } from './store.js';
import {
  busy,
  fixtureAnswer,
  newExchange,
  nextExchangeId,
  reconcileExchanges,
  SERVER_REPLY_TIMEOUT_MS,
  type Exchange,
  questionProblem,
  staffFor,
  FIXTURE_STAFF,
} from './conference.js';
import { fixtureView } from '../table/fixture.js';
import { initialState } from '../net/state.js';

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
  it('admits ignorance with no view or no contacts', () => {
    expect(fixtureAnswer(req('intelligence'), undefined).text).toContain('no reports');
    const empty = { ...fixtureView, visibleEnemies: [], lastKnownContacts: [] };
    expect(fixtureAnswer(req('intelligence'), empty).text).toContain(
      'nothing of their whereabouts',
    );
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

describe('Conference view', () => {
  let cmp: ReturnType<typeof mount> | undefined;
  afterEach(() => {
    if (cmp) unmount(cmp);
    cmp = undefined;
    document.body.innerHTML = '';
    conferenceLog.set([]);
    gameState.set(initialState);
  });

  it('shows the officer traits and cost, and holds an answer until game time reaches it', async () => {
    gameState.set({ ...initialState, view: fixtureView });
    cmp = mount(Conference, { target: document.body });
    flushSync();
    expect(document.body.textContent).toContain('Traits: meticulous, cautious');
    expect(document.body.textContent).toContain('10 min');
    const ta = document.querySelector('textarea')!;
    ta.value = 'How do we stand?';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    flushSync();
    await Promise.resolve();
    flushSync();
    // No clock runs, so game time is the view's: the answer is due 10 minutes later and is not shown yet.
    expect(document.body.textContent).toContain('consulting the papers');
    expect(get(conferenceLog)[0]!.answer).toBeDefined();
    expect(document.body.textContent).not.toContain(fixtureView.ownUnits[0]!.name + ',');
    // A second question to the same officer is refused while they are busy.
    ta.value = 'And now?';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    flushSync();
    expect(document.querySelector('[role=alert]')?.textContent).toMatch(/still answering/);
    expect(get(conferenceLog)).toHaveLength(1);
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
