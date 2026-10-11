import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
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
});
