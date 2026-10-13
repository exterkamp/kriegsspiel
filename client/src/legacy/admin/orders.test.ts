// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OrdersPanel,
  buildDryRun,
  matchesOrderFilter,
  signerLabel,
  type OrderAttempt,
  type PlaygroundForm,
} from './orders.js';

const attempt = (over: Partial<OrderAttempt> = {}): OrderAttempt => ({
  key: 'log-3',
  seq: 3,
  wallMs: 1000,
  gameMs: 65_000,
  side: 'blue',
  text: 'Hold the bridge',
  outcome: 'intents',
  answeredBy: 'canned',
  fallbacks: ['parse: unit "x" is not one of the side\'s units'],
  correlationId: 'c-1',
  llmCalls: 2,
  summary: 'blue-1: hold',
  ...over,
});

const form = (over: Partial<PlaygroundForm> = {}): PlaygroundForm => ({
  side: 'blue',
  text: 'Advance',
  context: '',
  prompts: { parse: 'P', interpret: 'I' },
  defaults: { parse: 'P', interpret: 'I' },
  provider: '',
  model: '',
  temperature: '',
  maxTokens: '',
  numCtx: '',
  interpret: true,
  ...over,
});

const json = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body }) as never;

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('helpers', () => {
  it('filters on the text, outcome, source and fallback reasons', () => {
    expect(matchesOrderFilter(attempt(), 'bridge')).toBe(true);
    expect(matchesOrderFilter(attempt(), 'CANNED')).toBe(true);
    expect(matchesOrderFilter(attempt(), 'not one of')).toBe(true);
    expect(matchesOrderFilter(attempt(), 'ford')).toBe(false);
  });

  it('labels a seat', () => {
    expect(signerLabel({ role: 'brigade', unitId: 'blue-1' })).toBe('brigade blue-1');
    expect(signerLabel(undefined)).toBe('');
  });

  it('sends only edited prompts and set route fields', () => {
    expect(buildDryRun(form())).toEqual({
      body: { side: 'blue', text: 'Advance', interpret: true },
    });
    const r = buildDryRun(
      form({
        prompts: { parse: 'EDITED', interpret: 'I' },
        provider: 'ollama',
        model: 'qwen2.5:1.5b',
        temperature: '0.2',
        numCtx: '8192',
        interpret: false,
        context: '{"units":[],"map":{"features":[]}}',
      }),
    );
    expect(r).toEqual({
      body: {
        side: 'blue',
        text: 'Advance',
        interpret: false,
        prompts: { parse: 'EDITED' },
        route: { provider: 'ollama', model: 'qwen2.5:1.5b', temperature: 0.2, numCtx: 8192 },
        context: { units: [], map: { features: [] } },
      },
    });
    expect(buildDryRun(form({ text: ' ' }))).toEqual({ error: 'Write an order to try.' });
    expect(buildDryRun(form({ context: '{' }))).toEqual({
      error: 'The context is not valid JSON.',
    });
  });
});

describe('OrdersPanel', () => {
  const detail = {
    ...attempt(),
    result: { kind: 'intents', unitId: 'blue-1', intents: [{ kind: 'hold' }] },
    calls: [
      {
        seq: 9,
        ts: 1,
        kind: 'llm',
        correlationId: 'c-1',
        data: {
          stage: 'parse',
          provider: 'ollama',
          model: 'qwen',
          mode: 'live',
          promptVersion: 'parse-orders-v1',
          system: 'SYSTEM <b>not html</b>',
          input: { order: 'Hold the bridge' },
          schema: { type: 'object' },
          response: '{"result":"intents","unitId":"x"}',
          ok: true,
        },
      },
    ],
    notes: [],
    chain: [{ seq: 8, ts: 1, kind: 'command', correlationId: 'c-1', data: {} }],
  };

  function mount(fetchFn: ReturnType<typeof vi.fn>) {
    document.body.innerHTML = '<section></section>';
    const root = document.querySelector('section')!;
    return { root, panel: new OrdersPanel(root, () => 'tok', fetchFn as unknown as typeof fetch) };
  }

  it('lists attempts and shows the detail of one as text', async () => {
    const fetchFn = vi.fn((url: string) => {
      if (url.startsWith('/admin/api/games/g1/orders/log-3')) return json(detail);
      if (url.startsWith('/admin/api/games/g1/orders-context'))
        return json({ side: 'blue', units: [] });
      return json({
        attempts: [attempt(), attempt({ key: 'log-1', text: 'Advance', fallbacks: [] })],
      });
    });
    const { root, panel } = mount(fetchFn);
    await panel.setGame('g1');
    expect(fetchFn).toHaveBeenCalledWith('/admin/api/games/g1/orders?token=tok');
    const rows = [...root.querySelectorAll<HTMLElement>('tbody tr')];
    expect(rows.map((r) => r.dataset.key)).toEqual(['log-3', 'log-1']);
    expect(rows[0]!.classList.contains('bad')).toBe(true);
    expect(rows[0]!.textContent).toContain('1:05');
    panel.setFilter('advance');
    expect(root.querySelectorAll('tbody tr')).toHaveLength(1);
    panel.setFilter('');
    root.querySelector<HTMLElement>('tr[data-key="log-3"]')!.click();
    await vi.waitFor(() => expect(root.querySelector('.or-detail h2')).not.toBeNull());
    const text = root.querySelector('.or-detail')!.textContent!;
    expect(text).toContain('answered by');
    expect(text).toContain('is not one of');
    expect(text).toContain('SYSTEM <b>not html</b>');
    expect(root.querySelector('.or-detail b')).toBeNull();
    expect(text).toContain('raw reply');
    expect(text).toContain('handed to the engine');
  });

  it('runs a dry run and shows model, canned and recorded side by side', async () => {
    const posts: RequestInit[] = [];
    const fetchFn = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(init);
        return json({
          route: { provider: 'ollama', model: 'qwen' },
          model: {
            result: { kind: 'clarification', question: 'restate' },
            problems: ['parse: unknown place "x"'],
            calls: [
              {
                request: {
                  stage: 'parse',
                  promptVersion: 'p+edited',
                  system: 'S',
                  input: {},
                  schema: {},
                },
                ok: true,
                response: '{}',
                latencyMs: 12,
              },
            ],
          },
          canned: { result: { kind: 'intents' }, problems: [], calls: [] },
          usage: { runs: 1, calls: 1, inputTokens: 3, outputTokens: 2, usd: 0 },
        });
      }
      return json({ attempts: [] });
    });
    const { root, panel } = mount(fetchFn);
    await panel.setGame('g1');
    await panel.run(
      form({ text: 'Hold the bridge', prompts: { parse: 'EDITED', interpret: 'I' } }),
    );
    expect(fetchFn).toHaveBeenCalledWith(
      '/admin/api/games/g1/orders/dry-run?token=tok',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(String(posts[0]!.body))).toMatchObject({ prompts: { parse: 'EDITED' } });
    const heads = [...root.querySelectorAll('.or-results h2')].map((h) => h.textContent);
    expect(heads).toEqual(['Model: ollama/qwen', 'Canned parser', 'Recorded']);
    expect(root.querySelector('.or-results')!.textContent).toContain('unknown place "x"');
    expect(root.querySelector('.or-usage')!.textContent).toContain('dry runs: 1');
  });

  it('shows a rate limit as a message', async () => {
    const fetchFn = vi.fn((_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? json({ error: 'rate_limited', message: 'at most 6 dry runs a minute' }, 429)
        : json({ attempts: [] }),
    );
    const { root, panel } = mount(fetchFn);
    await panel.setGame('g1');
    await panel.run(form());
    expect(root.querySelector('.or-results')!.textContent).toContain('rate_limited');
  });
});
