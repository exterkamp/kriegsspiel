import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClockComponent } from './clock.component';
import { GameService } from './game.service';

beforeEach(() => TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] }));

describe('ClockComponent', () => {
  it('shows no clock and the connecting link before the server speaks', async () => {
    const fixture = TestBed.createComponent(ClockComponent);
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('No clock');
    expect(text).toContain('connecting…');
  });

  it('reports the offline link for the fixture board', async () => {
    TestBed.inject(GameService).connect({ protocol: 'http:', host: 'x', search: '' });
    const fixture = TestBed.createComponent(ClockComponent);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('no server (fixture)');
  });

  it('says the connection was lost and offers a retry once it gives up', async () => {
    const game = TestBed.inject(GameService);
    const retry = vi.spyOn(game, 'retry');
    // A socket that never answers, so only the test moves the link.
    vi.stubGlobal(
      'WebSocket',
      class {
        readyState = 0;
        send(): void {}
        close(): void {}
      },
    );
    game.connect({ protocol: 'http:', host: 'x', search: '?game=g1&side=blue' });
    const fixture = TestBed.createComponent(ClockComponent);
    await fixture.whenStable();
    (game as unknown as { _state: { update(f: (s: object) => object): void } })._state.update(
      (s) => ({ ...s, link: 'failed' }),
    );
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Connection lost');
    (el.querySelector('[data-testid="clock-retry"]') as HTMLButtonElement).click();
    expect(retry).toHaveBeenCalled();
    game.disconnect();
    vi.unstubAllGlobals();
  });
});
