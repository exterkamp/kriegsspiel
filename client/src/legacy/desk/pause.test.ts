// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

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

import { PROTOCOL_VERSION, type PauseProposal, type ServerMessage } from '@kriegsspiel/protocol';
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
