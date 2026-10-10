import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { StubOrderParser } from '../stubParser.js';
import { CORPUS_CONTEXT, GOLDEN_ORDERS } from './corpus.js';
import { diffBaseline, formatReport, runEval, toBaseline, type Baseline } from './harness.js';

/**
 * `npm run eval:orders -w server [-- --update] [-- --json]`
 *
 * Runs the stub parser over the golden corpus and prints the report. With `--update` it rewrites
 * the stored baseline; otherwise it exits 1 if any order's output differs from the baseline.
 * Swap the parser below to evaluate the LLM umpire once it exists.
 */
const BASELINE_URL = new URL('../../../baselines/stub-parser.json', import.meta.url);

async function main(): Promise<number> {
  const args = new Set(process.argv.slice(2));
  const report = await runEval('stub', new StubOrderParser(), GOLDEN_ORDERS, CORPUS_CONTEXT);
  console.log(args.has('--json') ? JSON.stringify(report, null, 2) : formatReport(report));
  if (args.has('--update')) {
    writeFileSync(BASELINE_URL, `${JSON.stringify(toBaseline(report), null, 2)}\n`);
    console.log(`\nbaseline written to ${fileURLToPath(BASELINE_URL)}`);
    return 0;
  }
  const baseline = JSON.parse(readFileSync(BASELINE_URL, 'utf8')) as Baseline;
  const changed = diffBaseline(report, baseline);
  if (changed.length > 0) {
    console.error(
      `\nchanged since baseline: ${changed.join(', ')} (rerun with --update to accept)`,
    );
    return 1;
  }
  return 0;
}

process.exitCode = await main();
