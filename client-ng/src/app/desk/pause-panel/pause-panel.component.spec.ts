import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, type PauseProposal, type ServerMessage } from '@kriegsspiel/protocol';
import { applyServerMessage, initialState, type ClientState } from '@legacy/net/state';
import { PAUSE_ACTIONS } from '../../game/ports';
import { stubGame } from '../testing';
import { PausePanelComponent } from './pause-panel.component';

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
const proposed = (over: Partial<PauseProposal> = {}, at = Date.now()): ClientState =>
  apply(
    initialState,
    { v, kind: 'pauseState', phase: 'pause_proposed', proposal: proposal(over) },
    at,
  );

function open(state: ClientState, ok = true) {
  const game = stubGame(state);
  const a = {
    proposePause: vi.fn(() => ok),
    proposeResume: vi.fn(() => ok),
    vote: vi.fn(() => ok),
  };
  TestBed.overrideProvider(PAUSE_ACTIONS, { useValue: a });
  const f = TestBed.createComponent(PausePanelComponent);
  const el = f.nativeElement as HTMLElement;
  const q = (sel: string): HTMLElement | null => el.querySelector<HTMLElement>(sel);
  return { f, el, q, a, game };
}

describe('PausePanelComponent', () => {
  it('proposes a pause with a reason', async () => {
    const { f, q, a } = open(apply(initialState, { v, kind: 'pauseState', phase: 'running' }));
    await f.whenStable();
    expect(q('[data-testid=pause-vote]')).toBeNull();
    q('[data-testid=open-pause]')!.click();
    await f.whenStable();
    const input = q('[data-testid=pause-reason]') as HTMLInputElement;
    input.value = 'someone at the door';
    input.dispatchEvent(new Event('input'));
    q('[data-testid=propose-pause]')!.click();
    await f.whenStable();
    expect(a.proposePause).toHaveBeenCalledWith('someone at the door');
    expect(q('[data-testid=pause-reason]')).toBeNull();
  });

  it('asks to resume when paused', async () => {
    const { f, q, a } = open(apply(initialState, { v, kind: 'pauseState', phase: 'paused' }));
    await f.whenStable();
    q('[data-testid=propose-resume]')!.click();
    expect(a.proposeResume).toHaveBeenCalled();
  });

  it('prompts for a vote, sends it, and shows the wait once voted', async () => {
    const { f, q, a, game } = open(proposed({ reason: 'door' }));
    await f.whenStable();
    const box = q('[data-testid=pause-vote]')!;
    expect(box.textContent).toContain('Red asks to pause the game.');
    expect(box.textContent).toContain('door');
    expect(q('[data-testid=pause-countdown]')!.textContent).toMatch(/\ds left/);
    expect(document.title.startsWith('(vote)')).toBe(true);
    q('[data-testid=vote-no]')!.click();
    expect(a.vote).toHaveBeenCalledWith('p1', false);

    game.set(proposed({ myVote: false, no: 1 }));
    await f.whenStable();
    expect(q('[data-testid=vote-yes]')).toBeNull();
    expect(q('[data-testid=pause-voted]')!.textContent).toContain('You voted no.');
    expect(document.title.startsWith('(vote)')).toBe(false);
  });

  it('counts down on the timer signal', async () => {
    vi.useFakeTimers();
    try {
      const { f, q } = open(proposed({ msLeft: 30_000 }, Date.now()));
      f.detectChanges();
      const before = q('[data-testid=pause-countdown]')!.textContent;
      vi.advanceTimersByTime(10_000);
      f.detectChanges();
      expect(q('[data-testid=pause-countdown]')!.textContent).not.toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores the page title when the panel goes away mid-vote', async () => {
    document.title = 'Kriegsspiel';
    const { f } = open(proposed());
    await f.whenStable();
    expect(document.title.startsWith('(vote)')).toBe(true);
    f.destroy();
    expect(document.title).toBe('Kriegsspiel');
  });

  it('says so when the link is down', async () => {
    const { f, q } = open(proposed(), false);
    await f.whenStable();
    q('[data-testid=vote-yes]')!.click();
    await f.whenStable();
    expect(q('[role=alert]')!.textContent).toContain('Not connected');
  });
});
