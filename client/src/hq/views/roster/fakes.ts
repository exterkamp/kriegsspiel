/** Roster fixtures contain only supplied player knowledge. No engine or log imports. */
import { vi } from 'vitest';
import type {
  HqNavigation,
  HqSnapshot,
  Knowledge,
  MapSurface,
  Result,
  RosterRow,
  Scope,
  ShellState,
} from '../../contracts';
export const scope: Scope = { gameId: 'fixture', sideId: 'blue', playerId: 'one' };
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const failure = (
  message: string,
  code: 'aborted' | 'internal' | 'scope-mismatch' = 'internal',
): Result<never> => ({ ok: false, error: { code, message, retry: 'never' } });
export const known = <T>(value: T, atGame = 60000): Knowledge<T> => ({
  kind: 'snapshot',
  value,
  atGame,
});
export const unknown = <T>(reason = 'Not supplied'): Knowledge<T> => ({ kind: 'unknown', reason });
export function formation(unitId = 'own-1', name = 'First formation'): RosterRow {
  return {
    unitId,
    name,
    commander: unknown('Commander not supplied'),
    position: known({ x: 350, y: 250 }),
    strength: known(100),
    morale: known(0.5),
    supply: known(0.25),
  };
}
export function snapshot(roster: readonly RosterRow[] = [formation()]): HqSnapshot {
  return {
    scope,
    epoch: 'fixture-epoch',
    ordinal: 1,
    authorityRevision: null,
    atGame: 60000,
    clock: {
      authoritativeGameMs: 60000,
      rate: 1,
      status: 'paused',
      mode: 'manual',
      barrier: { kind: 'unknown' },
      coherence: 'fixture-atomic',
      receivedMonotonicMs: 0,
    },
    roster,
    papers: [],
    pieces: [
      {
        key: 'contact:enemy',
        unitId: 'enemy',
        relationship: 'enemy',
        label: 'Enemy contact',
        position: { x: 1000, y: 800 },
        provenance: 'fixture-contact',
        observedAtGame: null,
        ageMs: null,
        uncertaintyRadiusM: null,
        appearance: null,
      },
    ],
  };
}
export function makePorts() {
  let state: ShellState = { scope, view: 'roster', selection: { kind: 'none' } };
  const listeners = new Set<(state: ShellState) => void>();
  const emit = (next: ShellState) => {
    state = next;
    listeners.forEach((listener) => listener(next));
  };
  const navigation: HqNavigation = {
    scope,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    select: vi.fn((selection) => {
      if (
        selection.kind !== 'none' &&
        (selection.scope.gameId !== scope.gameId ||
          selection.scope.sideId !== scope.sideId ||
          selection.scope.playerId !== scope.playerId)
      )
        return failure('Wrong scope', 'scope-mismatch');
      emit({ ...state, selection });
      return ok(state);
    }),
    navigate: vi.fn(async (view, _key, op) => {
      if (op.signal.aborted) return failure('Canceled', 'aborted');
      emit({ ...state, view });
      return ok(state);
    }),
    dispose: vi.fn(),
  };
  const surface: MapSurface = {
    scope,
    coordinates: 'metres',
    implementation: 'continuous',
    acquireControls: vi.fn(() => ({ ok: true as const, value: () => {} })),
    mount: vi.fn(async () => ok(undefined)),
    apply: vi.fn(async () => ok(undefined)),
    resize: vi.fn(() => ok(undefined)),
    setActive: vi.fn(() => ok(undefined)),
    getCamera: vi.fn(() => failure('No camera')),
    restoreCamera: vi.fn(() => ok(undefined)),
    transitionTo: vi.fn(async () => ok(undefined)),
    snap: vi.fn(() => ok(undefined)),
    focusAt: vi.fn(async () => ok(undefined)),
    pickAt: vi.fn(() => ok({ kind: 'none' as const })),
    project: vi.fn(() => ok(null)),
    dispose: vi.fn(),
  };
  return { navigation, surface, emit, listeners };
}
