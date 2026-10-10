import { SideView } from '@kriegsspiel/protocol';
import { fixtureView } from '../../table/fixture.js';
import type {
  Capabilities,
  HqClock,
  HqDataSource,
  HqSnapshot,
  Knowledge,
  MapPiece,
  Operation,
  PublicArtwork,
  Result,
  Scope,
  SourceState,
} from '../contracts/index.js';
import { failure, immutable, success } from './common.js';

export const demoScope: Scope = { gameId: 'hq-demo', sideId: 'blue', playerId: 'demo-general' };
export const demoArtwork: PublicArtwork = {
  kind: 'public-artwork',
  id: 'hq-schematic',
  revision: '2',
  widthM: 4000,
  heightM: 3000,
  image: { url: '/hq-preview.svg', pixelWidth: 1200, pixelHeight: 900 },
  registration: 'full-image-nw-origin',
  credit: 'Original Kriegsspiel HQ fixture artwork',
  licence: 'Project-owned fixture; external reuse terms unspecified',
  sourceUrl: null,
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
] as const;
export const fixtureCapabilities = immutable(
  Object.fromEntries(
    features.map((feature) => [
      feature,
      ['read-snapshot', 'public-artwork', 'clock-mode', 'barrier-state'].includes(feature)
        ? { state: 'fixture', evidence: 'Explicit local demonstration; no live server' }
        : { state: 'unavailable', reason: 'Awaiting an accepted service or persistence contract' },
    ]),
  ) as unknown as Capabilities,
);

/** Validate the existing wire fixture, then enforce temporal and size constraints. */
export function normalizeFixture(raw: unknown, scope: Scope, now: number, ordinal = 1): HqSnapshot {
  const view = SideView.parse(raw);
  if (view.side !== scope.sideId || !Number.isFinite(now)) throw new Error('Invalid fixture scope');
  const times = [view.atGame, view.clock.gameMsAtAnchor];
  if (times.some((t) => !Number.isSafeInteger(t)) || view.atGame !== view.clock.gameMsAtAnchor)
    throw new Error('Inconsistent fixture clock');
  if (
    view.ownUnits.length + view.visibleEnemies.length + view.lastKnownContacts.length > 1000 ||
    view.dispatches.length > 2000
  )
    throw new Error('Fixture exceeds limits');
  const bounded = (p: { x: number; y: number }) =>
    p.x >= 0 && p.x <= demoArtwork.widthM && p.y >= 0 && p.y <= demoArtwork.heightM;
  const ids = new Set<string>();
  const identity = (id: string) => {
    if (!id || id.length > 128 || ids.has(id))
      throw new Error('Invalid duplicate fixture identity');
    ids.add(id);
  };
  const known = <T>(value: T): Knowledge<T> => ({ kind: 'snapshot', value, atGame: view.atGame });
  const validShape = (unit: {
    position: { x: number; y: number };
    facing: number;
    footprint: { frontage: number; depth: number };
    shape?: { x: number; y: number }[];
  }) =>
    unit.footprint.frontage <= demoArtwork.widthM &&
    unit.footprint.depth <= demoArtwork.heightM &&
    (unit.shape?.length ?? 0) <= 256 &&
    (unit.shape ?? []).every((offset) =>
      bounded({
        x: unit.position.x + offset.x * Math.cos(unit.facing) + offset.y * Math.sin(unit.facing),
        y: unit.position.y + offset.x * Math.sin(unit.facing) - offset.y * Math.cos(unit.facing),
      }),
    );
  const pieces: MapPiece[] = [];
  for (const u of view.ownUnits) {
    identity(`own:${u.id}`);
    if (!bounded(u.position) || u.name.length > 256 || !validShape(u))
      throw new Error('Invalid fixture unit');
    pieces.push({
      key: `own:${u.id}`,
      unitId: u.id,
      relationship: 'own',
      label: u.name,
      position: u.position,
      provenance: 'fixture-snapshot',
      observedAtGame: null,
      ageMs: null,
      uncertaintyRadiusM: null,
      appearance: {
        facingRad: u.facing,
        formation: u.formation,
        frontageM: u.footprint.frontage,
        depthM: u.footprint.depth,
        shape: u.shape ?? null,
      },
    });
  }
  const liveIds = new Set(view.visibleEnemies.map((u) => u.id));
  for (const u of view.visibleEnemies) {
    identity(`contact:${u.id}`);
    if (!bounded(u.position) || (u.sizeEstimate?.length ?? 0) > 256 || !validShape(u))
      throw new Error('Invalid fixture contact');
    pieces.push({
      key: `contact:${u.id}`,
      unitId: u.id,
      relationship: 'enemy',
      label: u.sizeEstimate ?? 'Contact',
      position: u.position,
      provenance: 'fixture-snapshot',
      observedAtGame: null,
      ageMs: 0,
      uncertaintyRadiusM: null,
      appearance: {
        facingRad: u.facing,
        formation: u.formation,
        frontageM: u.footprint.frontage,
        depthM: u.footprint.depth,
        shape: u.shape ?? null,
      },
    });
  }
  for (const c of view.lastKnownContacts) {
    if (
      !Number.isSafeInteger(c.observedAtGame) ||
      c.observedAtGame > view.atGame ||
      c.ageMs !== view.atGame - c.observedAtGame ||
      !bounded(c.position) ||
      (c.sizeEstimate?.length ?? 0) > 256
    )
      throw new Error('Invalid fixture contact time or position');
    if (liveIds.has(c.id)) continue;
    identity(`contact:${c.id}`);
    pieces.push({
      key: `contact:${c.id}`,
      unitId: c.id,
      relationship: 'enemy',
      label: c.sizeEstimate ?? 'Stale contact',
      position: c.position,
      provenance: 'fixture-contact',
      observedAtGame: c.observedAtGame,
      ageMs: c.ageMs,
      uncertaintyRadiusM: c.uncertaintyRadius,
      appearance: null,
    });
  }
  const papers = new Map<string, HqSnapshot['papers'][number]>();
  for (const d of view.dispatches) {
    if (
      d.id.length > 128 ||
      d.text.length > 16384 ||
      d.from.length > 256 ||
      !Number.isSafeInteger(d.writtenAtGame) ||
      !Number.isSafeInteger(d.receivedAtGame) ||
      d.writtenAtGame > d.receivedAtGame ||
      d.receivedAtGame > view.atGame ||
      (d.location && !bounded(d.location))
    )
      throw new Error('Invalid fixture paper');
    const paper = {
      id: d.id,
      from: d.from,
      category: d.category,
      writtenAtGame: d.writtenAtGame,
      receivedAtGame: d.receivedAtGame,
      observedAtGame: null,
      location: d.location ?? null,
      unitId: view.ownUnits.some((u) => u.id === d.unit) ? d.unit! : null,
      sizeEstimate: d.sizeEstimate ?? null,
      confidence: d.confidence ?? null,
      text: d.text,
    };
    if (papers.has(d.id) && JSON.stringify(papers.get(d.id)) !== JSON.stringify(paper))
      throw new Error('Conflicting paper identity');
    papers.set(d.id, paper);
  }
  return immutable({
    scope: { ...scope },
    epoch: 'fixture-session-1',
    ordinal,
    authorityRevision: null,
    atGame: view.atGame,
    clock: {
      authoritativeGameMs: view.atGame,
      rate: view.clock.rate,
      status: view.clock.status,
      mode: 'realtime',
      barrier: { kind: 'clear' },
      coherence: 'fixture-atomic',
      receivedMonotonicMs: now,
    },
    roster: view.ownUnits.map((u) => ({
      unitId: u.id,
      name: u.name,
      commander: { kind: 'unknown', reason: 'Not supplied by this wire version' },
      position: known(u.position),
      strength: known(u.strength),
      morale: known(u.morale),
      supply: known(u.supply),
    })),
    papers: [...papers.values()].sort(
      (a, b) => a.receivedAtGame - b.receivedAtGame || a.id.localeCompare(b.id),
    ),
    pieces,
  });
}

export class FixtureSource implements HqDataSource {
  readonly kind = 'fixture';
  readonly capabilities = fixtureCapabilities;
  private state: SourceState = immutable({
    connection: 'idle',
    stale: false,
    snapshot: null,
    error: null,
  });
  private listeners = new Set<(state: SourceState) => void>();
  private ordinal = 0;
  readonly scope: Scope;
  constructor(
    scope: Scope = demoScope,
    private now = () => performance.now(),
  ) {
    this.scope = immutable({ ...scope });
  }
  getState(): SourceState {
    return this.state;
  }
  subscribe(listener: (state: SourceState) => void): () => void {
    listener(this.state);
    if (this.state.connection !== 'disposed') this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(state: SourceState): void {
    this.state = immutable(state);
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {
        /* Isolate subscribers. */
      }
    }
  }
  async open(op: Operation): Promise<Result<HqSnapshot>> {
    if (this.state.connection === 'opening')
      return failure('conflict', 'The demonstration is already loading.');
    if (this.state.connection === 'ready' && this.state.snapshot)
      return success(this.state.snapshot);
    return this.refresh(op);
  }
  async refresh(op: Operation): Promise<Result<HqSnapshot>> {
    if (this.state.connection === 'disposed')
      return failure('disposed', 'This demonstration is closed.');
    if (op.signal.aborted) return failure('aborted', 'Loading cancelled.');
    if (this.state.connection === 'opening')
      return failure('conflict', 'The demonstration is already loading.');
    // Synchronous preparation cannot race another refresh within this source instance.
    const previous = this.state;
    this.emit({ ...this.state, connection: 'opening' });
    try {
      const raw = structuredClone(fixtureView);
      raw.side = this.scope.sideId;
      raw.dispatches = [
        {
          id: 'demo-scout-1',
          from: 'Scouting patrol',
          category: 'scouts',
          writtenAtGame: 1800000,
          receivedAtGame: 2400000,
          location: { x: 2150, y: 350 },
          confidence: 'medium',
          text: 'A body of infantry was seen near the north wood. This paper records an older observation; it does not move a mark.',
        },
        {
          id: 'demo-staff-1',
          from: 'Headquarters staff',
          category: 'staff',
          writtenAtGame: 3000000,
          receivedAtGame: 3300000,
          text: 'The demonstration contains local fixture data. Signing orders and consulting live staff remain unavailable.',
        },
      ];
      // Correct the old fixture's inconsistent age; no live data is altered.
      raw.lastKnownContacts = raw.lastKnownContacts.map((c) => ({
        ...c,
        ageMs: raw.atGame - c.observedAtGame,
      }));
      if (this.scope.sideId !== 'blue')
        raw.ownUnits = raw.ownUnits.map((u) => ({
          ...u,
          id: u.id.replace('blue-', 'red-'),
          position: { x: demoArtwork.widthM - u.position.x, y: demoArtwork.heightM - u.position.y },
        }));
      const snapshot = normalizeFixture(raw, this.scope, this.now(), ++this.ordinal);
      if (this.getState().connection === 'disposed')
        return failure('disposed', 'This demonstration is closed.');
      if (op.signal.aborted) {
        this.emit(previous);
        return failure('aborted', 'Loading cancelled.');
      }
      this.emit({ connection: 'ready', stale: false, snapshot, error: null });
      return success(snapshot);
    } catch {
      if (this.getState().connection === 'disposed')
        return failure('disposed', 'This demonstration is closed.');
      const result = failure<HqSnapshot>(
        'invalid-data',
        'The demonstration data could not be validated.',
      );
      if (!result.ok) this.emit({ ...this.state, connection: 'error', error: result.error });
      return result;
    }
  }
  dispose(): void {
    if (this.state.connection === 'disposed') return;
    this.emit({ ...this.state, connection: 'disposed', stale: true });
    this.listeners.clear();
  }
}

export function projectGameTime(
  state: SourceState,
  kind: 'fixture' | 'live',
  now: number,
): number | null {
  const s = state.snapshot;
  if (!s) return null;
  const c: HqClock = s.clock;
  if (
    kind !== 'fixture' ||
    state.connection !== 'ready' ||
    state.stale ||
    c.coherence !== 'fixture-atomic' ||
    c.status !== 'running' ||
    c.mode !== 'realtime' ||
    c.barrier.kind !== 'clear' ||
    !Number.isFinite(now)
  )
    return c.authoritativeGameMs;
  const time = Math.floor(
    c.authoritativeGameMs + Math.max(0, now - c.receivedMonotonicMs) * c.rate,
  );
  return Number.isSafeInteger(time) ? time : c.authoritativeGameMs;
}
