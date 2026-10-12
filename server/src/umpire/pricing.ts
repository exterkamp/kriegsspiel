import type { TokenUsage } from './umpireClient.js';

/** USD per million tokens. Cache reads bill at 10% of input, 5-minute cache writes at 125%. */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  /** The test provider (canned responses) costs nothing. */
  test: { input: 0, output: 0 },
};

/** Cost of one attempt, or `null` when the model has no entry in the price table. */
export function costUsd(model: string, usage: TokenUsage): number | null {
  const p = PRICES[model];
  if (!p) return null;
  const perToken = 1 / 1_000_000;
  return (
    (usage.inputTokens * p.input +
      usage.outputTokens * p.output +
      usage.cacheReadTokens * p.input * 0.1 +
      usage.cacheWriteTokens * p.input * 1.25) *
    perToken
  );
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

export const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};
