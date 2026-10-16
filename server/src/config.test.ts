import { describe, expect, it } from 'vitest';
import { aiCommanderFromEnv, llmOrderParserEnabled, turnUmpireEnabled } from './config.js';
import { DEFAULT_UMPIRE_CONFIG, umpireConfigFromEnv } from './umpire/index.js';

describe('aiCommanderFromEnv', () => {
  it('is off unless AI_COMMANDER is llm', () => {
    expect(aiCommanderFromEnv({})).toBeUndefined();
    expect(aiCommanderFromEnv({ AI_COMMANDER: 'scripted' })).toBeUndefined();
  });

  it('defaults to a normal, balanced commander', () => {
    expect(aiCommanderFromEnv({ AI_COMMANDER: 'LLM' })).toEqual({
      difficulty: 'normal',
      personality: 'balanced',
    });
  });

  it('reads difficulty and personality, and rejects a bad value', () => {
    expect(
      aiCommanderFromEnv({
        AI_COMMANDER: 'llm',
        AI_DIFFICULTY: 'hard',
        AI_PERSONALITY: 'cautious',
      }),
    ).toEqual({ difficulty: 'hard', personality: 'cautious' });
    expect(() => aiCommanderFromEnv({ AI_COMMANDER: 'llm', AI_DIFFICULTY: 'insane' })).toThrow(
      /AI_DIFFICULTY/,
    );
  });
});

describe('llmOrderParserEnabled', () => {
  it('needs the default provider’s API key', () => {
    expect(llmOrderParserEnabled({}, DEFAULT_UMPIRE_CONFIG)).toBe(false);
    expect(llmOrderParserEnabled({ ANTHROPIC_API_KEY: 'k' }, DEFAULT_UMPIRE_CONFIG)).toBe(true);
  });

  it('can be forced to the stub', () => {
    const env = { ANTHROPIC_API_KEY: 'k', ORDER_PARSER: 'stub' };
    expect(llmOrderParserEnabled(env, DEFAULT_UMPIRE_CONFIG)).toBe(false);
  });

  it('counts a configured local provider, which needs no key', () => {
    const config = {
      ...DEFAULT_UMPIRE_CONFIG,
      providers: { local: { type: 'ollama', baseUrl: 'http://localhost:11434' } },
      stages: {
        ...DEFAULT_UMPIRE_CONFIG.stages,
        parse: { provider: 'local', model: 'llama3' },
      },
    };
    expect(llmOrderParserEnabled({}, config)).toBe(true);
  });
});

describe('turnUmpireEnabled (D39, 11.6)', () => {
  const on = (env: Record<string, string>) => turnUmpireEnabled(env, umpireConfigFromEnv(env));

  it('is on with the Anthropic key, on Sonnet with a 300 s call timeout', () => {
    expect(on({ ANTHROPIC_API_KEY: 'k' })).toBe(true);
    const cfg = umpireConfigFromEnv({ ANTHROPIC_API_KEY: 'k' });
    expect(cfg.stages.adjudicate).toMatchObject({
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
    });
    expect(cfg.stageTimeoutMs?.adjudicate).toBe(300_000);
    expect(
      umpireConfigFromEnv({ UMPIRE_TIMEOUT_MS_ADJUDICATE: '600000' }).stageTimeoutMs?.adjudicate,
    ).toBe(600_000);
  });

  it('is off with no capable model: no key, the keyless demo (test or Ollama), or every stage canned', () => {
    expect(on({})).toBe(false);
    expect(on({ UMPIRE_KEYLESS_PROVIDER: 'test' })).toBe(false);
    expect(on({ UMPIRE_KEYLESS_PROVIDER: 'ollama' })).toBe(false);
    // The keyless Ollama demo leaves adjudicate on the canned provider, not the local model.
    expect(
      umpireConfigFromEnv({ UMPIRE_KEYLESS_PROVIDER: 'ollama' }).stages.adjudicate.provider,
    ).toBe('test');
    expect(on({ UMPIRE_PROVIDER: 'test' })).toBe(false);
    expect(on({ ANTHROPIC_API_KEY: 'k', TURN_UMPIRE: 'off' })).toBe(false);
  });

  it('is on when the stage’s provider is named, even the canned one', () => {
    expect(on({ UMPIRE_PROVIDER_ADJUDICATE: 'test' })).toBe(true);
  });

  it('counts a configured remote provider but not a local Ollama', () => {
    const with_ = (type: string) => ({
      ...DEFAULT_UMPIRE_CONFIG,
      providers: { other: { type } },
      stages: { ...DEFAULT_UMPIRE_CONFIG.stages, adjudicate: { provider: 'other', model: 'm' } },
    });
    expect(turnUmpireEnabled({}, with_('openai-compatible'))).toBe(true);
    expect(turnUmpireEnabled({}, with_('ollama'))).toBe(false);
  });
});
