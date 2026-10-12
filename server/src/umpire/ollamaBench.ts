import { MS_PER_MINUTE, holdTheBridge, loadScenario, mm } from '@kriegsspiel/engine';
import type { GameState, ViewReport } from '@kriegsspiel/engine';
import { CORPUS_CONTEXT, GOLDEN_ORDERS } from '../orders/eval/corpus.js';
import { runEval } from '../orders/eval/harness.js';
import { LlmOrderParser } from '../orders/llmParser.js';
import { umpireConfigFromEnv } from './config.js';
import { createUmpireClient } from './createUmpireClient.js';
import { narrateReports } from './narrate.js';
import { StaffRoster, answerStaffQuestion, runStaff } from './staff.js';
import type { UmpireClient, UmpireRequest, UmpireResponse } from './umpireClient.js';

/**
 * `OLLAMA_URL=http://localhost:11434 OLLAMA_MODEL=qwen2.5:0.5b npm run bench:ollama -w server [-- --json]`
 *
 * Runs the umpire stages against a live Ollama with NO fallback, so a failure counts against the model: the
 * order-parsing golden corpus, `checkNarration` over a few report batches, and the staff checks for every
 * vacant seat. Prints pass rate and median/p95 latency per stage. See docs/llm-providers.md.
 */
const config = umpireConfigFromEnv({ UMPIRE_KEYLESS_PROVIDER: 'ollama', ...process.env });
delete config.fallbackProvider;
const inner = createUmpireClient({ config });

const latencies: Record<string, number[]> = {};
const failures: Record<string, number> = {};
const timed: UmpireClient = {
  async call<T>(req: UmpireRequest): Promise<UmpireResponse<T>> {
    const t = performance.now();
    try {
      return await inner.call<T>(req);
    } catch (e) {
      failures[req.stage] = (failures[req.stage] ?? 0) + 1;
      throw e;
    } finally {
      (latencies[req.stage] ??= []).push(performance.now() - t);
    }
  },
};

const quantile = (xs: number[], q: number) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]!;
};

function reports(n: number): ViewReport[] {
  const kinds = ['contact', 'unitLost', 'situation', 'lowAmmo'] as const;
  return Array.from({ length: n }, (_, i) => ({
    id: `blue-r${i}`,
    kind: kinds[i % 4]!,
    from: ['2nd Hussars', '1st Jaegers', 'Cavalry Squadron', '1st Battalion'][i % 4]!,
    ...(i % 4 === 0 ? { sizeEstimate: 'about 400 men' } : {}),
    confidence: 'medium' as const,
    observedAt: 10 * MS_PER_MINUTE,
    deliveredAt: 14 * MS_PER_MINUTE,
    ageMs: 6 * MS_PER_MINUTE,
    location: { x: 2100, y: 900 },
    place: 'near the mill, east of the Albrecht road',
    uncertaintyRadius: 120,
    text: 'template',
  }));
}

function world(): GameState {
  const w = loadScenario(holdTheBridge);
  const blue = w.units.find((u) => u.id === 'blue-1')!;
  const units = w.units.map((u) =>
    u.id === 'red-1' ? { ...u, center: { x: blue.center.x + mm(300), y: blue.center.y } } : u,
  );
  return { ...w, units };
}

const parse = await runEval('ollama', new LlmOrderParser(timed), GOLDEN_ORDERS, CORPUS_CONTEXT);

let narratePass = 0;
let narrateRetried = 0;
let narrateFellBack = 0;
const narrateSizes = [1, 2, 4, 1, 2, 4];
for (const n of narrateSizes) {
  const r = await narrateReports(timed, 'blue', reports(n));
  if (r.fellBack) narrateFellBack++;
  else if (r.calls === 1) narratePass++;
  else narrateRetried++;
}

// The conference: a question to each officer, as `GameActor.answerStaff` asks it. An answer that
// needed the second call is "retried"; none (the canned answer is used) is a "fallback" (#342).
const questions = [
  ['chiefOfStaff', 'What should we do next?'],
  ['intelligence', 'Where is the enemy?'],
  ['quartermaster', 'How is our ammunition?'],
  ['engineer', 'Can we hold the bridge?'],
] as const;
let answerPass = 0;
let answerRetried = 0;
let answerFellBack = 0;
const answerWorld = world();
for (const [role, q] of [...questions, ...questions]) {
  const a = await answerStaffQuestion(
    timed,
    answerWorld,
    'blue',
    role,
    q,
    answerWorld.time + 60 * MS_PER_MINUTE,
  );
  if (!a) answerFellBack++;
  else if (a.records.length === 1) answerPass++;
  else answerRetried++;
}

let staffPass = 0;
let staffTotal = 0;
for (let round = 0; round < 2; round++) {
  const w = world();
  const turns = await runStaff(timed, w, new StaffRoster('blue'), {
    rate: 1,
    now: w.time + 60 * MS_PER_MINUTE,
  });
  for (const t of turns) {
    staffTotal++;
    if (!t.silent && t.rejections.length === 0) staffPass++;
  }
}

const outcomes = {
  narrate: { firstTry: narratePass, retried: narrateRetried, fallback: narrateFellBack },
  answer: { firstTry: answerPass, retried: answerRetried, fallback: answerFellBack },
};
const rows = [
  { stage: 'parse', pass: parse.passed, total: parse.total },
  { stage: 'narrate', pass: narratePass, total: narrateSizes.length },
  { stage: 'staff', pass: staffPass, total: staffTotal },
].map((r) => ({
  ...r,
  rate: Number((r.pass / r.total).toFixed(3)),
  calls: latencies[r.stage]?.length ?? 0,
  callFailures: failures[r.stage] ?? 0,
  medianMs: Math.round(quantile(latencies[r.stage] ?? [], 0.5)),
  p95Ms: Math.round(quantile(latencies[r.stage] ?? [], 0.95)),
}));
const out = {
  model: config.stages.parse.model,
  parseUnsafe: parse.unsafe,
  parseCategories: parse.categories,
  outcomes,
  rows,
};
if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`outcomes ${JSON.stringify(outcomes)}`);
  console.log(`model ${out.model}  (parse unsafe: ${out.parseUnsafe})`);
  for (const r of rows) {
    console.log(
      `${r.stage.padEnd(8)} pass ${r.pass}/${r.total} (${(r.rate * 100).toFixed(0)}%)  calls ${r.calls}  failed ${r.callFailures}  median ${r.medianMs} ms  p95 ${r.p95Ms} ms`,
    );
  }
}
