import { generateBattlefield } from '@kriegsspiel/maps';
import { createWorkerRunner, parseReplayParameters } from './generation/index.js';

const scope = globalThis as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
};
const runner = createWorkerRunner({
  generate: (request, report) => {
    report({ stage: 'terrain', fraction: 0, message: 'Starting complete battlefield generation' });
    return generateBattlefield(
      parseReplayParameters({
        seed: request.seed,
        settings: request.settings,
        overrides: request.overrides,
      }),
    );
  },
  postMessage: (message) => scope.postMessage(message),
});
scope.onmessage = (event) => {
  void runner.handleMessage(event.data).catch((error) => {
    setTimeout(() => {
      throw error;
    }, 0);
  });
};
