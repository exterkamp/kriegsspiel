import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { noteEntry, type JournalEntry } from '@legacy/desk/journal';
import { DeskStore } from '../desk.store';
import { stubGame } from '../testing';
import { JournalComponent } from './journal.component';

const e = (id: string, kind: JournalEntry['kind'], at: number, text: string): JournalEntry => ({
  id,
  kind,
  at,
  text,
});

async function open() {
  stubGame();
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
    expect(noteEntry('x', 0, 'y').kind).toBe('note');
  });

  it('exports as a text download', async () => {
    const { q } = await open();
    let blob: Blob | undefined;
    URL.createObjectURL = ((b: Blob) => ((blob = b), 'blob:x')) as typeof URL.createObjectURL;
    URL.revokeObjectURL = () => undefined;
    const click = HTMLAnchorElement.prototype.click;
    let name = '';
    HTMLAnchorElement.prototype.click = function () {
      name = this.download;
    };
    q<HTMLButtonElement>('#journal-export').click();
    HTMLAnchorElement.prototype.click = click;
    expect(name).toBe('war-diary.txt');
    expect(blob?.type).toContain('text/plain');
  });
});
