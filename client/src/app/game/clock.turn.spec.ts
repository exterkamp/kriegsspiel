import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { initialState, withTurnSettings, type ClientState } from '@legacy/net/state';
import { stubGame } from '../desk/testing';
import { ClockComponent } from './clock.component';

/** A turn game reloaded after its end: a stopped clock and the outcome, but no turnState (#429). */
const over: ClientState = {
  ...initialState,
  link: 'open',
  clock: { gameMs: 2_400_000, localWallMs: 0, rate: 1, status: 'stopped' },
  gameOver: { winner: 'red', reason: 'objective-taken', atGame: 2_400_000 },
};

async function render(state: ClientState): Promise<HTMLElement> {
  stubGame(state);
  const fixture = TestBed.createComponent(ClockComponent);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('ClockComponent after a turn game ends (#429)', () => {
  it('shows the game over with its turn length, not a rate', async () => {
    const el = await render(
      withTurnSettings(over, { dial: 'rigid', persona: 'dry', mode: 'turns', turnMinutes: 20 }),
    );
    expect(el.querySelector('.time')?.textContent).toBe('Day 1 00:40');
    expect(el.querySelector('[data-testid="clock-rate"]')?.textContent).toBe('20-min turns');
    expect(el.querySelector('[data-testid="clock-status"]')?.textContent?.trim()).toBe('Game over');
    expect(el.textContent).not.toContain('1:1');
    expect(el.textContent).not.toContain('⏹');
  });

  it('keeps the rate and Stopped for a finished real-time game', async () => {
    const el = await render(withTurnSettings(over, { dial: 'standard', persona: 'dry' }));
    expect(el.querySelector('[data-testid="clock-rate"]')?.textContent).toBe('1:1');
    expect(el.querySelector('[data-testid="clock-status"]')?.textContent).toContain('Stopped');
  });
});
