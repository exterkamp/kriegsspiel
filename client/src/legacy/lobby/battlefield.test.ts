import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { ApprovedBattlefield } from '@kriegsspiel/protocol';
import { fetchGameBattlefield, GameBattlefieldError } from './battlefield.js';

const gameId = 'game /?#é';
const scenarioId = 'hold-the-bridge';
const byteLimit = 256 * 1024;
const encoder = new TextEncoder();

function descriptor(): ApprovedBattlefield {
  const terrainIdentity = `engine-terrain-v1:sha256:${'a'.repeat(64)}`;
  return {
    map: {
      id: 'bridge:default',
      name: 'Défense du pont 🗺',
      source: 'scenario-default',
      terrainIdentity,
      widthM: 4000,
      heightM: 3000,
      preview: [
        {
          id: 'bridge',
          kind: 'bridge',
          layer: 4,
          geometry: { shape: 'point', at: { x: 2050, y: 1500 }, radiusM: 110 },
        },
        {
          id: 'wood',
          kind: 'wood',
          layer: 1,
          geometry: {
            shape: 'polygon',
            points: [
              { x: 600, y: 300 },
              { x: 1300, y: 350 },
              { x: 1250, y: 900 },
            ],
          },
        },
        {
          id: 'road',
          kind: 'road',
          layer: 2,
          geometry: {
            shape: 'polyline',
            points: [
              { x: 0.001, y: 1.001 },
              { x: 2050, y: 3000 },
            ],
            widthM: 0.001,
          },
        },
      ],
    },
    pairing: {
      id: 'bridge:default',
      revision: `engine-pairing-v1:sha256:${'b'.repeat(64)}`,
      scenarioId,
      resolvedScenarioId: 'hold-the-bridge-open-v1',
      scenarioRevision: `engine-scenario-v1:sha256:${'c'.repeat(64)}`,
      terrainIdentity,
      assemblyVersion: 'engine-native-v1',
    },
    isDefault: true,
  };
}

function envelope() {
  return { id: gameId, scenario: scenarioId, battlefield: descriptor() };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function streamResponse(chunks: Uint8Array[], headers?: HeadersInit) {
  const cancel = vi.fn();
  let index = 0;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (index === chunks.length) controller.close();
        else controller.enqueue(chunks[index++]!);
      },
      cancel,
    },
    { highWaterMark: 0 },
  );
  return { response: new Response(body, { headers }), body, cancel };
}

async function load(value: unknown) {
  return fetchGameBattlefield(
    gameId,
    new AbortController().signal,
    async () => new Response(JSON.stringify(value)),
  );
}

describe('public game battlefield fetch', () => {
  it('makes exactly one authenticated capability GET with the caller signal and encoded ID', async () => {
    const controller = new AbortController();
    const f = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(envelope())));
    const result = await fetchGameBattlefield(gameId, controller.signal, f);
    expect(f.mock.calls).toEqual([
      [
        '/games/game%20%2F%3F%23%C3%A9?battlefieldVersion=1',
        { method: 'GET', credentials: 'same-origin', signal: controller.signal },
      ],
    ]);
    expect(result.gameId).toBe(gameId);
    expect(result.scenarioId).toBe(scenarioId);
    expect(result.battlefield.pairing.resolvedScenarioId).toBe('hold-the-bridge-open-v1');
  });

  it('accepts a bounded independent parent at the 128-character limit', async () => {
    const value = envelope();
    value.scenario = 'a'.repeat(128);
    value.battlefield.pairing.scenarioId = value.scenario;
    await expect(load(value)).resolves.toMatchObject({ scenarioId: value.scenario });
  });

  it('rejects trailing whitespace even when the descriptor agrees with that parent', async () => {
    const value = envelope();
    value.scenario += '\n';
    value.battlefield.pairing.scenarioId = value.scenario;
    await expect(load(value)).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('returns detached public metadata and actual asymmetric terrain in final paint order only', async () => {
    const input = {
      ...envelope(),
      sides: [{ units: ['secret-unit'] }],
      initialWorld: { seed: 97 },
    };
    const original = structuredClone(input);
    const result = await load(input);
    expect(Object.keys(result).sort()).toEqual(['battlefield', 'gameId', 'map', 'scenarioId']);
    expect(result.battlefield).toEqual(input.battlefield);
    expect(result.map).toEqual({
      width: 4000,
      height: 3000,
      features: [
        {
          id: 'wood',
          kind: 'wood',
          layer: 1,
          geometry: {
            shape: 'polygon',
            points: [
              { x: 600, y: 300 },
              { x: 1300, y: 350 },
              { x: 1250, y: 900 },
            ],
          },
        },
        {
          id: 'road',
          kind: 'road',
          layer: 2,
          geometry: {
            shape: 'polyline',
            points: [
              { x: 0.001, y: 1.001 },
              { x: 2050, y: 3000 },
            ],
            width: 0.001,
          },
        },
        {
          id: 'bridge',
          kind: 'bridge',
          layer: 4,
          geometry: { shape: 'point', at: { x: 2050, y: 1500 }, radius: 110 },
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/secret-unit|initialWorld|"seed"|"sides"/);
    result.battlefield.map.preview[0]!.geometry = {
      shape: 'point',
      at: { x: 1, y: 1 },
      radiusM: 1,
    };
    expect(result.map.features[2]!.geometry).toEqual({
      shape: 'point',
      at: { x: 2050, y: 1500 },
      radius: 110,
    });
    result.map.features.length = 0;
    expect(result.battlefield.map.preview).toHaveLength(3);
    expect(input).toEqual(original);
    input.battlefield.map.widthM = 8000;
    expect(result.battlefield.map.widthM).toBe(4000);
  });

  it('decodes UTF-8 characters split across individual streamed bytes without json/text fallback', async () => {
    const bytes = encoder.encode(JSON.stringify(envelope()));
    const { response, body } = streamResponse(Array.from(bytes, (byte) => Uint8Array.of(byte)));
    const json = vi.spyOn(response, 'json');
    const text = vi.spyOn(response, 'text');
    const result = await fetchGameBattlefield(
      gameId,
      new AbortController().signal,
      async () => response,
    );
    expect(result.battlefield.map.name).toBe('Défense du pont 🗺');
    expect(json).not.toHaveBeenCalled();
    expect(text).not.toHaveBeenCalled();
    expect(body.locked).toBe(false);
  });

  it('accepts exactly 256 KiB even without Content-Length', async () => {
    const json = JSON.stringify(envelope());
    const bytes = encoder.encode(json + ' '.repeat(byteLimit - encoder.encode(json).length));
    expect(bytes.byteLength).toBe(byteLimit);
    const { response } = streamResponse([bytes.subarray(0, 1500), bytes.subarray(1500)]);
    await expect(
      fetchGameBattlefield(gameId, new AbortController().signal, async () => response),
    ).resolves.toMatchObject({ gameId, scenarioId });
  });

  it.each([undefined, '1'])(
    'counts bytes across chunks despite Content-Length=%s and cancels at the limit',
    async (contentLength) => {
      const json = JSON.stringify(envelope());
      const prefix = encoder.encode(json + ' '.repeat(byteLimit - encoder.encode(json).length));
      const headers = contentLength ? { 'Content-Length': contentLength } : undefined;
      const { response, cancel, body } = streamResponse(
        [prefix, Uint8Array.of(32), encoder.encode('never read')],
        headers,
      );
      await expect(
        fetchGameBattlefield(gameId, new AbortController().signal, async () => response),
      ).rejects.toMatchObject({ kind: 'unavailable' });
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(body.locked).toBe(false);
    },
  );

  it('enforces bytes rather than string length for an oversized single Unicode chunk', async () => {
    const value = JSON.stringify({ ...envelope(), padding: 'é'.repeat(byteLimit / 2) });
    expect(value.length).toBeLessThan(byteLimit);
    expect(encoder.encode(value).length).toBeGreaterThan(byteLimit);
    const { response, cancel } = streamResponse([encoder.encode(value), Uint8Array.of(32)]);
    await expect(
      fetchGameBattlefield(gameId, new AbortController().signal, async () => response),
    ).rejects.toMatchObject({ kind: 'unavailable' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['malformed JSON', encoder.encode('{')],
    [
      'invalid UTF-8 in otherwise valid JSON',
      new Uint8Array([...encoder.encode('{"name":"'), 0xc3, 0x28, ...encoder.encode('"}')]),
    ],
    ['empty body', new Uint8Array()],
  ])('rejects %s with retryable copy', async (_name, bytes) => {
    const { response, body } = streamResponse([bytes]);
    await expect(
      fetchGameBattlefield(gameId, new AbortController().signal, async () => response),
    ).rejects.toMatchObject({
      kind: 'unavailable',
      message: 'The battlefield is unavailable. Please try again.',
    });
    expect(body.locked).toBe(false);
  });

  it.each([
    ['foreign game ID', () => ({ ...envelope(), id: 'another-game' })],
    ['missing game ID', () => ({ ...envelope(), id: undefined })],
    ['foreign independent parent', () => ({ ...envelope(), scenario: 'another-scenario' })],
    ['missing parent', () => ({ ...envelope(), scenario: undefined })],
    ['non-string parent', () => ({ ...envelope(), scenario: { id: scenarioId } })],
    ['unbounded parent', () => ({ ...envelope(), scenario: 'a'.repeat(129) })],
    ['empty parent', () => ({ ...envelope(), scenario: '' })],
    ['invalid parent characters', () => ({ ...envelope(), scenario: '../hold the bridge' })],
    ['missing battlefield', () => ({ ...envelope(), battlefield: undefined })],
    [
      'private descriptor fields',
      () => ({ ...envelope(), battlefield: { ...descriptor(), initialWorld: { seed: 97 } } }),
    ],
    [
      'private map fields',
      () => {
        const battlefield = descriptor();
        return {
          ...envelope(),
          battlefield: { ...battlefield, map: { ...battlefield.map, units: [] } },
        };
      },
    ],
    [
      'legacy descriptor',
      () => {
        const battlefield = descriptor();
        return {
          ...envelope(),
          battlefield: {
            map: battlefield.map,
            pairing: { ...battlefield.pairing, revision: battlefield.pairing.scenarioRevision },
            capabilities: { addMaps: false },
          },
        };
      },
    ],
    ['null envelope', () => null],
    ['array envelope', () => [envelope()]],
  ])(
    'rejects %s without returning fixture terrain or response contents',
    async (_name, invalid) => {
      await expect(load(invalid())).rejects.toMatchObject({
        name: 'GameBattlefieldError',
        kind: 'unavailable',
        message: 'The battlefield is unavailable. Please try again.',
      });
    },
  );

  it.each([
    [401, 'sign-in', 'Sign in to view this battlefield.'],
    [426, 'reload', 'Reload to view this battlefield.'],
    [404, 'missing', 'This game is unavailable.'],
    [403, 'unavailable', 'The battlefield is unavailable. Please try again.'],
    [500, 'unavailable', 'The battlefield is unavailable. Please try again.'],
  ])(
    'classifies HTTP %i without reading its error body or retrying',
    async (status, kind, message) => {
      const cancel = vi.fn();
      const pull = vi.fn();
      const response = new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), {
        status,
      });
      const f = vi.fn<typeof fetch>(async () => response);
      await expect(fetchGameBattlefield(gameId, new AbortController().signal, f)).rejects.toEqual(
        new GameBattlefieldError(kind as GameBattlefieldError['kind']),
      );
      await expect(
        fetchGameBattlefield(
          gameId,
          new AbortController().signal,
          async () => new Response(null, { status }),
        ),
      ).rejects.toMatchObject({ kind, message });
      expect(f).toHaveBeenCalledTimes(1);
      expect(pull).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledTimes(1);
    },
  );

  it('classifies network and body failures as retryable, and releases the failed reader', async () => {
    const f = vi.fn<typeof fetch>(async () => {
      throw new Error('sensitive network detail');
    });
    await expect(
      fetchGameBattlefield(gameId, new AbortController().signal, f),
    ).rejects.toMatchObject({
      kind: 'unavailable',
      message: 'The battlefield is unavailable. Please try again.',
    });
    expect(f).toHaveBeenCalledTimes(1);
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        c.error(new Error('broken stream'));
      },
    });
    await expect(
      fetchGameBattlefield(gameId, new AbortController().signal, async () => new Response(body)),
    ).rejects.toMatchObject({ kind: 'unavailable' });
    expect(body.locked).toBe(false);
    await expect(
      fetchGameBattlefield(gameId, new AbortController().signal, async () => new Response(null)),
    ).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('cancels a non-byte stream without parsing or publishing data', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream(
      {
        start(c) {
          c.enqueue('not bytes');
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    await expect(
      fetchGameBattlefield(gameId, new AbortController().signal, async () => new Response(body)),
    ).rejects.toMatchObject({ kind: 'unavailable' });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it('rejects an already aborted lifetime without fetching', async () => {
    const controller = new AbortController();
    controller.abort('old connection');
    const f = vi.fn<typeof fetch>();
    await expect(fetchGameBattlefield(gameId, controller.signal, f)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(f).not.toHaveBeenCalled();
  });

  it('rejects promptly on abort even if fetch ignores it, then cancels the late response', async () => {
    const controller = new AbortController();
    const pending = deferred<Response>();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const request = fetchGameBattlefield(gameId, controller.signal, () => pending.promise);
    controller.abort();
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    const { response, cancel, body } = streamResponse([encoder.encode(JSON.stringify(envelope()))]);
    pending.resolve(response);
    await pending.promise;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it.each(['resolve', 'reject', 'pending'])(
    'cancels an outstanding read and removes its abort listener when source cancellation will %s',
    async (settlement) => {
      const controller = new AbortController();
      const reading = deferred<void>();
      const cancel = vi.fn(() => {
        if (settlement === 'reject') return Promise.reject(new Error('cancellation failed'));
        if (settlement === 'pending') return new Promise<void>(() => {});
        return Promise.resolve();
      });
      const body = new ReadableStream<Uint8Array>(
        {
          pull() {
            reading.resolve();
          },
          cancel,
        },
        { highWaterMark: 0 },
      );
      const add = vi.spyOn(controller.signal, 'addEventListener');
      const remove = vi.spyOn(controller.signal, 'removeEventListener');
      const request = fetchGameBattlefield(
        gameId,
        controller.signal,
        async () => new Response(body),
      );
      await reading.promise;
      controller.abort();
      await expect(request).rejects.toMatchObject({ name: 'AbortError' });
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(body.locked).toBe(false);
      expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]![1]);
    },
  );

  it('rejects a complete body if its final read resolves after the lifetime was aborted', async () => {
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>(
      {
        pull(c) {
          c.enqueue(encoder.encode(JSON.stringify(envelope())));
          c.close();
          controller.abort();
        },
      },
      { highWaterMark: 0 },
    );
    await expect(
      fetchGameBattlefield(gameId, controller.signal, async () => new Response(body)),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(body.locked).toBe(false);
  });

  it('does not publish a completed map when abort arrives between EOF and request settlement', async () => {
    const controller = new AbortController();
    let sent = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(c) {
          if (!sent) {
            sent = true;
            c.enqueue(encoder.encode(JSON.stringify(envelope())));
          } else {
            c.close();
            queueMicrotask(() => queueMicrotask(() => controller.abort()));
          }
        },
      },
      { highWaterMark: 0 },
    );
    await expect(
      fetchGameBattlefield(gameId, controller.signal, async () => new Response(body)),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(body.locked).toBe(false);
  });

  it('removes listeners after success and validation failure; a later abort cannot cancel a finished body', async () => {
    for (const value of [envelope(), { ...envelope(), scenario: 'foreign' }]) {
      const controller = new AbortController();
      const add = vi.spyOn(controller.signal, 'addEventListener');
      const remove = vi.spyOn(controller.signal, 'removeEventListener');
      const { response, body, cancel } = streamResponse([encoder.encode(JSON.stringify(value))]);
      const request = fetchGameBattlefield(gameId, controller.signal, async () => response);
      if (value.scenario === scenarioId) await expect(request).resolves.toMatchObject({ gameId });
      else await expect(request).rejects.toMatchObject({ kind: 'unavailable' });
      expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]![1]);
      controller.abort();
      expect(cancel).not.toHaveBeenCalled();
      expect(body.locked).toBe(false);
    }
  });

  it('imports only public protocol and table adapter/types, without private or fixture access', () => {
    const source = readFileSync(new URL('battlefield.ts', import.meta.url), 'utf8');
    expect([...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1])).toEqual([
      '@kriegsspiel/protocol',
      '../table/battlefieldMap.js',
      '../table/types.js',
    ]);
    expect(source).not.toMatch(/\b(?:ApprovedBattlefieldSchema|MasterState|InitialWorld)\b/);
  });
});
