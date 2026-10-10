import { isDeepStrictEqual } from 'node:util';
import type { OrderIntent, OrderParser, ParseContext, ParseResult } from '../orderParser.js';
import { CATEGORIES, type Category, type GoldenOrder } from './corpus.js';

/** Token and money spent by a parser so far. An LLM-backed parser reports this; the stub does not. */
export type Usage = { inputTokens: number; outputTokens: number; usd: number };

/** Optional: lets the harness attribute cost to each order by reading a running total. */
export interface UsageMeter {
  usage(): Usage;
}

/** The part of a `ParseResult` kept for regression: everything but the echoed order text. */
export type StoredOutput =
  | { kind: 'intents'; unitId: string; intents: readonly OrderIntent[] }
  | { kind: 'clarification'; question: string; options?: string[] }
  | { kind: 'rejection'; reason: string };

export type OrderOutcome = {
  id: string;
  category: Category;
  pass: boolean;
  /** An `intents` result addressed a unit the issuing side does not own. */
  unsafe: boolean;
  usage: Usage;
  output: StoredOutput;
};

export type CategoryScore = { total: number; passed: number; accuracy: number };

export type EvalReport = {
  parser: string;
  total: number;
  passed: number;
  accuracy: number;
  unsafe: number;
  categories: Record<Category, CategoryScore>;
  usage: Usage;
  orders: OrderOutcome[];
};

const ZERO: Usage = { inputTokens: 0, outputTokens: 0, usd: 0 };

function isMeter(p: unknown): p is UsageMeter {
  return typeof (p as UsageMeter).usage === 'function';
}

function store(r: ParseResult): StoredOutput {
  switch (r.kind) {
    case 'intents':
      return { kind: 'intents', unitId: r.unitId, intents: r.intents };
    case 'clarification':
      return r.options === undefined
        ? { kind: 'clarification', question: r.question }
        : { kind: 'clarification', question: r.question, options: r.options };
    case 'rejection':
      return { kind: 'rejection', reason: r.reason };
  }
}

function matches(order: GoldenOrder, r: ParseResult): boolean {
  const e = order.expect;
  if (!e.kinds.includes(r.kind)) return false;
  if (r.kind !== 'intents') return true;
  if (e.unitId !== undefined && r.unitId !== e.unitId) return false;
  return e.intents === undefined || isDeepStrictEqual(r.intents, e.intents);
}

/**
 * Run `parser` over `orders` in `context`, one at a time and in corpus order, and score it.
 * A parser that throws fails that order (recorded as a rejection) instead of aborting the run.
 */
export async function runEval(
  name: string,
  parser: OrderParser,
  orders: readonly GoldenOrder[],
  context: ParseContext,
): Promise<EvalReport> {
  const meter = isMeter(parser) ? parser : undefined;
  const own = new Set(context.units.filter((u) => u.side === context.side).map((u) => u.id));
  const outcomes: OrderOutcome[] = [];
  for (const order of orders) {
    const before = meter?.usage() ?? ZERO;
    let result: ParseResult;
    let crashed = false;
    try {
      result = await parser.parse(order.text, context);
    } catch (err) {
      crashed = true;
      result = {
        kind: 'rejection',
        text: order.text,
        reason: `parser threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    const after = meter?.usage() ?? ZERO;
    const unsafe = result.kind === 'intents' && !own.has(result.unitId);
    outcomes.push({
      id: order.id,
      category: order.category,
      pass: !crashed && !unsafe && matches(order, result),
      unsafe,
      usage: {
        inputTokens: after.inputTokens - before.inputTokens,
        outputTokens: after.outputTokens - before.outputTokens,
        usd: after.usd - before.usd,
      },
      output: store(result),
    });
  }

  const categories = {} as Record<Category, CategoryScore>;
  for (const c of CATEGORIES) {
    const mine = outcomes.filter((o) => o.category === c);
    const passed = mine.filter((o) => o.pass).length;
    categories[c] = {
      total: mine.length,
      passed,
      accuracy: mine.length ? passed / mine.length : 0,
    };
  }
  const passed = outcomes.filter((o) => o.pass).length;
  return {
    parser: name,
    total: outcomes.length,
    passed,
    accuracy: outcomes.length ? passed / outcomes.length : 0,
    unsafe: outcomes.filter((o) => o.unsafe).length,
    categories,
    usage: outcomes.reduce(
      (s, o) => ({
        inputTokens: s.inputTokens + o.usage.inputTokens,
        outputTokens: s.outputTokens + o.usage.outputTokens,
        usd: s.usd + o.usage.usd,
      }),
      ZERO,
    ),
    orders: outcomes,
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** The human-readable report. Format is documented in docs/order-eval.md. */
export function formatReport(report: EvalReport): string {
  const lines = [`Order parser evaluation: ${report.parser}`, ''];
  lines.push('category        passed  total  accuracy');
  for (const c of CATEGORIES) {
    const s = report.categories[c];
    lines.push(
      `${c.padEnd(15)} ${String(s.passed).padStart(6)}  ${String(s.total).padStart(5)}  ${pct(s.accuracy).padStart(8)}`,
    );
  }
  lines.push(
    `${'overall'.padEnd(15)} ${String(report.passed).padStart(6)}  ${String(report.total).padStart(5)}  ${pct(report.accuracy).padStart(8)}`,
  );
  lines.push('');
  lines.push(`unsafe results: ${report.unsafe} (intents for a unit the side does not own)`);
  const u = report.usage;
  lines.push(
    `cost: ${u.inputTokens} input tokens, ${u.outputTokens} output tokens, $${u.usd.toFixed(4)}`,
  );
  const failed = report.orders.filter((o) => !o.pass);
  lines.push('');
  lines.push(failed.length === 0 ? 'failures: none' : `failures (${failed.length}):`);
  for (const o of failed) lines.push(`  ${o.id}: got ${o.output.kind}`);
  return lines.join('\n');
}

export type BaselineEntry = { id: string; pass: boolean; output: StoredOutput };
export type Baseline = { parser: string; orders: BaselineEntry[] };

/** The slice of a report that is stored for regression: no cost, so it is stable across runs. */
export function toBaseline(report: EvalReport): Baseline {
  return {
    parser: report.parser,
    orders: report.orders.map((o) => ({ id: o.id, pass: o.pass, output: o.output })),
  };
}

/** Ids whose stored output or pass/fail changed, appeared or vanished since `baseline`. */
export function diffBaseline(report: EvalReport, baseline: Baseline): string[] {
  const now = new Map(toBaseline(report).orders.map((o) => [o.id, o]));
  const then = new Map(baseline.orders.map((o) => [o.id, o]));
  const ids = new Set([...now.keys(), ...then.keys()]);
  return [...ids].filter((id) => !isDeepStrictEqual(now.get(id), then.get(id))).sort();
}
