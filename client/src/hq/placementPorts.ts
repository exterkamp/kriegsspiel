import type { MapSurface, PublicArtwork, Scope, Unsubscribe } from './contracts';
import type { PersonalMarksController } from './data/marks';
import type { PlotPorts } from './interactions/plotting';
import type { ShellViewContext } from './shell/types';
import { failure, sameScope, success } from './data/common';
export interface PlacementEnvironment {
  readonly context: ShellViewContext;
  readonly hub: HTMLElement;
  readonly canvas: HTMLCanvasElement;
}
export function createPlacementPorts(options: {
  scope: Scope;
  artwork: PublicArtwork;
  surface: MapSurface;
  marks: PersonalMarksController;
  alive: () => boolean;
  environment: () => PlacementEnvironment | null;
}): PlotPorts {
  const captures = new Map<HTMLElement, Map<number, symbol>>();
  const check: PlotPorts['check'] = (stage) => {
    const env = options.environment();
    if (!options.alive()) return failure('disposed', 'Headquarters is closed.');
    if (!env) return failure('not-ready', 'The map interaction is not ready.');
    if (
      !sameScope(env.context.state.scope, options.scope) ||
      !sameScope(options.surface.scope, options.scope) ||
      !sameScope(options.marks.scope, options.scope) ||
      JSON.stringify(options.marks.artwork) !== JSON.stringify(options.artwork)
    )
      return failure('scope-mismatch', 'Report placement belongs to another headquarters or map.');
    const state = options.marks.getState();
    if (state.busy || !state.writable)
      return failure('not-ready', 'Local marks are unavailable or busy.');
    if (stage === 'place' && (env.context.state.view !== 'table' || env.context.mapReady !== true))
      return failure('not-ready', 'Wait for the map table to settle before placing the report.');
    return success(undefined);
  };
  return {
    check,
    async enterTable(op) {
      const env = options.environment();
      if (!env) return failure('not-ready', 'The map interaction is not ready.');
      const result = await env.context.navigation.navigate('table', null, op);
      if (!result.ok) return result;
      if (op.signal.aborted || !options.alive())
        return failure('aborted', 'Report placement was cancelled.');
      return check('place');
    },
    acquireControls: (op) => options.surface.acquireControls(op),
    capturePointer(id) {
      const env = options.environment();
      if (!env || !options.alive()) return failure('not-ready', 'The report drag is unavailable.');
      const token = Symbol('report-pointer');
      const hub = env.hub;
      const owned = captures.get(hub) ?? new Map<number, symbol>();
      captures.set(hub, owned);
      owned.set(id, token);
      const release: Unsubscribe = () => {
        if (owned.get(id) !== token) return;
        owned.delete(id);
        if (owned.size === 0) captures.delete(hub);
        if (hub.hasPointerCapture(id)) hub.releasePointerCapture(id);
      };
      try {
        hub.setPointerCapture(id);
        return success(release);
      } catch {
        try {
          release();
        } catch {
          /* Unsupported capture leaves no owned pointer. */
        }
        return failure(
          'unsupported',
          'Pointer capture is unavailable. Choose report coordinates instead.',
        );
      }
    },
    pickAt(x, y) {
      const ready = check('place');
      if (!ready.ok) return ready;
      const env = options.environment()!;
      const rect = env.canvas.getBoundingClientRect();
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < rect.left ||
        x > rect.right ||
        y < rect.top ||
        y > rect.bottom ||
        rect.width <= 0 ||
        rect.height <= 0 ||
        env.canvas.ownerDocument.elementFromPoint(x, y) !== env.canvas
      )
        return success({ kind: 'none' });
      return options.surface.pickAt(x, y);
    },
    project: (at) => options.surface.project(at),
    createPin(capture, at, label) {
      const ready = check('place');
      if (!ready.ok) return ready;
      return options.marks.create(
        {
          label,
          geometry: { kind: 'pin', at },
          source: { kind: 'paper', paperId: capture.paperId },
        },
        capture.snapshot,
        capture.gameMs,
      );
    },
  };
}
