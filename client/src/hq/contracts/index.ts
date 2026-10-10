/** HQ first-gate proposal, hq-contracts/1. UI ports only; no new wire schemas.
 * Continuous baseline af0dc698392f350b73cdfc3684e6adc3a1282ca0. Runtime validation required.
 * Live orders, shared annotations, conference and reveal services are unavailable.
 */
export type GameMs = number; // Safe nonnegative integer game milliseconds.
export type Revision = string; // Opaque equality token, never lexically ordered.
export interface PointM {
  readonly x: number;
  readonly y: number;
} // Finite metres.
export interface Scope {
  readonly gameId: string;
  readonly sideId: string;
  readonly playerId: string;
}
export interface Operation {
  readonly signal: AbortSignal;
}
export type Unsubscribe = () => void;
export type ErrorCode =
  | 'unsupported'
  | 'invalid-data'
  | 'scope-mismatch'
  | 'unauthorized'
  | 'not-ended'
  | 'not-found'
  | 'conflict'
  | 'offline'
  | 'timeout'
  | 'aborted'
  | 'disposed'
  | 'not-ready'
  | 'storage-unavailable'
  | 'quota-exceeded'
  | 'migration-required'
  | 'outcome-unknown'
  | 'internal';
export interface HqError {
  readonly code: ErrorCode;
  readonly message: string; // Safe player text, never raw payload/stack/secret.
  readonly retry: 'never' | 'read-only' | 'same-request' | 'after-resolution';
}
export type Result<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: HqError };
export type Feature =
  | 'read-snapshot'
  | 'public-artwork'
  | 'clock-mode'
  | 'barrier-state'
  | 'clock-controls'
  | 'pause-voting'
  | 'roster-reports'
  | 'dispatch-sketches'
  | 'sign-order'
  | 'order-status'
  | 'courier-choice'
  | 'order-annex'
  | 'personal-marks'
  | 'shared-marks'
  | 'conference'
  | 'replay';
export type Capability =
  | { readonly state: 'unavailable'; readonly reason: string }
  | { readonly state: 'fixture' | 'live'; readonly evidence: string };
export type Capabilities = Readonly<Record<Feature, Capability>>;
export type ViewId =
  | 'table'
  | 'in-tray'
  | 'orders'
  | 'roster'
  | 'conference'
  | 'terrain-studies'
  | 'journal'
  | 'replay';
export type Selection =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'unit' | 'paper';
      readonly id: string;
      readonly scope: Scope;
    };
export interface ShellState {
  readonly scope: Scope;
  readonly view: ViewId;
  readonly selection: Selection;
}
export interface HqNavigation {
  readonly scope: Scope;
  getState(): ShellState;
  subscribe(listener: (state: ShellState) => void): Unsubscribe;
  navigate(view: ViewId, returnFocusKey: string | null, op: Operation): Promise<Result<ShellState>>;
  select(selection: Selection): Result<ShellState>;
  dispose(): void;
}
/** Registration maps the whole image to [0,width] x [0,height], origin NW, x east/y south.
 * Art contains public geography only, never engine terrain/truth metadata.
 */
export interface PublicArtwork {
  readonly kind: 'public-artwork';
  readonly id: string;
  readonly revision: Revision;
  readonly widthM: number;
  readonly heightM: number;
  readonly image: {
    readonly url: string;
    readonly pixelWidth: number;
    readonly pixelHeight: number;
  };
  readonly registration: 'full-image-nw-origin';
  readonly credit: string;
  readonly licence: string;
  readonly sourceUrl: string | null;
}
export type Knowledge<T> =
  | { readonly kind: 'unknown'; readonly reason: string }
  | { readonly kind: 'snapshot'; readonly value: T; readonly atGame: GameMs };
export interface RosterRow {
  readonly unitId: string;
  readonly name: string;
  readonly commander: Knowledge<string>;
  readonly position: Knowledge<PointM>;
  readonly strength: Knowledge<number>;
  readonly morale: Knowledge<number>; // [0,1] when known.
  readonly supply: Knowledge<number>; // [0,1] when known.
}
export interface Paper {
  readonly id: string;
  readonly from: string;
  readonly category: 'urgent' | 'scouts' | 'subordinates' | 'staff' | 'intelligence' | 'rumour';
  readonly writtenAtGame: GameMs;
  readonly receivedAtGame: GameMs;
  readonly observedAtGame: GameMs | null; // v1 Dispatch does NOT supply this.
  readonly location: PointM | null;
  readonly unitId: string | null;
  readonly sizeEstimate: string | null;
  readonly confidence: 'low' | 'medium' | 'high' | null; // Public confidence, not reliability.
  readonly text: string;
}
export interface MapPiece {
  readonly key: string; // Namespaced own:<id> or contact:<id>.
  readonly unitId: string;
  readonly relationship: 'own' | 'enemy';
  readonly label: string;
  readonly position: PointM;
  readonly provenance: 'fixture-snapshot' | 'fixture-contact';
  readonly observedAtGame: GameMs | null;
  readonly ageMs: GameMs | null;
  readonly uncertaintyRadiusM: number | null;
  readonly appearance: null | {
    readonly facingRad: number; // 0 north, clockwise; no eight-way restriction.
    readonly formation: 'line' | 'column' | 'square' | 'skirmish' | 'loose';
    readonly frontageM: number;
    readonly depthM: number;
    readonly shape: readonly PointM[] | null; // Own frame: x right, y front, metres.
  };
}
export interface HqClock {
  readonly authoritativeGameMs: GameMs;
  readonly rate: number;
  readonly status: 'running' | 'paused' | 'stopped';
  readonly mode: 'realtime' | 'manual' | 'fast-forward' | 'unknown';
  readonly barrier:
    | { readonly kind: 'unknown' | 'clear' }
    | { readonly kind: 'working'; readonly needAtGame: GameMs | null };
  readonly coherence: 'fixture-atomic' | 'unverified';
  readonly receivedMonotonicMs: number;
}
export interface HqSnapshot {
  readonly scope: Scope;
  readonly epoch: string;
  readonly ordinal: number; // Increasing LOCAL observation token; reserve before async load.
  readonly authorityRevision: Revision | null; // v1 has none.
  readonly atGame: GameMs;
  readonly clock: HqClock;
  readonly roster: readonly RosterRow[];
  readonly papers: readonly Paper[];
  readonly pieces: readonly MapPiece[]; // Explicit fixture knowledge preview, not auto-plotted beliefs.
}
export interface SourceState {
  readonly connection: 'idle' | 'opening' | 'ready' | 'offline' | 'error' | 'disposed';
  readonly stale: boolean;
  readonly snapshot: HqSnapshot | null;
  readonly error: HqError | null;
}
/** Read-only first gate. No commands silently mapped onto draftEdit.ops or actor methods. */
export interface HqDataSource {
  readonly kind: 'fixture' | 'live';
  readonly scope: Scope; // Fixed for instance lifetime; not an authorization credential.
  readonly capabilities: Capabilities;
  getState(): SourceState;
  subscribe(listener: (state: SourceState) => void): Unsubscribe;
  open(op: Operation): Promise<Result<HqSnapshot>>;
  refresh(op: Operation): Promise<Result<HqSnapshot>>;
  dispose(): void;
}
export interface CameraBookmark {
  readonly mapId: string;
  readonly mapRevision: Revision;
  readonly target: PointM;
  readonly distanceM: number;
  readonly azimuthRad: number;
  readonly tiltRad: number;
}
export interface MapPresentation {
  readonly scope: Scope;
  readonly revision: Revision;
  /** Canonical source observation, for honest snapshot tags and late-result rejection. */
  readonly snapshot: {
    readonly atGame: GameMs;
    readonly epoch: string;
    readonly ordinal: number;
  };
  readonly artwork: PublicArtwork;
  readonly mode: 'fixture-knowledge-preview';
  readonly pieces: readonly MapPiece[];
  readonly marks: readonly PersonalMark[];
  readonly selection: Selection;
}
export type Pick =
  | { readonly kind: 'none' }
  | { readonly kind: 'map'; readonly at: PointM }
  | {
      readonly kind: 'piece';
      readonly key: string;
      readonly unitId: string;
      readonly at: PointM;
    };
export interface MapSurface {
  readonly scope: Scope;
  readonly coordinates: 'metres';
  readonly implementation: 'continuous';
  mount(canvas: HTMLCanvasElement, op: Operation): Promise<Result<void>>;
  apply(presentation: MapPresentation, op: Operation): Promise<Result<void>>;
  resize(widthCssPx: number, heightCssPx: number, devicePixelRatio: number): Result<void>;
  setActive(active: boolean): Result<void>; // Suspend RAF/controls, retain scene/resources.
  getCamera(): Result<CameraBookmark>;
  restoreCamera(camera: CameraBookmark): Result<void>;
  transitionTo(
    view: 'desk' | 'table',
    reducedMotion: boolean,
    op: Operation,
  ): Promise<Result<void>>;
  snap(view: 'top-down' | 'oblique'): Result<void>;
  focusAt(at: PointM, op: Operation): Promise<Result<void>>;
  pickAt(clientXCssPx: number, clientYCssPx: number): Result<Pick>;
  project(at: PointM): Result<{
    readonly clientXCssPx: number;
    readonly clientYCssPx: number;
  } | null>;
  dispose(): void;
}
/** First local version only persists shell preferences. Drafts/marks/history need later schemas. */
export interface LocalDocument {
  readonly schemaVersion: 1;
  readonly scope: Scope;
  readonly revision: Revision;
  readonly view: ViewId;
  readonly selection: Selection;
  readonly camera: CameraBookmark | null;
  readonly highContrast: boolean;
  readonly reducedMotion: boolean;
}
export interface RepositoryLoad {
  readonly document: LocalDocument;
  readonly durability: 'browser' | 'session-memory';
}
export interface HqRepository {
  readonly scope: Scope;
  readonly durability: 'browser' | 'session-memory';
  load(op: Operation): Promise<Result<RepositoryLoad>>;
  /** One writer; document.revision must equal expected/current. Repo assigns next revision.
   * Abort before storage commit prevents write; abort after commit still returns success.
   */
  save(
    document: LocalDocument,
    expectedRevision: Revision,
    op: Operation,
  ): Promise<Result<RepositoryLoad>>;
  dispose(): void;
}
/** Disabled reservation only. Future authorized frame/event APIs require a separate contract gate. */
export interface ReplaySource {
  readonly scope: Scope;
  readonly capability: {
    readonly state: 'unavailable';
    readonly reason: string;
  };
  open(op: Operation): Promise<Result<never>>; // Returns unsupported; never returns truth.
  dispose(): void;
}

/** Separately reviewed browser-only personal-mark contract; no server authority. */
export type MarkGeometry =
  | { readonly kind: 'pin'; readonly at: PointM }
  | { readonly kind: 'polyline' | 'arrow'; readonly points: readonly PointM[] }
  | { readonly kind: 'ring'; readonly centre: PointM; readonly radiusM: number }
  | { readonly kind: 'symbol'; readonly at: PointM; readonly symbol: 'cross' | 'dot' | 'flag' };
export type MarkSource =
  | { readonly kind: 'manual' }
  | {
      readonly kind: 'paper';
      readonly paperId: string;
      readonly writtenAtGame: GameMs;
      readonly receivedAtGame: GameMs;
      readonly observedAtGame: GameMs | null;
      readonly reportedLocation: PointM | null;
      readonly excerpt: string;
    };
export interface PersonalMark {
  readonly id: string;
  readonly scope: Scope;
  readonly map: { readonly id: string; readonly revision: Revision };
  readonly label: string;
  readonly geometry: MarkGeometry;
  readonly source: MarkSource;
  /** Fixture display times, not server-accepted command timestamps. */
  readonly placedAtGame: GameMs | null;
  readonly editedAtGame: GameMs | null;
}
export interface PersonalMarksDocument {
  readonly schemaVersion: 1;
  readonly scope: Scope;
  readonly map: { readonly id: string; readonly revision: Revision };
  readonly revision: Revision;
  readonly marks: readonly PersonalMark[];
}
export interface PersonalMarksRepository {
  readonly scope: Scope;
  readonly artwork: PublicArtwork;
  load(op: Operation): Promise<Result<PersonalMarksDocument>>;
  save(
    marks: readonly PersonalMark[],
    expectedRevision: Revision,
    op: Operation,
  ): Promise<Result<PersonalMarksDocument>>;
  dispose(): void;
}
export interface MarkCreateInput {
  readonly label: string;
  readonly geometry: MarkGeometry;
  readonly source:
    { readonly kind: 'manual' } | { readonly kind: 'paper'; readonly paperId: string };
}
export interface MarkEditInput {
  readonly label: string;
  readonly geometry: MarkGeometry;
}
