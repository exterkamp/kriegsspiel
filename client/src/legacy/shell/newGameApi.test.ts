import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodeApprovedBattlefield,
  type BattlefieldCatalog,
  type ScenarioBattlefield,
} from '@kriegsspiel/protocol';
import { CreationPendingError, createGame, fetchScenarioOptions } from './newGameApi.js';
import { initialForm, toRequest, type CreateRequest, type ScenarioOptions } from './newGame.js';

const terrainIdentity = `engine-terrain-v1:sha256:${'a'.repeat(64)}`;
const scenarioRevision = `engine-scenario-v1:sha256:${'b'.repeat(64)}`;
const battlefield: ScenarioBattlefield = {
  map: {
    id: 'bridge:default',
    name: 'Bridge battlefield',
    source: 'scenario-default',
    terrainIdentity,
    widthM: 4000,
    heightM: 3000,
    preview: [],
  },
  pairing: {
    id: 'bridge:default',
    revision: scenarioRevision,
    scenarioId: 'bridge',
    scenarioRevision,
    terrainIdentity,
  },
  capabilities: { addMaps: false },
};
const options: ScenarioOptions = {
  opponent: 'scripted',
  scenarios: [
    {
      id: 'bridge',
      name: 'Bridge',
      briefing: 'Defend the crossing.',
      lengthMinutes: 50,
      sides: [
        { id: 'blue', name: 'Blue', controller: 'human' },
        { id: 'red', name: 'Red', controller: 'scripted' },
      ],
      defaults: { side: 'blue', rate: 12 },
      battlefield,
    },
  ],
};

describe('new-game metadata transport', () => {
  it('preserves the server descriptor without creating a game or altering scenario defaults', async () => {
    const calls: string[] = [];
    const loaded = await fetchScenarioOptions(async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify(options));
    });
    expect(calls).toEqual(['/scenarios']);
    expect(loaded.scenarios[0]!.battlefield).toEqual(battlefield);
    expect(initialForm(loaded)).toEqual(initialForm(options));
  });

  it('keeps the existing scenario-only immediate-create request even when a pairing is displayed', async () => {
    const request = toRequest(initialForm(options)!, options);
    let sent: unknown;
    const game = await createGame(request, async (url, init) => {
      expect(url).toBe('/games');
      expect(init?.method).toBe('POST');
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: 'new-game' }), { status: 201 });
    });
    expect(game).toBe('new-game');
    expect(sent).toEqual({
      scenario: 'bridge',
      side: 'blue',
      rate: 12,
      dial: 'standard',
      persona: 'dry',
      sessionType: 'co_op_vs_ai',
    });
  });

  it('still accepts an older server without battlefield metadata', async () => {
    const oldScenario = { ...options.scenarios[0]!, battlefield: undefined };
    const loaded = await fetchScenarioOptions(
      async () => new Response(JSON.stringify({ ...options, scenarios: [oldScenario] })),
    );
    expect(loaded.scenarios[0]!.battlefield).toBeUndefined();
    expect(toRequest(initialForm(loaded)!, loaded).scenario).toBe('bridge');
  });
});

const key = 'a6a2f415-21b7-44a4-ad57-199332364a98';
const encoder = new TextEncoder();
const scenarioLimit = 256 * 1024;
const createLimit = 64 * 1024;
function catalog(): BattlefieldCatalog {
  const entry = decodeApprovedBattlefield(
    {
      map: {
        ...battlefield.map,
        preview: [
          {
            id: 'bridge',
            kind: 'bridge',
            layer: 0,
            geometry: { shape: 'point', at: { x: 2050.001, y: 1500.001 }, radiusM: 110 },
          },
        ],
      },
      pairing: {
        ...battlefield.pairing,
        revision: `engine-pairing-v1:sha256:${'c'.repeat(64)}`,
        resolvedScenarioId: 'bridge-native-v1',
        assemblyVersion: 'engine-native-v1',
      },
      isDefault: true,
    },
    'bridge',
  );
  return { schemaVersion: 1, scenarioId: 'bridge', entries: [entry] };
}
function modernOptions() {
  return { ...options, scenarios: [{ ...options.scenarios[0]!, battlefields: catalog() }] };
}
function request(): CreateRequest {
  return {
    ...toRequest(initialForm(options)!, options),
    requestId: key,
    battlefieldVersion: 1,
    pairing: { pairingId: 'bridge:default', revision: catalog().entries[0]!.pairing.revision },
  };
}
function receipt(gameId = 'created-game', status = 'started', requestId = key) {
  return { requestId, gameId, status };
}
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function stream(chunks: Uint8Array[], status = 200, headers?: HeadersInit) {
  let index = 0;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>(
    {
      pull(c) {
        if (index === chunks.length) c.close();
        else c.enqueue(chunks[index++]!);
      },
      cancel,
    },
    { highWaterMark: 0 },
  );
  return { response: new Response(body, { status, headers }), body, cancel };
}
function padded(value: unknown, limit: number): Uint8Array {
  const text = JSON.stringify(value);
  return encoder.encode(text + ' '.repeat(limit - encoder.encode(text).length));
}
function sequence(...responses: Array<Response | Error>) {
  return vi.fn<typeof fetch>(async () => {
    const next = responses.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error('Unexpected extra request');
    return next;
  });
}
afterEach(() => {
  if (vi.isFakeTimers()) expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('bounded scenario collection', () => {
  it('validates a modern catalog against its independent parent and returns detached allowlisted metadata', async () => {
    const source = modernOptions();
    const f = vi.fn<typeof fetch>(async () => json({ ...source, initialWorld: { seed: 97 } }));
    const loaded = await fetchScenarioOptions(f);
    expect(f.mock.calls[0]![0]).toBe('/scenarios');
    expect(f.mock.calls[0]![1]).toMatchObject({
      credentials: 'same-origin',
      signal: expect.any(AbortSignal),
    });
    expect(loaded).toEqual(source);
    expect(Object.keys(loaded).sort()).toEqual(['opponent', 'scenarios']);
    expect(loaded.scenarios[0]!.battlefields).not.toBe(source.scenarios[0]!.battlefields);
    expect(loaded.scenarios[0]!.battlefields!.entries[0]!.map.preview[0]!.geometry).toEqual({
      shape: 'point',
      at: { x: 2050.001, y: 1500.001 },
      radiusM: 110,
    });
    loaded.scenarios[0]!.battlefields!.entries[0]!.map.preview.length = 0;
    expect(source.scenarios[0]!.battlefields.entries[0]!.map.preview).toHaveLength(1);
    const again = await fetchScenarioOptions(f);
    expect(again.scenarios[0]!.battlefields!.entries[0]!.map.preview).toHaveLength(1);
  });

  it.each([
    [
      'foreign parent',
      (value: ReturnType<typeof modernOptions>) => {
        value.scenarios[0]!.id = 'foreign';
      },
    ],
    [
      'foreign collection',
      (value: ReturnType<typeof modernOptions>) => {
        value.scenarios[0]!.battlefields.scenarioId = 'foreign';
      },
    ],
    [
      'foreign entry',
      (value: ReturnType<typeof modernOptions>) => {
        value.scenarios[0]!.battlefields.entries[0]!.pairing.scenarioId = 'foreign';
      },
    ],
    [
      'legacy pairing revision',
      (value: ReturnType<typeof modernOptions>) => {
        value.scenarios[0]!.battlefields.entries[0]!.pairing.revision = scenarioRevision;
      },
    ],
    [
      'missing default',
      (value: ReturnType<typeof modernOptions>) => {
        value.scenarios[0]!.battlefields.entries = [];
      },
    ],
    [
      'unbounded parent',
      (value: ReturnType<typeof modernOptions>) => {
        value.scenarios[0]!.id = 'a'.repeat(129);
      },
    ],
    [
      'parent trailing newline',
      (value: ReturnType<typeof modernOptions>) => {
        value.scenarios[0]!.id += '\n';
      },
    ],
  ])(
    'rejects %s despite a valid legacy preview, without leaking decoder details',
    async (_label, change) => {
      const value = modernOptions();
      change(value);
      await expect(fetchScenarioOptions(async () => json(value))).rejects.toThrow(
        'The scenarios could not be read. Check your connection and try again.',
      );
    },
  );

  it.each([null, { ...catalog(), initialWorld: { units: [] } }, battlefield])(
    'rejects a present malformed modern catalog rather than erasing it',
    async (battlefields) => {
      const value = { ...options, scenarios: [{ ...options.scenarios[0]!, battlefields }] };
      await expect(fetchScenarioOptions(async () => json(value))).rejects.toThrow(
        /scenarios could not be read/,
      );
    },
  );

  it('preserves optional invalid legacy preview metadata for the legacy UI without blocking scenario-only creation', async () => {
    const value = {
      ...options,
      scenarios: [{ ...options.scenarios[0]!, battlefield: { unavailable: true } }],
    };
    const loaded = await fetchScenarioOptions(async () => json(value));
    expect(loaded.scenarios[0]!.battlefield).toEqual({ unavailable: true });
    expect(toRequest(initialForm(loaded)!, loaded)).toEqual(
      toRequest(initialForm(options)!, options),
    );
  });

  it('accepts the exact byte limit and decodes Unicode split through individual bytes', async () => {
    const value = modernOptions();
    value.scenarios[0]!.name = 'Pont é 🗺';
    const bytes = padded(value, scenarioLimit);
    const first = encoder.encode(JSON.stringify(value)).length;
    const chunks = [
      ...Array.from(bytes.subarray(0, first), (byte) => Uint8Array.of(byte)),
      bytes.subarray(first),
    ];
    const response = stream(chunks);
    const loaded = await fetchScenarioOptions(async () => response.response);
    expect(loaded.scenarios[0]!.name).toBe('Pont é 🗺');
    expect(bytes.byteLength).toBe(scenarioLimit);
    expect(response.body.locked).toBe(false);
  });

  it.each([undefined, '1'])(
    'rejects one byte beyond the limit with Content-Length=%s and cancels the reader',
    async (length) => {
      const response = stream(
        [padded(options, scenarioLimit), Uint8Array.of(32), Uint8Array.of(32)],
        200,
        length ? { 'Content-Length': length } : undefined,
      );
      await expect(fetchScenarioOptions(async () => response.response)).rejects.toThrow(
        /scenarios could not be read/,
      );
      expect(response.cancel).toHaveBeenCalledTimes(1);
      expect(response.body.locked).toBe(false);
    },
  );

  it('counts actual Unicode bytes rather than string length', async () => {
    const value = JSON.stringify({ ...options, padding: 'é'.repeat(scenarioLimit / 2) });
    expect(value.length).toBeLessThan(scenarioLimit);
    expect(encoder.encode(value).length).toBeGreaterThan(scenarioLimit);
    const response = stream([encoder.encode(value), Uint8Array.of(32)]);
    await expect(fetchScenarioOptions(async () => response.response)).rejects.toThrow(
      /scenarios could not be read/,
    );
    expect(response.cancel).toHaveBeenCalledTimes(1);
  });

  it.each([
    encoder.encode('{'),
    new Uint8Array([0xc3, 0x28]),
    encoder.encode('null'),
    encoder.encode('{"scenarios":{}}'),
  ])('rejects malformed JSON/UTF-8/envelopes', async (bytes) => {
    await expect(fetchScenarioOptions(async () => stream([bytes]).response)).rejects.toThrow(
      /scenarios could not be read/,
    );
  });

  it('retains the readable legacy HTTP error message while bounding its error stream too', async () => {
    const response = stream([new Uint8Array(scenarioLimit + 1), Uint8Array.of(32)], 503);
    await expect(fetchScenarioOptions(async () => response.response)).rejects.toThrow(
      'Could not load the scenarios (503).',
    );
    expect(response.cancel).toHaveBeenCalledTimes(1);
  });
});

describe('bounded creation and receipt reconciliation', () => {
  it('sends the exact modern request once and recovers a lost acknowledgement through an authenticated owner GET', async () => {
    const req = request();
    req.requestId = 'key /?#';
    const f = sequence(
      new Error('lost acknowledgement'),
      json(receipt('same-game', 'lobby', req.requestId)),
    );
    expect(await createGame(req, f)).toBe('same-game');
    expect(f.mock.calls.map((call) => [call[0], call[1]?.method])).toEqual([
      ['/games', 'POST'],
      ['/game-creations/key%20%2F%3F%23', 'GET'],
    ]);
    expect(f.mock.calls[0]![1]).toMatchObject({
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      signal: expect.any(AbortSignal),
    });
    expect(JSON.parse(String(f.mock.calls[0]![1]?.body))).toEqual(req);
    expect(f.mock.calls[1]![1]).toMatchObject({
      credentials: 'same-origin',
      signal: expect.any(AbortSignal),
    });
  });

  it.each([
    new Response('{', { status: 201 }),
    json({ id: 'bad/id' }, 201),
    json({ id: 'created-game', status: 'pending' }, 202),
    json({ error: 'recovery' }, 503),
  ])(
    'reconciles truncated/invalid success and server failures without repeating POST',
    async (response) => {
      const f = sequence(response, json(receipt()));
      expect(await createGame(request(), f)).toBe('created-game');
      expect(f.mock.calls.map((call) => call[1]?.method)).toEqual(['POST', 'GET']);
    },
  );

  it.each(['started', 'lobby'])(
    'checks expected key, game ID and %s status in a receipt',
    async (status) => {
      const f = sequence(
        json({ error: 'creation_recovery_required', id: 'known-game' }, 503),
        json(receipt('known-game', status)),
      );
      expect(await createGame(request(), f)).toBe('known-game');
    },
  );

  it.each([
    ['foreign key', receipt('known-game', 'started', 'foreign-key')],
    ['foreign game', receipt('another-game')],
    ['pending', receipt('known-game', 'pending')],
    ['recovery required', receipt('known-game', 'recovery_required')],
    ['unknown status', receipt('known-game', 'reserved')],
    ['missing status', { requestId: key, gameId: 'known-game' }],
    ['invalid game ID', receipt('bad/id')],
    ['oversized game ID', receipt('a'.repeat(129))],
    ['conflicting ID alias', { ...receipt('known-game'), id: 'another-game' }],
    ['nonobject receipt', null],
  ])('retains the original key for %s', async (_label, body) => {
    const f = sequence(json({ id: 'known-game' }, 503), json(body));
    await expect(createGame(request(), f)).rejects.toEqual(new CreationPendingError(key));
    expect(f).toHaveBeenCalledTimes(2);
  });

  it.each([404, 409, 410, 401, 503, 202])(
    'receipt HTTP %i never authorizes fresh allocation',
    async (status) => {
      const f = sequence(new Error('lost ack'), json(receipt(), status));
      const result = createGame(request(), f);
      await expect(result).rejects.toEqual(new CreationPendingError(key));
      await expect(result).rejects.toBeInstanceOf(CreationPendingError);
      await expect(result).rejects.toMatchObject({ requestId: key });
      expect(f.mock.calls.map((call) => call[1]?.method)).toEqual(['POST', 'GET']);
    },
  );

  it.each(['request_conflict', 'request_ambiguous', 'request_removed', 'unknown_conflict'])(
    'retains the key on create 409 %s without treating it as a definite rejection',
    async (error) => {
      const f = sequence(json({ error }, 409));
      await expect(createGame(request(), f)).rejects.toEqual(new CreationPendingError(key));
      expect(f).toHaveBeenCalledTimes(1);
    },
  );

  it('never trusts contradictory game IDs in the POST response even if a receipt matches one alias', async () => {
    const f = sequence(json({ id: 'one', gameId: 'two' }, 201), json(receipt('one')));
    await expect(createGame(request(), f)).rejects.toEqual(new CreationPendingError(key));
  });

  it('takes an immutable snapshot of request body/key before an unresolved POST', async () => {
    const req = request();
    const original = structuredClone(req);
    const gate = deferred<Response>();
    const f = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(() => gate.promise)
      .mockResolvedValueOnce(json(receipt()));
    const result = createGame(req, f);
    req.requestId = 'changed-key';
    req.pairing!.revision = 'changed-revision';
    gate.resolve(new Response('{', { status: 201 }));
    expect(await result).toBe('created-game');
    expect(JSON.parse(String(f.mock.calls[0]![1]?.body))).toEqual(original);
    expect(f.mock.calls[1]![0]).toBe(`/game-creations/${key}`);
  });

  it('accepts exactly 64 KiB create, receipt and error bodies without unbounded convenience reads', async () => {
    const parseJson = vi.spyOn(Response.prototype, 'json');
    const parseText = vi.spyOn(Response.prototype, 'text');
    const created = stream([padded({ id: 'created-game' }, createLimit)], 201);
    expect(await createGame(request(), async () => created.response)).toBe('created-game');
    const reconciled = stream([padded(receipt(), createLimit)]);
    expect(await createGame(request(), sequence(new Error('lost ack'), reconciled.response))).toBe(
      'created-game',
    );
    const error = stream([padded({ error: 'bad_side' }, createLimit)], 400);
    await expect(createGame(request(), async () => error.response)).rejects.toThrow(
      'That side is not available in this scenario. Choose another.',
    );
    await fetchScenarioOptions(async () => json(options));
    expect(parseJson).not.toHaveBeenCalled();
    expect(parseText).not.toHaveBeenCalled();
    expect([created.body.locked, reconciled.body.locked, error.body.locked]).toEqual([
      false,
      false,
      false,
    ]);
  });

  it.each(['create', 'receipt', 'error'])(
    'bounds actual %s bytes at 64 KiB, cancelling oversized bodies',
    async (phase) => {
      const value =
        phase === 'receipt'
          ? receipt()
          : phase === 'error'
            ? { error: 'bad_side' }
            : { id: 'created-game' };
      const response = stream(
        [padded(value, createLimit), Uint8Array.of(32), Uint8Array.of(32)],
        phase === 'error' ? 400 : phase === 'create' ? 201 : 200,
        { 'Content-Length': '1' },
      );
      const f =
        phase === 'receipt'
          ? sequence(new Error('lost ack'), response.response)
          : sequence(response.response, json({}, 404));
      await expect(createGame(request(), f)).rejects.toEqual(new CreationPendingError(key));
      expect(response.cancel).toHaveBeenCalledTimes(1);
      expect(response.body.locked).toBe(false);
      expect(f.mock.calls.map((call) => call[1]?.method)).toEqual(['POST', 'GET']);
    },
  );

  it.each(['bad/id', 'id\n', '', 'a'.repeat(129)])(
    'rejects an invalid legacy success ID %j without reconciliation',
    async (id) => {
      const f = sequence(json({ id }, 201));
      await expect(createGame(toRequest(initialForm(options)!, options), f)).rejects.toThrow(
        'The game response could not be read. Check Your games.',
      );
      expect(f).toHaveBeenCalledTimes(1);
    },
  );

  it('preserves legacy network/error messages and performs no keyless reconciliation', async () => {
    const req = toRequest(initialForm(options)!, options);
    const f = sequence(new Error('sensitive network text'));
    await expect(createGame(req, f)).rejects.toThrow(
      'Could not reach the server. Check your connection and try again.',
    );
    expect(f).toHaveBeenCalledTimes(1);
    await expect(createGame(req, async () => json({ error: 'bad_scenario' }, 400))).rejects.toThrow(
      'That scenario is no longer available. Choose another.',
    );
    await expect(createGame(req, async () => new Response('{', { status: 401 }))).rejects.toThrow(
      'You are signed out. Sign in again, then press Start.',
    );
  });
});

describe('transport deadline and cancellation', () => {
  it('does not fetch an already-aborted scenario or create call', async () => {
    const controller = new AbortController();
    controller.abort();
    const f = vi.fn<typeof fetch>();
    await expect(fetchScenarioOptions(f, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    await expect(createGame(request(), f, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(f).not.toHaveBeenCalled();
  });

  it.each(['fetch', 'body'])(
    'times out a non-cooperating scenario %s at 30s and promptly cleans up',
    async (phase) => {
      vi.useFakeTimers();
      const late = deferred<Response>();
      const reading = deferred<void>();
      const cancel = vi.fn(() => new Promise<void>(() => {}));
      const body = new ReadableStream<Uint8Array>(
        {
          pull() {
            reading.resolve();
          },
          cancel,
        },
        { highWaterMark: 0 },
      );
      const f = vi.fn<typeof fetch>(
        phase === 'fetch' ? () => late.promise : async () => new Response(body),
      );
      const result = fetchScenarioOptions(f);
      const assertion = expect(result).rejects.toThrow(
        'Loading the scenarios took too long. Please try again.',
      );
      if (phase === 'body') await reading.promise;
      let done = false;
      void result.catch(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(29_999);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await assertion;
      expect(f.mock.calls[0]![1]?.signal?.aborted).toBe(true);
      if (phase === 'body') {
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(body.locked).toBe(false);
      } else {
        const response = stream([encoder.encode(JSON.stringify(options))]);
        late.resolve(response.response);
        await late.promise;
        expect(response.cancel).toHaveBeenCalledTimes(1);
      }
    },
  );

  it('limits both an ignored POST and its ignored reconciliation independently without retrying POST', async () => {
    vi.useFakeTimers();
    const f = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
    const result = createGame(request(), f);
    const assertion = expect(result).rejects.toEqual(new CreationPendingError(key));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.mock.calls.map((call) => call[1]?.method)).toEqual(['POST', 'GET']);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(f.mock.calls.every((call) => call[1]?.signal?.aborted)).toBe(true);
  });

  it('keeps a known conflict pending even when its body times out, rather than recovering a different intent', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const f = sequence(new Response(body, { status: 409 }), json(receipt()));
    const result = createGame(request(), f);
    const assertion = expect(result).rejects.toEqual(new CreationPendingError(key));
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;
    expect(f).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
  });

  it('aborts a pending body, releases its reader/listener and reports AbortError for scenario reads', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const reading = deferred<void>();
    const cancel = vi.fn(async () => {
      throw new Error('Cancel failed');
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
    const result = fetchScenarioOptions(async () => new Response(body), controller.signal);
    await reading.promise;
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(body.locked).toBe(false);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it.each(['POST', 'GET'])(
    'retains a dispatched creation key on abort during %s and discards the late response',
    async (phase) => {
      const controller = new AbortController();
      const late = deferred<Response>();
      const started = deferred<void>();
      const f = vi.fn<typeof fetch>(async (_url, init) => {
        if (phase === 'GET' && init?.method === 'POST') throw new Error('Lost ack');
        started.resolve();
        return late.promise;
      });
      const result = createGame(request(), f, controller.signal);
      await started.promise;
      controller.abort();
      await expect(result).rejects.toEqual(new CreationPendingError(key));
      const response = stream([
        encoder.encode(JSON.stringify(phase === 'GET' ? receipt() : { id: 'created-game' })),
      ]);
      late.resolve(response.response);
      await f.mock.results.at(-1)!.value;
      expect(response.cancel).toHaveBeenCalledTimes(1);
      expect(f.mock.calls.map((call) => call[1]?.method)).toEqual(
        phase === 'POST' ? ['POST'] : ['POST', 'GET'],
      );
    },
  );

  it.each(['scenario', 'create', 'receipt'])(
    'rejects late abort between EOF and %s result publication',
    async (phase) => {
      const controller = new AbortController();
      let sent = false;
      const value =
        phase === 'scenario' ? options : phase === 'receipt' ? receipt() : { id: 'created-game' };
      const body = new ReadableStream<Uint8Array>(
        {
          pull(c) {
            if (!sent) {
              sent = true;
              c.enqueue(encoder.encode(JSON.stringify(value)));
            } else {
              c.close();
              queueMicrotask(() => queueMicrotask(() => controller.abort()));
            }
          },
        },
        { highWaterMark: 0 },
      );
      const f =
        phase === 'receipt'
          ? sequence(new Error('lost ack'), new Response(body))
          : sequence(new Response(body));
      const result =
        phase === 'scenario'
          ? fetchScenarioOptions(f, controller.signal)
          : createGame(request(), f, controller.signal);
      if (phase === 'scenario') await expect(result).rejects.toMatchObject({ name: 'AbortError' });
      else await expect(result).rejects.toEqual(new CreationPendingError(key));
      expect(body.locked).toBe(false);
    },
  );
});

describe('optional durable library capability projection', () => {
  it('preserves only the exact supported advertisement as a boolean without changing ordinary setup or create requests', async () => {
    const baseline = modernOptions();
    const source = { ...baseline, mapLibrary: { schemaVersion: 1, available: true } };
    const f = vi.fn<typeof fetch>().mockResolvedValue(json(source));
    const result = await fetchScenarioOptions(f);
    expect(result.mapLibrary).toBe(true);
    expect(result.scenarios).toEqual(source.scenarios);
    expect(result.scenarios[0]).not.toBe(source.scenarios[0]);
    expect(initialForm(result)).toEqual(initialForm(baseline));
    expect(toRequest(initialForm(result)!, result)).toEqual(
      toRequest(initialForm(baseline)!, baseline),
    );
    expect(toRequest(initialForm(result)!, result)).not.toHaveProperty('mapLibrary');
    expect(f).toHaveBeenCalledExactlyOnceWith(
      '/scenarios',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it.each([
    undefined,
    null,
    true,
    false,
    'true',
    [],
    {},
    { schemaVersion: 1 },
    { available: true },
    { schemaVersion: 1, available: false },
    { schemaVersion: 2, available: true },
    { schemaVersion: '1', available: true },
    { schemaVersion: 1, available: 'true' },
    { schemaVersion: 1, available: 1 },
    { schemaVersion: 1, available: true, ownerId: 'private' },
    { schemaVersion: 1, available: true, temporary: true },
  ])(
    'omits unknown, false or malformed capability %j while preserving ordinary scenario setup',
    async (mapLibrary) => {
      const source = { ...options, mapLibrary };
      const result = await fetchScenarioOptions(async () => json(source));
      expect(Object.hasOwn(result, 'mapLibrary')).toBe(false);
      expect(result).toEqual(options);
      expect(initialForm(result)).toEqual(initialForm(options));
      expect(toRequest(initialForm(result)!, result)).toEqual(
        toRequest(initialForm(options)!, options),
      );
    },
  );

  it('does not promote a per-scenario or unknown root advertisement into the durable capability', async () => {
    const source = {
      ...options,
      library: { schemaVersion: 1, available: true },
      scenarios: [{ ...options.scenarios[0]!, mapLibrary: { schemaVersion: 1, available: true } }],
    };
    expect(await fetchScenarioOptions(async () => json(source))).toEqual(options);
  });
});
