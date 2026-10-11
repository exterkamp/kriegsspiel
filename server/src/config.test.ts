import { describe, expect, it } from 'vitest';
import { aiCommanderFromEnv } from './config.js';

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
