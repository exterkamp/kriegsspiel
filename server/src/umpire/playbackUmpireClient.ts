import { Ajv } from 'ajv';
import type { ValidateFunction } from 'ajv';
import { UmpireError } from './umpireClient.js';
import type {
  UmpireCallRecord,
  UmpireClient,
  UmpireRequest,
  UmpireResponse,
} from './umpireClient.js';

function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}

const keyOf = (r: { stage: string; promptVersion: string; input: unknown }) =>
  `${r.stage}\u0000${r.promptVersion}\u0000${stable(r.input)}`;

/**
 * Serves recorded outputs for replay. It takes no transport, so it cannot reach the network.
 * Records are matched on stage, prompt version and input; repeated identical calls are served in
 * the order they were recorded. A call with no recording fails loudly: a replay that diverges
 * from the original game is a bug, not something to paper over with a live call.
 */
export class PlaybackUmpireClient implements UmpireClient {
  private readonly queues = new Map<string, UmpireCallRecord[]>();
  private readonly ajv = new Ajv({ strict: false });
  private readonly validators = new WeakMap<object, ValidateFunction>();

  constructor(records: readonly UmpireCallRecord[]) {
    for (const r of records) {
      const k = keyOf(r);
      const q = this.queues.get(k);
      if (q) q.push(r);
      else this.queues.set(k, [r]);
    }
  }

  async call<T>(request: UmpireRequest): Promise<UmpireResponse<T>> {
    const record = this.queues.get(keyOf(request))?.shift();
    if (!record) {
      throw new UmpireError(
        `no recording for ${request.stage} call (prompt ${request.promptVersion})`,
        'missing-recording',
        0,
      );
    }
    let output: unknown;
    try {
      output = JSON.parse(record.rawOutput);
    } catch {
      throw new UmpireError('recorded output is not JSON', 'schema', 0);
    }
    let validate = this.validators.get(request.schema);
    if (!validate) {
      validate = this.ajv.compile(request.schema);
      this.validators.set(request.schema, validate);
    }
    if (!validate(output)) {
      throw new UmpireError(
        `recorded output no longer matches schema: ${this.ajv.errorsText(validate.errors)}`,
        'schema',
        0,
      );
    }
    return { output: output as T, record };
  }
}
