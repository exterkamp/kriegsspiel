import { describe, expect, it } from 'vitest';
import { aiCommanderFromEnv, llmOrderParserEnabled } from './config.js';
import { DEFAULT_UMPIRE_CONFIG } from './umpire/index.js';

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
