import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import type * as Maps from '@kriegsspiel/maps';
import type { LibraryLease } from './admission.js';
export const LIBRARY_ASSET_BYTES = 64 * 1024 * 1024;
const summary = z
  .object({
    identity: z.string().regex(/^[a-f0-9]{64}$/),
    widthM: z.number().finite().min(1).max(20000),
    heightM: z.number().finite().min(1).max(20000),
  })
  .strict();
export type ValidatedLibraryAsset = {
  readonly canonicalJson: string;
  readonly identity: string;
  readonly widthM: number;
  readonly heightM: number;
};
/** Self-contained trusted worker function: input bytes are data, never executable source. */
async function certify(maps: typeof Maps, json: string) {
  const asset = maps.importAsset(json);
  const result = maps.validateBattlefield(asset);
  if (!result.ok) throw new Error('invalid_map');
  if (
    asset.bounds.minX !== 0 ||
    asset.bounds.minY !== 0 ||
    asset.bounds.maxX !== asset.settings.widthM ||
    asset.bounds.maxY !== asset.settings.heightM
  )
    throw new Error('invalid_map_bounds');
  if (maps.canonicalizeAsset(asset) !== json) throw new Error('noncanonical_map');
  return {
    identity: await maps.assetIdentity(asset, 'asset'),
    widthM: asset.bounds.maxX,
    heightM: asset.bounds.maxY,
  };
}
const bootstrap = `const {parentPort,workerData}=require('node:worker_threads');
(async()=>{try{const maps=await import(workerData.moduleUrl);const value=await (${certify.toString()})(maps,workerData.json);parentPort.postMessage({ok:true,value});}catch{parentPort.postMessage({ok:false});}finally{parentPort.close();}})();`;
export type LibraryWorkerFactory = (
  source: string,
  options: ConstructorParameters<typeof Worker>[1],
) => Worker;
/** A lease must already exist before the caller buffers or retrieves json. */
export async function validateLibraryAsset(
  json: string,
  lease: LibraryLease,
  signal: AbortSignal,
  factory: LibraryWorkerFactory = (source, options) => new Worker(source, options),
): Promise<ValidatedLibraryAsset> {
  lease.assertActive();
  if (signal.aborted) throw new DOMException('Map operation cancelled', 'AbortError');
  if (json.length > LIBRARY_ASSET_BYTES || Buffer.byteLength(json) > LIBRARY_ASSET_BYTES)
    throw new Error('map_too_large');
  const moduleUrl = new URL('../../../packages/maps/dist/index.js', import.meta.url).href;
  const worker = factory(bootstrap, {
    eval: true,
    workerData: { json, moduleUrl },
    resourceLimits: { maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64, stackSizeMb: 4 },
  });
  let exited = false;
  let settled = false;
  let resolveExit!: () => void;
  const exit = new Promise<void>((resolve) => {
    resolveExit = resolve;
  });
  lease.track(exit);
  let terminate: Promise<number> | undefined;
  const stop = () => {
    if (!exited && !terminate) terminate = worker.terminate();
    void terminate?.catch(() => {});
  };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    const result = await new Promise<z.infer<typeof summary>>((resolve, reject) => {
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        stop();
        reject(error);
      };
      abort = () => fail(new DOMException('Map operation cancelled', 'AbortError'));
      worker.once('error', () => fail(new Error('map_validation_failed')));
      worker.once('exit', () => {
        exited = true;
        resolveExit();
        if (!settled) {
          settled = true;
          reject(new Error('map_validation_failed'));
        }
      });
      worker.once('message', (message: unknown) => {
        if (settled) return;
        const envelope = z
          .object({ ok: z.literal(true), value: summary })
          .strict()
          .safeParse(message);
        if (!envelope.success) {
          fail(new Error('map_validation_failed'));
          return;
        }
        settled = true;
        resolve(envelope.data.value);
      });
      timeout = setTimeout(() => fail(new Error('map_validation_timeout')), 30000);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    // Even successful acknowledgement is not retirement. Await exit while its admission slot is held.
    stop();
    await exit;
    if (signal.aborted) throw new DOMException('Map operation cancelled', 'AbortError');
    return Object.freeze({ canonicalJson: json, ...result });
  } finally {
    if (timeout) clearTimeout(timeout);
    if (abort) signal.removeEventListener('abort', abort);
    stop();
    await exit;
  }
}
