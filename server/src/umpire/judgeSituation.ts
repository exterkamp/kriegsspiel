/**
 * The `judge` stage's discretion task (3.6): a situation the rules do not cover, ruled on by the
 * umpire within a cap, with the game's case law in the prompt so a repeat is ruled alike.
 *
 * The model never writes state. `judgeSituation` returns a `JudgmentProposal` for the caller to
 * queue with the engine's `issueJudgment`, which clamps and records it. It always returns one:
 * a precedent is followed with no model call; a failed, malformed or leaking answer is retried
 * once and then replaced by the standard rule (modifier 0, `fallback`), so a tiny or absent
 * model never blocks a game or changes an outcome unpredictably.
 */
import { JUDGMENT_CAP, caseLaw, precedentFor } from '@kriegsspiel/engine';
import type { GameState, JudgmentProposal, JudgmentRequest } from '@kriegsspiel/engine';
import { checkProseAgainst, proseFactsOf } from './narrate.js';
import type { JsonSchema, UmpireClient } from './umpireClient.js';

export const JUDGE_SITUATION_PROMPT_VERSION = 'judge-situation-v1';

export const JUDGE_SITUATION_SYSTEM = `You are the umpire of a Napoleonic wargame in the tradition of Kriegsspiel. The rules do not cover the situation you are given, so you rule on it. Return "modifier": a number from -${JUDGMENT_CAP} to ${JUDGMENT_CAP}, the fraction by which the rule's usual figure is better (positive) or worse (negative) for the unit in this situation; 0 means the usual rule stands. The engine clamps anything beyond the range, so do not try to exceed it. "caseLaw" lists your earlier rulings in this game: rule the same way on a like situation, and say so. Give "rationale" (your reasoning, for the record) and "narrative" (one plain sentence for the players, using only names and numbers from the situation). Reply with the JSON object only.`;

export const JUDGE_SITUATION_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    modifier: { type: 'number' },
    rationale: { type: 'string' },
    narrative: { type: 'string' },
  },
  required: ['modifier', 'rationale', 'narrative'],
  additionalProperties: false,
};

export interface JudgeSituationOutput {
  modifier: number;
  rationale: string;
  narrative: string;
}

/** What the model sees: the request and the game's case law, oldest first. */
export function judgeSituationInput(world: GameState, request: JudgmentRequest) {
  return {
    key: request.key,
    situation: request.situation,
    cap: JUDGMENT_CAP,
    gameMinutes: Math.round(world.time / 600) / 100,
    caseLaw: caseLaw(world).map((r) => ({
      key: r.key,
      situation: r.situation,
      modifier: r.modifier,
      rationale: r.rationale,
    })),
  };
}

export interface JudgeSituationOptions {
  /** Model calls allowed, the first included. Default 2. */
  maxCalls?: number;
  /** Names that must not appear in the narrative (the other side's hidden terms). */
  hidden?: readonly string[];
}

export interface JudgeSituationResult {
  proposal: JudgmentProposal;
  /** Model calls made (0 when a precedent was followed). */
  calls: number;
  /** Why the model's answer was not used, when the standard rule stands. */
  reason?: string;
}

const STANDARD_RULE: Pick<JudgmentProposal, 'rationale' | 'narrative'> = {
  rationale: 'No usable ruling from the umpire; the standard rule stands.',
  narrative: 'The umpire sees no cause to depart from the usual rule.',
};

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `text` names `term`: whole words for a short term, ignoring spacing for a long one. */
function names(text: string, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return false;
  const lower = text.toLowerCase();
  if (t.length < 4)
    return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(t)}(?![\\p{L}\\p{N}])`, 'u').test(lower);
  const squash = (x: string) => x.replace(/[\s\u200b-\u200d\u2060\ufeff]+/g, '');
  return squash(lower).includes(squash(t));
}

function problemsWith(
  out: unknown,
  facts: ReturnType<typeof proseFactsOf>,
  hidden: readonly string[],
): string[] {
  const o = out as Partial<JudgeSituationOutput> | null;
  if (!o || typeof o.modifier !== 'number' || !Number.isFinite(o.modifier)) {
    return ['modifier is not a number'];
  }
  if (typeof o.rationale !== 'string' || !o.rationale.trim()) return ['no rationale'];
  if (typeof o.narrative !== 'string' || !o.narrative.trim()) return ['no narrative'];
  const narrative = o.narrative;
  const leaked = hidden.filter((h) => names(narrative, h));
  return [
    ...leaked.map((h) => `narrative names hidden "${h}"`),
    ...checkProseAgainst(o.narrative, facts),
  ];
}

export async function judgeSituation(
  client: UmpireClient,
  world: GameState,
  request: JudgmentRequest,
  opts: JudgeSituationOptions = {},
): Promise<JudgeSituationResult> {
  const prior = precedentFor(world, request.key);
  if (prior) {
    return {
      calls: 0,
      proposal: {
        request,
        modifier: prior.modifier,
        rationale: `Following ${prior.id} on the same situation: ${prior.rationale}`,
        // The stored sentence was written for the first unit and side: reuse it only for the
        // same unit and when it names nothing hidden from the asker.
        narrative:
          prior.unitId === request.unitId &&
          !(opts.hidden ?? []).some((h) => names(prior.narrative, h))
            ? prior.narrative
            : STANDARD_RULE.narrative,
        precedent: true,
      },
    };
  }
  const input = judgeSituationInput(world, request);
  const facts = proseFactsOf(input);
  const maxCalls = Math.max(1, opts.maxCalls ?? 2);
  let reason = 'no call made';
  let calls = 0;
  while (calls < maxCalls) {
    calls++;
    try {
      const { output } = await client.call<JudgeSituationOutput>({
        stage: 'judge',
        promptVersion: JUDGE_SITUATION_PROMPT_VERSION,
        system: JUDGE_SITUATION_SYSTEM,
        input,
        schema: JUDGE_SITUATION_SCHEMA,
      });
      const problems = problemsWith(output, facts, opts.hidden ?? []);
      if (problems.length === 0) {
        return {
          calls,
          proposal: {
            request,
            modifier: output.modifier,
            rationale: output.rationale,
            narrative: output.narrative,
          },
        };
      }
      reason = problems.join('; ');
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e);
    }
  }
  return {
    calls,
    reason,
    proposal: { request, modifier: 0, ...STANDARD_RULE, fallback: true },
  };
}
