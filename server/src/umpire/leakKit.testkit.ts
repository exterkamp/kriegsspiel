/**
 * Shared harness for the cross-side leak suite (#44) and the prompt-injection suite (#350).
 *
 * `plantCanaries` gives every unit of a world distinctive, never-before-seen names and exact
 * strengths, and lists them as `Secret`s owned by their side. A `LeakProbe` wraps the umpire
 * client one side's stages use: it records every request that side's prompts carried and every
 * answer the model gave, and `findLeaks` reports each secret of the other side found in either,
 * with where. `ScriptedModel` is the fake model: a reply function per stage, so a test can play a
 * well-behaved model or an adversarial one that names the other side's units.
 */
import { holdTheBridge, loadScenario } from '@kriegsspiel/engine';
import type { GameState, SideId } from '@kriegsspiel/engine';
import type { UmpireClient, UmpireRequest, UmpireResponse, UmpireStage } from './umpireClient.js';

export interface Secret {
  value: string;
  /** The side that must never see it. The other side. */
  hiddenFrom: SideId;
  /** What it is, for the failure message: "red-2 name". */
  what: string;
}

export interface Leak {
  secret: Secret;
  /** For the side `reader`, in which stage and part: "narrate request input", "staff output". */
  where: string;
}

export const other = (side: SideId): SideId => (side === 'blue' ? 'red' : 'blue');

const CANARY_NAMES: Record<SideId, string[]> = {
  red: ['Zxqvian Grenadiers', 'Wrobeln Cuirassiers', 'Ulthar Voltigeurs', 'Quenzell Guns'],
  blue: ['Ymbrel Fusiliers', 'Kvothe Hussars', 'Plinth Dragoons', 'Orvane Sappers'],
};
const CANARY_COMMANDERS: Record<SideId, string[]> = {
  red: ['Marshal Vortigern', 'General Skellwick', 'Colonel Brazzle', 'Major Hoxley'],
  blue: ['Marshal Tessaly', 'General Murdoch', 'Colonel Fenwick', 'Major Dunmore'],
};

/**
 * `world` with canaries in its hidden fields: each unit's name, commander and exact strength
 * (a 4-digit number no scenario value or metre coordinate uses). The unit ids are returned
 * separately, because a side may legitimately learn an enemy id once it has seen the unit.
 */
export function plantCanaries(world: GameState = loadScenario(holdTheBridge)): {
  world: GameState;
  secrets: Secret[];
  ids: Secret[];
} {
  const secrets: Secret[] = [];
  const ids: Secret[] = [];
  const count: Record<string, number> = {};
  const units = world.units.map((u) => {
    const i = (count[u.side] = (count[u.side] ?? -1) + 1);
    const name = CANARY_NAMES[u.side][i % 4]!;
    const commander = CANARY_COMMANDERS[u.side][i % 4]!;
    const strength = (u.side === 'red' ? 7300 : 6100) + 11 * (i + 1) + 1;
    const hiddenFrom = other(u.side);
    secrets.push(
      { value: name, hiddenFrom, what: `${u.id} name` },
      { value: commander, hiddenFrom, what: `${u.id} commander` },
      { value: String(strength), hiddenFrom, what: `${u.id} exact strength` },
    );
    ids.push({ value: u.id, hiddenFrom, what: `${u.id} id` });
    return { ...u, name, commander, strength };
  });
  return { world: { ...world, units }, secrets, ids };
}

/** Secrets present in `text` that are hidden from `reader`, with `where` filled in. */
export function scan(
  text: string,
  secrets: readonly Secret[],
  reader: SideId,
  where: string,
): Leak[] {
  const hay = text.toLowerCase();
  return secrets
    .filter((s) => s.hiddenFrom === reader && hay.includes(s.value.toLowerCase()))
    .map((secret) => ({ secret, where }));
}

/** One model call, kept by the probe. */
export interface Exchange {
  reader: SideId;
  stage: UmpireStage;
  request: UmpireRequest;
  /** The model's answer as JSON text, or undefined when the call threw. */
  output?: string;
}

/** Records, for each side, what its prompts carried and what the model said back. */
export class LeakProbe {
  readonly exchanges: Exchange[] = [];

  /** The client a side's stages must use. */
  client(reader: SideId, inner: UmpireClient): UmpireClient {
    return {
      call: async <T>(request: UmpireRequest): Promise<UmpireResponse<T>> => {
        const ex: Exchange = { reader, stage: request.stage, request };
        this.exchanges.push(ex);
        const res = await inner.call<T>(request);
        ex.output = JSON.stringify(res.output);
        return res;
      },
    };
  }

  /**
   * Every secret of the other side in a prompt (system and input) or, unless `outputs` is false,
   * in an answer. A retry prompt quotes the problems with the model's own last reply, which
   * is the model's text coming back, not state; `retries: false` leaves those prompts out.
   */
  findLeaks(
    secrets: readonly Secret[],
    opts: { outputs?: boolean; retries?: boolean } = {},
  ): Leak[] {
    const { outputs = true, retries = true } = opts;
    return this.exchanges.flatMap((ex) => {
      const isRetry =
        typeof ex.request.input === 'object' &&
        ex.request.input !== null &&
        'rejected' in ex.request.input;
      return [
        ...(isRetry && !retries
          ? []
          : scan(
              JSON.stringify([ex.request.system, ex.request.input]),
              secrets,
              ex.reader,
              `${ex.reader} ${ex.stage} request`,
            )),
        ...(outputs
          ? scan(ex.output ?? '', secrets, ex.reader, `${ex.reader} ${ex.stage} model output`)
          : []),
      ];
    });
  }
}

/** One line per leak: which secret, hidden from whom, and where it turned up. */
export function describeLeaks(leaks: readonly Leak[]): string {
  return leaks
    .map((l) => `LEAK: "${l.secret.value}" (${l.secret.what}) reached ${l.where}`)
    .join('\n');
}

export type Reply = (request: UmpireRequest) => unknown;

/** A fake model. `replies` by stage; a stage with none throws, so a test says what it exercises. */
export class ScriptedModel implements UmpireClient {
  readonly requests: UmpireRequest[] = [];
  constructor(private readonly replies: Partial<Record<UmpireStage, Reply>>) {}
  async call<T>(request: UmpireRequest): Promise<UmpireResponse<T>> {
    this.requests.push(request);
    const reply = this.replies[request.stage];
    if (!reply) throw new Error(`ScriptedModel has no reply for stage "${request.stage}"`);
    const output = reply(request);
    return {
      output: output as T,
      record: {
        stage: request.stage,
        model: 'scripted',
        promptVersion: request.promptVersion,
        system: request.system,
        input: request.input,
        rawOutput: JSON.stringify(output),
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        costUsd: 0,
        attempts: 1,
      },
    };
  }
}
