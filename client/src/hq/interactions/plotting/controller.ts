import { z } from 'zod';
import type {
  HqError,
  Paper,
  PointM,
  PublicArtwork,
  Result,
  Scope,
  Unsubscribe,
} from '../../contracts';
import { immutable, sameScope, success } from '../../data/common';
import { createPersonalMark } from '../../data/marks';
import { cloneBinding } from '../../data/marks/validation';
import type {
  PlotCapture,
  PlotPointer,
  PlotPorts,
  PlotReceipt,
  PlotState,
  ReportPlacementController,
} from './types';

const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const point = z.object({ x: z.number().finite(), y: z.number().finite() }).strict();
const paperSchema = z
  .object({
    id: z.string().min(1).max(128),
    from: z.string(),
    category: z.enum(['urgent', 'scouts', 'subordinates', 'staff', 'intelligence', 'rumour']),
    writtenAtGame: time,
    receivedAtGame: time,
    observedAtGame: time.nullable(),
    location: point.nullable(),
    unitId: z.string().nullable(),
    sizeEstimate: z.string().nullable(),
    confidence: z.enum(['low', 'medium', 'high']).nullable(),
    text: z.string(),
  })
  .strict();
const empty: PlotState = {
  phase: 'idle',
  requestId: null,
  paper: null,
  gameMs: null,
  pointerId: null,
  label: '',
  preview: null,
  outcome: 'none',
  error: null,
};
const failure = (code: HqError['code'], message: string): { ok: false; error: HqError } => ({
  ok: false,
  error: { code, message, retry: code === 'conflict' ? 'after-resolution' : 'never' },
});
interface Request {
  id: number;
  capture: PlotCapture | null;
  paper: Paper;
  abort: AbortController;
  settle: (result: Result<void>) => void;
  pointer: PlotPointer | null;
  controls: Unsubscribe | null;
  releasePointer: Unsubscribe | null;
  consumed: boolean;
  cleanupFailed: boolean;
}

export function createReportPlacementController(options: {
  scope: Scope;
  artwork: PublicArtwork;
  ports: PlotPorts;
}): ReportPlacementController {
  const { scope, artwork } = cloneBinding(options.scope, options.artwork);
  const ports = options.ports;
  let state = immutable({ ...empty });
  let generation = 0;
  let active: Request | null = null;
  let disposed = false;
  let writing = false;
  const listeners = new Set<(state: PlotState) => void>();
  const current = (r: Request) => !disposed && active === r && generation === r.id;
  const aborted = () => failure('aborted', 'Report placement was cancelled.');
  function emit(next: PlotState) {
    state = immutable(structuredClone(next));
    const published = state;
    for (const listener of [...listeners]) {
      if (state !== published) break;
      try {
        listener(published);
      } catch {
        /* A subscriber cannot own the request lifetime. */
      }
    }
  }
  function update(r: Request, patch: Partial<PlotState>) {
    if (current(r)) emit({ ...state, ...patch });
  }
  function call<T>(callback: () => Result<T>): Result<T> {
    try {
      return callback();
    } catch {
      return failure('internal', 'The placement operation failed.');
    }
  }
  function release(r: Request, callback: Unsubscribe | null) {
    try {
      callback?.();
    } catch {
      r.cleanupFailed = true;
    }
  }
  function releasePointer(r: Request) {
    // Clear ownership before releasing: lostpointercapture may dispatch synchronously.
    r.pointer = null;
    const callback = r.releasePointer;
    r.releasePointer = null;
    release(r, callback);
  }
  function refuseDrop(r: Request, error: HqError): Result<never> {
    if (!current(r)) return aborted();
    releasePointer(r);
    if (!current(r)) return aborted();
    update(r, { pointerId: null, preview: null, error });
    return current(r) ? { ok: false, error } : aborted();
  }
  function cleanup(r: Request) {
    r.capture = null;
    r.settle(aborted());
    r.abort.abort();
    releasePointer(r);
    const callback = r.controls;
    r.controls = null;
    release(r, callback);
  }
  function finish(r: Request, error: HqError | null, outcome: PlotState['outcome'] = 'none') {
    if (active === r) active = null;
    cleanup(r);
    if (!disposed && generation === r.id)
      emit({ ...state, phase: 'finished', pointerId: null, preview: null, outcome, error });
  }
  function remember(r: Request, kind: 'controls' | 'releasePointer', callback: Unsubscribe) {
    if (!current(r)) {
      release(r, callback);
      return false;
    }
    let released = false;
    r[kind] = () => {
      if (!released) {
        released = true;
        callback();
      }
    };
    return true;
  }
  function validPoint(at: PointM, label: string): Result<PointM> {
    const parsed = point.safeParse(at);
    if (
      !parsed.success ||
      typeof label !== 'string' ||
      label.length > 256 ||
      parsed.data.x < 0 ||
      parsed.data.y < 0 ||
      parsed.data.x > artwork.widthM ||
      parsed.data.y > artwork.heightM
    )
      return failure(
        'invalid-data',
        'Enter finite map coordinates and a label of at most 256 characters.',
      );
    return success(immutable(parsed.data));
  }
  function validPointer(p: PlotPointer): boolean {
    return (
      Number.isSafeInteger(p.pointerId) &&
      p.pointerId >= 0 &&
      ['mouse', 'touch', 'pen'].includes(p.pointerType) &&
      typeof p.isPrimary === 'boolean' &&
      Number.isInteger(p.button) &&
      Number.isFinite(p.clientXCssPx) &&
      Number.isFinite(p.clientYCssPx)
    );
  }
  function eligible(p: PlotPointer): boolean {
    return validPointer(p) && p.isPrimary && p.button === 0;
  }
  function capture(raw: PlotCapture): Result<{ capture: PlotCapture; paper: Paper }> {
    try {
      const captured = immutable(structuredClone(raw));
      if (!sameScope(captured.snapshot.scope, scope))
        return failure('scope-mismatch', 'The report belongs to another headquarters.');
      const matches = captured.snapshot.papers.filter((p) => p.id === captured.paperId);
      if (!matches.length) return failure('not-found', 'The selected report is unavailable.');
      if (matches.length !== 1) return failure('conflict', 'The report has conflicting copies.');
      const parsed = paperSchema.safeParse(matches[0]);
      if (!parsed.success) return failure('invalid-data', 'The selected report is malformed.');
      // Reuse the accepted immutable-provenance/date/bounds validator without creating RAM data.
      const checked = createPersonalMark(
        {
          label: '',
          geometry: { kind: 'pin', at: { x: 0, y: 0 } },
          source: { kind: 'paper', paperId: captured.paperId },
        },
        { scope, artwork, snapshot: captured.snapshot, gameMs: captured.gameMs },
        () => 'capture-validation',
      );
      if (!checked.ok) return checked;
      return success({ capture: captured, paper: immutable(parsed.data) });
    } catch {
      return failure('invalid-data', 'The report capture is invalid.');
    }
  }
  function request(id: number): Result<Request> {
    if (disposed) return failure('disposed', 'Report placement is closed.');
    if (!active || active.id !== id) return aborted();
    return success(active);
  }
  function ready(r: Request): Result<void> {
    if (!current(r)) return aborted();
    if (state.phase !== 'placing' || r.consumed || writing)
      return failure('not-ready', 'Wait for the table before placing the report.');
    const result = call(() => ports.check('place'));
    return current(r) ? result : aborted();
  }
  function preview(id: number, at: PointM, label: string): Result<void> {
    const found = request(id);
    if (!found.ok) return found;
    const r = found.value;
    const checked = ready(r);
    if (!checked.ok) return checked;
    const parsed = validPoint(at, label);
    if (!parsed.ok) {
      update(r, {
        error: parsed.error,
        preview: null,
        ...(typeof label === 'string' && label.length <= 256 ? { label } : {}),
      });
      return parsed;
    }
    const projected = call(() => ports.project(parsed.value));
    if (!current(r)) return aborted();
    if (!projected.ok) {
      update(r, { error: projected.error, preview: null });
      return projected;
    }
    const css = projected.value;
    if (css && (!Number.isFinite(css.clientXCssPx) || !Number.isFinite(css.clientYCssPx))) {
      const result = failure('invalid-data', 'The map preview is unavailable.');
      update(r, { preview: null, error: result.error });
      return result;
    }
    update(r, { label, preview: { at: parsed.value, css }, error: null });
    return current(r) ? success(undefined) : aborted();
  }
  function place(id: number, at: PointM, label: string): Result<PlotReceipt> {
    const found = request(id);
    if (!found.ok) return found;
    const r = found.value;
    const checked = ready(r);
    if (!checked.ok) return checked;
    const parsed = validPoint(at, label);
    if (!parsed.ok) {
      update(r, { error: parsed.error });
      return parsed;
    }
    r.consumed = true;
    writing = true;
    update(r, { phase: 'committing', label, error: null });
    if (!current(r)) {
      writing = false;
      return aborted();
    }
    releasePointer(r);
    if (!current(r)) {
      writing = false;
      return aborted();
    }
    const captured = r.capture!;
    let result: Result<void>;
    try {
      result = ports.createPin(captured, parsed.value, label);
    } catch {
      writing = false;
      const unknown = failure(
        'outcome-unknown',
        'Creation outcome unknown. Inspect local marks before starting a new placement; do not retry this request.',
      );
      finish(r, unknown.error, 'unknown');
      return unknown;
    }
    writing = false;
    if (result.ok) {
      finish(r, null, 'created');
      const warning = r.cleanupFailed
        ? {
            code: 'internal' as const,
            retry: 'never' as const,
            message: 'Created locally; unsaved. Placement cleanup failed.',
          }
        : null;
      if (!disposed && generation === r.id && warning) emit({ ...state, error: warning });
      return success(immutable({ kind: 'created', warning }));
    }
    if (current(r)) {
      r.consumed = false;
      update(r, { phase: 'placing', pointerId: null, error: result.error });
    }
    return result;
  }
  function cancel(id: number): Result<void> {
    const found = request(id);
    if (!found.ok) return found;
    finish(found.value, aborted().error);
    return success(undefined);
  }
  function pointer(
    id: number,
    event: 'down' | 'move' | 'up' | 'cancel' | 'lost-capture',
    p: PlotPointer,
  ): Result<PlotReceipt | null> {
    const found = request(id);
    if (!found.ok) return found;
    const r = found.value;
    if (!validPointer(p)) return failure('invalid-data', 'The placement pointer is invalid.');
    if (event === 'down' && p.pointerType === 'touch' && !p.isPrimary) {
      cancel(id);
      return success(null);
    }
    if (event === 'down' && !r.pointer) {
      if (!eligible(p)) return success(null);
      const checked = ready(r);
      if (!checked.ok) return checked;
      r.pointer = immutable(structuredClone(p));
      const held = call(() => ports.capturePointer(p.pointerId));
      if (!held.ok) {
        releasePointer(r);
        update(r, { pointerId: null, error: held.error });
        return held;
      }
      if (!remember(r, 'releasePointer', held.value)) return aborted();
      update(r, { pointerId: p.pointerId });
      return current(r) ? success(null) : aborted();
    }
    if (
      !r.pointer ||
      r.pointer.pointerId !== p.pointerId ||
      r.pointer.pointerType !== p.pointerType
    )
      return success(null);
    if (event === 'cancel' || event === 'lost-capture') {
      cancel(id);
      return success(null);
    }
    if (event === 'up' && state.phase === 'navigating') {
      cancel(id);
      return success(null);
    }
    if (event !== 'up' && event !== 'move') return success(null);
    const checked = ready(r);
    if (!checked.ok) return event === 'up' ? refuseDrop(r, checked.error) : checked;
    r.pointer = immutable(structuredClone(p));
    const picked = call(() => ports.pickAt(p.clientXCssPx, p.clientYCssPx));
    if (!current(r)) return aborted();
    const at = picked.ok && picked.value.kind !== 'none' ? picked.value.at : null;
    const parsed = at ? validPoint(at, state.label) : null;
    if (!picked.ok || !parsed?.ok) {
      if (event === 'up') releasePointer(r);
      update(r, {
        preview: null,
        pointerId: r.pointer?.pointerId ?? null,
        error: !picked.ok ? picked.error : parsed && !parsed.ok ? parsed.error : null,
      });
      return current(r) ? success(null) : aborted();
    }
    if (event === 'up') {
      const placed = place(id, parsed.value, state.label);
      // Picking itself may trigger a presentation change before place's second readiness check.
      return !placed.ok && current(r) ? refuseDrop(r, placed.error) : placed;
    }
    update(r, {
      preview: {
        at: parsed.value,
        css: { clientXCssPx: p.clientXCssPx, clientYCssPx: p.clientYCssPx },
      },
      error: null,
    });
    return current(r) ? success(null) : aborted();
  }
  return {
    scope,
    artwork,
    getState: () => state,
    subscribe(listener) {
      if (!disposed) listeners.add(listener);
      try {
        listener(state);
      } catch {
        /* Isolate initial delivery too. */
      }
      let subscribed = true;
      return () => {
        if (subscribed) {
          subscribed = false;
          listeners.delete(listener);
        }
      };
    },
    begin(raw, p) {
      if (disposed) return failure('disposed', 'Report placement is closed.');
      if (writing) return failure('conflict', 'Report creation is already committing.');
      const id = ++generation;
      if (active) {
        const previous = active;
        active = null;
        cleanup(previous);
      }
      if (disposed || generation !== id) return aborted();
      const captured = capture(raw);
      if (!captured.ok) {
        emit({ ...empty, phase: 'finished', requestId: id, error: captured.error });
        return captured;
      }
      if (p && !eligible(p)) {
        const result = failure('invalid-data', 'Use one primary placement pointer.');
        emit({ ...empty, phase: 'finished', requestId: id, error: result.error });
        return result;
      }
      let settled = false;
      let resolve!: (result: Result<void>) => void;
      const promise = new Promise<Result<void>>((r) => {
        resolve = r;
      });
      const r: Request = {
        id,
        capture: captured.value.capture,
        paper: captured.value.paper,
        abort: new AbortController(),
        settle: (result) => {
          if (!settled) {
            settled = true;
            resolve(result);
          }
        },
        pointer: p ? immutable(structuredClone(p)) : null,
        controls: null,
        releasePointer: null,
        consumed: false,
        cleanupFailed: false,
      };
      active = r;
      const checked = call(() => ports.check('start'));
      if (!current(r)) return aborted();
      if (!checked.ok) {
        finish(r, checked.error);
        return checked;
      }
      const controls = call(() => ports.acquireControls({ signal: r.abort.signal }));
      if (!controls.ok) {
        finish(r, controls.error);
        return controls;
      }
      if (!remember(r, 'controls', controls.value)) return aborted();
      if (p) {
        const held = call(() => ports.capturePointer(p.pointerId));
        if (!held.ok) {
          finish(r, held.error);
          return held;
        }
        if (!remember(r, 'releasePointer', held.value)) return aborted();
      }
      if (!current(r)) return aborted();
      emit({
        ...empty,
        phase: 'navigating',
        requestId: id,
        paper: r.paper,
        gameMs: captured.value.capture.gameMs,
        pointerId: p?.pointerId ?? null,
        label: `${r.paper.from}: report`.slice(0, 256),
      });
      if (!current(r)) return aborted();
      // Rejections are observed even when the port ignores abort and completes long after teardown.
      let entering: Promise<Result<void>>;
      try {
        entering = ports.enterTable({ signal: r.abort.signal });
      } catch {
        entering = Promise.resolve(failure('internal', 'The table could not be opened.'));
      }
      void Promise.resolve(entering).then(
        (result) => {
          if (!current(r)) return;
          if (!result.ok) {
            r.settle(result);
            finish(r, result.error);
            return;
          }
          const settledTable = call(() => ports.check('place'));
          if (!current(r)) return;
          if (!settledTable.ok) {
            r.settle(settledTable);
            finish(r, settledTable.error);
            return;
          }
          update(r, { phase: 'placing' });
          if (current(r)) r.settle(success(undefined));
        },
        () => {
          if (!current(r)) return;
          const result = failure('internal', 'The table could not be opened.');
          r.settle(result);
          finish(r, result.error);
        },
      );
      if (!current(r)) return aborted();
      return success(Object.freeze({ id, ready: promise }));
    },
    pointer,
    preview,
    place,
    cancel,
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      if (active) {
        const previous = active;
        active = null;
        cleanup(previous);
      }
      emit({ ...empty, phase: 'disposed' });
      listeners.clear();
    },
  };
}
