// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeRenderer {
    setPixelRatio(): void {}
    setSize(): void {}
    render(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

import { flushSync, mount, unmount } from 'svelte';
import { PROTOCOL_VERSION, type PauseProposal, type ServerMessage } from '@kriegsspiel/protocol';
import Desk from './Desk.svelte';
import { activeView, gameState, pauseActions } from './store.js';
import { clockView } from './clock.js';
import { pausePanel, pageTitle, voteWaiting } from './pause.js';
import { applyServerMessage, initialState, type ClientState } from '../net/state.js';

const v = PROTOCOL_VERSION;
const apply = (s: ClientState, m: ServerMessage, at = 0) => applyServerMessage(s, m, at);
const proposal = (over: Partial<PauseProposal> = {}): PauseProposal => ({
  id: 'p1',
  kind: 'pause',
  bySide: 'red',
  byYou: false,
  yes: 1,
  no: 0,
  voters: 3,
  msLeft: 30_000,
  ...over,
});
const proposed = (over: Partial<PauseProposal> = {}, at = 1000): ClientState =>
  apply(
    initialState,
    { v, kind: 'pauseState', phase: 'pause_proposed', proposal: proposal(over) },
    at,
  );

describe('pausePanel', () => {
  it('is hidden in a game without voting and once the game is over', () => {
    expect(pausePanel(initialState, 0)).toEqual({ kind: 'hidden' });
    const over = apply(proposed(), {
      v,
      kind: 'gameOver',
      winner: 'blue',
      reason: 'objective-held',
      atGame: 1,
    });
    expect(pausePanel(over, 0)).toEqual({ kind: 'hidden' });
  });

  it('offers to pause while running and to resume while paused', () => {
    const running = apply(initialState, { v, kind: 'pauseState', phase: 'running' });
    expect(pausePanel(running, 0)).toEqual({ kind: 'idle', action: 'pause' });
    const paused = apply(initialState, { v, kind: 'pauseState', phase: 'paused' });
    expect(pausePanel(paused, 0)).toEqual({ kind: 'idle', action: 'resume' });
  });

  it('shows who asked, why, the tally and a countdown that runs on this client’s clock', () => {
    const s = proposed({ reason: 'door' }, 1000);
    expect(pausePanel(s, 1000)).toMatchObject({
      kind: 'vote',
      id: 'p1',
      action: 'pause',
      headline: 'Red asks to pause the game.',
      reason: 'door',
      secondsLeft: 30,
      tally: '1 of 3 yes',
      needsVote: true,
      waitingOn: 2,
    });
    expect(pausePanel(s, 11_500)).toMatchObject({ secondsLeft: 20 });
    expect(pausePanel(s, 99_000)).toMatchObject({ secondsLeft: 0 });
  });

  it('says you asked, and once you voted stops asking for a vote', () => {
    const asked = proposed({ byYou: true, myVote: true, yes: 1, no: 0 });
    expect(pausePanel(asked, 1000)).toMatchObject({
      headline: 'You asked to pause the game.',
      needsVote: false,
      myVote: true,
    });
    const no = proposed({ myVote: false, yes: 1, no: 1 });
    expect(pausePanel(no, 1000)).toMatchObject({ tally: '1 of 3 yes, 1 no', waitingOn: 1 });
  });

  it('marks the page title while a vote waits for this player', () => {
    expect(voteWaiting(proposed())).toBe(true);
    expect(pageTitle('Kriegsspiel', proposed())).toBe('(vote) Kriegsspiel');
    expect(pageTitle('Kriegsspiel', proposed({ myVote: true }))).toBe('Kriegsspiel');
    expect(pageTitle('Kriegsspiel', initialState)).toBe('Kriegsspiel');
  });
});

describe('pause messages in the client state', () => {
  it('replaces the vote on each pauseState and clears it when none is open', () => {
    let s = proposed();
    expect(s.pause?.proposal?.closesAtWall).toBe(31_000);
    s = apply(s, { v, kind: 'pauseState', phase: 'paused' });
    expect(s.pause).toEqual({ phase: 'paused' });
  });

  it('turns each result into a notice', () => {
    const results: Array<[ServerMessage, string]> = [
      [{ v, kind: 'pauseResult', outcome: 'paused', cause: 'all-yes' }, 'The game is paused'],
      [{ v, kind: 'pauseResult', outcome: 'resumed', cause: 'all-yes' }, 'The game resumes'],
      [
        { v, kind: 'pauseResult', outcome: 'resumed', cause: 'max-pause' },
        'The pause reached its time limit',
      ],
      [
        {
          v,
          kind: 'pauseResult',
          outcome: 'cancelled',
          cause: 'no-vote',
          proposalKind: 'pause',
          bySide: 'red',
        },
        'The vote to pause was cancelled: Red voted no',
      ],
      [
        {
          v,
          kind: 'pauseResult',
          outcome: 'cancelled',
          cause: 'timeout',
          proposalKind: 'resume',
        },
        'The vote to resume ran out of time',
      ],
    ];
    for (const [m, text] of results) {
      const s = apply(initialState, m);
      expect(s.notices.at(-1)).toMatchObject({ code: 'pause_result' });
      expect(s.notices.at(-1)!.message).toContain(text);
    }
  });

  it('shows the open vote on the desk clock', () => {
    const s = apply(proposed(), {
      v,
      kind: 'clockState',
      clock: {
        gameMsAtAnchor: 0,
        wallMsAtAnchor: 0,
        rate: 4,
        status: 'running',
      },
    });
    expect(clockView(s, 0).vote).toBe('pause');
    expect(
      clockView(apply(s, { v, kind: 'pauseState', phase: 'running' }), 0).vote,
    ).toBeUndefined();
  });
});

describe('PausePanel', () => {
  let cmp: ReturnType<typeof mount> | undefined;
  afterEach(() => {
    if (cmp) unmount(cmp);
    cmp = undefined;
    document.body.innerHTML = '';
    activeView.set('table');
    gameState.set(initialState);
    pauseActions.set(undefined);
  });
  const q = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
  const open = (): void => {
    cmp = mount(Desk, { target: document.body });
    flushSync();
  };
  const actions = () => ({
    proposePause: vi.fn(() => true),
    proposeResume: vi.fn(() => true),
    vote: vi.fn(() => true),
  });

  it('proposes a pause with a reason', () => {
    const a = actions();
    pauseActions.set(a);
    gameState.set(apply(initialState, { v, kind: 'pauseState', phase: 'running' }));
    open();
    expect(q('[data-testid=pause-vote]')).toBeNull();
    q('[data-testid=open-pause]')!.click();
    flushSync();
    const input = q('[data-testid=pause-reason]') as HTMLInputElement;
    input.value = 'someone at the door';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    q('[data-testid=propose-pause]')!.click();
    expect(a.proposePause).toHaveBeenCalledWith('someone at the door');
  });

  it('asks to resume when paused', () => {
    const a = actions();
    pauseActions.set(a);
    gameState.set(apply(initialState, { v, kind: 'pauseState', phase: 'paused' }));
    open();
    q('[data-testid=propose-resume]')!.click();
    expect(a.proposeResume).toHaveBeenCalled();
  });

  it('prompts for a vote, sends it, and shows the wait once voted', () => {
    const a = actions();
    pauseActions.set(a);
    gameState.set(proposed({ reason: 'door' }, Date.now()));
    open();
    expect(q('[data-testid=pause-vote]')!.textContent).toContain('Red asks to pause the game.');
    expect(q('[data-testid=pause-vote]')!.textContent).toContain('door');
    expect(q('[data-testid=clock-vote]')).toBeNull(); // no clock yet
    expect(document.title.startsWith('(vote)')).toBe(true);
    q('[data-testid=vote-no]')!.click();
    expect(a.vote).toHaveBeenCalledWith('p1', false);

    gameState.set(proposed({ myVote: false, no: 1 }, Date.now()));
    flushSync();
    expect(q('[data-testid=vote-yes]')).toBeNull();
    expect(q('[data-testid=pause-voted]')!.textContent).toContain('You voted no.');
    expect(document.title.startsWith('(vote)')).toBe(false);
  });

  it('restores the page title when the desk goes away mid-vote', () => {
    pauseActions.set(actions());
    document.title = 'Kriegsspiel';
    gameState.set(proposed({}, Date.now()));
    open();
    expect(document.title.startsWith('(vote)')).toBe(true);
    unmount(cmp!);
    cmp = undefined;
    expect(document.title).toBe('Kriegsspiel');
  });

  it('says so when the link is down', () => {
    const a = actions();
    a.vote.mockReturnValue(false);
    pauseActions.set(a);
    gameState.set(proposed({}, Date.now()));
    open();
    q('[data-testid=vote-yes]')!.click();
    flushSync();
    expect(q('[role=alert]')!.textContent).toContain('Not connected');
  });
});
