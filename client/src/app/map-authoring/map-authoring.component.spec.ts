import { ErrorHandler, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MapAuthoringComponent, matchAppContrast } from './map-authoring.component';

// jsdom has no Canvas2D, so the real authoring app stops at the map preview: these specs check the page frame and
// markup the host owns (#308), and that the start-up failure lands in the header's status line.
const errors: unknown[] = [];
beforeEach(() => {
  errors.length = 0;
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: ErrorHandler, useValue: { handleError: (e: unknown) => errors.push(e) } },
    ],
  });
});
afterEach(() => {
  delete document.documentElement.dataset['contrast'];
  document.body.replaceChildren();
});

async function render() {
  const fixture = TestBed.createComponent(MapAuthoringComponent);
  await fixture.whenStable();
  return fixture.nativeElement as HTMLElement;
}

describe('map authoring page frame (#308)', () => {
  it('wears the shared theme with the tool header, a way back to the menu and one h1', async () => {
    const el = await render();
    expect(el.classList).toContain('ks-theme');
    const back = el.querySelector<HTMLAnchorElement>('ks-tool-header a')!;
    expect(back.getAttribute('href')).toBe('/');
    expect(back.textContent).toContain('Main menu');
    expect([...el.querySelectorAll('h1')].map((h) => h.textContent!.trim())).toEqual([
      'Battlefield authoring',
    ]);
    expect(el.querySelector('ks-menu-link')).toBeNull();
    const status = el.querySelector<HTMLElement>('ks-tool-header #asset-status')!;
    expect(status.classList).toContain('ks-status');
    // The start-up failure is reported in that status line, flagged for the error style.
    expect(errors).toHaveLength(1);
    expect(status.dataset['error']).toBe('true');
    expect(status.textContent).toContain('Canvas2D');
  });

  it('keeps every id the imperative app looks up, labels its controls and has one main landmark', async () => {
    const el = await render();
    for (const id of [
      'asset-status',
      'summary',
      'diagnostics',
      'layers',
      'contrast',
      'position',
      'fit',
      'detail',
      'zoom-in',
      'zoom-out',
      'map',
    ])
      expect(el.querySelector(`#${id}`), id).not.toBeNull();
    expect(el.querySelectorAll('main')).toHaveLength(1);
    expect(el.querySelector('#contrast')!.closest('label.ks-choice')!.textContent!.trim()).toBe(
      'High-contrast map',
    );
    for (const button of el.querySelectorAll('button'))
      expect(button.textContent!.trim() || button.getAttribute('aria-label')).toBeTruthy();
    for (const h2 of el.querySelectorAll('aside h2'))
      expect(h2.classList).toContain('ks-section-h');
  });

  it('keeps the zoom buttons together in one labelled group at the end of the viewport bar (#496)', async () => {
    const el = await render();
    const nav = el.querySelector('nav[aria-label="Viewport controls"]')!;
    const zoom = nav.querySelector<HTMLElement>('.zoom[role="group"]')!;
    expect(zoom.getAttribute('aria-label')).toBe('Zoom');
    expect([...zoom.children].map((c) => c.id)).toEqual(['zoom-out', 'zoom-in']);
    expect(nav.lastElementChild).toBe(zoom);
    expect(nav.querySelector('.spacer')).toBeNull();
  });
});

describe('matchAppContrast', () => {
  function box() {
    document.body.innerHTML = '<input id="contrast" type="checkbox" />';
    const input = document.getElementById('contrast') as HTMLInputElement;
    const changes: boolean[] = [];
    input.addEventListener('change', () => changes.push(input.checked));
    return { input, changes };
  }

  it('leaves the preview alone when the app is not in high contrast', () => {
    const { input, changes } = box();
    document.documentElement.dataset['contrast'] = 'normal';
    matchAppContrast(document);
    expect(input.checked).toBe(false);
    expect(changes).toEqual([]);
  });

  it('switches the preview to high contrast once when the app is', () => {
    const { input, changes } = box();
    document.documentElement.dataset['contrast'] = 'high';
    matchAppContrast(document);
    matchAppContrast(document);
    expect(input.checked).toBe(true);
    expect(changes).toEqual([true]);
  });
});
