import { describe, expect, it } from 'vitest';
import { MS_PER_MINUTE } from '@kriegsspiel/engine';
import type { ViewReport } from '@kriegsspiel/engine';
import { GameUmpireClient } from './gameLimits.js';
import type { GameUmpireMetric } from './gameLimits.js';
import { STAFF_OVERLOADED_NOTICE, narrateReports } from './narrate.js';
import { UmpireError } from './umpireClient.js';
import type { UmpireClient, UmpireRequest, UmpireResponse } from './umpireClient.js';
import { aiCommanderBudgetWarning } from '../config.js';
import { loadUmpireConfig, umpireConfigFromEnv } from './config.js';

const request: UmpireRequest = {
  stage: 'narrate',
  promptVersion: 'v1',
  system: 's',
  input: {},
  schema: {},
};

/** A shared client that answers every call with 100 tokens and 1 cent. */
function inner(output: unknown = { dispatches: [] }, fail?: () => Error) {
  const seen: UmpireRequest[] = [];
  const client: UmpireClient = {
    async call<T>(req: UmpireRequest): Promise<UmpireResponse<T>> {
      seen.push(req);
      if (fail) throw fail();
      return {
        output: output as T,
        record: {
          stage: req.stage,
          model: 'm',
          promptVersion: req.promptVersion,
          system: req.system,
          input: req.input,
          rawOutput: '',
          usage: { inputTokens: 60, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 },
          costUsd: 0.01,
          attempts: 1,
        },
      };
    },
  };
  return { client, seen };
}

describe('GameUmpireClient', () => {
  it('reports the cost of the game and logs a metric per call', async () => {
    const metrics: GameUmpireMetric[] = [];
    const { client } = inner();
    const g = new GameUmpireClient(client, { gameId: 'g1', onMetric: (m) => metrics.push(m) });
    await g.call(request);
    await g.call({ ...request, stage: 'parse' });
    const r = g.report();
    expect(r).toMatchObject({ gameId: 'g1', calls: 2, totalTokens: 200, budgetSpent: false });
    expect(r.costUsd).toBeCloseTo(0.02);
    expect(r.byStage.parse).toMatchObject({ calls: 1, totalTokens: 100 });
    expect(metrics).toHaveLength(2);
    expect(metrics[1]).toMatchObject({ kind: 'call', stage: 'parse', totalTokens: 200 });
  });

  it('refuses once the token cap is spent, without calling the model', async () => {
    const metrics: GameUmpireMetric[] = [];
    const { client, seen } = inner();
    const g = new GameUmpireClient(client, {
      gameId: 'g1',
      limits: { maxTotalTokens: 150 },
      onMetric: (m) => metrics.push(m),
    });
    await g.call(request);
    await g.call(request); // 100 < 150: allowed, now 200
    await expect(g.call(request)).rejects.toMatchObject({ kind: 'budget', attempts: 0 });
    expect(seen).toHaveLength(2);
    expect(g.report()).toMatchObject({ refusedBudget: 1, budgetSpent: true });
    expect(metrics.at(-1)).toEqual({
      kind: 'refused',
      gameId: 'g1',
      stage: 'narrate',
      reason: 'budget',
    });
  });

  it('refuses once the dollar cap is spent', async () => {
    const { client } = inner();
    const g = new GameUmpireClient(client, { gameId: 'g', limits: { maxCostUsd: 0.015 } });
    await g.call(request);
    await g.call(request);
    await expect(g.call(request)).rejects.toMatchObject({ kind: 'budget' });
  });

  it('refuses when spend equals the cap exactly', async () => {
    const tokens = new GameUmpireClient(inner().client, {
      gameId: 'g',
      limits: { maxTotalTokens: 200 },
    });
    await tokens.call(request);
    await tokens.call(request);
    await expect(tokens.call(request)).rejects.toMatchObject({ kind: 'budget' });
    const dollars = new GameUmpireClient(inner().client, {
      gameId: 'g',
      limits: { maxCostUsd: 0.02 },
    });
    await dollars.call(request);
    await dollars.call(request);
    await expect(dollars.call(request)).rejects.toMatchObject({ kind: 'budget' });
  });

  it('logs a failed call that carries no usage', async () => {
    const metrics: GameUmpireMetric[] = [];
    const { client } = inner({}, () => new UmpireError('timeout', 'timeout', 1));
    const g = new GameUmpireClient(client, { gameId: 'g', onMetric: (m) => metrics.push(m) });
    await expect(g.call(request)).rejects.toMatchObject({ kind: 'timeout' });
    expect(g.report()).toMatchObject({ calls: 1, failedCalls: 1, totalTokens: 0 });
    expect(metrics).toEqual([expect.objectContaining({ kind: 'call', ok: false, costUsd: null })]);
  });

  it('counts the spend of a failed call', async () => {
    const usage = { inputTokens: 80, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const { client } = inner({}, () => new UmpireError('bad', 'schema', 3, usage, 0.02));
    const g = new GameUmpireClient(client, { gameId: 'g', limits: { maxTotalTokens: 100 } });
    await expect(g.call(request)).rejects.toMatchObject({ kind: 'schema' });
    expect(g.report()).toMatchObject({ calls: 1, failedCalls: 1, totalTokens: 100 });
    await expect(g.call(request)).rejects.toMatchObject({ kind: 'budget' });
  });

  it('rate limits calls per sliding minute and recovers', async () => {
    let t = 0;
    const { client, seen } = inner();
    const g = new GameUmpireClient(client, {
      gameId: 'g',
      limits: { maxCallsPerMinute: 2 },
      now: () => t,
    });
    await g.call(request);
    t = 10_000;
    await g.call(request);
    t = 59_999;
    await expect(g.call(request)).rejects.toMatchObject({ kind: 'rate-limit' });
    t = 60_000; // the first call has left the window
    await g.call(request);
    expect(seen).toHaveLength(3);
    expect(g.report().refusedRateLimit).toBe(1);
  });

  it('keeps one game’s spend apart from another’s', async () => {
    const { client } = inner();
    const a = new GameUmpireClient(client, { gameId: 'a', limits: { maxTotalTokens: 50 } });
    const b = new GameUmpireClient(client, { gameId: 'b', limits: { maxTotalTokens: 50 } });
    await a.call(request);
    await expect(a.call(request)).rejects.toMatchObject({ kind: 'budget' });
    await b.call(request);
    expect(b.report().calls).toBe(1);
  });
});

describe('staff sub-cap', () => {
  const staff: UmpireRequest = { ...request, stage: 'staff' };
  const parse: UmpireRequest = { ...request, stage: 'parse' };

  it('a saturated staff token share never blocks an order parse', async () => {
    const { client } = inner();
    const g = new GameUmpireClient(client, { gameId: 'g', limits: { maxTotalTokens: 1000 } });
    await g.call(staff);
    await g.call(staff);
    await g.call(staff); // 300 >= 250, the staff share
    await expect(g.call(staff)).rejects.toMatchObject({ kind: 'budget', attempts: 0 });
    await expect(g.call(parse)).resolves.toBeDefined();
    expect(g.report().budgetSpent).toBe(false);
  });

  it('a saturated staff dollar share never blocks an order parse', async () => {
    const g = new GameUmpireClient(inner().client, { gameId: 'g', limits: { maxCostUsd: 0.04 } });
    await g.call(staff); // 0.01 >= 0.01, the staff share
    await expect(g.call(staff)).rejects.toMatchObject({ kind: 'budget' });
    await expect(g.call(parse)).resolves.toBeDefined();
  });

  it('staff calls per minute stop at their share, leaving the rest for parsing', async () => {
    let t = 0;
    const g = new GameUmpireClient(inner().client, {
      gameId: 'g',
      limits: { maxCallsPerMinute: 8 },
      now: () => t,
    });
    await g.call(staff);
    await g.call(staff);
    await expect(g.call(staff)).rejects.toMatchObject({ kind: 'rate-limit' });
    for (let i = 0; i < 6; i++) await g.call(parse);
    await expect(g.call(parse)).rejects.toMatchObject({ kind: 'rate-limit' });
    t = 61_000;
    await expect(g.call(staff)).resolves.toBeDefined();
  });
});

describe('AI commander sub-cap', () => {
  const command: UmpireRequest = { ...request, stage: 'command' };
  const parse: UmpireRequest = { ...request, stage: 'parse' };

  it('a saturated commander share never blocks an order parse', async () => {
    const g = new GameUmpireClient(inner().client, {
      gameId: 'g',
      limits: { maxTotalTokens: 1000 },
    });
    const ai = g.commanderClient();
    await ai.call(command);
    await ai.call(command);
    await ai.call(command);
    await ai.call(command); // 400 >= 400, the commander share
    await expect(ai.call(command)).rejects.toMatchObject({ kind: 'budget', attempts: 0 });
    await expect(g.call(parse)).resolves.toBeDefined();
    expect(g.report().budgetSpent).toBe(false);
  });

  it('the parses of the commander text count against its share, not the humans', async () => {
    const g = new GameUmpireClient(inner().client, { gameId: 'g', limits: { maxCostUsd: 0.125 } });
    const ai = g.commanderClient();
    for (let i = 0; i < 5; i++) await ai.call(parse); // 0.05 >= 0.05
    await expect(ai.call(parse)).rejects.toMatchObject({ kind: 'budget' });
    await expect(ai.call(command)).rejects.toMatchObject({ kind: 'budget' });
    await expect(g.call(parse)).resolves.toBeDefined();
  });

  it('commander calls per minute stop at their share', async () => {
    const g = new GameUmpireClient(inner().client, {
      gameId: 'g',
      limits: { maxCallsPerMinute: 10 },
      now: () => 0,
    });
    const ai = g.commanderClient();
    for (let i = 0; i < 4; i++) await ai.call(command);
    await expect(ai.call(command)).rejects.toMatchObject({ kind: 'rate-limit' });
    await expect(g.call(parse)).resolves.toBeDefined();
  });
});

describe('aiCommanderBudgetWarning', () => {
  it('warns when no per-game cost or token cap is set', () => {
    expect(aiCommanderBudgetWarning(undefined)).toMatch(/no per-game cost cap/);
    expect(aiCommanderBudgetWarning({ maxCallsPerMinute: 5 })).toMatch(/UMPIRE_GAME_BUDGET_USD/);
  });

  it('is silent once a cap is configured', () => {
    expect(aiCommanderBudgetWarning({ maxCostUsd: 1 })).toBeUndefined();
    expect(aiCommanderBudgetWarning({ maxTotalTokens: 1000 })).toBeUndefined();
  });
});

describe('a capped game degrades', () => {
  const reports: ViewReport[] = [
    {
      id: 'blue-r1',
      kind: 'contact',
      observedAt: 0,
      deliveredAt: 4 * MS_PER_MINUTE,
      ageMs: 4 * MS_PER_MINUTE,
      from: '2nd Hussars',
      location: { x: 0, y: 0 },
      place: 'the mill',
      uncertaintyRadius: 100,
      confidence: 'medium',
      text: '2nd Hussars sighted the enemy at the mill.',
    },
  ];

  it('narration returns the template text and the staff-overloaded notice, no error, no retry', async () => {
    const { client, seen } = inner();
    const g = new GameUmpireClient(client, { gameId: 'g', limits: { maxCallsPerMinute: 1 } });
    await g.call(request); // uses the minute's only call
    const r = await narrateReports(g, 'blue', reports);
    expect(r).toEqual({
      dispatches: [{ reportIds: ['blue-r1'], text: reports[0]!.text }],
      fellBack: true,
      calls: 0,
      rejections: [],
      overloaded: STAFF_OVERLOADED_NOTICE,
    });
    expect(seen).toHaveLength(1);
  });

  it('an ordinary model failure is not reported as overload', async () => {
    const { client } = inner({}, () => new UmpireError('x', 'transport', 3));
    const g = new GameUmpireClient(client, { gameId: 'g' });
    const r = await narrateReports(g, 'blue', reports);
    expect(r.fellBack).toBe(true);
    expect(r.overloaded).toBeUndefined();
  });
});

describe('per-game config', () => {
  it('reads caps from env over the file, and defaults parse to the cheap model', () => {
    const c = umpireConfigFromEnv(
      { UMPIRE_GAME_BUDGET_USD: '2.5', UMPIRE_GAME_CALLS_PER_MINUTE: '30' },
      { gameBudget: { maxTotalTokens: 1000, maxCostUsd: 9 } },
    );
    expect(c.gameBudget).toEqual({ maxCostUsd: 2.5, maxTotalTokens: 1000, maxCallsPerMinute: 30 });
    expect(c.stages.parse.model).toBe('claude-haiku-5-5');
    expect(loadUmpireConfig({}).gameBudget).toBeUndefined();
  });

  it('rejects a bad per-minute cap', () => {
    expect(() => umpireConfigFromEnv({ UMPIRE_GAME_CALLS_PER_MINUTE: '0' })).toThrow();
  });

  it('rejects non-positive caps in the config file', () => {
    expect(() => umpireConfigFromEnv({}, { gameBudget: { maxCallsPerMinute: 0 } })).toThrow(
      /gameBudget.maxCallsPerMinute/,
    );
    expect(() => umpireConfigFromEnv({}, { budget: { maxCostUsd: -1 } })).toThrow(
      /budget.maxCostUsd/,
    );
  });
});
