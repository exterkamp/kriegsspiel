import { provideZonelessChangeDetection, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import type { Dispatch } from '@kriegsspiel/protocol';
import { fixtureView } from '@legacy/table/fixture';
import type { GameOver } from '@legacy/net/state';
import { DeskComponent } from './desk/desk.component';
import { DeskStore } from './desk/desk.store';
import { fakeGame } from './desk/fake-game';
import { FlatBoardComponent } from './game/flat-board.component';
import { StyleGuideComponent } from './style-guide/style-guide.component';
import { setHighContrast } from './ui/contrast';

/**
 * Automated accessibility check (#59): axe-core over the desk views, the game-over dialog, the flat map board and the
 * style guide, in the normal and the high-contrast variants. jsdom has no layout, so axe's colour-contrast rule cannot
 * run here; text contrast is checked from the tokens in `styles/design-system.test.ts`.
 */
const dispatches: Dispatch[] = [
  {
    id: 'd1',
    from: 'Lt. Marsh',
    writtenAtGame: 60_000,
    receivedAtGame: 120_000,
    category: 'scouts',
    text: 'Enemy infantry seen near the bridge.',
  },
];
const over: GameOver = { winner: 'blue', reason: 'eliminated', atGame: 60_000 };

async function audit(name: string, el: HTMLElement) {
  const r = await axe.run(el, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  const bad = r.violations.map(
    (v) => `${name}: ${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
  );
  expect(bad).toEqual([]);
}

async function mount<T>(cmp: Type<T>, state: Parameters<typeof fakeGame>[0] = {}, gameId = 'g1') {
  const g = fakeGame({ view: fixtureView, dispatches, ...state }, gameId);
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), { provide: g.provide, useValue: g.fake }],
  });
  const f = TestBed.createComponent(cmp);
  document.body.append(f.nativeElement);
  await f.whenStable();
  return { f, el: f.nativeElement as HTMLElement, desk: TestBed.inject(DeskStore) };
}

afterEach(() => {
  setHighContrast(false);
  document.body.replaceChildren();
});

for (const high of [false, true]) {
  describe(`axe, ${high ? 'high contrast' : 'normal'}`, () => {
    const views = ['inTray', 'orders', 'roster', 'journal', 'conference'] as const;
    for (const view of views) {
      it(`the ${view} view has no violations`, async () => {
        setHighContrast(high);
        const { f, el, desk } = await mount(DeskComponent);
        desk.activeView.set(view);
        await f.whenStable();
        await audit(view, el);
      });
    }

    it('the game-over dialog has no violations', async () => {
      setHighContrast(high);
      const { el } = await mount(DeskComponent, { gameOver: over });
      await audit('game over', el);
    });

    it('the flat board has no violations', async () => {
      setHighContrast(high);
      const { el } = await mount(FlatBoardComponent);
      await audit('flat board', el);
    });

    it('the style guide has no violations', async () => {
      setHighContrast(high);
      const { el } = await mount(StyleGuideComponent);
      await audit('style guide', el);
    });
  });
}

describe('screen reader support', () => {
  it('announces a dispatch that arrives, but not the ones already there', async () => {
    const g = fakeGame({ view: fixtureView, dispatches }, 'g1');
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), { provide: g.provide, useValue: g.fake }],
    });
    const f = TestBed.createComponent(DeskComponent);
    document.body.append(f.nativeElement);
    await f.whenStable();
    const say = () => f.nativeElement.querySelector('[data-testid=announcer]').textContent.trim();
    expect(say()).toBe('');
    g.fake.set({
      dispatches: [...dispatches, { ...dispatches[0]!, id: 'd2', from: 'Capt. Hale' }],
    });
    await f.whenStable();
    expect(say()).toBe('New dispatch from Capt. Hale.');
  });

  it('describes the flat board in text', async () => {
    const { el } = await mount(FlatBoardComponent);
    const items = [...el.querySelectorAll('#board-summary li')].map((l) => l.textContent);
    expect(items.some((t) => t?.startsWith('Your unit'))).toBe(true);
    expect(el.querySelector('svg')?.getAttribute('aria-describedby')).toBe('board-summary');
  });

  it('keeps Tab inside the game-over dialog', async () => {
    const { el } = await mount(DeskComponent, { gameOver: over });
    const buttons = [...el.querySelectorAll<HTMLButtonElement>('[role=dialog] button')].filter(
      (b) => !b.disabled,
    );
    buttons.at(-1)!.focus();
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    buttons.at(-1)!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);
  });
});
