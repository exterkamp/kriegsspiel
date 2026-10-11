import { battlefieldPreset, CURRENT_GENERATOR, CONSUMED_FORK } from '@kriegsspiel/maps';
import { createAuthoringRuntime } from './runtime/index.js';
import { mountAuthoringApp } from './authoring-app.js';
import './style.css';

// Exact support identities come from G; settings edits never replace recorded versions.
function equal(left: unknown, right: unknown): boolean {
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object')
    return left === right;
  const a = left as Record<string, unknown>,
    b = right as Record<string, unknown>;
  const keys = Object.keys(a).sort();
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && equal(a[key], b[key]))
  );
}
const runtime = createAuthoringRuntime({
  generationWorkerFactory: () =>
    new Worker(new URL('./generate.worker.ts', import.meta.url), { type: 'module' }),
  validationWorkerFactory: () =>
    new Worker(new URL('./validate.worker.ts', import.meta.url), { type: 'module' }),
});
try {
  mountAuthoringApp(document, runtime, {
    presets: (['flat-countryside', 'wooded-hills', 'river-valley'] as const).map((name) => ({
      id: name,
      label: name.replaceAll('-', ' '),
      settings: battlefieldPreset(name).settings,
    })),
    checkReplaySupport: (provenance) =>
      equal(provenance.generator, CURRENT_GENERATOR) && equal(provenance.fork, CONSUMED_FORK)
        ? { supported: true }
        : {
            supported: false,
            reason: 'Recorded generator, stages or fork artifact are unsupported by this version',
          },
  });
} catch (error) {
  runtime.dispose();
  const status = document.getElementById('asset-status');
  if (status) {
    status.textContent = error instanceof Error ? error.message : 'Authoring initialization failed';
    status.dataset.error = 'true';
  }
  throw error;
}
