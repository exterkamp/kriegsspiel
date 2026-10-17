/**
 * The `critique` stage (docs/gameplay.md, After the game): once a game is over the umpire writes
 * up what each side knew and when, the decisions that mattered, the misreadings and the pauses.
 *
 * The model sees only the digest of the game's log (`critiqueFacts`) and returns points that cite
 * fact ids. `checkCritique` refuses a reply that cites a fact that does not exist, dates a point
 * at a minute none of its cites has, or whose prose names an entity, id or figure the digest
 * does not hold. A refused reply is asked for again with the problems listed; after `maxCalls`,
 * or if the umpire fails, the log's own wording stands in (`templateCritique`), so a critique
 * always exists and always cites real events. The model never touches game state.
 */
import type { Critique, CritiqueKind, CritiquePoint } from '@kriegsspiel/protocol';
import { checkProseAgainst, proseFactsOf } from './narrate.js';
import type { CritiqueDigest, CritiqueFact, FactKind } from './critiqueFacts.js';
import type { JsonSchema, UmpireCallRecord, UmpireClient } from './umpireClient.js';
import { UmpireError } from './umpireClient.js';

export const CRITIQUE_PROMPT_VERSION = 'critique-v2';

export const CRITIQUE_SYSTEM = `You are the umpire of a finished Napoleonic wargame in the tradition of Kriegsspiel, giving the players your critique. Input: "sides", "result", "endMinute" and "facts", the only record you have: each fact has an "id" (fact-N), a game "minute", a "kind" and its "text". Optionally "rejected", the problems with your last reply.

Write what the players can learn from: what each side knew and when (kind "knowledge", from the report facts), the decisions that mattered (kind "decision", from orders, deliveries, rulings and losses), misreadings (kind "misreading", where a report did not match the truth), and pauses or votes (kind "pause"). You may add one "outcome" point.

A game played in turns also has facts of kind "turn" (who decided each turn: the umpire, with its account, or the tables), "fallback" (a turn the umpire could not decide, and why), "clamp" (a correction the engine made to the umpire's proposal, with the limit it broke), "roll" (dice the umpire asked for, the odds and the result) and "precedent" (a standing ruling from the umpire's journal). Use them for "decision" points: say what a turn decided and why, citing the turn and its corrections, rolls and precedents.

Rules:
- Every point cites the fact ids it rests on in "cites" (one to six), and "minute" must be the minute of one of them.
- Use only names, places, units and numbers that appear in the facts. Do not invent events, causes or figures. Do not put fact ids in the text.
- "side" is the side the point is about, or "both".
- Plain, specific, teaching prose in the umpire's voice, one to three sentences a point; no more than twelve points; "summary" is two sentences at most.
Reply with the JSON object only.`;

export const CRITIQUE_TEXT_MAX = 500;
export const CRITIQUE_MAX_POINTS = 12;
export const CRITIQUE_KINDS: readonly CritiqueKind[] = [
  'knowledge',
  'decision',
  'misreading',
  'pause',
  'outcome',
];

export const CRITIQUE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string', maxLength: CRITIQUE_TEXT_MAX },
    points: {
      type: 'array',
      maxItems: CRITIQUE_MAX_POINTS,
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...CRITIQUE_KINDS] },
          side: { type: 'string' },
          minute: { type: 'integer', minimum: 0 },
          text: { type: 'string', maxLength: CRITIQUE_TEXT_MAX },
          cites: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string' } },
        },
        required: ['kind', 'side', 'minute', 'text', 'cites'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'points'],
  additionalProperties: false,
};

export interface CritiqueOutput {
  summary: string;
  points: Array<{
    kind: CritiqueKind;
    side: string;
    minute: number;
    text: string;
    cites: string[];
  }>;
}

/** What the model sees. */
export function critiqueInput(digest: CritiqueDigest, rejected?: readonly string[]) {
  return {
    sides: digest.sides,
    result: digest.result,
    endMinute: digest.endMinute,
    facts: digest.facts,
    ...(rejected && rejected.length > 0 ? { rejected } : {}),
  };
}

const ID_PATTERN = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\d+\b/gi;

/** The fact kinds a point of each kind may rest on, at least one of its cites being among them. */
const SUPPORT: Record<CritiqueKind, readonly FactKind[] | undefined> = {
  knowledge: ['report'],
  misreading: ['misreading'],
  pause: ['pause'],
  outcome: ['outcome'],
  decision: undefined,
};

/** The problems with a reply, against the digest. Empty means it passes. */
export function checkCritique(output: CritiqueOutput, digest: CritiqueDigest): string[] {
  const byId = new Map(digest.facts.map((f) => [f.id, f]));
  const sides = new Set([...digest.sides, 'both']);
  const input = critiqueInput(digest);
  const known = new Set(
    (JSON.stringify(input).match(ID_PATTERN) ?? []).map((s) => s.toLowerCase()),
  );
  const prose = proseFactsOf(input);
  const problems: string[] = [];
  if (output.points.length === 0) problems.push('no points');
  if (output.points.length > CRITIQUE_MAX_POINTS) problems.push('too many points');
  const checkText = (what: string, text: string) => {
    if (text.trim() === '') problems.push(`${what} is empty`);
    if (text.length > CRITIQUE_TEXT_MAX)
      problems.push(`${what} over ${CRITIQUE_TEXT_MAX} characters`);
    for (const id of text.match(ID_PATTERN) ?? []) {
      if (!known.has(id.toLowerCase())) problems.push(`unknown entity "${id}"`);
    }
    problems.push(...checkProseAgainst(text, prose));
  };
  checkText('summary', output.summary);
  output.points.forEach((p, i) => {
    const at = `point ${i + 1}`;
    checkText(`${at} text`, p.text);
    if (!sides.has(p.side)) problems.push(`${at}: unknown side "${p.side}"`);
    if (!CRITIQUE_KINDS.includes(p.kind)) problems.push(`${at}: unknown kind "${p.kind}"`);
    const cited: CritiqueFact[] = [];
    for (const id of new Set(p.cites)) {
      const f = byId.get(id);
      if (f) cited.push(f);
      else problems.push(`${at}: cites "${id}", which is not a fact`);
    }
    if (cited.length === 0) problems.push(`${at}: cites no fact`);
    else {
      if (!cited.some((f) => f.minute === p.minute)) {
        problems.push(`${at}: minute ${p.minute} is not the minute of any fact it cites`);
      }
      const need = SUPPORT[p.kind];
      if (need && !cited.some((f) => need.includes(f.kind))) {
        problems.push(`${at}: a ${p.kind} point must cite a ${need.join(' or ')} fact`);
      }
    }
  });
  return [...new Set(problems)];
}

const cite = (f: CritiqueFact) => ({
  id: f.id,
  minute: f.minute,
  label: f.text.length <= 90 ? f.text : `${f.text.slice(0, 89).trimEnd()}…`,
});

const KIND_OF: Record<FactKind, CritiqueKind> = {
  outcome: 'outcome',
  order: 'decision',
  delivery: 'decision',
  courier: 'decision',
  report: 'knowledge',
  misreading: 'misreading',
  contact: 'decision',
  loss: 'decision',
  fire: 'decision',
  ruling: 'decision',
  pause: 'pause',
  turn: 'decision',
  fallback: 'decision',
  clamp: 'decision',
  roll: 'decision',
  precedent: 'decision',
};

/** Rendered with its cites resolved. Throws if a cite is not a fact, so nothing unchecked is shown. */
export function resolveCritique(
  source: Critique['source'],
  output: CritiqueOutput,
  digest: CritiqueDigest,
): Critique {
  const byId = new Map(digest.facts.map((f) => [f.id, f]));
  const points: CritiquePoint[] = output.points.map((p) => ({
    kind: p.kind,
    side: p.side,
    minute: p.minute,
    text: p.text.trim(),
    cites: [...new Set(p.cites)].map((id) => {
      const f = byId.get(id);
      if (!f) throw new Error(`critique cites unknown fact ${id}`);
      return cite(f);
    }),
  }));
  return { source, summary: output.summary.trim(), points };
}

/** How many facts of a kind the template quotes, per side where it says so. */
const TEMPLATE_TAKE: Partial<Record<FactKind, { n: number; perSide?: boolean }>> = {
  outcome: { n: 1 },
  report: { n: 2, perSide: true },
  misreading: { n: 4 },
  pause: { n: 4 },
  delivery: { n: 3 },
  courier: { n: 2 },
  ruling: { n: 2 },
  loss: { n: 3 },
  // Turn mode only (D39).
  turn: { n: 2 },
  fallback: { n: 1 },
  clamp: { n: 2 },
  roll: { n: 1 },
  precedent: { n: 1 },
};

/** Real-time kinds keep their order; a turn game's join them, the fallback and clamps last. */
const DROP_FIRST: readonly FactKind[] = [
  'loss',
  'precedent',
  'roll',
  'turn',
  'ruling',
  'courier',
  'clamp',
  'delivery',
  'fallback',
  'pause',
];

/**
 * The critique the log alone supports: the facts themselves, picked and dated. Used when no
 * model is configured, the model fails or its replies keep citing what is not there.
 */
export function templateCritique(digest: CritiqueDigest): Critique {
  const picked: CritiqueFact[] = [];
  const counts = new Map<string, number>();
  for (const f of digest.facts) {
    const take = TEMPLATE_TAKE[f.kind];
    if (!take) continue;
    const key = take.perSide ? `${f.kind}:${f.side ?? ''}` : f.kind;
    const n = counts.get(key) ?? 0;
    if (n >= take.n) continue;
    counts.set(key, n + 1);
    picked.push(f);
  }
  // Over the limit, the least telling kinds go first, so the result and the knowledge stay.
  for (const kind of DROP_FIRST) {
    while (picked.length > CRITIQUE_MAX_POINTS) {
      const i = picked.map((f) => f.kind).lastIndexOf(kind);
      if (i < 0) break;
      picked.splice(i, 1);
    }
  }
  const points: CritiquePoint[] = picked.slice(0, CRITIQUE_MAX_POINTS).map((f) => ({
    kind: KIND_OF[f.kind],
    side: f.side ?? 'both',
    minute: f.minute,
    text: f.text,
    cites: [cite(f)],
  }));
  return { source: 'template', summary: digest.result, points };
}

export interface CritiqueRun {
  critique: Critique;
  /** Every model call made, for the input log. */
  records: UmpireCallRecord[];
  calls: number;
  /** The problems of each refused reply, oldest first. */
  rejections: string[][];
  /** Why the template stands in, when it does. */
  fallback?: string;
}

export interface CritiqueOptions {
  /** Model calls allowed, the first included. Default 2. */
  maxCalls?: number;
}

/** Writes the critique. Always returns one: the model's if it passes the checks, else the template. */
export async function writeCritique(
  client: UmpireClient | undefined,
  digest: CritiqueDigest,
  opts: CritiqueOptions = {},
): Promise<CritiqueRun> {
  const run: CritiqueRun = {
    critique: templateCritique(digest),
    records: [],
    calls: 0,
    rejections: [],
  };
  if (!client) return { ...run, fallback: 'no umpire' };
  if (digest.facts.length === 0) return { ...run, fallback: 'no facts' };
  const maxCalls = Math.max(1, opts.maxCalls ?? 2);
  let rejected: string[] | undefined;
  while (run.calls < maxCalls) {
    run.calls++;
    let output: CritiqueOutput;
    try {
      const res = await client.call<CritiqueOutput>({
        stage: 'critique',
        promptVersion: CRITIQUE_PROMPT_VERSION,
        system: CRITIQUE_SYSTEM,
        input: critiqueInput(digest, rejected),
        schema: CRITIQUE_SCHEMA,
        maxTokens: 3000,
      });
      run.records.push(res.record);
      output = res.output;
    } catch (e) {
      return { ...run, fallback: e instanceof UmpireError ? e.kind : 'error' };
    }
    const problems = checkCritique(output, digest);
    if (problems.length === 0) {
      return { ...run, critique: resolveCritique('model', output, digest) };
    }
    run.rejections.push(problems);
    rejected = problems;
  }
  return { ...run, fallback: 'rejected' };
}
