import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestUmpireBadgeComponent } from './test-umpire-badge.component';

beforeEach(() => TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] }));
afterEach(() => vi.unstubAllGlobals());

async function render(reply: () => Promise<unknown>): Promise<string> {
  vi.stubGlobal('fetch', reply);
  const fixture = TestBed.createComponent(TestUmpireBadgeComponent);
  await fixture.whenStable();
  await fixture.componentInstance.ngOnInit();
  await fixture.whenStable();
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

const json = (body: unknown) => async () => ({ ok: true, json: async () => body });

describe('TestUmpireBadgeComponent', () => {
  it('says so when the server runs the test umpire', async () => {
    expect(await render(json({ scenarios: [], umpire: 'test' }))).toContain(
      'Test umpire (canned responses)',
    );
  });

  it('shows nothing for a real umpire, or when the server cannot be read', async () => {
    expect(await render(json({ scenarios: [] }))).not.toContain('Test umpire');
    expect(
      await render(async () => {
        throw new Error('offline');
      }),
    ).not.toContain('Test umpire');
  });
});
