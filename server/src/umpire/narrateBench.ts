import { readFileSync, writeFileSync } from 'node:fs';
import { MS_PER_MINUTE } from '@kriegsspiel/engine';
import type { ViewReport, ViewUnit } from '@kriegsspiel/engine';
import { umpireConfigFromEnv } from './config.js';
import { createUmpireClient } from './createUmpireClient.js';
import {
  NARRATE_MAX_TOKENS,
  NARRATE_PROMPT_VERSION,
  NARRATE_SCHEMA,
  NARRATE_SYSTEM,
  checkFieldNote,
  checkNarration,
  narrateInput,
  type NarrateOutput,
} from './narrate.js';
import { withPersona } from './persona.js';
import { UmpireError } from './umpireClient.js';

/**
 * `OLLAMA_URL=http://localhost:11434 OLLAMA_MODEL=qwen2.5:0.5b npm run bench:narrate -w server -- [flags]`
 *
 * The narrate stage alone, one report per call and no retry, against a live Ollama with no fallback (#419).
 * Each reply is judged twice: by the fact check alone (`checkProse` and the ids, what passed before #419)
 * and by the full `checkNarration` with the field-note rules. Prints, per report kind, how many replies
 * each passes and why the rest were rejected, with latency. Flags:
 * - `--system-file <path>`: a system prompt to try in place of `NARRATE_SYSTEM` (with `--prompt-version`);
 * - `--max-tokens <n>`: the reply cap (default `NARRATE_MAX_TOKENS`);
 * - `--per-kind <n>`: reports per kind (default 3);
 * - `--out <path>`: write every reply and verdict as JSON, for the record.
 */
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1];
};
const systemFile = flag('system-file');
const system = systemFile ? readFileSync(systemFile, 'utf8') : NARRATE_SYSTEM;
const promptVersion =
  flag('prompt-version') ?? (systemFile ? 'bench-file' : NARRATE_PROMPT_VERSION);
const maxTokens = Number(flag('max-tokens') ?? NARRATE_MAX_TOKENS);
const perKind = Number(flag('per-kind') ?? 3);
const out = flag('out');

const config = umpireConfigFromEnv({ UMPIRE_KEYLESS_PROVIDER: 'ollama', ...process.env });
delete config.fallbackProvider;
const client = createUmpireClient({ config });

/** The Hold the Bridge officers, in varied states, so every manner and condition is tried. */
const units: ViewUnit[] = [
  [
    'blue-1',
    '1st Battalion',
    'Col. Aubry',
    'steady and methodical; holds a line under fire',
    80,
    20,
    90,
  ],
  ['blue-2', '2nd Battalion', 'Col. Delacroix', 'cautious; slow to commit his reserve', 50, 50, 40],
  ['blue-3', 'Cavalry Squadron', 'Maj. Verneuil', 'dashing scout; prone to over-reach', 30, 10, 90],
  ['blue-4', 'Line Battalion', 'Col. Hartmann', 'by the book; waits for orders', 75, 85, 10],
].map(
  ([id, name, commander, trait, morale, fatigue, ammo]) =>
    ({ id, name, commander, trait, strength: 500, morale, fatigue, ammo }) as unknown as ViewUnit,
);
const places = [
  'at the bridge, on the High road',
  'near the Northern wood',
  'east of the river',
  'on the High road',
];
const kinds = [
  'engaged',
  'contact',
  'orderDelivered',
  'heavyLosses',
  'lowAmmo',
  'exhausted',
  'broke',
  'destroyed',
] as const;

function reportFor(kind: (typeof kinds)[number], n: number): ViewReport {
  const unit = units[n % units.length]!;
  const sized = kind === 'contact' || kind === 'destroyed';
  return {
    id: `blue-r${kinds.indexOf(kind) * 100 + n}`,
    kind,
    from: unit.name,
    place: places[(n + kinds.indexOf(kind)) % places.length]!,
    observedAt: 30 * MS_PER_MINUTE,
    deliveredAt: (33 + n) * MS_PER_MINUTE,
    ageMs: 0,
    location: { x: 0, y: 0 },
    uncertaintyRadius: kind === 'contact' ? 150 : 0,
    confidence: (['high', 'medium', 'low'] as const)[n % 3]!,
    ...(sized ? { sizeEstimate: ['about a battalion', 'a squadron', 'enemy troops'][n % 3]! } : {}),
    text: 'template',
  };
}

interface Row {
  kind: string;
  reportId: string;
  ms: number;
  text?: string;
  error?: string;
  factProblems: string[];
  problems: string[];
}

const rows: Row[] = [];
for (let n = 0; n < perKind; n++) {
  for (const kind of kinds) {
    const r = reportFor(kind, n);
    const input = narrateInput('blue', [r], units);
    const t = performance.now();
    try {
      const { output } = await client.call<NarrateOutput>({
        stage: 'narrate',
        promptVersion,
        system: withPersona(system),
        input,
        schema: NARRATE_SCHEMA,
        maxTokens,
      });
      const ms = performance.now() - t;
      const problems = checkNarration(output, input);
      const fieldProblems = new Set(
        output.dispatches.flatMap((d) => checkFieldNote(d.text, input.reports[0]!)),
      );
      rows.push({
        kind,
        reportId: r.id,
        ms,
        text: output.dispatches.map((d) => d.text).join(' | '),
        factProblems: problems.filter((p) => !fieldProblems.has(p)),
        problems,
      });
    } catch (e) {
      const ms = performance.now() - t;
      const error = e instanceof UmpireError ? `${e.kind}: ${e.message}` : String(e);
      rows.push({ kind, reportId: r.id, ms, error, factProblems: [error], problems: [error] });
    }
    const last = rows.at(-1)!;
    process.stderr.write(
      `${kind} ${Math.round(last.ms / 1000)}s ${last.problems.length === 0 ? 'pass' : last.factProblems.length === 0 ? 'facts only' : 'fail'}: ${last.text ?? last.error}\n`,
    );
  }
}

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]!;
};
const reasons = new Map<string, number>();
for (const row of rows) {
  for (const p of row.problems) {
    const key = p.replace(/"[^"]*"/g, '"…"').replace(/\(\d+ [^)]*\)/, '(n)');
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
}
const summary = {
  promptVersion,
  model: config.stages.narrate.model,
  maxTokens,
  calls: rows.length,
  callFailures: rows.filter((r) => r.error).length,
  passFactCheck: rows.filter((r) => r.factProblems.length === 0).length,
  passAllChecks: rows.filter((r) => r.problems.length === 0).length,
  medianMs: Math.round(
    quantile(
      rows.map((r) => r.ms),
      0.5,
    ),
  ),
  p95Ms: Math.round(
    quantile(
      rows.map((r) => r.ms),
      0.95,
    ),
  ),
  byKind: Object.fromEntries(
    kinds.map((k) => {
      const of = rows.filter((r) => r.kind === k);
      return [k, `${of.filter((r) => r.problems.length === 0).length}/${of.length}`];
    }),
  ),
  reasons: Object.fromEntries([...reasons].sort((a, b) => b[1] - a[1])),
};
console.log(JSON.stringify(summary, null, 2));
if (out) writeFileSync(out, JSON.stringify({ summary, rows }, null, 2));
