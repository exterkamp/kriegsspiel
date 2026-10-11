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
