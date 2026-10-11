import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LlmOrderParser } from '../llmParser.js';
import type { OrderParser } from '../orderParser.js';
import { StubOrderParser } from '../stubParser.js';
import { PlaybackUmpireClient, createUmpireClient, loadUmpireConfig } from '../../umpire/index.js';
import type { UmpireCallRecord, UmpireClient } from '../../umpire/index.js';
import { CORPUS_CONTEXT, GOLDEN_ORDERS } from './corpus.js';
import { diffBaseline, formatReport, runEval, toBaseline, type Baseline } from './harness.js';

/**
 * `npm run eval:orders -w server [-- --llm [--live [--record]]] [-- --update] [-- --json]`
 *
 * Runs a parser over the golden corpus and prints the report. The stub is the default. `--llm`
 * runs the LLM parser against the recorded model outputs (no network). `--llm --live` calls the
 * configured `parse` provider instead (see docs/llm-providers.md), and with `--record` stores
 * those calls as the new recording. With `--update` the stored baseline is rewritten; otherwise
 * the run exits 1 if any order's output differs from the baseline.
 */
const dir = (name: string) => new URL(`../../../baselines/${name}`, import.meta.url);

async function main(): Promise<number> {
  const args = new Set(process.argv.slice(2));
  const llm = args.has('--llm');
  const recorded: UmpireCallRecord[] = [];
  let client: UmpireClient | undefined;
  let parser: OrderParser = new StubOrderParser();
  if (llm) {
    client = args.has('--live')
      ? createUmpireClient({
          config: loadUmpireConfig(),
          recorder: { record: (r) => void recorded.push(r) },
        })
      : new PlaybackUmpireClient(
          JSON.parse(readFileSync(dir('llm-parser.recording.json'), 'utf8')) as UmpireCallRecord[],
        );
    parser = new LlmOrderParser(client, {
      onFallback: (f) => console.error(`fallback: ${f.reason}`),
    });
  }
  const name = llm ? 'llm' : 'stub';
  const baselineUrl = dir(llm ? 'llm-parser.json' : 'stub-parser.json');
  const report = await runEval(name, parser, GOLDEN_ORDERS, CORPUS_CONTEXT);
  console.log(args.has('--json') ? JSON.stringify(report, null, 2) : formatReport(report));
  if (args.has('--record') && !args.has('--live')) {
    console.error('--record has no effect without --live; nothing was recorded');
  }
  if (args.has('--record') && args.has('--live')) {
    writeFileSync(dir('llm-parser.recording.json'), `${JSON.stringify(recorded, null, 1)}\n`);
    console.log(`\nrecording written to ${fileURLToPath(dir('llm-parser.recording.json'))}`);
  }
  if (args.has('--update')) {
    writeFileSync(baselineUrl, `${JSON.stringify(toBaseline(report), null, 2)}\n`);
    console.log(`\nbaseline written to ${fileURLToPath(baselineUrl)}`);
    return 0;
  }
  const baseline = JSON.parse(readFileSync(baselineUrl, 'utf8')) as Baseline;
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
