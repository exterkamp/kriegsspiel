import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { TableScene } from '@legacy/table/TableScene';
import { DeskStore } from '../desk/desk.store';
import { fakeGame } from '../desk/fake-game';
import { MarksService } from '../game/marks.service';
import { TableService } from '../game/table.service';
import { HudComponent } from './hud.component';
import { MarksBarComponent } from './marks-bar.component';
import { SideSwitchComponent } from './side-switch.component';

function configure(state = {}) {
  const g = fakeGame(state);
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), { provide: g.provide, useValue: g.fake }],
  });
  return g;
}

describe('HudComponent', () => {
  it('snaps the camera and shows the last pick', async () => {
    configure();
    const table = TestBed.inject(TableService);
    const scene = { snapTopDown: vi.fn(), snapOblique: vi.fn() };
    table.scene.set(scene as unknown as TableScene);
    const f = TestBed.createComponent(HudComponent);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('#pick')?.textContent).toBe('Click the map');
    el.querySelector<HTMLButtonElement>('#top')!.click();
    el.querySelector<HTMLButtonElement>('#obl')!.click();
    expect(scene.snapTopDown).toHaveBeenCalled();
    expect(scene.snapOblique).toHaveBeenCalled();
    table.status.set('hello');
    await f.whenStable();
    expect(el.querySelector('#pick')?.textContent).toBe('hello');
  });

  it('keeps the game over status hidden until the game ends', async () => {
    const g = configure();
    const f = TestBed.createComponent(HudComponent);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector<HTMLElement>('#gameover')!.hidden).toBe(true);
    g.fake.set({ gameOver: { winner: 'blue', reason: 'eliminated', atGame: 0 } });
    await f.whenStable();
    expect(el.querySelector<HTMLElement>('#gameover')!.hidden).toBe(false);
    expect(el.querySelector('#gameover')?.textContent).toMatch(/eliminated/);
  });
});

describe('MarksBarComponent', () => {
  const open = async () => {
    configure();
    const f = TestBed.createComponent(MarksBarComponent);
    await f.whenStable();
    const el = f.nativeElement as HTMLElement;
    return { f, el, marks: TestBed.inject(MarksService) };
  };

  it('starts collapsed at a narrow width and the Tools button opens it', async () => {
    const { f, el } = await open();
    const toggle = el.querySelector<HTMLButtonElement>('#marks-toggle')!;
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    expect(el.querySelector<HTMLElement>('#marks-body')!.hidden).toBe(!expanded);
    toggle.click();
    await f.whenStable();
    expect(toggle.getAttribute('aria-expanded')).toBe(String(!expanded));
  });

  it('presses one tool at a time and sets the service tool', async () => {
    const { f, el, marks } = await open();
    const btn = (t: string) => el.querySelector<HTMLButtonElement>(`[data-tool=${t}]`)!;
    expect(btn('view').getAttribute('aria-pressed')).toBe('true');
    btn('arrow').click();
    await f.whenStable();
    expect(marks.tool()).toBe('arrow');
    expect(btn('arrow').getAttribute('aria-pressed')).toBe('true');
    expect(btn('view').getAttribute('aria-pressed')).toBe('false');
  });

  it('enables Delete and Plot only when they can act', async () => {
    const { f, el, marks } = await open();
    const del = el.querySelector<HTMLButtonElement>('#mark-delete')!;
    expect(del.disabled).toBe(true);
    expect(el.querySelector<HTMLButtonElement>('#mark-plot')!.disabled).toBe(true);
    marks.selectedId.set('m1');
    await f.whenStable();
    expect(del.disabled).toBe(false);
  });

  it('keeps the note and the overlay toggles in the service', async () => {
    const { f, el, marks } = await open();
    const note = el.querySelector<HTMLInputElement>('#mark-label')!;
    note.value = 'hill';
    note.dispatchEvent(new Event('input'));
    expect(marks.label()).toBe('hill');
    const cb = el.querySelector<HTMLInputElement>('[data-overlay=routes]')!;
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    await f.whenStable();
    expect(marks.overlays()).toMatchObject({ routes: false, orders: true });
  });

  it('is hidden while a desk view or the umpire window is showing', async () => {
    const { f, el, marks } = await open();
    const section = el.querySelector<HTMLElement>('#marks')!;
    expect(section.hidden).toBe(false);
    TestBed.inject(DeskStore).activeView.set('journal');
    await f.whenStable();
    expect(section.hidden).toBe(true);
    expect(marks.deskOpen()).toBe(true);
  });
});

describe('SideSwitchComponent', () => {
  it('offers the other side and loads the page seated there', async () => {
    configure();
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    const f = TestBed.createComponent(SideSwitchComponent);
    f.componentRef.setInput('game', 'g 1');
    f.componentRef.setInput('sides', ['blue', 'red']);
    f.componentRef.setInput('current', 'blue');
    await f.whenStable();
    const [a, b] = [...(f.nativeElement as HTMLElement).querySelectorAll('button')];
    expect(a!.textContent?.trim()).toBe('Playing blue');
    expect(a!.disabled).toBe(true);
    expect(b!.textContent?.trim()).toBe('Switch to red');
    b!.click();
    expect(assign).toHaveBeenCalledWith('/?game=g%201&side=red');
    vi.unstubAllGlobals();
  });
});
