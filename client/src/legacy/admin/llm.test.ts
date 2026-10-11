// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  COLLAPSE_OVER,
  LlmPanel,
  formatCost,
  matchesFilter,
  toLlmCall,
  totalsOf,
  type TraceEntryLike,
} from './llm.js';

const entry = (seq: number, data: Record<string, unknown>, kind = 'llm'): TraceEntryLike => ({
  seq,
  ts: 1_700_000_000_000 + seq,
  kind,
  data,
});

const judge = entry(1, {
  stage: 'judge',
  provider: 'anthropic',
  model: 'm1',
  mode: 'live',
  latencyMs: 1500,
  usage: { inputTokens: 100, outputTokens: 20 },
  costUsd: 0.01,
  retries: 1,
  ok: true,
  system: 'You are the umpire',
  input: { q: 1 },
  schema: { type: 'object' },
  response: '{"a":1}',
  output: { a: 1 },
});
const failed = entry(2, {
  stage: 'parse',
  provider: 'mock',
  mode: 'playback',
  usage: { inputTokens: 5, outputTokens: 0 },
  costUsd: null,
  retries: 0,
  ok: false,
  errorKind: 'timeout',
  error: { name: 'UmpireError', message: 'timed out' },
});

describe('llm model', () => {
  it('ignores non-LLM entries and reads tokens, cost and errors', () => {
    expect(toLlmCall(entry(3, {}, 'engine'))).toBeUndefined();
    expect(toLlmCall(failed)).toMatchObject({ ok: false, error: 'timed out', costUsd: null });
  });
  it('totals tokens, cost, retries and errors', () => {
    const t = totalsOf([toLlmCall(judge)!, toLlmCall(failed)!]);
    expect(t).toEqual({
      calls: 2,
      inputTokens: 105,
      outputTokens: 20,
      costUsd: 0.01,
      unpriced: 1,
      retries: 1,
      errors: 1,
    });
    expect(formatCost(0.01)).toBe('$0.0100');
    expect(formatCost(null)).toBe('n/a');
  });
  it('filters on headline fields', () => {
    const c = toLlmCall(failed)!;
    expect(matchesFilter(c, 'TIMEOUT')).toBe(true);
    expect(matchesFilter(c, 'anthropic')).toBe(false);
    expect(matchesFilter(c, '')).toBe(true);
  });
});

describe('LlmPanel', () => {
  function mount() {
    document.body.innerHTML = '<section id="p"></section>';
    return new LlmPanel(document.getElementById('p')!);
  }

  it('lists calls with totals, badges and de-duplicates by seq', () => {
    const p = mount();
    p.add(judge);
    p.add(judge);
    p.add(failed);
    p.add(entry(9, {}, 'clock'));
    expect(document.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(document.querySelector('.llm-totals')!.textContent).toContain('2 calls');
    expect([...document.querySelectorAll('.badge')].map((b) => b.textContent)).toEqual([
      'live',
      'playback',
    ]);
    p.setFilter('judge');
    expect(document.querySelectorAll('tbody tr')).toHaveLength(1);
    p.reset();
    expect(document.querySelector('.empty')!.textContent).toBe('No LLM calls yet.');
  });

  it('shows the full prompt, schema, response and parsed result on selection', () => {
    const p = mount();
    p.add(judge);
    document.querySelector<HTMLElement>('tbody tr')!.click();
    const text = document.querySelector('.llm-detail')!.textContent!;
    for (const part of ['You are the umpire', '"type": "object"', '{"a":1}', 'parsed result']) {
      expect(text).toContain(part);
    }
  });

  it('collapses long text, copies it, and renders values as text not HTML', () => {
    const p = mount();
    const long = 'x'.repeat(COLLAPSE_OVER + 1);
    p.add(entry(5, { stage: 'narrate', system: long, input: '<img src=x onerror=alert(1)>' }));
    p.select(5);
    const [sys, input] = [...document.querySelectorAll<HTMLDetailsElement>('details')];
    expect(sys!.open).toBe(false);
    expect(input!.open).toBe(true);
    expect(document.querySelector('.llm-detail img')).toBeNull();
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    sys!.querySelector('button')!.click();
    expect(writeText).toHaveBeenCalledWith(long);
  });

  it('keeps the detail view (open sections) when live entries arrive or the filter changes', () => {
    const p = mount();
    const long = 'x'.repeat(COLLAPSE_OVER + 1);
    p.add(entry(5, { stage: 'narrate', system: long }));
    p.select(5);
    const detail = document.querySelector('.llm-detail')!;
    const sys = detail.querySelector('details')!;
    sys.open = true;
    const before = detail.firstElementChild;
    p.add(judge);
    p.setFilter('narrate');
    expect(detail.querySelector('details')).toBe(sys);
    expect(detail.firstElementChild).toBe(before);
    expect(sys.open).toBe(true);
    p.select(1);
    expect(detail.querySelector('details')).not.toBe(sys);
  });

  it('selects a row from the keyboard', () => {
    const p = mount();
    p.add(judge);
    const row = document.querySelector<HTMLElement>('tbody tr')!;
    expect(row.tabIndex).toBe(0);
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(document.querySelector('.llm-detail')!.textContent).toContain('You are the umpire');
  });
});
