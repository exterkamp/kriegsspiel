import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialState } from '@legacy/net/state';
import { type JournalEntry } from '@legacy/desk/journal';
import { DeskStore } from '../desk.store';
import { stubGame } from '../testing';
import { JournalComponent } from './journal.component';

const e = (id: string, kind: JournalEntry['kind'], at: number, text: string): JournalEntry => ({
  id,
  kind,
  at,
  text,
});

async function open(state = initialState) {
  stubGame(state);
  const desk = TestBed.inject(DeskStore);
  desk.journal.set([
    e('order:o1', 'order', 0, 'Order sent: Advance'),
    e('dispatch:d1', 'dispatch', 60_000, 'Scout: bridge held'),
  ]);
  const f = TestBed.createComponent(JournalComponent);
  await f.whenStable();
  const el = f.nativeElement as HTMLElement;
  const q = <T extends HTMLElement>(s: string): T => el.querySelector<T>(s)!;
  const items = () => el.querySelectorAll('li');
  return { f, desk, el, q, items };
}

describe('JournalComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('lists entries and says when there are none', async () => {
    const { items, desk, f, el } = await open();
    expect(items()).toHaveLength(2);
    desk.journal.set([]);
    await f.whenStable();
    expect(el.textContent).toContain('Nothing recorded yet.');
  });

  it('searches', async () => {
    const { q, items, f, el } = await open();
    const s = q<HTMLInputElement>('#journal-search');
    s.value = 'bridge';
    s.dispatchEvent(new Event('input'));
    await f.whenStable();
    expect(items()).toHaveLength(1);
    s.value = 'zzz';
    s.dispatchEvent(new Event('input'));
    await f.whenStable();
    expect(el.textContent).toContain('No entries match.');
  });

  it('filters by kind and toggles back', async () => {
    const { el, items, f } = await open();
    const orders = [...el.querySelectorAll<HTMLButtonElement>('.tools button')].find(
      (b) => b.textContent?.trim() === 'Orders',
    )!;
    orders.click();
    await f.whenStable();
    expect(items()).toHaveLength(1);
    expect(items()[0]!.dataset['kind']).toBe('order');
    expect(orders.getAttribute('aria-pressed')).toBe('true');
    orders.click();
    await f.whenStable();
    expect(items()).toHaveLength(2);
    expect(orders.getAttribute('aria-pressed')).toBe('false');
  });

  it('adds a note, and ignores a blank one', async () => {
    const { q, f, el, desk } = await open();
    expect(q<HTMLButtonElement>('#journal-add').disabled).toBe(true);
    const ta = q<HTMLTextAreaElement>('#journal-note');
    ta.value = 'Check the ford';
    ta.dispatchEvent(new Event('input'));
    await f.whenStable();
    q<HTMLButtonElement>('#journal-add').click();
    await f.whenStable();
    expect(el.textContent).toContain('Check the ford');
    expect(desk.journal().some((j) => j.kind === 'note')).toBe(true);
    expect(ta.value).toBe('');
  });

  it('shows the delivery progress of an order still riding', async () => {
    const pending = (etaGame?: number) => ({
      ...initialState,
      pending: [
        {
          orderId: 'o1',
          text: 'Advance',
          sentAtGame: 0,
          toName: 'Guards',
          courier: 'safe' as const,
          ...(etaGame === undefined ? {} : { etaGame }),
        },
      ],
    });
    const riding = await open(pending(600_000));
    const order = riding.el.querySelector('li[data-kind=order]')!;
    expect(order.querySelector('progress')).not.toBeNull();
    expect(order.textContent).toContain('Courier riding, expected Day 1 00:10');
    expect(riding.el.querySelector('li[data-kind=dispatch] progress')).toBeNull();
    TestBed.resetTestingModule();

    const unknown = await open(pending());
    const noEta = unknown.el.querySelector('li[data-kind=order]')!;
    expect(noEta.querySelector('progress')).toBeNull();
    expect(noEta.textContent).toContain('awaiting word');
  });

  it('re-reads delivery against game time on a timer', () => {
    vi.useFakeTimers();
    try {
      stubGame({
        ...initialState,
        clock: { gameMs: 0, localWallMs: Date.now(), rate: 12, status: 'running' },
        pending: [{ orderId: 'o1', text: 'Advance', sentAtGame: 0, etaGame: 600_000 }],
      });
      TestBed.inject(DeskStore).journal.set([e('order:o1', 'order', 0, 'Order sent: Advance')]);
      const f = TestBed.createComponent(JournalComponent);
      f.detectChanges();
      const el = f.nativeElement as HTMLElement;
      expect(el.textContent).toContain('Courier riding');
      // 1 wall minute at 12:1 is 12 game minutes, past the 10 minute estimate.
      vi.advanceTimersByTime(60_000);
      f.detectChanges();
      expect(el.textContent).toContain('Should have arrived by');
    } finally {
      vi.useRealTimers();
    }
  });

  it('exports as a text download', async () => {
    const { q } = await open();
    let blob: Blob | undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => ((blob = b as Blob), 'blob:x'));
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    let name = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      name = this.download;
    });
    q<HTMLButtonElement>('#journal-export').click();
    expect(name).toBe('war-diary.txt');
    expect(blob?.type).toContain('text/plain');
  });
});
