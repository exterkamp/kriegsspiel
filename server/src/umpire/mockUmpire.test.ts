import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { MockUmpireClient, UmpireError, loadFixtureFile, loadFixtures } from './index.js';
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

describe('fixture validation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mock-umpire-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const write = (name: string, body: unknown) => {
    const p = join(dir, name);
    writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body));
    return p;
  };

  it.each([
    ['unknown stage', { fixtures: [{ stage: 'bogus', output: 1 }] }, /bad or missing stage/],
    ['missing stage', { fixtures: [{ output: 1 }] }, /bad or missing stage/],
    [
      'unknown failure kind',
      { fixtures: [{ stage: 'judge', failure: { kind: 'nope' } }] },
      /bad failure kind/,
    ],
    ['neither output nor failure', { fixtures: [{ stage: 'judge' }] }, /needs output or failure/],
    [
      'failure with times but no output',
      { fixtures: [{ stage: 'judge', failure: { kind: 'timeout', times: 2 } }] },
      /needs output or failure/,
    ],
    ['not a fixtures object', { stuff: [] }, /expected \{"fixtures"/],
    ['fixtures not an array', { fixtures: {} }, /expected \{"fixtures"/],
  ])('loadFixtureFile rejects %s', (_n, body, message) => {
    expect(() => loadFixtureFile(write('bad.json', body))).toThrow(message);
  });

  it('names the file and fixture index in the error', () => {
    const p = write('named.json', { fixtures: [{ stage: 'judge', output: 1 }, { stage: 'x' }] });
    expect(() => loadFixtureFile(p)).toThrow(`${p} fixture 1`);
  });

  it('loads the {fixtures} form, a bare array, and an always-failing fixture', () => {
    expect(
      loadFixtureFile(write('a.json', { fixtures: [{ stage: 'parse', output: 1 }] })),
    ).toHaveLength(1);
    expect(loadFixtureFile(write('b.json', [{ stage: 'judge', output: null }]))).toHaveLength(1);
    expect(
      loadFixtureFile(write('c.json', [{ stage: 'judge', failure: { kind: 'refusal' } }])),
    ).toHaveLength(1);
  });

  it('loads a directory in name order and ignores non-json files', () => {
    const d = mkdtempSync(join(dir, 'dir-'));
    writeFileSync(join(d, 'b.json'), JSON.stringify([{ stage: 'judge', name: 'b', output: 1 }]));
    writeFileSync(join(d, 'a.json'), JSON.stringify([{ stage: 'judge', name: 'a', output: 1 }]));
    writeFileSync(join(d, 'notes.txt'), 'not json at all');
    expect(loadFixtures(d).map((f) => f.name)).toEqual(['a', 'b']);
    expect(loadFixtures(join(d, 'a.json')).map((f) => f.name)).toEqual(['a']);
  });

  it('validates inline fixtures when the client is built', () => {
    expect(
      () => new MockUmpireClient([{ stage: 'judge', failure: { kind: 'timeout', times: 2 } }]),
    ).toThrow(/fixture 0: needs output or failure/);
    expect(() => new MockUmpireClient([{ stage: 'oops' as never, output: 1 }])).toThrow(
      /bad or missing stage/,
    );
  });
});
