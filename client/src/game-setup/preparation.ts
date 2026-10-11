import { assetIdentity, canonicalizeAsset, type MapAsset } from '@kriegsspiel/maps';
import { createAuthoringRuntime } from '../map-authoring/runtime/index.js';
import type { ReplayParameters } from '../map-authoring/generation/protocol.js';
import type { BoardPreparation, CertifiedBoard, MapSummary } from './contracts.js';

type Runtime = ReturnType<typeof createAuthoringRuntime>;
/** Each operation owns a fresh runtime; saved certification never invokes generation. */
export function createBoardPreparation(
  options: { runtimeFactory?: () => Runtime } = {},
): BoardPreparation {
  let disposed = false;
  let stop: (() => void) | null = null;
  async function prepare(
    input: string | ReplayParameters,
    summary: MapSummary | null,
    signal: AbortSignal,
  ): Promise<CertifiedBoard> {
    if (disposed || signal.aborted) throw new Error('Preparation cancelled');
    stop?.();
    const runtime =
      options.runtimeFactory?.() ??
      createAuthoringRuntime({
        generationWorkerFactory: () =>
          new Worker(new URL('../map-authoring/generate.worker.ts', import.meta.url), {
            type: 'module',
          }),
        validationWorkerFactory: () =>
          new Worker(new URL('../map-authoring/validate.worker.ts', import.meta.url), {
            type: 'module',
          }),
      });
    return new Promise((resolve, reject) => {
      let done = false;
      let checking = false;
      let id: number | null = null;
      let unsubscribe = () => {};
      const finish = (error?: unknown, board?: CertifiedBoard) => {
        if (done) return;
        done = true;
        signal.removeEventListener('abort', abort);
        unsubscribe();
        if (stop === abort) stop = null;
        runtime.dispose();
        if (error) reject(error);
        else resolve(board!);
      };
      const abort = () => finish(new Error('Preparation cancelled'));
      stop = abort;
      signal.addEventListener('abort', abort, { once: true });
      const inspect = () => {
        const state = runtime.controller.state;
        if (done || state.requestId !== id) return;
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
              const asset = runtime.controller.exportAsset;
              const files = runtime.exportFiles;
              if (
                !asset ||
                !files ||
                canonicalizeAsset(structuredClone(asset) as MapAsset) !== files.json
              )
                throw new Error('Certification export does not match the current asset');
              const identity = await assetIdentity(structuredClone(asset) as MapAsset, 'asset');
              if (
                done ||
                signal.aborted ||
                runtime.controller.state.requestId !== id ||
                runtime.controller.exportAsset !== asset ||
                runtime.exportFiles !== files
              )
                return;
              const widthM = asset.bounds.maxX;
              const heightM = asset.bounds.maxY;
              if (summary && (summary.widthM !== widthM || summary.heightM !== heightM))
                throw new Error('Saved map dimensions do not match the catalog');
              finish(undefined, {
                asset,
                canonicalJson: files.json,
                assetIdentity: identity,
                summary: { name: asset.name, widthM, heightM, ref: summary?.ref ?? null },
                bounds: { minX: 0, minY: 0, maxX: widthM, maxY: heightM },
              });
            } catch (error) {
              finish(error);
            }
          })();
        }
      };
      try {
        unsubscribe = runtime.controller.subscribe(inspect);
        id =
          typeof input === 'string'
            ? runtime.controller.loadSavedAsset(input)
            : runtime.controller.generate(structuredClone(input));
        inspect();
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
