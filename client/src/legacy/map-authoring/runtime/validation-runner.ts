import type { GenerationResult, MapAsset } from '@kriegsspiel/maps';
import {
  errorMessage,
  parseValidation,
  type CompleteAssetValidator,
  type ReadonlyData,
} from '../generation/index.js';
import {
  parseValidationRequest,
  parseExportResult,
  parseValidationResponse,
  type ValidatedFiles,
  type ValidationResponse,
} from './protocol.js';

/** Inject this runner into a dedicated worker entry once G's full validator is frozen. */
export function createValidationRunner(options: {
  validate: CompleteAssetValidator;
  exportValidated?: (
    asset: ReadonlyData<MapAsset>,
  ) => GenerationResult<ValidatedFiles> | Promise<GenerationResult<ValidatedFiles>>;
  postMessage: (message: ValidationResponse) => void;
}): { handleMessage(input: unknown): Promise<void> } {
  let started = false;
  return {
    async handleMessage(input) {
      const request = parseValidationRequest(input);
      if (started) throw new Error('Validation runner accepts one candidate per worker');
      started = true;
      let response: ValidationResponse;
      let phase = 'FULL_VALIDATOR_EXCEPTION';
      try {
        const outcome = parseValidation(await options.validate(request.asset, request.context));
        response = { v: 1, requestId: request.requestId, type: 'validated', outcome };
        if (outcome.ok && options.exportValidated) {
          phase = 'FULL_EXPORT_EXCEPTION';
          const exported = parseExportResult(await options.exportValidated(request.asset));
          if (exported.ok) {
            response.files = exported.value;
            const seen = new Set<string>();
            response.outcome = parseValidation({
              ok: true,
              diagnostics: [...outcome.diagnostics, ...exported.diagnostics].filter(
                (diagnostic) => {
                  const key = JSON.stringify(diagnostic);
                  if (seen.has(key)) return false;
                  seen.add(key);
                  return true;
                },
              ),
            });
          } else
            response.outcome = parseValidation({
              ok: false,
              kind: 'infeasible',
              diagnostics: exported.diagnostics,
            });
        }
        response = parseValidationResponse(response);
      } catch (error) {
        response = {
          v: 1,
          requestId: request.requestId,
          type: 'error',
          code: phase,
          message: errorMessage(error),
        };
      }
      // A broken transport must reject through the worker error channel.
      options.postMessage(response);
    },
  };
}
