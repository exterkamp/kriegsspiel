import { type GenerationResult, type MapAsset } from '@kriegsspiel/maps';
import {
  errorMessage,
  freezeData,
  parseGeneratorResult,
  parseProgress,
  parseRequest,
  type GenerateRequest,
  type Progress,
  type ReadonlyData,
  type WorkerResponse,
} from './protocol';

export interface RunnerOptions {
  generate: (
    request: ReadonlyData<GenerateRequest>,
    report: (progress: Progress) => void,
  ) => GenerationResult<MapAsset> | Promise<GenerationResult<MapAsset>>;
  postMessage: (message: WorkerResponse) => void;
}
/** One request per dedicated worker. Its future entry point must forward MessageEvent.data here. */
export function createWorkerRunner(options: RunnerOptions): {
  handleMessage(input: unknown): Promise<void>;
} {
  let started = false;
  return {
    async handleMessage(input: unknown): Promise<void> {
      // Invalid input throws to the entry adapter; no guessed request ID is sent back.
      const request = freezeData(parseRequest(input));
      if (started) throw new Error('Worker runner accepts only one generation request');
      started = true;
      const envelope = { v: 1 as const, requestId: request.requestId };
      let completed = false;
      function fail(error: unknown): void {
        if (completed) return;
        completed = true;
        options.postMessage({
          ...envelope,
          type: 'error',
          error: { kind: 'programming', code: 'GENERATOR_EXCEPTION', message: errorMessage(error) },
        });
      }
      try {
        const raw = await options.generate(request, (progress) => {
          if (completed) return;
          try {
            options.postMessage({
              ...envelope,
              type: 'progress',
              progress: parseProgress(progress),
            });
          } catch (error) {
            fail(error);
          }
        });
        if (completed) return;
        const result = parseGeneratorResult(raw);
        completed = true;
        if (!result.ok)
          options.postMessage({ ...envelope, type: 'infeasible', diagnostics: result.diagnostics });
        // Contract validity is not complete certification. The controller still validates it.
        else
          options.postMessage({
            ...envelope,
            type: 'candidate',
            asset: result.value,
            diagnostics: result.diagnostics,
          });
      } catch (error) {
        // A terminal transport failure cannot be reported over that same broken channel.
        if (completed) throw error;
        fail(error);
      }
    },
  };
}
