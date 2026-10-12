import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { routes } from './app.routes';
import { TrailingSlashUrlSerializer } from './trailing-slash';

describe('routes', () => {
  it.each([
    ['/map-authoring.html', '/map-authoring'],
    ['/map-benchmark.html', '/map-benchmark'],
    ['/table-benchmark.html', '/table-benchmark'],
  ])('redirects the old page %s to %s', async (from, to) => {
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), provideRouter(routes)],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl(from);
    expect(router.url).toBe(to);
  });

  it.each(['/map-authoring', '/map-benchmark', '/table-benchmark', '/admin/'])(
    'has a route for the menu link %s',
    async (url) => {
      TestBed.configureTestingModule({
        providers: [provideZonelessChangeDetection(), provideRouter(routes)],
      });
      const router = TestBed.inject(Router);
      await router.navigateByUrl(url.replace(/\/$/, ''));
      expect(router.url).toBe(url.replace(/\/$/, ''));
    },
  );

  it('keeps /admin/api out of the app routes', () => {
    expect(routes.some((r) => r.path === 'admin' && !r.children)).toBe(true);
    expect(routes.some((r) => r.path?.startsWith('admin/'))).toBe(false);
  });
});

describe('TrailingSlashUrlSerializer', () => {
  const serializer = new TrailingSlashUrlSerializer();
  it.each([
    ['/admin/', '/admin'],
    ['/admin', '/admin'],
    ['/admin/?token=x', '/admin?token=x'],
    ['/', '/'],
  ])('parses %s as %s', (input, output) => {
    expect(serializer.serialize(serializer.parse(input))).toBe(output);
  });
});
