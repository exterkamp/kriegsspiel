/**
 * `npm run bench:umpire -w server -- <mode> [options]` (#398). See docs/umpire-benchmark.md.
 *
 *   --model <tag> --url <ollama url>      run every case against an Ollama model
 *   --provider anthropic --model <id>     run against the Anthropic API (needs ANTHROPIC_API_KEY)
 *   --provider test                       the canned adjudicator (projection as proposal), no model
 *   --export <dir>                        write each case as a self-contained prompt for Claude Code
 *   --import <dir> --model <label>        score a Claude Code pane's answers in <dir>
 *   --blind <dir> --key <file>            write the blind grading packet (letters, not names)
 *   --report [--grades <file> --key <file>]  join checks, grades and models.json into a table
 *
 * Common: --out <dir> (default bench/umpire), --cases a,b (a subset), --num-ctx <n> (Ollama).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AnthropicProvider } from '../providers/anthropic.js';
import { OllamaProvider } from '../providers/ollama.js';
import type { LlmProvider } from '../provider.js';
import { TURN_CASES } from './turnCases.js';
import {
  blindPacket,
  exportCases,
  importAnswers,
  loadRuns,
  runCanned,
  runCase,
  saveRun,
  slug,
  summarise,
  tableMarkdown,
  type CaseRun,
  type ModelMeta,
} from './bench.js';
import type { Grades } from './rubric.js';

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string) => argv.includes(`--${name}`);
const readJson = <T>(f: string | undefined, fallback: T): T =>
  f && existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : fallback;

const out = arg('out') ?? 'bench/umpire';
const only = arg('cases')?.split(',');
const cases = only ? TURN_CASES.filter((c) => only.includes(c.id)) : TURN_CASES;

const line = (r: CaseRun) => {
  const fails = Object.entries(r.checks.problems)
    .filter(([, v]) => v.length > 0)
    .map(([k, v]) => `${k}: ${v.slice(0, 2).join('; ')}`)
    .join(' | ');
  const s = r.latencyMs === null ? '-' : `${(r.latencyMs / 1000).toFixed(1)} s`;
  return `${r.caseId.padEnd(20)} ${r.checks.pass ? 'PASS' : 'FAIL'}  ${s.padStart(8)}  ${fails}`;
};

async function ollamaMeta(url: string, model: string): Promise<ModelMeta> {
  try {
    const tags = (await (await fetch(`${url}/api/tags`)).json()) as {
      models: Array<{ name: string; size: number }>;
    };
    const ps = (await (await fetch(`${url}/api/ps`)).json()) as {
      models: Array<{ name: string; size: number }>;
    };
    const gb = (n?: number) => (n ? Math.round(n / 1e8) / 10 : undefined);
    const disk = gb(tags.models.find((m) => m.name === model)?.size);
    const mem = gb(ps.models.find((m) => m.name === model)?.size);
    return { ...(disk ? { diskGb: disk } : {}), ...(mem ? { memGb: mem } : {}) };
  } catch {
    return {};
  }
}

if (has('export')) {
  const dir = arg('export')!;
  exportCases(dir, cases);
  console.log(`wrote ${cases.length} prompts to ${dir}`);
} else if (has('import')) {
  const model = arg('model');
  if (!model) throw new Error('--import needs --model <label>');
  for (const r of importAnswers(arg('import')!, model, cases)) {
    saveRun(out, r);
    console.log(line(r));
  }
} else if (has('blind')) {
  const key = arg('key');
  if (!key) throw new Error('--blind needs --key <file> outside the packet directory');
  blindPacket(arg('blind')!, key, loadRuns(out));
  console.log(`wrote the grading packet to ${arg('blind')} and the key to ${key}`);
} else if (has('report')) {
  const metaFile = join(out, 'models.json');
  const rows = summarise(
    loadRuns(out),
    readJson<Grades>(arg('grades') ?? join(out, 'grades.json'), {}),
    readJson<Record<string, string>>(arg('key') ?? join(out, 'blind-key.json'), {}),
    readJson<Record<string, ModelMeta>>(metaFile, {}),
  );
  const table = tableMarkdown(rows);
  writeFileSync(join(out, 'results.md'), table + '\n');
  console.log(table);
} else {
  const providerId = arg('provider') ?? 'ollama';
  const url = arg('url') ?? 'http://localhost:11434';
  let provider: LlmProvider | undefined;
  if (providerId === 'ollama') {
    provider = new OllamaProvider({ baseUrl: url, numCtx: Number(arg('num-ctx') ?? 12288) });
  } else if (providerId === 'anthropic') {
    provider = new AnthropicProvider();
  } else if (providerId !== 'test') {
    throw new Error(`unknown provider ${providerId}`);
  }
  const model = providerId === 'test' ? 'test' : arg('model');
  if (!model) throw new Error('--model <tag> is required');
  for (const c of cases) {
    const r = provider ? await runCase(provider, model, c) : runCanned(c);
    saveRun(out, r);
    console.log(line(r));
  }
  if (providerId === 'ollama') {
    const metaFile = join(out, 'models.json');
    const meta = readJson<Record<string, ModelMeta>>(metaFile, {});
    meta[model] = { ...meta[model], ...(await ollamaMeta(url, model)) };
    writeFileSync(metaFile, JSON.stringify(meta, null, 2) + '\n');
  }
  console.log(`saved to ${join(out, slug(model))}`);
}
