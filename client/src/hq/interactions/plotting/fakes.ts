import { vi } from 'vitest';
import type { HqSnapshot, PublicArtwork, Result, Scope } from '../../contracts';
import { createReportPlacementController } from './controller';
import type { PlotCapture, PlotPointer, PlotPorts } from './types';
export const scope: Scope = { gameId: 'fixture', sideId: 'blue', playerId: 'one' };
export const artwork: PublicArtwork = {
  kind: 'public-artwork',
  id: 'hq-schematic',
  revision: '2',
  widthM: 4000,
  heightM: 3000,
  image: { url: '/hq-preview.svg', pixelWidth: 1200, pixelHeight: 900 },
  registration: 'full-image-nw-origin',
  credit: 'Fixture',
  licence: 'Project',
  sourceUrl: null,
};
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (message = 'Not ready'): Result<never> => ({
  ok: false,
  error: { code: 'not-ready', message, retry: 'never' },
});
export function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
export function capture(): PlotCapture {
  const snapshot: HqSnapshot = {
    scope: { ...scope },
    epoch: 'epoch',
    ordinal: 1,
    authorityRevision: null,
    atGame: 300,
    clock: {
      authoritativeGameMs: 300,
      rate: 1,
      status: 'paused',
      mode: 'manual',
      barrier: { kind: 'unknown' },
      coherence: 'fixture-atomic',
      receivedMonotonicMs: 0,
    },
    roster: [],
    pieces: [],
    papers: [
      {
        id: 'paper',
        from: 'Scout',
        category: 'scouts',
        writtenAtGame: 100,
        receivedAtGame: 200,
        observedAtGame: null,
        location: null,
        unitId: null,
        sizeEstimate: null,
        confidence: null,
        text: 'Supplied report <img src=x>.',
      },
    ],
  };
  return { snapshot, paperId: 'paper', gameMs: 450 };
}
export function pointer(overrides: Partial<PlotPointer> = {}): PlotPointer {
  return {
    pointerId: 7,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    clientXCssPx: 350.125,
    clientYCssPx: 250.875,
    ...overrides,
  };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export function setup() {
  const releaseControls = vi.fn();
  const releasePointer = vi.fn();
  const ports = {
    check: vi.fn<PlotPorts['check']>(() => ok(undefined)),
    enterTable: vi.fn<PlotPorts['enterTable']>(async () => ok(undefined)),
    acquireControls: vi.fn<PlotPorts['acquireControls']>(() => ok(releaseControls)),
    capturePointer: vi.fn<PlotPorts['capturePointer']>(() => ok(releasePointer)),
    pickAt: vi.fn<PlotPorts['pickAt']>((x, y) => ok({ kind: 'map', at: { x, y } })),
    project: vi.fn<PlotPorts['project']>((at) =>
      ok({ clientXCssPx: at.x / 4, clientYCssPx: at.y / 4 }),
    ),
    createPin: vi.fn<PlotPorts['createPin']>(() => ok(undefined)),
  };
  const controller = createReportPlacementController({ scope, artwork, ports });
  return { ports, controller, releaseControls, releasePointer };
}
