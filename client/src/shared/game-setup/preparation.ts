import { assetIdentity, canonicalizeAsset, type MapAsset } from '@kriegsspiel/maps';
import { createAuthoringRuntime } from '../../legacy/map-authoring/runtime/index.js';
import type { ReplayParameters } from '../../legacy/map-authoring/generation/protocol.js';
import type { BoardPreparation, CertifiedBoard, MapSummary } from './contracts.js';

type Runtime = ReturnType<typeof createAuthoringRuntime>;
/** Trusted opt-in verification of the runtime export; the ordinary local-board path is unchanged. */
export type PreparationAssetVerifier = (
  candidate: MapAsset,
  canonicalJson: string,
  signal: AbortSignal,
) => Promise<{ asset: MapAsset; assetIdentity: string }>;
/** Each operation owns a fresh runtime; saved certification never invokes generation. */
export function createBoardPreparation(
  options: { runtimeFactory?: () => Runtime; verifyAsset?: PreparationAssetVerifier } = {},
): BoardPreparation {
  const verifyAsset = options.verifyAsset;
  let disposed = false;
  let stop: (() => void) | null = null;
  let retiring: Promise<void> | null = null;
  async function prepare(
    input: string | ReplayParameters,
    summary: MapSummary | null,
    signal: AbortSignal,
  ): Promise<CertifiedBoard> {
    if (disposed || signal.aborted) throw new Error('Preparation cancelled');
    return new Promise((resolve, reject) => {
      let done = false;
      let checking = false;
      let id: number | null = null;
      let runtime: Runtime | null = null;
      let unsubscribe: (() => void) | null = null;
      const release = () => {
        // Detach ownership before injected cleanup can reenter preparation.
        const subscription = unsubscribe;
        const ownedRuntime = runtime;
        unsubscribe = null;
        runtime = null;
        try {
          subscription?.();
        } catch {
          /* Subscription cleanup must not block runtime release or settlement. */
        }
        try {
          ownedRuntime?.dispose();
        } catch {
          /* A faulty injected cleanup must not strand the operation's promise. */
        }
      };
      const finish = (error?: unknown, board?: CertifiedBoard) => {
        if (done) return;
        done = true;
        signal.removeEventListener('abort', abort);
        if (stop === abort) stop = null;
        // Worker/runtime/subscription factories may still be handing us resources,
        // including during asynchronous candidate validation. Retire after that
        // synchronous handoff, and before a replacement allocates its runtime.
        const retirement = (retiring ?? Promise.resolve()).then(release);
        retiring = retirement;
        void retirement.then(() => {
          if (retiring === retirement) retiring = null;
          if (!board) reject(error);
          else resolve(board);
        });
      };
      const abort = () => finish(new Error('Preparation cancelled'));
      const previous = stop;
      stop = abort;
      signal.addEventListener('abort', abort, { once: true });
      const current = () => !done && !disposed && !signal.aborted && stop === abort;
      const inspect = () => {
        if (!current() || !runtime || id === null) return;
        const ownedRuntime = runtime;
        const state = ownedRuntime.controller.state;
        if (state.requestId !== id) {
          finish(new Error('Certification no longer belongs to the current request'));
          return;
        }
        if (state.status === 'failed')
          finish(
            new Error(
              state.failure?.message ??
                (state.candidateDiagnostics
                  .filter((d) => d.severity === 'error')
                  .map((d) => d.message)
                  .join('\n') ||
                  'Map certification failed'),
            ),
          );
        else if (state.status === 'ready' && !checking) {
          checking = true;
          void (async () => {
            try {
              const asset = ownedRuntime.controller.exportAsset;
              const files = ownedRuntime.exportFiles;
              let snapshot = asset ? (structuredClone(asset) as MapAsset) : null;
              if (!snapshot || !files)
                throw new Error('Certification export does not match the current asset');
              let identity: string;
              if (verifyAsset) {
                const verified = await verifyAsset(snapshot, files.json, signal);
                if (!current()) return;
                snapshot = structuredClone(verified.asset);
                identity = verified.assetIdentity;
                if (!/^[a-f0-9]{64}$/.test(identity))
                  throw new Error('Invalid verified asset identity');
              } else {
                if (canonicalizeAsset(snapshot) !== files.json)
                  throw new Error('Certification export does not match the current asset');
                identity = await assetIdentity(snapshot, 'asset');
              }
              if (!current()) return;
              if (
                ownedRuntime.controller.state.status !== 'ready' ||
                ownedRuntime.controller.state.requestId !== id ||
                ownedRuntime.controller.exportAsset !== asset ||
                ownedRuntime.exportFiles !== files
              ) {
                finish(new Error('Certification no longer belongs to the current request'));
                return;
              }
              const { minX, minY, maxX: widthM, maxY: heightM } = snapshot.bounds;
              if (minX !== 0 || minY !== 0)
                throw new Error('Certified map must use north-west zero bounds');
              if (
                savedSummary &&
                (savedSummary.widthM !== widthM || savedSummary.heightM !== heightM)
              )
                throw new Error('Saved map dimensions do not match the catalog');
              finish(undefined, {
                asset: snapshot,
                canonicalJson: files.json,
                assetIdentity: identity,
                summary: { name: snapshot.name, widthM, heightM, ref: savedSummary?.ref ?? null },
                bounds: { minX: 0, minY: 0, maxX: widthM, maxY: heightM },
              });
            } catch (error) {
              if (current()) finish(error);
            }
          })();
        }
      };
      let savedSummary: MapSummary | null = null;
      const start = (request: string | ReplayParameters) => {
        try {
          if (!current()) {
            abort();
            return;
          }
          runtime =
            options.runtimeFactory?.() ??
            createAuthoringRuntime({
              generationWorkerFactory: () =>
                new Worker(
                  new URL('../../legacy/map-authoring/generate.worker.ts', import.meta.url),
                  {
                    type: 'module',
                  },
                ),
              validationWorkerFactory: () =>
                new Worker(
                  new URL('../../legacy/map-authoring/validate.worker.ts', import.meta.url),
                  {
                    type: 'module',
                  },
                ),
            });
          if (!current()) {
            abort();
            return;
          }
          unsubscribe = runtime.controller.subscribe(inspect);
          if (!current()) {
            abort();
            return;
          }
          id =
            typeof request === 'string'
              ? runtime.controller.loadSavedAsset(request)
              : runtime.controller.generate(request);
          if (!current()) abort();
          else inspect();
        } catch (error) {
          finish(error);
        }
      };
      try {
        previous?.();
        if (!current()) {
          abort();
          return;
        }
        savedSummary = summary ? structuredClone(summary) : null;
        const request = typeof input === 'string' ? input : structuredClone(input);
        if (retiring) void retiring.then(() => start(request));
        else start(request);
      } catch (error) {
        finish(error);
      }
    });
  }
  return {
    load: (json, summary, signal) => prepare(json, summary, signal),
    generate: (recipe, signal) => prepare(recipe, null, signal),
    dispose() {
      if (disposed) return;
      disposed = true;
      stop?.();
    },
  };
}
