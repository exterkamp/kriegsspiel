/** Focused shell-test ports: no engine imports, transport or storage fallback. */
import { vi } from 'vitest';
import type {
  Capabilities,
  HqDataSource,
  HqError,
  HqRepository,
  HqSnapshot,
  LocalDocument,
  MapSurface,
  PublicArtwork,
  Result,
  Scope,
  SourceState,
} from '../contracts';
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (code: HqError['code'], message: string = code): Result<never> => ({
  ok: false,
  error: { code, message, retry: 'never' },
});
export const scope: Scope = { gameId: 'fixture', sideId: 'blue', playerId: 'one' };
export const artwork: PublicArtwork = {
  kind: 'public-artwork',
  id: 'public-map',
  revision: '2',
  widthM: 4000,
  heightM: 3000,
  image: { url: '/fixture-map.svg', pixelWidth: 1200, pixelHeight: 900 },
  registration: 'full-image-nw-origin',
  credit: 'Test artwork',
  licence: 'CC0',
  sourceUrl: null,
};
export function makePorts(session: Scope = scope) {
  const snapshot: HqSnapshot = {
    scope: session,
    epoch: 'epoch',
    ordinal: 1,
    authorityRevision: null,
    atGame: 10,
    clock: {
      authoritativeGameMs: 10,
      rate: 1,
      status: 'paused',
      mode: 'manual',
      barrier: { kind: 'unknown' },
      coherence: 'fixture-atomic',
      receivedMonotonicMs: 0,
    },
    roster: [],
    papers: [],
    pieces: [
      {
        key: 'own:one',
        unitId: 'one',
        relationship: 'own',
        label: 'Own piece',
        position: { x: 350, y: 250 },
        provenance: 'fixture-snapshot',
        observedAtGame: 10,
        ageMs: 0,
        uncertaintyRadiusM: null,
        appearance: null,
      },
      {
        key: 'contact:enemy',
        unitId: 'enemy',
        relationship: 'enemy',
        label: 'Contact',
        position: { x: 3100, y: 1200 },
        provenance: 'fixture-contact',
        observedAtGame: null,
        ageMs: null,
        uncertaintyRadiusM: null,
        appearance: null,
      },
    ],
  };
  let sourceState: SourceState = { connection: 'idle', stale: false, snapshot: null, error: null };
  const listeners = new Set<(state: SourceState) => void>();
  const emit = (state: SourceState) => {
    sourceState = state;
    listeners.forEach((listener) => listener(state));
  };
  const features = [
    'read-snapshot',
    'public-artwork',
    'clock-mode',
    'barrier-state',
    'clock-controls',
    'pause-voting',
    'roster-reports',
    'dispatch-sketches',
    'sign-order',
    'order-status',
    'courier-choice',
    'order-annex',
    'personal-marks',
    'shared-marks',
    'conference',
    'replay',
  ];
  const capabilities = Object.fromEntries(
    features.map((feature) => [
      feature,
      { state: 'unavailable', reason: `${feature} service unavailable.` },
    ]),
  ) as Capabilities;
  const source: HqDataSource = {
    kind: 'fixture',
    scope: session,
    capabilities,
    getState: () => sourceState,
    subscribe(listener) {
      listeners.add(listener);
      listener(sourceState);
      return () => {
        listeners.delete(listener);
      };
    },
    open: vi.fn(async () => {
      emit({ connection: 'ready', stale: false, snapshot, error: null });
      return ok(snapshot);
    }),
    refresh: vi.fn(async () => ok(snapshot)),
    dispose: vi.fn(() => listeners.clear()),
  };
  let saved: LocalDocument = {
    schemaVersion: 1,
    scope: session,
    revision: 'local-1',
    view: 'table',
    selection: { kind: 'none' },
    camera: null,
    highContrast: false,
    reducedMotion: false,
  };
  const repository: HqRepository = {
    scope: session,
    durability: 'session-memory',
    load: vi.fn(async () => ok({ document: saved, durability: 'session-memory' as const })),
    save: vi.fn(async (document, expected) => {
      if (expected !== saved.revision) return fail('conflict');
      saved = { ...document, revision: `${saved.revision}+` };
      return ok({ document: saved, durability: 'session-memory' as const });
    }),
    dispose: vi.fn(),
  };
  const camera = {
    mapId: artwork.id,
    mapRevision: artwork.revision,
    target: { x: 1000, y: 800 },
    distanceM: 2000,
    azimuthRad: 0,
    tiltRad: 0,
  };
  const surface: MapSurface = {
    scope: session,
    coordinates: 'metres',
    implementation: 'continuous',
    mount: vi.fn(async () => ok(undefined)),
    apply: vi.fn(async () => ok(undefined)),
    resize: vi.fn(() => ok(undefined)),
    setActive: vi.fn(() => ok(undefined)),
    getCamera: vi.fn(() => ok(camera)),
    restoreCamera: vi.fn(() => ok(undefined)),
    transitionTo: vi.fn(async () => ok(undefined)),
    snap: vi.fn(() => ok(undefined)),
    focusAt: vi.fn(async () => ok(undefined)),
    pickAt: vi.fn(() => ok({ kind: 'none' as const })),
    project: vi.fn(() => ok(null)),
    dispose: vi.fn(),
  };
  return {
    source,
    surface,
    repository,
    snapshot,
    emit,
    listeners,
    setDocument: (document: LocalDocument) => {
      saved = document;
    },
    getDocument: () => saved,
  };
}
