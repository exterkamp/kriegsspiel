import type {
  HqError,
  HqSnapshot,
  MapSurface,
  Operation,
  Paper,
  Pick,
  PointM,
  PublicArtwork,
  Result,
  Scope,
  Unsubscribe,
} from '../../contracts';

export interface PlotCapture {
  readonly snapshot: HqSnapshot;
  readonly paperId: string;
  readonly gameMs: number | null;
}
export interface PlotPointer {
  readonly pointerId: number;
  readonly pointerType: 'mouse' | 'touch' | 'pen';
  readonly isPrimary: boolean;
  readonly button: number;
  readonly clientXCssPx: number;
  readonly clientYCssPx: number;
}
export interface PlotRequest {
  readonly id: number;
  readonly ready: Promise<Result<void>>;
}
export interface PlotReceipt {
  readonly kind: 'created';
  readonly warning: HqError | null;
}
export interface PlotState {
  readonly phase: 'idle' | 'navigating' | 'placing' | 'committing' | 'finished' | 'disposed';
  readonly requestId: number | null;
  readonly paper: Paper | null;
  readonly gameMs: number | null;
  readonly pointerId: number | null;
  readonly label: string;
  readonly preview: {
    readonly at: PointM;
    readonly css: { readonly clientXCssPx: number; readonly clientYCssPx: number } | null;
  } | null;
  readonly outcome: 'none' | 'created' | 'unknown';
  readonly error: HqError | null;
}
export interface PlotPorts {
  check(stage: 'start' | 'place'): Result<void>;
  enterTable(op: Operation): Promise<Result<void>>;
  acquireControls(op: Operation): Result<Unsubscribe>;
  capturePointer(pointerId: number): Result<Unsubscribe>;
  pickAt(clientXCssPx: number, clientYCssPx: number): Result<Pick>;
  project(at: PointM): ReturnType<MapSurface['project']>;
  createPin(capture: PlotCapture, at: PointM, label: string): Result<void>;
}
export interface ReportPlacementController {
  readonly scope: Scope;
  readonly artwork: PublicArtwork;
  getState(): PlotState;
  subscribe(listener: (state: PlotState) => void): Unsubscribe;
  begin(capture: PlotCapture, pointer: PlotPointer | null): Result<PlotRequest>;
  pointer(
    id: number,
    event: 'down' | 'move' | 'up' | 'cancel' | 'lost-capture',
    pointer: PlotPointer,
  ): Result<PlotReceipt | null>;
  preview(id: number, at: PointM, label: string): Result<void>;
  place(id: number, at: PointM, label: string): Result<PlotReceipt>;
  cancel(id: number): Result<void>;
  dispose(): void;
}
