/** The new-game screen's two calls: the scenario list and game creation. */
import { decodeBattlefieldCatalog } from '@kriegsspiel/protocol';
import {
  createErrorMessage,
  type CreateRequest,
  type ScenarioInfo,
  type ScenarioOptions,
} from './newGame.js';

type Fetch = typeof fetch;
type JsonResponse = { status: number; ok: boolean; body: unknown };
const scenariosBytes = 256 * 1024;
const creationBytes = 64 * 1024;
const deadlineMs = 30_000;
const networkMessage = 'Could not reach the server. Check your connection and try again.';
const unreadMessage = 'The game response could not be read. Check Your games.';
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const validId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 128 &&
  value.trim() === value &&
  /^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/.test(value);
const ready = (value: unknown): boolean => value === 'started' || value === 'lobby';
const abortError = () => new DOMException('The request was aborted.', 'AbortError');

class ResponseReadError extends Error {
  constructor(
    readonly status: number,
    readonly timedOut = false,
  ) {
    super('Unreadable response');
  }
}

function discard(body: ReadableStream<Uint8Array> | null): void {
  if (body) void body.cancel().catch(() => {});
}

/** One bounded HTTP lifetime, including a non-cooperating fetch/body and late completion. */
async function readResponse(
  f: Fetch,
  url: string,
  init: RequestInit,
  limit: number,
  caller?: AbortSignal,
): Promise<JsonResponse> {
  if (caller?.aborted) throw abortError();
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let consumed = false;
  let cancelled = false;
  let responseStatus: number | undefined;
  const cancel = () => {
    if (reader && !consumed && !cancelled) {
      cancelled = true;
      // A source may never acknowledge cancellation. Observe rejection without waiting for it.
      void reader.cancel().catch(() => {});
    }
  };
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  void aborted.catch(() => {});
  const onAbort = () => {
    cancel();
    rejectAbort(controller.signal.reason);
  };
  const onCaller = () => controller.abort(abortError());
  controller.signal.addEventListener('abort', onAbort, { once: true });
  caller?.addEventListener('abort', onCaller, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException('The request timed out.', 'TimeoutError')),
    deadlineMs,
  );

  const read = async (): Promise<JsonResponse> => {
    const response = await f(url, {
      ...init,
      credentials: 'same-origin',
      signal: controller.signal,
    });
    responseStatus = response.status;
    if (controller.signal.aborted) {
      discard(response.body);
      throw controller.signal.reason;
    }
    try {
      if (!response.body) throw new ResponseReadError(response.status);
      reader = response.body.getReader();
      const bytes = new Uint8Array(limit);
      let length = 0;
      let chunks = 0;
      for (;;) {
        const chunk = await reader.read();
        if (controller.signal.aborted) throw controller.signal.reason;
        if (chunk.done) {
          consumed = true;
          break;
        }
        if (
          ++chunks > limit + 1 ||
          !(chunk.value instanceof Uint8Array) ||
          chunk.value.byteLength > limit - length
        )
          throw new ResponseReadError(response.status);
        bytes.set(chunk.value, length);
        length += chunk.value.byteLength;
      }
      const body: unknown = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)),
      );
      return { status: response.status, ok: response.ok, body };
    } catch {
      if (controller.signal.aborted) throw controller.signal.reason;
      throw new ResponseReadError(response.status);
    }
  };
  try {
    // A single race for the whole lifetime avoids retaining one abort reaction per chunk.
    const result = await Promise.race([read(), aborted]);
    if (controller.signal.aborted) throw controller.signal.reason;
    return result;
  } catch (error) {
    if (controller.signal.aborted && !caller?.aborted && responseStatus !== undefined)
      throw new ResponseReadError(responseStatus, true);
    throw error;
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener('abort', onCaller);
    controller.signal.removeEventListener('abort', onAbort);
    cancel();
    reader?.releaseLock();
  }
}

function scenarioOptions(value: unknown): ScenarioOptions {
  const body = record(value);
  if (
    !body ||
    !Array.isArray(body['scenarios']) ||
    (body['opponent'] !== undefined &&
      body['opponent'] !== 'scripted' &&
      body['opponent'] !== 'ai_commander')
  )
    throw new Error('Invalid scenarios');
  const ids = new Set<string>();
  const scenarios = body['scenarios'].map((value): ScenarioInfo => {
    const scenario = record(value);
    const defaults = record(scenario?.['defaults']);
    if (
      !scenario ||
      !validId(scenario['id']) ||
      ids.has(scenario['id']) ||
      typeof scenario['name'] !== 'string' ||
      !scenario['name'].trim() ||
      typeof scenario['briefing'] !== 'string' ||
      typeof scenario['lengthMinutes'] !== 'number' ||
      !Number.isFinite(scenario['lengthMinutes']) ||
      !defaults ||
      !validId(defaults['side']) ||
      typeof defaults['rate'] !== 'number' ||
      !Number.isFinite(defaults['rate']) ||
      !Array.isArray(scenario['sides']) ||
      !scenario['sides'].length
    )
      throw new Error('Invalid scenario');
    ids.add(scenario['id']);
    const sides = scenario['sides'].map((value): ScenarioInfo['sides'][number] => {
      const side = record(value);
      if (
        !side ||
        !validId(side['id']) ||
        typeof side['name'] !== 'string' ||
        (side['controller'] !== 'human' && side['controller'] !== 'scripted')
      )
        throw new Error('Invalid side');
      return { id: side['id'], name: side['name'], controller: side['controller'] };
    });
    const result: ScenarioInfo = {
      id: scenario['id'],
      name: scenario['name'],
      briefing: scenario['briefing'],
      lengthMinutes: scenario['lengthMinutes'],
      sides,
      defaults: { side: defaults['side'], rate: defaults['rate'] },
    };
    // Legacy optional preview metadata is retained, including a preview that the legacy UI cannot check.
    if (Object.hasOwn(scenario, 'battlefield'))
      result.battlefield = scenario['battlefield'] as ScenarioInfo['battlefield'];
    if (Object.hasOwn(scenario, 'battlefields'))
      result.battlefields = decodeBattlefieldCatalog(scenario['battlefields'], result.id);
    return result;
  });
  const library = record(body['mapLibrary']);
  const mapLibrary =
    library &&
    Object.keys(library).length === 2 &&
    library['schemaVersion'] === 1 &&
    library['available'] === true;
  return {
    scenarios,
    opponent: body['opponent'] as ScenarioOptions['opponent'],
    ...(mapLibrary ? { mapLibrary: true } : {}),
  };
}

export async function fetchScenarioOptions(
  f: Fetch = fetch,
  signal?: AbortSignal,
): Promise<ScenarioOptions> {
  try {
    const response = await readResponse(f, '/scenarios', {}, scenariosBytes, signal);
    if (!response.ok) throw new ResponseReadError(response.status);
    const result = scenarioOptions(response.body);
    if (signal?.aborted) throw abortError();
    return result;
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (
      (error instanceof ResponseReadError && error.timedOut) ||
      (error instanceof DOMException && error.name === 'TimeoutError')
    )
      throw new Error('Loading the scenarios took too long. Please try again.');
    if (error instanceof ResponseReadError && (error.status < 200 || error.status >= 300))
      throw new Error(`Could not load the scenarios (${error.status}).`);
    throw new Error('The scenarios could not be read. Check your connection and try again.');
  }
}

/** An accepted result may exist: preserve the exact request/key until reconciliation or same-key retry. */
export class CreationPendingError extends Error {
  constructor(readonly requestId: string) {
    super('The server may have accepted this game. Retry creation to recover the same game.');
    this.name = 'CreationPendingError';
  }
}

async function reconcile(
  requestId: string,
  f: Fetch,
  signal?: AbortSignal,
  expectedGameId?: string | null,
): Promise<string> {
  try {
    const response = await readResponse(
      f,
      `/game-creations/${encodeURIComponent(requestId)}`,
      { method: 'GET' },
      creationBytes,
      signal,
    );
    const body = record(response.body);
    if (
      response.status === 200 &&
      body?.['requestId'] === requestId &&
      validId(body['gameId']) &&
      (expectedGameId === undefined || body['gameId'] === expectedGameId) &&
      ready(body['status']) &&
      (body['id'] === undefined || body['id'] === body['gameId']) &&
      !signal?.aborted
    )
      return body['gameId'];
  } catch {
    /* Failed, cancelled, missing or unresolved reconciliation never authorizes a new key. */
  }
  throw new CreationPendingError(requestId);
}

/** Makes and starts a game; never repeats POST. Ambiguous keyed results retain their key. */
export async function createGame(
  req: CreateRequest,
  f: Fetch = fetch,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw abortError();
  const requestId = req.requestId;
  const payload = JSON.stringify(req);
  const create = async (): Promise<string> => {
    let response: JsonResponse;
    try {
      response = await readResponse(
        f,
        '/games',
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: payload },
        creationBytes,
        signal,
      );
    } catch (error) {
      if (requestId) {
        if (
          signal?.aborted ||
          (error instanceof ResponseReadError && [409, 410].includes(error.status))
        )
          throw new CreationPendingError(requestId);
        return reconcile(requestId, f, signal);
      }
      if (signal?.aborted) throw abortError();
      if (error instanceof ResponseReadError)
        throw new Error(
          error.status >= 200 && error.status < 300
            ? unreadMessage
            : createErrorMessage(error.status, ''),
        );
      throw new Error(networkMessage);
    }
    const body = record(response.body);
    if (signal?.aborted) throw abortError();
    const expectedGameId =
      body?.['id'] !== undefined && body?.['gameId'] !== undefined && body['id'] !== body['gameId']
        ? null
        : validId(body?.['id'])
          ? body['id']
          : validId(body?.['gameId'])
            ? body['gameId']
            : undefined;
    if (!response.ok) {
      if (requestId && [409, 410].includes(response.status))
        throw new CreationPendingError(requestId);
      if (requestId && response.status >= 500)
        return reconcile(requestId, f, signal, expectedGameId);
      const code = typeof body?.['error'] === 'string' ? body['error'] : '';
      const message = typeof body?.['message'] === 'string' ? body['message'] : undefined;
      throw new Error(createErrorMessage(response.status, code, message));
    }
    if (
      validId(body?.['id']) &&
      (!requestId ||
        ((response.status === 200 || response.status === 201) &&
          (body['requestId'] === undefined || body['requestId'] === requestId) &&
          (body['gameId'] === undefined || body['gameId'] === body['id']) &&
          (body['status'] === undefined || ready(body['status']))))
    )
      return body['id'];
    if (requestId) return reconcile(requestId, f, signal, expectedGameId);
    throw new Error(unreadMessage);
  };
  try {
    const id = await create();
    if (signal?.aborted) throw abortError();
    return id;
  } catch (error) {
    if (signal?.aborted) {
      if (requestId) throw new CreationPendingError(requestId);
      throw abortError();
    }
    throw error;
  }
}
