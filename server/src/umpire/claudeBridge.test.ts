import { describe, expect, it, vi } from 'vitest';
import { llmOrderParserEnabled, turnUmpireEnabled, usesTestUmpire } from '../config.js';
import { CORPUS_CONTEXT } from '../orders/eval/corpus.js';
import { LlmOrderParser } from '../orders/llmParser.js';
import { ADJUDICATE_SCHEMA } from './adjudicate.js';
import { UMPIRE_STAGES, umpireConfigFromEnv } from './config.js';
import { createUmpireClient } from './createUmpireClient.js';
import type { UmpireFallback } from './fallbackUmpireClient.js';
import { CLAUDE_BRIDGE_DEFAULT_URL } from './providers/claudeBridge.js';
import type { UmpireCallRecord } from './umpireClient.js';

const ENV = {
  UMPIRE_KEYLESS_PROVIDER: 'claude-bridge',
  CLAUDE_BRIDGE_URL: 'http://172.17.0.1:8790',
};
const ORDER = 'Move the 1st Battalion to the bridge and hold it.';

describe('Claude Code bridge configuration (#457)', () => {
  it('UMPIRE_KEYLESS_PROVIDER=claude-bridge puts every keyless stage on the bridge with test as the fallback', () => {
    const c = umpireConfigFromEnv(ENV);
    expect(c.providers['claude-bridge']).toEqual({
      type: 'claude-bridge',
      baseUrl: 'http://172.17.0.1:8790',
    });
    for (const s of UMPIRE_STAGES) expect(c.stages[s].provider).toBe('claude-bridge');
    // The routes keep their Claude models; no small-model tuning applies.
    expect(c.stages.parse.model).toBe('claude-haiku-5-5');
    expect(c.stages.adjudicate).toMatchObject({
      model: 'claude-sonnet-5-5',
      params: { maxTokens: 12_000 },
    });
    expect(c.stages.narrate.params).toBeUndefined();
    expect(c.fallbackProvider).toBe('test');
    expect(c.rateLimit).toBeUndefined();
    expect(c.maxAttempts).toBe(3);
  });

  it('turns on the LLM parser and the turn umpire, and is not the canned umpire', () => {
    const c = umpireConfigFromEnv(ENV);
    expect(llmOrderParserEnabled(ENV, c)).toBe(true);
    expect(turnUmpireEnabled(ENV, c)).toBe(true);
    expect(usesTestUmpire(c)).toBe(false);
  });

  it('selects models per stage and defaults the URL', () => {
    const c = umpireConfigFromEnv({
      UMPIRE_KEYLESS_PROVIDER: 'claude-bridge',
      UMPIRE_MODEL_ADJUDICATE: 'opus',
      UMPIRE_MODEL_NARRATE: 'sonnet',
    });
    expect(c.providers['claude-bridge']!.baseUrl).toBe(CLAUDE_BRIDGE_DEFAULT_URL);
    expect(c.stages.adjudicate.model).toBe('opus');
    expect(c.stages.narrate.model).toBe('sonnet');
  });

  it('an API key switches back to Anthropic; UMPIRE_PROVIDER names the bridge with no fallback', () => {
    const keyed = umpireConfigFromEnv({ ...ENV, ANTHROPIC_API_KEY: 'sk-ant-x' });
    expect(keyed.stages.judge.provider).toBe('anthropic');
    expect(keyed.fallbackProvider).toBeUndefined();
    const all = umpireConfigFromEnv({ UMPIRE_PROVIDER: 'claude-bridge' });
    expect(all.stages.staff.provider).toBe('claude-bridge');
    expect(all.fallbackProvider).toBeUndefined();
    const one = umpireConfigFromEnv({ UMPIRE_PROVIDER_ADJUDICATE: 'claude-bridge' });
    expect(one.stages.adjudicate.provider).toBe('claude-bridge');
    expect(one.stages.parse.provider).toBe('anthropic');
  });

  it('is not configured unless the env names it', () => {
    expect(umpireConfigFromEnv({}).providers['claude-bridge']).toBeUndefined();
  });
});

describe('bridge down on the keyless route', () => {
  function setup(fetch: typeof globalThis.fetch) {
    const fallbacks: UmpireFallback[] = [];
    const records: UmpireCallRecord[] = [];
    const client = createUmpireClient({
      config: umpireConfigFromEnv({
        ...ENV,
        UMPIRE_BASE_BACKOFF_MS: '1',
        UMPIRE_MAX_BACKOFF_MS: '1',
      }),
      env: {},
      fetch,
      recorder: { record: (r) => records.push(r) },
      onFallback: (f) => fallbacks.push(f),
    });
    return { client, fallbacks, records };
  }

  it('answers an order from the test provider, and leaves a turn to the engine', async () => {
    const down = vi.fn(() => Promise.reject(new TypeError('fetch failed')));
    const { client, fallbacks, records } = setup(down as never);
    const r = await new LlmOrderParser(client).parse(ORDER, CORPUS_CONTEXT);
    expect(r.kind).toBe('intents');
    expect(fallbacks[0]).toMatchObject({
      stage: 'parse',
      kind: 'transport',
      provider: 'claude-bridge',
    });
    // The recorded call is the one that answered, so replay never needs the bridge.
    expect(records.at(-1)).toMatchObject({ provider: 'test', model: 'test' });
    // The adjudicator is not answered with a canned proposal: the turn falls back to the engine (D39).
    await expect(
      client.call({
        stage: 'adjudicate',
        promptVersion: 'x',
        system: 'x',
        input: {},
        schema: ADJUDICATE_SCHEMA,
      }),
    ).rejects.toMatchObject({ kind: 'transport' });
  });

  it('a logged-out bridge (424) is not retried before the fallback answers', async () => {
    const fetch = vi.fn(
      async () =>
        new Response('{"error":{"code":"not_logged_in","message":"run /login"}}', { status: 424 }),
    );
    const { client, fallbacks } = setup(fetch as never);
    expect((await new LlmOrderParser(client).parse(ORDER, CORPUS_CONTEXT)).kind).toBe('intents');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fallbacks[0]).toMatchObject({ kind: 'transport' });
  });
});
