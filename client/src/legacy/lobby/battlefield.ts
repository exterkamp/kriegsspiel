import { decodeApprovedBattlefield, type ApprovedBattlefield } from '@kriegsspiel/protocol';
import { battlefieldMap } from '../table/battlefieldMap.js';
import type { BaseMap } from '../table/types.js';

export interface GameBattlefield {
  gameId: string;
  scenarioId: string;
  battlefield: ApprovedBattlefield;
  map: BaseMap;
}

export type GameBattlefieldErrorKind = 'sign-in' | 'reload' | 'missing' | 'unavailable';

const messages: Record<GameBattlefieldErrorKind, string> = {
  'sign-in': 'Sign in to view this battlefield.',
  reload: 'Reload to view this battlefield.',
  missing: 'This game is unavailable.',
  unavailable: 'The battlefield is unavailable. Please try again.',
};

export class GameBattlefieldError extends Error {
  constructor(readonly kind: GameBattlefieldErrorKind) {
    super(messages[kind]);
    this.name = 'GameBattlefieldError';
  }
}

const maxBytes = 256 * 1024;
const scenarioIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/;

function abortError(): DOMException {
  return new DOMException('The request was aborted.', 'AbortError');
}

/** Cancellation must not mask the original failure, or leave a rejected promise unobserved. */
function discard(body: ReadableStream<Uint8Array> | null): void {
  if (body) void body.cancel().catch(() => {});
}

/** Fetch only the public, parent-bound terrain; the caller owns connection lifetime and retries. */
export async function fetchGameBattlefield(
  gameId: string,
  signal: AbortSignal,
  f: typeof fetch = fetch,
): Promise<GameBattlefield> {
  if (signal.aborted) throw abortError();

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let cancelled = false;
  let consumed = false;
  const cancelReader = () => {
    if (reader && !cancelled && !consumed) {
      cancelled = true;
      // Do not wait for an underlying source that ignores cancellation to acknowledge it.
      void reader.cancel().catch(() => {});
    }
  };
  let rejectAbort!: (error: DOMException) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  // Observe even an abort triggered synchronously by an injected fetch before the first race.
  void aborted.catch(() => {});
  const onAbort = () => {
    cancelReader();
    rejectAbort(abortError());
  };
  signal.addEventListener('abort', onAbort, { once: true });

  const readBattlefield = async (): Promise<GameBattlefield> => {
    const response = await f(`/games/${encodeURIComponent(gameId)}?battlefieldVersion=1`, {
      method: 'GET',
      credentials: 'same-origin',
      signal,
    });
    // Fetch implementations may resolve after abort. Dispose of that body as well.
    if (signal.aborted) {
      discard(response.body);
      throw abortError();
    }
    if (!response.ok) {
      discard(response.body);
      throw new GameBattlefieldError(
        response.status === 401
          ? 'sign-in'
          : response.status === 426
            ? 'reload'
            : response.status === 404
              ? 'missing'
              : 'unavailable',
      );
    }
    if (!response.body) throw new GameBattlefieldError('unavailable');
    reader = response.body.getReader();
    const bytes = new Uint8Array(maxBytes);
    let length = 0;
    for (;;) {
      const chunk = await reader.read();
      if (signal.aborted) throw abortError();
      if (chunk.done) {
        consumed = true;
        break;
      }
      if (!(chunk.value instanceof Uint8Array) || chunk.value.byteLength > maxBytes - length)
        throw new GameBattlefieldError('unavailable');
      bytes.set(chunk.value, length);
      length += chunk.value.byteLength;
    }

    const value: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)),
    );
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      throw new GameBattlefieldError('unavailable');
    const envelope = value as Record<string, unknown>;
    const scenarioId = envelope['scenario'];
    if (
      envelope['id'] !== gameId ||
      typeof scenarioId !== 'string' ||
      scenarioId.length > 128 ||
      scenarioId.trim() !== scenarioId ||
      !scenarioIdPattern.test(scenarioId)
    )
      throw new GameBattlefieldError('unavailable');
    const battlefield = decodeApprovedBattlefield(envelope['battlefield'], scenarioId);
    const map = battlefieldMap(battlefield, scenarioId);
    if (signal.aborted) throw abortError();
    return { gameId, scenarioId, battlefield, map };
  };

  try {
    // One lifetime race avoids retaining an abort reaction for every streamed chunk.
    const result = await Promise.race([readBattlefield(), aborted]);
    if (signal.aborted) throw abortError();
    return result;
  } catch (error) {
    if (signal.aborted) throw abortError();
    if (error instanceof GameBattlefieldError) throw error;
    throw new GameBattlefieldError('unavailable');
  } finally {
    signal.removeEventListener('abort', onAbort);
    cancelReader();
    reader?.releaseLock();
  }
}
