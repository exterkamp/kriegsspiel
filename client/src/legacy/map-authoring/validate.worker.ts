import {
  exportBattlefield,
  validateBattlefield,
  supportsValidation,
  type MapAsset,
} from '@kriegsspiel/maps';
import { createValidationRunner } from './runtime/index.js';

const scope = globalThis as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
};
const runner = createValidationRunner({
  validate: (asset) => {
    if (!supportsValidation(asset))
      return {
        ok: false,
        kind: 'infeasible',
        diagnostics: [
          {
            severity: 'error',
            stage: 'validation',
            code: 'UNSUPPORTED_REPLAY',
            message: 'Recorded generator, stage or fork identities are unsupported',
            remediation: 'Use the recorded supported generator and exact fork artifact',
          },
        ],
      };
    const result = validateBattlefield(asset);
    return result.ok ? { ok: true, diagnostics: result.diagnostics } : result;
  },
  exportValidated: (asset) => exportBattlefield(structuredClone(asset) as MapAsset),
  postMessage: (message) => scope.postMessage(message),
});
scope.onmessage = (event) => {
  void runner.handleMessage(event.data).catch((error) => {
    setTimeout(() => {
      throw error;
    }, 0);
  });
};
