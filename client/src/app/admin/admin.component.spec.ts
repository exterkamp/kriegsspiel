import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlSerializer } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminPage } from '@legacy/admin/admin';
import { routes } from '../app.routes';
import { TrailingSlashUrlSerializer } from '../trailing-slash';

beforeEach(() => {
  // The admin page polls `/admin/api`; answer 401 so it settles without a server.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 401 })),
  );
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter(routes),
      { provide: UrlSerializer, useClass: TrailingSlashUrlSerializer },
    ],
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('admin route', () => {
  it.each(['/admin', '/admin/'])('%s hosts the existing AdminPage', async (url) => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    await harness.fixture.whenStable();
    const el = harness.fixture.nativeElement as HTMLElement;
    await vi.waitFor(() => expect(el.querySelector('h1')?.textContent).toBe('kriegsspiel admin'));
    expect(el.querySelector('[role="tablist"]')).not.toBeNull();
    expect(TestBed.inject(Router).url).toBe('/admin');
  });

  it('shows a persistent banner only when the server says admin is open', async () => {
    const answer = (admin?: string) =>
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) =>
          url === '/scenarios'
            ? new Response(JSON.stringify({ scenarios: [], ...(admin ? { admin } : {}) }))
            : new Response('{}', { status: 401 }),
        ),
      );
    answer('open');
    let harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/');
    const el = harness.fixture.nativeElement as HTMLElement;
    await vi.waitFor(() => {
      harness.fixture.detectChanges();
      expect(el.querySelector('.open-banner')?.textContent).toContain(
        'anyone who can reach this port can read all hidden game state and LLM prompts',
      );
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter(routes),
        { provide: UrlSerializer, useClass: TrailingSlashUrlSerializer },
      ],
    });
    answer('token');
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin/');
    await harness.fixture.whenStable();
    await new Promise((r) => setTimeout(r, 20));
    harness.fixture.detectChanges();
    expect((harness.fixture.nativeElement as HTMLElement).querySelector('.open-banner')).toBeNull();
  });

  it('stops the page when the route is left', async () => {
    const stop = vi.spyOn(AdminPage.prototype, 'stop');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/admin');
    await harness.fixture.whenStable();
    expect(stop).not.toHaveBeenCalled();
    await harness.navigateByUrl('/map-benchmark.html');
    expect(TestBed.inject(Router).url).toBe('/map-benchmark');
    expect(document.querySelector('ks-admin')).toBeNull();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
