# #52 bounded report-placement proposal

Proposed for independent review; no implementation dispatched. Read AGENTS.md, decisions (D2/D3/HQ fixture composition), hq implementation plan/contracts, App, Shell/navigation, InTray/papers, personal-marks helpers and ContinuousSurface.

## Scope and ownership

One explicit private paper-backed **pin**, placed by mouse/touch or by entering chosen coordinates. Keep accepted Plot paper (supplied report location), numeric Marks, reading/filing and fixture/live entry routes. Opening/arrivals never plot; reports never move marks. No staff-quality/accuracy/auto-plot policy, inferred dates, server commands, automatic Save or map-checkout changes.

Future writer exclusively owns `client/src/hq/interactions/plotting/**`: controller/types/index, ReportPlotHandle.svelte, Plotting.svelte and tests. Root owns App/Shell/InTray bridges, shared surface/contracts/fakes, integration tests/docs. No data/marks or table ownership transfers. Independent reviewer acceptance precedes dispatch.

## Exact proposed API

Import existing HQ contract types. New plotting types remain local to plotting/**.

```ts
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
  readonly phase: 'idle' | 'navigating' | 'placing' |
    'committing' | 'finished' | 'disposed';
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
  pointer(id: number, event: 'down' | 'move' | 'up' | 'cancel' | 'lost-capture',
    pointer: PlotPointer): Result<PlotReceipt | null>;
  preview(id: number, at: PointM, label: string): Result<void>;
  place(id: number, at: PointM, label: string): Result<PlotReceipt>;
  cancel(id: number): Result<void>;
  dispose(): void;
}
export function createReportPlacementController(options: {
  scope: Scope; artwork: PublicArtwork; ports: PlotPorts;
}): ReportPlacementController;
```

Runtime index exports exactly `createReportPlacementController`, `ReportPlotHandle`, `Plotting` (Svelte defaults re-exported), plus the listed type exports. Exposed scope/artwork/state are cloned and deeply immutable. Subscribe delivers once immediately, isolates listener errors, returns idempotent unsubscribe; disposed subscriptions are not retained.

Component props:

```ts
// ReportPlotHandle.svelte
{
  paperId: string;
  disabled: boolean;
  onStart: (paperId: string, pointer: PlotPointer | null) => Result<PlotRequest>;
}
// Plotting.svelte: persistent Shell slot
{
  controller: ReportPlacementController;
  hub: HTMLElement;
  canvas: HTMLCanvasElement;
}
```

The handle provides “Drag report to map” and a native “Choose report coordinates” button. Primary left mouse/touch/pen pointerdown on the dedicated drag handle passes a pointer. Keyboard activation and the coordinate button pass null. No native HTML drag/dataTransfer, threshold or timer is needed. Touch users can drag or use the coordinate button. Disable dragstart; touch-action:none applies only to the dedicated handle and exposed placement input area, preserving panel scrolling.

## Immutable capture and RAM boundary

Root constructs one controller per fixed HQ scope/approved full artwork (revision 2, 4000×3000 m). On start root passes the accepted/displayed Shell snapshot, paper ID and one sampled `projectGameTime(...)` before any await. Begin checks fixed binding and marks writable/not busy, validates matching scope, exactly one matching Paper and accepted provenance/date/location/time rules, then synchronously clones/deep-freezes the snapshot and Paper. Reject malformed/missing/conflicting input before capture/navigation. Keep the full captured snapshot private; expose the captured Paper/time. Do not look up fresh reports at commit.

New text/location under the same ID, removal, filing/discarding, source/clock updates and selection changes never rewrite pending or existing provenance. New explicit begin captures anew. Approved stale knowledge remains labelled stale/local using the existing frozen display-time policy; local placement cannot restore source freshness. Scope/artifact/session change cancels/remounts; no conversion to another map.

Chosen position and reported location remain distinct. Unknown Paper.location stays null. Numeric fields may offer a supplied location labelled “Reported location”, otherwise start blank. Default label `${paper.from}: report` is plain text bounded to 256 characters. No coordinate is committed without drop or form submission.

Root `createPin` synchronously rechecks binding, marks writable/busy and table readiness, then returns this existing creation result directly:

```ts
personalMarks.create(
  { label, geometry: { kind: 'pin', at }, source: { kind: 'paper', paperId: capture.paperId } },
  capture.snapshot, capture.gameMs,
);
```

No navigation/focus/selection/Save or fallible callback follows success inside this port. Ordinary returned failure guarantees no creation. Existing root marks/source queue renders the RAM list; later render failure is separate feedback, not rollback/retry. While placement is active root disables competing Marks mutation/Save/Reload; runtime data guards still reject races. Existing explicit Save alone establishes persistence.

## Interaction and cancellation

1. Begin returns a request token synchronously, acquires control suppression and (for drag) pointer capture before navigation/notifications. Capture belongs to the **persistent Shell root/hub**, never the InTray handle which unmounts. Root renders Plotting once outside the changing desk/table subtree and map-layer inert wrapper; supplies a persistent interaction snippet with `(ShellViewContext, hub, canvas)` and an InTray handle bridge. Existing onPlotPaper stays unchanged.
2. enterTable uses accepted navigation.navigate('table', null, op), resolving after final transition frame and focus transfer. Drag avoids autofocus scrolling; numeric placement focuses its form after settlement. Preserve camera/selection, with no automatic snap/focus at reported location. No picking/commit during initialization, desk, transition/rollback or unsettled presentation. Release before ready cancels navigation and creates nothing; never replay a buffered drop. Unrelated navigation/focus/snap cancels first. InTray unmount during the requested transition does not cancel.
3. Move uses guarded CSS pick only when ready. Map.at and piece.at are actual plane coordinates; never substitute a piece centre. Validate finite inclusive metre bounds against captured artwork. None/error clears preview. Up freshly picks its own CSS coordinates/current rectangle, never cached preview, Paper.location, clamping or DPR scaling. Off-map/over-panel up creates nothing, releases capture, and leaves the frozen request placing for another map contact or numeric input. Noncommitting pointer events return success(null); successful drop returns the receipt.
4. Own one primary pointer. Secondary touch cancels instead of interpreting pinch as placement. Non-owner/stale-token events cannot create; pointer-ID reuse cannot revive old work. Cancel on unexpected lost capture, pointercancel, Escape, blur, hidden document, Cancel, navigation away after settlement, scope/artifact change or teardown. Clear owned pointer state before deliberate release; synchronous capture-loss cleanup cannot affect a successor.
5. Persistent hub capture-phase handlers consume placement events before canvas selection/OrbitControls. Suppress the drag's matching compatibility click; new physical down clears that latch, keyboard click is unaffected. Root ordinary selection checks defaultPrevented/active placement. Preview uses pointer-events:none. Listener/observer cleanup belongs to persistent Plotting; root owns final controller disposal, before shared navigation/surface/data teardown.
6. Preview is ephemeral DOM marker/text, never a mark/presentation/storage write. project(null-result) means valid but offscreen: show numeric preview. On resize/scroll replay the owner move packet or numeric preview using existing methods. CSS pixels throughout. Numeric form supplies east/south metre fields, label, captured provenance/unknowns, preview, Cancel and explicit “Create local report pin”. Blank/nonfinite/out-of-range rejection retains fields. Plain text, labelled limits/status, contrast/reduced motion; writing suppresses global shortcuts, Escape explicitly cancels this form.

## Latest request and truthful outcomes

Reserve generation before callbacks; newer begin cancels old precommit work and resolves old ready promptly even if a fake enterTable ignores abort. Check generation/lifetime after every port/subscriber callback and await. Newly acquired releasers returned after reentrant cancel/dispose must immediately run. Capture/control release is idempotent and request-owned; late old cleanup cannot release a successor, including recycled pointer IDs.

Consume the request before invoking createPin; double up/click/submit/key repeat/reentrant place cannot invoke twice. Reject reentrant begin while committing. Check after committing notification before invocation. Cancellation before invocation creates nothing. Success after reentrant cancel/dispose still returns a created receipt; cleanup errors become warnings saying “Created locally; unsaved”, never aborted/no-creation. Do not publish into a dead/new request. A returned no-creation failure is recoverable if the session remains valid. A thrown creation callback could have mutated RAM: finish with outcome-unknown, consume that request, explain inspection of local marks and never retry it. Cancellation never deletes a created mark or invokes Save.

Dispose is terminal/idempotent: abort/settle ready, release capture/controls, clear private pending snapshot/preview/listeners. Late events/results cannot publish or create. The controller does not dispose shared ports.

## Required root-owned surface boundary

Add exactly:

```ts
MapSurface.acquireControls(op: Operation): Result<Unsubscribe>;
```

Suppress OrbitControls, keep RAF active. Token-owned releases/abort handling are idempotent; stale/terminal release cannot enable another lock or disposed scene. ContinuousSurface centrally derives enabled from active && settled-table && no-transition && no-control-lock, including apply/setActive/transition finish/rollback. Root owns the shared signature, implementation/fakes and focused regression. No Three/engine imports in plotting/**.

Current pickAt permits active transition frames. Root tightens it to not-ready unless active, settled table and no transition. check('start') allows desk but verifies fixed bindings/marks readiness; check('place') adds settled navigation/presentation. Root pick wrapper checks **exposed canvas**, not merely the full background rectangle: captured event.target is hub, so hit-test to exclude panels/navigation/forms/occluding overlays before surface.pickAt. Off-canvas/off-map remains refused.

## Independent test gates

Writer: immutable capture under mutation/report refresh/removal; duplicate/missing/scope/art/date rejection; null location/date and start-time gameMs; mouse/touch/keyboard chosen-coordinate parity; capture surviving InTray unmount; early release/offmap/panel refusal; corners/decimals/fresh up after CSS resize/DPR; second touch/cancel/lost capture/Escape/blur; compatibility-click isolation; late navigation and reentrant acquire/release/pick/project/create/notify/dispose; canceled ready settles promptly; single commit/busy/recoverable rejection; created-after-dispose receipt and thrown-after-mutation unknown; zero Save/server calls; retained form/plain text/ARIA semantics/listener cleanup.

Root: accepted Plot paper/numeric Marks/live entry preserved; persistent capture bridge and exposed-canvas guard; settled-only pick/reduced-motion/rollback; suppression across apply/setActive/transition/release/dispose; no stale cleanup unlocking successor; accepted source/marks queue and offline-health invariants; render/navigation errors after RAM creation cannot report no creation; camera/art/pieces/selection retained; terminal teardown prevents late writes.

Focused tests/types/Svelte/lint/format only. No implementation, browser/devserver, new agents or shared edits in this architecture packet. Browser/touch/axe evidence, full #52/#50, shared persistence and other shape pointer authoring stay open. Reviewer acceptance precedes dispatch.
