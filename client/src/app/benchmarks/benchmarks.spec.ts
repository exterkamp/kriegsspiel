import { ErrorHandler, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MapBenchmarkComponent } from './map-benchmark.component';
import { TableBenchmarkComponent } from './table-benchmark.component';

// jsdom has neither Canvas2D nor WebGL, so the runners stop early: these specs check the page frames the hosts own
// (#308), with the real runner DOM where it is built before the canvas is needed.
beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: ErrorHandler, useValue: { handleError: () => undefined } },
    ],
  });
});

function header(el: HTMLElement) {
  const back = el.querySelector<HTMLAnchorElement>('ks-tool-header a')!;
  return {
    href: back.getAttribute('href'),
    back: back.textContent!.trim(),
    h1: [...el.querySelectorAll('h1')].map((h) => h.textContent!.trim()),
  };
}

describe('benchmark page frames (#308)', () => {
  it('the map benchmark has the tool header over the runner, in the shared theme', async () => {
    const fixture = TestBed.createComponent(MapBenchmarkComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.classList).toContain('ks-theme');
    expect(header(el)).toEqual({ href: '/', back: '← Main menu', h1: ['Map preview benchmark'] });
    expect(el.querySelector('main .benchmark-form #benchmark-run')!.className).toBe('ks-primary');
    expect(el.querySelector('ks-menu-link')).toBeNull();
  });

  it('the table benchmark keeps its full-viewport canvas, with the header and result over it', async () => {
    const fixture = TestBed.createComponent(TableBenchmarkComponent);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.classList).toContain('ks-theme');
    expect(header(el)).toEqual({ href: '/', back: '← Main menu', h1: ['Table benchmark'] });
    expect(el.querySelector('canvas#table')).not.toBeNull();
    const result = el.querySelector('#result')!;
    expect(result.classList).toContain('ks-overlay');
    // Without WebGL the harness cannot start, and the result line says so.
    await vi.waitFor(() => expect(result.textContent).toContain('Benchmark failed'));
  });
});
