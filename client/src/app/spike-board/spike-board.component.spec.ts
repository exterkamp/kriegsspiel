import { describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { SpikeBoardComponent } from './spike-board.component';

async function open(url: string) {
  TestBed.configureTestingModule({ providers: [provideRouter([{ path: '**', children: [] }])] });
  await TestBed.inject(Router).navigateByUrl(url);
  const f = TestBed.createComponent(SpikeBoardComponent);
  f.detectChanges();
  await f.whenStable();
  return { f, el: f.nativeElement as HTMLElement };
}

const click = (el: Element | null) =>
  (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));

describe('SpikeBoardComponent', () => {
  it('plays the turns asked for in the URL and shows trails, contact and enemies', async () => {
    const { el } = await open('/spike/board?turn=2');
    expect(el.querySelector('[data-testid=turn-label]')?.textContent).toContain('Turn 2');
    expect(el.querySelectorAll('.trail.enemy').length).toBeGreaterThan(0);
    expect(el.querySelectorAll('g.contact').length).toBe(1);
    expect(el.querySelectorAll('.counter.enemy.seen').length).toBeGreaterThan(0);
    expect(el.querySelectorAll('.counter.enemy.stale').length).toBeGreaterThan(0);
    expect(el.querySelector('[data-testid=report]')?.textContent).toContain(
      '1st Battalion is in action.',
    );
  });

  it('opens a unit by clicking it on the table and holds an order for the next turn', async () => {
    const { f, el } = await open('/spike/board?turn=1');
    click(el.querySelector('[data-unit=b2]'));
    f.detectChanges();
    expect(el.querySelector('[data-testid=unit-panel] h2')?.textContent).toContain('2nd Battalion');
    click(el.querySelector('[data-verb=hold]'));
    f.detectChanges();
    expect(el.textContent).toContain('{"verb":"hold"}');
    click(el.querySelector('[data-testid=give-order]'));
    f.detectChanges();
    expect(el.textContent).toContain('Held for next turn: Hold');
    expect(el.querySelector('[data-testid=end-turn]')?.textContent).toContain('(1 new)');
    click(el.querySelector('[data-testid=end-turn]'));
    f.detectChanges();
    expect(el.querySelector('[data-testid=turn-label]')?.textContent).toContain('Turn 2');
  });

  it('shows the current look when asked, for comparison', async () => {
    const { el } = await open('/spike/board?turn=2&pieces=labels&enemy=ghost&trails=off');
    expect(el.querySelectorAll('.counter').length).toBe(0);
    expect(el.querySelectorAll('.old-piece.ghost').length).toBeGreaterThan(0);
    expect(el.querySelectorAll('.trail').length).toBe(0);
  });
});
