/**
 * The umpire benchmark runner (#398): runs every turn case against a model, applies the
 * automatic checks, and stores raw outputs and latency under `bench/umpire/<model>/`. It also
 * exports the cases as self-contained prompts for a Claude Code pane, imports that pane's answers,
 * builds the blind grading packet, and joins checks and grades into one table.
 * The CLI is `benchCli.ts`; docs/umpire-benchmark.md has the procedure.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { LlmProvider } from '../provider.js';
import { CHECKS, checkProposal, type CheckName, type CheckResult } from './turnChecks.js';
import { TURN_CASES, type TurnCase } from './turnCases.js';
import {
  ADJUDICATE_PROMPT_VERSION,
  ADJUDICATE_SYSTEM,
  cannedProposal,
  turnInput,
} from './turnInput.js';
import { TURN_PROPOSAL_JSON_SCHEMA } from './turnProposal.js';
import { RUBRIC, rubricMarkdown, type Grades } from './rubric.js';

export interface CaseRun {
  caseId: string;
  model: string;
  provider: string;
  promptVersion: string;
  /** Wall-clock ms of the call; null when unknown (imported answers). */
  latencyMs: number | null;
  usage?: { inputTokens: number; outputTokens: number };
  truncated?: boolean;
  /** Transport error, timeout or unparseable JSON. */
  error?: string;
  raw: string;
  checks: CheckResult;
}

/** A model name as a directory name. */
export const slug = (model: string) => model.replace(/[^a-zA-Z0-9.-]+/g, '-');

/** The model's JSON, with a wrapping code fence or leading prose stripped. */
export function parseJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = (fenced ? fenced[1]! : text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('no JSON object in the reply');
  return JSON.parse(body.slice(start, end + 1));
}

function failedChecks(why: string): CheckResult {
  const problems = Object.fromEntries(CHECKS.map((k) => [k, [] as string[]])) as Record<
    CheckName,
    string[]
  >;
  problems.schema.push(why);
  return { pass: false, problems };
}

export function scoreRaw(c: TurnCase, raw: string): Pick<CaseRun, 'checks' | 'error'> {
  let parsed: unknown;
  try {
    parsed = parseJson(raw);
  } catch (e) {
    const error = `not JSON: ${(e as Error).message}`;
    return { error, checks: failedChecks(error) };
  }
  return { checks: checkProposal(c, parsed) };
}

/** The user message: the case input as JSON (the same for every provider and the export). */
export const userMessage = (c: TurnCase) => JSON.stringify(turnInput(c));

export async function runCase(
  provider: LlmProvider,
  model: string,
  c: TurnCase,
  opts: { maxTokens?: number; timeoutMs?: number; temperature?: number } = {},
): Promise<CaseRun> {
  const base = {
    caseId: c.id,
    model,
    provider: provider.id,
    promptVersion: ADJUDICATE_PROMPT_VERSION,
  };
  const t = performance.now();
  try {
    const res = await provider.generate(
      {
        model,
        system: ADJUDICATE_SYSTEM,
        messages: [{ role: 'user', content: userMessage(c) }],
        schema: TURN_PROPOSAL_JSON_SCHEMA,
        structured: provider.capabilities.structuredOutput,
        maxTokens: opts.maxTokens ?? 8000,
        temperature: opts.temperature ?? 0,
      },
      AbortSignal.timeout(opts.timeoutMs ?? 60 * 60 * 1000),
    );
    const latencyMs = Math.round(performance.now() - t);
    return {
      ...base,
      latencyMs,
      usage: { inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens },
      ...(res.truncated ? { truncated: true } : {}),
      raw: res.text,
      ...scoreRaw(c, res.text),
    };
  } catch (e) {
    const error = `call failed: ${(e as Error).message}`;
    return {
      ...base,
      latencyMs: Math.round(performance.now() - t),
      error,
      raw: '',
      checks: failedChecks(error),
    };
  }
}

/** The canned adjudicator's run (the `test` provider): the projection as the proposal, no model. */
export function runCanned(c: TurnCase): CaseRun {
  const raw = JSON.stringify(cannedProposal(c));
  return {
    caseId: c.id,
    model: 'test',
    provider: 'test',
    promptVersion: ADJUDICATE_PROMPT_VERSION,
    latencyMs: 0,
    raw,
    ...scoreRaw(c, raw),
  };
}

export function saveRun(outDir: string, run: CaseRun): void {
  const dir = join(outDir, slug(run.model));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${run.caseId}.json`), JSON.stringify(run, null, 2) + '\n');
}

export function loadRuns(outDir: string): Map<string, CaseRun[]> {
  const out = new Map<string, CaseRun[]>();
  if (!existsSync(outDir)) return out;
  for (const d of readdirSync(outDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const runs = TURN_CASES.flatMap((c) => {
      const f = join(outDir, d.name, `${c.id}.json`);
      return existsSync(f) ? [JSON.parse(readFileSync(f, 'utf8')) as CaseRun] : [];
    });
    if (runs.length > 0) out.set(runs[0]!.model, runs);
  }
  return out;
}

/**
 * One self-contained prompt per case, for a Claude Code pane to answer into `<dir>/<case>.json`
 * with no tools beyond reading and writing files.
 */
export function exportCases(dir: string, cases: TurnCase[] = TURN_CASES): void {
  mkdirSync(dir, { recursive: true });
  for (const c of cases) {
    writeFileSync(
      join(dir, `${c.id}.prompt.md`),
      [
        `# Umpire turn: ${c.id}`,
        '',
        `Prompt version: ${ADJUDICATE_PROMPT_VERSION}. Answer with one JSON object that matches the schema below, and write it, and nothing else, to \`${c.id}.json\` in this directory.`,
        '',
        '## System',
        '',
        ADJUDICATE_SYSTEM,
        '',
        '## Input',
        '',
        '```json',
        JSON.stringify(turnInput(c), null, 1),
        '```',
        '',
        '## Output schema (JSON Schema)',
        '',
        '```json',
        JSON.stringify(TURN_PROPOSAL_JSON_SCHEMA),
        '```',
        '',
      ].join('\n'),
    );
  }
}

/** Score a Claude Code pane's answers in `dir` as `model`. `timings.json` (case id to ms) is optional. */
export function importAnswers(
  dir: string,
  model: string,
  cases: TurnCase[] = TURN_CASES,
): CaseRun[] {
  const timingsFile = join(dir, 'timings.json');
  const timings: Record<string, number> = existsSync(timingsFile)
    ? (JSON.parse(readFileSync(timingsFile, 'utf8')) as Record<string, number>)
    : {};
  return cases.map((c) => {
    const f = join(dir, `${c.id}.json`);
    const raw = existsSync(f) ? readFileSync(f, 'utf8') : '';
    return {
      caseId: c.id,
      model,
      provider: 'claude-code',
      promptVersion: ADJUDICATE_PROMPT_VERSION,
      latencyMs: timings[c.id] ?? null,
      raw,
      ...(raw ? scoreRaw(c, raw) : { error: 'no answer', checks: failedChecks('no answer') }),
    };
  });
}

/** A fixed shuffle (the case id seeds it), so the letters are stable but not in model order. */
function shuffled<T>(xs: T[], seed: string): T[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * The blind grading packet: one file per case with the case, what it tests, the input, and each
 * model's proposal under a letter. Models get one letter for the whole packet (so a grader can
 * see a model's consistency), assigned in a fixed shuffled order. The key goes to `keyFile`,
 * which must be outside `dir`.
 */
export function blindPacket(dir: string, keyFile: string, runs: Map<string, CaseRun[]>): void {
  mkdirSync(dir, { recursive: true });
  const models = shuffled([...runs.keys()].sort(), 'umpire-bench-v0');
  const letters = new Map(models.map((m, i) => [m, String.fromCharCode(65 + i)]));
  writeFileSync(
    keyFile,
    JSON.stringify(Object.fromEntries([...letters].map(([m, l]) => [l, m])), null, 2) + '\n',
  );
  writeFileSync(join(dir, 'RUBRIC.md'), rubricMarkdown());
  for (const c of TURN_CASES) {
    const answers = models.map((m) => {
      const run = runs.get(m)!.find((r) => r.caseId === c.id);
      let body = run?.raw ?? '';
      try {
        body = JSON.stringify(parseJson(body), null, 1);
      } catch {
        body = body || '(no answer)';
      }
      return `## Proposal ${letters.get(m)}\n\n\`\`\`json\n${body}\n\`\`\`\n`;
    });
    writeFileSync(
      join(dir, `${c.id}.md`),
      [
        `# Case ${c.id}: ${c.title}`,
        '',
        `**What this case tests.** ${c.tests}`,
        '',
        "## The umpire's input",
        '',
        '```json',
        JSON.stringify(turnInput(c), null, 1),
        '```',
        '',
        ...answers,
      ].join('\n'),
    );
  }
}

const quantile = (xs: number[], q: number) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]!;
};

export interface ModelMeta {
  /** Download size on disk, GB. */
  diskGb?: number;
  /** Resident size while loaded (Ollama `/api/ps`), GB. */
  memGb?: number;
  note?: string;
}

export interface ModelRow {
  model: string;
  cases: number;
  schemaPass: number;
  allPass: number;
  /** Every check but D39's ammunition ceiling, which also fails an umpire whose units fire less than the engine's. */
  passExceptAmmo: number;
  failsByCheck: Record<CheckName, number>;
  medianS: number | null;
  p95S: number | null;
  rubric: Record<string, number | null>;
  rubricMean: number | null;
  meta: ModelMeta;
}

/** Join checks, grades (by blind letter) and model metadata into one row per model. */
export function summarise(
  runs: Map<string, CaseRun[]>,
  grades: Grades = {},
  key: Record<string, string> = {},
  meta: Record<string, ModelMeta> = {},
): ModelRow[] {
  const letterOf = new Map(Object.entries(key).map(([l, m]) => [m, l]));
  return [...runs].map(([model, rs]) => {
    const g = grades[letterOf.get(model) ?? ''] ?? {};
    const rubric = Object.fromEntries(
      RUBRIC.map((r) => {
        // Only the cases the model ran: a grader scores a case it has no answer for as 1.
        const xs = rs
          .map((run) => g[run.caseId]?.[r.key])
          .filter((n): n is number => typeof n === 'number');
        return [
          r.key,
          xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null,
        ];
      }),
    );
    const means = Object.values(rubric).filter((n): n is number => n !== null);
    const lat = rs.map((r) => r.latencyMs).filter((n): n is number => n !== null && n > 0);
    const s = (ms: number | null) => (ms === null ? null : Math.round(ms / 100) / 10);
    return {
      model,
      cases: rs.length,
      schemaPass: rs.filter((r) => r.checks.problems.schema.length === 0).length,
      allPass: rs.filter((r) => r.checks.pass).length,
      passExceptAmmo: rs.filter((r) =>
        CHECKS.every((k) => k === 'ammo' || r.checks.problems[k].length === 0),
      ).length,
      failsByCheck: Object.fromEntries(
        CHECKS.map((k) => [k, rs.filter((r) => r.checks.problems[k].length > 0).length]),
      ) as Record<CheckName, number>,
      medianS: s(quantile(lat, 0.5)),
      p95S: s(quantile(lat, 0.95)),
      rubric,
      rubricMean: means.length
        ? Math.round((means.reduce((a, b) => a + b, 0) / means.length) * 10) / 10
        : null,
      meta: meta[model] ?? {},
    };
  });
}

export function tableMarkdown(rows: ModelRow[]): string {
  const f = (n: number | null | undefined) => (n === null || n === undefined ? '-' : String(n));
  const head = [
    'Model',
    'Schema',
    'All checks',
    'All but ammo',
    'Failing checks (cases)',
    'Median s',
    'p95 s',
    ...RUBRIC.map((r) => r.key),
    'Rubric mean',
    'Disk GB',
    'RAM GB',
  ];
  const lines = rows.map((r) => {
    const fails = CHECKS.filter((k) => r.failsByCheck[k] > 0)
      .map((k) => `${k} ${r.failsByCheck[k]}`)
      .join(', ');
    return [
      r.model,
      `${r.schemaPass}/${r.cases}`,
      `${r.allPass}/${r.cases}`,
      `${r.passExceptAmmo}/${r.cases}`,
      fails || 'none',
      f(r.medianS),
      f(r.p95S),
      ...RUBRIC.map((x) => f(r.rubric[x.key])),
      f(r.rubricMean),
      f(r.meta.diskGb),
      f(r.meta.memGb),
    ].join(' | ');
  });
  return [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...lines.map((l) => `| ${l} |`),
  ].join('\n');
}
