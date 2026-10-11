import type {
  HqNavigation,
  MapSurface,
  Operation,
  Result,
  Scope,
  Selection,
  ShellState,
  ViewId,
} from '../contracts';

export const sameScope = (a: Scope, b: Scope): boolean =>
  a.gameId === b.gameId && a.sideId === b.sideId && a.playerId === b.playerId;

export const routes: ReadonlyArray<{ view: ViewId; label: string; object: string; key: string }> = [
  { view: 'table', label: 'Map table', object: 'Campaign map', key: 'm' },
  { view: 'in-tray', label: 'In-tray', object: 'Incoming papers', key: 'i' },
  { view: 'orders', label: 'Orders', object: 'Writing folio', key: 'o' },
  { view: 'roster', label: 'Roster', object: 'Muster book', key: 'r' },
  { view: 'journal', label: 'Journal', object: 'Day book', key: 'j' },
  { view: 'conference', label: 'Conference', object: 'Staff chairs', key: 'c' },
  { view: 'terrain-studies', label: 'Terrain studies', object: 'Survey portfolio', key: 't' },
  { view: 'replay', label: 'Replay', object: 'Archive case', key: 'p' },
];

const failure = (
  code: 'aborted' | 'disposed' | 'scope-mismatch' | 'internal' | 'invalid-data',
  message: string,
): Result<never> => ({ ok: false, error: { code, message, retry: 'never' } });

export interface NavigationOptions {
  surface: MapSurface;
  reducedMotion: () => boolean;
  /** Resolves after DOM focus transfer. null means the active heading. */
  focus: (view: ViewId, key: string | null, signal: AbortSignal) => void | Promise<void>;
}

const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 128;
function dataRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Reflect.ownKeys(value).every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return typeof key === 'string' && !!descriptor && 'value' in descriptor;
    })
  );
}
function validScope(value: unknown): value is Scope {
  try {
    return (
      dataRecord(value) &&
      Object.keys(value).length === 3 &&
      identifier(value.gameId) &&
      identifier(value.sideId) &&
      identifier(value.playerId)
    );
  } catch {
    return false;
  }
}
function validSelection(value: unknown): value is Selection {
  try {
    if (!dataRecord(value)) return false;
    return value.kind === 'none'
      ? Object.keys(value).length === 1
      : (value.kind === 'unit' || value.kind === 'paper') &&
          Object.keys(value).length === 3 &&
          identifier(value.id) &&
          validScope(value.scope);
  } catch {
    return false;
  }
}
const frozenScope = (scope: Scope): Scope =>
  Object.freeze({ gameId: scope.gameId, sideId: scope.sideId, playerId: scope.playerId });
function frozenSelection(selection: Selection): Selection {
  return selection.kind === 'none'
    ? Object.freeze({ kind: 'none' })
    : Object.freeze({
        kind: selection.kind,
        id: selection.id,
        scope: frozenScope(selection.scope),
      });
}

/** One session, one surface; published values never alias caller-owned objects. */
export function createHqNavigation(options: NavigationOptions): HqNavigation {
  const { surface } = options;
  if (!validScope(surface.scope)) throw new Error('Invalid navigation scope.');
  const scope = frozenScope(surface.scope);
  const makeState = (view: ViewId, selection: Selection): ShellState =>
    Object.freeze({ scope, view, selection: frozenSelection(selection) });
  let state = makeState('table', { kind: 'none' });
  const listeners = new Set<(state: ShellState) => void>();
  let disposed = false;
  const lifetime = new AbortController();
  let active: AbortController | null = null;
  let sequence = 0;
  let queue: Promise<unknown> = Promise.resolve();
  let returnKey: string | null = null;
  const deliver = (listener: (state: ShellState) => void) => {
    try {
      listener(state);
    } catch {
      /* Isolate consumers, including initial delivery. */
    }
  };
  const publish = () => {
    for (const listener of listeners) deliver(listener);
  };
  return {
    scope,
    getState: () => state,
    subscribe(listener) {
      deliver(listener);
      if (!disposed) listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    select(selection: Selection) {
      if (disposed) return failure('disposed', 'Navigation is closed.');
      if (!validSelection(selection)) return failure('invalid-data', 'Invalid HQ selection.');
      if (selection.kind !== 'none' && !sameScope(selection.scope, scope))
        return failure('scope-mismatch', 'Selection belongs to another HQ session.');
      state = makeState(state.view, selection);
      publish();
      return { ok: true, value: state };
    },
    navigate(view: ViewId, key: string | null, op: Operation) {
      if (disposed) return Promise.resolve(failure('disposed', 'Navigation is closed.'));
      if (!routes.some((route) => route.view === view) || (key !== null && !identifier(key)))
        return Promise.resolve(failure('invalid-data', 'Invalid HQ route.'));
      const ticket = ++sequence;
      active?.abort();
      const controller = new AbortController();
      active = controller;
      const abort = () => controller.abort();
      op.signal.addEventListener('abort', abort, { once: true });
      if (op.signal.aborted) abort();
      const run = async (): Promise<Result<ShellState>> => {
        const obsolete = () => disposed || ticket !== sequence || controller.signal.aborted;
        const previous = state.view;
        const previousReturnKey = returnKey;
        let camera: ReturnType<MapSurface['getCamera']> | null = null;
        let moved = false;
        // Rollback also covers the tentative DOM state needed for heading focus.
        // It remains inside this queued operation, before any successor can start.
        const rollback = async (): Promise<Result<void>> => {
          if (disposed) return failure('disposed', 'Navigation is closed.');
          let error: Result<void> = { ok: true, value: undefined };
          const check = (result: Result<void>) => {
            if (!result.ok && error.ok) error = result;
          };
          try {
            check(
              await surface.transitionTo(previous === 'table' ? 'table' : 'desk', true, {
                signal: lifetime.signal,
              }),
            );
            if (disposed) return failure('disposed', 'Navigation is closed.');
            if (camera?.ok) check(surface.restoreCamera(camera.value));
            check(surface.setActive(previous === 'table'));
          } catch {
            error = failure('internal', 'The desk could not be restored.');
          }
          if (!disposed) {
            returnKey = previousReturnKey;
            state = makeState(previous, state.selection);
            publish();
            try {
              await options.focus(
                previous,
                previous === 'table' ? (key ?? previousReturnKey) : null,
                lifetime.signal,
              );
            } catch {
              error = failure('internal', 'The desk focus could not be restored.');
            }
          }
          return error;
        };
        try {
          if (obsolete()) return failure('aborted', 'Navigation canceled.');
          camera = surface.getCamera();
          const activated = surface.setActive(true);
          if (!activated.ok) return activated;
          moved = true;
          const transition = await surface.transitionTo(
            view === 'table' ? 'table' : 'desk',
            options.reducedMotion(),
            { signal: controller.signal },
          );
          if (!transition.ok || obsolete()) {
            const restored = await rollback();
            if (!restored.ok && !disposed) return restored;
            return obsolete()
              ? failure('aborted', 'Navigation canceled.')
              : (transition as Result<never>);
          }
          const settled = surface.setActive(view === 'table');
          if (!settled.ok) {
            const restored = await rollback();
            return restored.ok ? settled : restored;
          }
          if (previous === 'table' && view !== 'table') returnKey = key;
          state = makeState(view, state.selection);
          publish();
          await options.focus(view, view === 'table' ? returnKey : null, controller.signal);
          if (obsolete()) {
            const restored = await rollback();
            return !restored.ok && !disposed
              ? restored
              : failure('aborted', 'Navigation canceled.');
          }
          return { ok: true, value: state };
        } catch {
          if (moved && !disposed) {
            const restored = await rollback();
            if (!restored.ok) return restored;
          }
          return obsolete()
            ? failure('aborted', 'Navigation canceled.')
            : failure('internal', 'The desk transition failed. Please try again.');
        } finally {
          op.signal.removeEventListener('abort', abort);
        }
      };
      const result = queue.then(run, run);
      queue = result;
      return result;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      sequence++;
      active?.abort();
      lifetime.abort();
      listeners.clear();
    },
  };
}
