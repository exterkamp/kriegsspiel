import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockUmpireClient, UmpireError, loadFixtures } from './index.js';
import type { UmpireCallRecord, UmpireRequest } from './index.js';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const verdictSchema = {
  type: 'object',
  properties: { verdict: { type: 'string' } },
  required: ['verdict'],
  additionalProperties: false,
};
const req = (over: Partial<UmpireRequest> = {}): UmpireRequest => ({
  stage: 'judge',
  promptVersion: 'judge-v1',
  system: 'sys',
  input: { a: 1, b: 2 },
  schema: verdictSchema,
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe('MockUmpireClient', () => {
  it('serves committed fixtures with no network access', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network touched');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const recorded: UmpireCallRecord[] = [];
    const mock = new MockUmpireClient(loadFixtures(fixtureDir), {
      recorder: { record: (r) => recorded.push(r) },
      sleep: async () => {},
    });
    const res = await mock.call<{ verdict: string }>(req());
    expect(res.output).toEqual({ verdict: 'ok' });
    expect(recorded).toEqual([res.record]);
    expect(res.record.model).toBe('mock');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('matches on stage, prompt version and input (key order ignored)', async () => {
    const mock = new MockUmpireClient([
      { stage: 'judge', promptVersion: 'judge-v2', output: { verdict: 'v2' } },
      { stage: 'judge', input: { b: 2, a: 1 }, output: { verdict: 'exact' } },
      { stage: 'narrate', output: { verdict: 'narr' } },
    ]);
    expect((await mock.call<{ verdict: string }>(req())).output.verdict).toBe('exact');
    expect(
      (await mock.call<{ verdict: string }>(req({ promptVersion: 'judge-v2', input: 0 }))).output
        .verdict,
    ).toBe('v2');
    await expect(mock.call(req({ input: { a: 9 } }))).rejects.toMatchObject({
      kind: 'missing-recording',
    });
    expect(mock.calls).toHaveLength(3);
  });

  it('simulates latency through the injected sleep', async () => {
    const sleep = vi.fn(async () => {});
    const mock = new MockUmpireClient(
      [{ stage: 'judge', latencyMs: 250, output: { verdict: 'x' } }],
      {
        sleep,
      },
    );
    await mock.call(req());
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it('holds a call open until the latency elapses', async () => {
    vi.useFakeTimers();
    try {
      const mock = new MockUmpireClient([
        { stage: 'judge', latencyMs: 1000, output: { verdict: 'x' } },
      ]);
      let done = false;
      const p = mock.call(req()).then(() => (done = true));
      await vi.advanceTimersByTimeAsync(999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('injects a failure for the first N calls, then succeeds', async () => {
    const mock = new MockUmpireClient(
      [{ stage: 'judge', output: { verdict: 'ok' }, failure: { kind: 'timeout', times: 2 } }],
      { sleep: async () => {} },
    );
    await expect(mock.call(req())).rejects.toMatchObject({ kind: 'timeout' });
    await expect(mock.call(req())).rejects.toBeInstanceOf(UmpireError);
    expect((await mock.call<{ verdict: string }>(req())).output.verdict).toBe('ok');
  });

  it('fails every call when a failure has no count', async () => {
    const mock = new MockUmpireClient([{ stage: 'judge', failure: { kind: 'refusal' } }]);
    await expect(mock.call(req())).rejects.toMatchObject({ kind: 'refusal' });
    await expect(mock.call(req())).rejects.toMatchObject({ kind: 'refusal' });
  });

  it('rejects a fixture that does not match the request schema', async () => {
    const mock = new MockUmpireClient([{ stage: 'judge', output: { nope: true } }]);
    await expect(mock.call(req())).rejects.toMatchObject({ kind: 'schema' });
  });
});
