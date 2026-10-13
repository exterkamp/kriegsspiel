/**
 * Order interpretation debug (Epic #119, story 8.10, #395): what went into the order pipeline, what came
 * back, what the checks said, and a dry-run playground. See docs/architecture.md (Admin API).
 *
 *   GET  /admin/api/games/:id/orders               every order attempt, newest first
 *   GET  /admin/api/games/:id/orders/:key          one attempt: the model calls, fallback notes and result
 *   GET  /admin/api/games/:id/orders-context?side= what the parser would be given for an order signed now
 *   GET  /admin/api/orders/playground              prompts, providers, the parse route, limits and dry-run usage
 *   POST /admin/api/games/:id/orders/dry-run       run an order through the pipeline without the game
 *
 * History joins two read-only sources: the input log (what was signed and the result the engine was given)
 * and the debug trace, by correlation id (every `llm` call the order caused and the `order` notes of
 * steps that fell back). Nothing here knows the shape of a prompt or a reply: calls are shown as the
 * trace recorded them, so the page keeps working whatever the interpretation design becomes.
 *
 * Dry runs never reach the game: they read the context once, then use their own umpire client (no game
 * budget, no fallback provider, no recorder), never touch the actor, the input log or the trace, and are
 * rate limited and counted on their own.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { GameHost } from '../game/index.js';
import type { GameStore, InputLogEntry } from '../game/store.js';
import { Redactor } from '../debug/redact.js';
import type { TraceEntry, TraceStore } from '../debug/trace.js';
import type { OrderParser, ParseContext, ParseResult } from '../orders/index.js';
import {
  LlmOrderParser,
  PARSE_ORDERS_PROMPT_VERSION,
  PARSE_ORDERS_SYSTEM,
} from '../orders/llmParser.js';
import {
  INTERPRET_ORDERS_PROMPT_VERSION,
  INTERPRET_ORDERS_SYSTEM,
  InterpretingParser,
} from '../orders/interpret.js';
import { StubOrderParser } from '../orders/stubParser.js';
import type { UmpireConfig } from '../umpire/config.js';
import { createUmpireClient } from '../umpire/createUmpireClient.js';
import type { UmpireClient, UmpireRequest, UmpireResponse } from '../umpire/umpireClient.js';
import { UmpireError } from '../umpire/umpireClient.js';

export type OrderOutcome = 'intents' | 'clarification' | 'rejection' | 'pending' | 'error';
/**
 * Who gave the answer the engine got: the configured `model`, the `canned` test provider (configured, or as
 * the fallback), the rule-based `rules` parser, `none` (the player was asked to restate), the `agent` that
 * wrote the order with its intents (a scripted side, the AI commander or a deputy; no parse ran), or
 * `unknown` when the trace no longer holds the order (a restart, or the ring buffer moved on).
 */
export type AnsweredBy = 'model' | 'canned' | 'rules' | 'none' | 'agent' | 'unknown';

export interface OrderAttempt {
  /** `log-<seq>` for a logged order, `trace-<seq>` for one still being parsed. */
  key: string;
  seq?: number;
  wallMs: number;
  gameMs?: number;
  side: string;
  /** The seat that signed, when the side plays with roles. */
  signer?: unknown;
  text: string;
  /** Issued by a scripted side's agent or a deputy, not a player. */
  agent?: boolean;
  outcome: OrderOutcome;
  answeredBy: AnsweredBy;
  /** Why a step did not take the model's answer, in order. Empty when nothing fell back. */
  fallbacks: string[];
  error?: string;
  correlationId?: string;
  llmCalls: number;
  /** One line: the unit and intents, the question or the reason. */
  summary: string;
}

export interface OrderAttemptDetail extends OrderAttempt {
  /** What the engine was given (the logged parse result). */
  result?: ParseResult;
  /** The `llm` trace entries the order caused, as recorded: prompt, input, schema, raw reply, output. */
  calls: TraceEntry[];
  /** The `order` notes: each step that fell back, why, and who answered instead. */
  notes: TraceEntry[];
  /** Every trace entry with the order's correlation id (request, command, engine, error, …). */
  chain: TraceEntry[];
}

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

function summarize(r: ParseResult | undefined): string {
  if (!r) return '';
  switch (r.kind) {
    case 'intents':
      return `${r.unitId}: ${r.intents.map((i) => i.kind).join(' → ') || '(no intents)'}`;
    case 'clarification':
      return r.question;
    case 'rejection':
      return r.reason;
  }
}

function answeredBy(
  linked: boolean,
  logFallback: boolean,
  calls: TraceEntry[],
  notes: TraceEntry[],
): AnsweredBy {
  if (logFallback) return 'none';
  const parseNote = notes.find((n) => rec(n.data).step === 'parse');
  const canned = calls.some((c) => {
    const d = rec(c.data);
    return d.ok !== false && (d.mode === 'test' || d.mode === 'fallback');
  });
  if (parseNote) {
    if (rec(parseNote.data).answeredBy !== 'fallback') return 'none';
    return canned ? 'canned' : 'rules';
  }
  const first = calls.find((c) => rec(c.data).ok !== false);
  if (first) {
    const mode = rec(first.data).mode;
    return mode === 'test' || mode === 'fallback' ? 'canned' : 'model';
  }
  return linked ? 'rules' : 'unknown';
}

function isOrderCommand(e: TraceEntry): boolean {
  return e.kind === 'command' && rec(rec(e.data).command).kind === 'order';
}

/**
 * Every order attempt of a game, newest first: the logged orders, then any still being parsed (in the
 * trace but not yet in the log). Pure: reads the log and the trace entries it is given.
 */
export function orderAttempts(
  log: readonly InputLogEntry[],
  trace: readonly TraceEntry[],
): OrderAttemptDetail[] {
  const commands = trace.filter(isOrderCommand);
  const bySeq = new Map<number, TraceEntry>();
  for (const c of commands) {
    const seq = rec(c.data).seq;
    if (typeof seq === 'number') bySeq.set(seq, c);
  }
  const byCorrelation = new Map<string, TraceEntry[]>();
  for (const e of trace) {
    if (e.correlationId === 'none') continue;
    let list = byCorrelation.get(e.correlationId);
    if (!list) byCorrelation.set(e.correlationId, (list = []));
    list.push(e);
  }
  const ordersIn = new Map<string, number>();
  for (const c of commands) ordersIn.set(c.correlationId, (ordersIn.get(c.correlationId) ?? 0) + 1);
  // A scheduler tick can carry several orders and unrelated calls (narration), so a call or note belongs
  // to an order when it carries the order's text; only a request with one order and no match takes all.
  const linkedTo = (command: TraceEntry | undefined, text: string, agent: boolean) => {
    const id = command && command.correlationId !== 'none' ? command.correlationId : undefined;
    const chain = id ? (byCorrelation.get(id) ?? []) : [];
    const mine = (e: TraceEntry, field: 'input' | 'text') => {
      const v = rec(e.data)[field];
      if (field === 'text') return v === text;
      const s = typeof v === 'string' ? v : JSON.stringify(v ?? null);
      return s.includes(text) || s.includes(JSON.stringify(text).slice(1, -1));
    };
    const pick = (kind: 'llm' | 'order', field: 'input' | 'text') => {
      const all = chain.filter((e) => e.kind === kind);
      const matched = all.filter((e) => mine(e, field));
      return matched.length || agent || (id && ordersIn.get(id)! > 1) ? matched : all;
    };
    return { correlationId: id, chain, calls: pick('llm', 'input'), notes: pick('order', 'text') };
  };
  const out: OrderAttemptDetail[] = [];
  const logged = new Set<number>();
  for (const entry of log) {
    if (entry.command.kind !== 'order') continue;
    logged.add(entry.seq);
    const command = bySeq.get(entry.seq);
    const link = linkedTo(command, entry.command.text, !!entry.agent);
    const fallbacks = link.notes.map((n) => {
      const d = rec(n.data);
      return `${String(d.step ?? '?')}: ${String(d.reason ?? '')}`;
    });
    if (entry.fallback) {
      fallbacks.push(
        `parser failed on all ${entry.fallback.attempts} attempts: ${entry.fallback.error}`,
      );
    }
    const outcome: OrderOutcome = entry.parse
      ? entry.parse.kind
      : entry.error
        ? 'error'
        : 'pending';
    out.push({
      key: `log-${entry.seq}`,
      seq: entry.seq,
      wallMs: entry.wallMs,
      gameMs: entry.gameMs,
      side: entry.command.side,
      ...(entry.command.signer === undefined ? {} : { signer: entry.command.signer }),
      text: entry.command.text,
      ...(entry.agent ? { agent: true } : {}),
      outcome,
      answeredBy: entry.agent
        ? 'agent'
        : answeredBy(command !== undefined, !!entry.fallback, link.calls, link.notes),
      fallbacks,
      ...(entry.error ? { error: entry.error } : {}),
      ...(link.correlationId ? { correlationId: link.correlationId } : {}),
      llmCalls: link.calls.length,
      summary: summarize(entry.parse) || entry.error || '',
      result: entry.parse,
      calls: link.calls,
      notes: link.notes,
      chain: link.chain,
    });
  }
  for (const c of commands) {
    const seq = rec(c.data).seq;
    if (typeof seq === 'number' && logged.has(seq)) continue;
    const command = rec(rec(c.data).command);
    const link = linkedTo(c, String(command.text ?? ''), false);
    out.push({
      key: `trace-${c.seq}`,
      ...(typeof seq === 'number' ? { seq } : {}),
      wallMs: c.ts,
      side: String(command.side ?? '?'),
      ...(command.signer === undefined ? {} : { signer: command.signer }),
      text: String(command.text ?? ''),
      outcome: 'pending',
      answeredBy: 'unknown',
      fallbacks: link.notes.map(
        (n) => `${String(rec(n.data).step)}: ${String(rec(n.data).reason)}`,
      ),
      ...(link.correlationId ? { correlationId: link.correlationId } : {}),
      llmCalls: link.calls.length,
      summary: 'being parsed',
      calls: link.calls,
      notes: link.notes,
      chain: link.chain,
    });
  }
  return out.sort((a, b) => b.wallMs - a.wallMs || (b.seq ?? 0) - (a.seq ?? 0));
}

/** The row without the joined trace entries, for the history list. */
export function attemptRow(d: OrderAttemptDetail): OrderAttempt {
  const row: Partial<OrderAttemptDetail> = { ...d };
  delete row.result;
  delete row.calls;
  delete row.notes;
  delete row.chain;
  return row as OrderAttempt;
}

// --- Playground ---------------------------------------------------------------------------------

/** The prompts a dry run can edit, by the name the page uses. */
export const PLAYGROUND_PROMPTS = {
  parse: { version: PARSE_ORDERS_PROMPT_VERSION, system: PARSE_ORDERS_SYSTEM },
  interpret: { version: INTERPRET_ORDERS_PROMPT_VERSION, system: INTERPRET_ORDERS_SYSTEM },
} as const;
export type PromptName = keyof typeof PLAYGROUND_PROMPTS;

export const DEFAULT_DRY_RUNS_PER_MINUTE = 6;

export interface PlaygroundRoute {
  /** A provider id from the server's umpire config. Arbitrary URLs are never accepted. */
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  /** Ollama only: `options.num_ctx`. */
  numCtx?: number;
}

export interface DryRunRequest {
  side: string;
  text: string;
  /** Units, places and hidden names; absent: the game's own, as an order signed now would see them. */
  context?: Omit<ParseContext, 'side'>;
  /** Replacement system prompts; the call is recorded with `<version>+edited`. */
  prompts?: Partial<Record<PromptName, string>>;
  route?: Partial<PlaygroundRoute>;
  /** Run the interpret step after the parse (default true). */
  interpret?: boolean;
}

export interface DryRunCall {
  request: Pick<UmpireRequest, 'stage' | 'promptVersion' | 'system' | 'input' | 'schema'> & {
    temperature?: number;
    maxTokens?: number;
  };
  ok: boolean;
  provider?: string;
  model?: string;
  /** The model's text as received. */
  response?: string;
  output?: unknown;
  latencyMs: number;
  usage?: unknown;
  costUsd?: number | null;
  attempts?: number;
  canned?: boolean;
  error?: string;
  errorKind?: string;
}

export interface DryRunSide {
  result: ParseResult;
  calls: DryRunCall[];
  /** Why the checks refused an answer, or a call failed; empty when everything passed. */
  problems: string[];
}

export interface DryRunUsage {
  runs: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

export interface DryRunResult {
  route?: PlaygroundRoute;
  /** The configured model with the edits; absent when no provider is configured. */
  model?: DryRunSide;
  /** The canned parser (the test provider, then the rules), as the game falls back to it. */
  canned: DryRunSide;
  /** Dry runs since the server started, counted apart from every game's budget. */
  usage: DryRunUsage;
}

export class PlaygroundError extends Error {
  constructor(
    readonly code: 'rate_limited' | 'unknown_provider',
    message: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

/** Wraps a client: swaps in edited prompts and records each call for the dry-run result. */
class CapturingClient implements UmpireClient {
  readonly calls: DryRunCall[] = [];

  constructor(
    private readonly inner: UmpireClient,
    private readonly prompts: Partial<Record<string, string>>,
    private readonly params: { temperature?: number; maxTokens?: number },
    private readonly now: () => number,
  ) {}

  async call<T>(request: UmpireRequest): Promise<UmpireResponse<T>> {
    const system = this.prompts[request.promptVersion];
    const req: UmpireRequest = {
      ...request,
      ...(system === undefined ? {} : { system, promptVersion: `${request.promptVersion}+edited` }),
      ...this.params,
    };
    const shown = {
      stage: req.stage,
      promptVersion: req.promptVersion,
      system: req.system,
      input: req.input,
      schema: req.schema,
      ...this.params,
    };
    const start = this.now();
    try {
      const res = await this.inner.call<T>(req);
      const r = res.record;
      this.calls.push({
        request: shown,
        ok: true,
        provider: r.provider,
        model: r.model,
        response: r.rawOutput,
        output: res.output,
        latencyMs: this.now() - start,
        usage: r.usage,
        costUsd: r.costUsd,
        attempts: r.attempts,
        ...(r.canned ? { canned: true } : {}),
      });
      return res;
    } catch (e) {
      const failed = e instanceof UmpireError ? e : undefined;
      this.calls.push({
        request: shown,
        ok: false,
        latencyMs: this.now() - start,
        usage: failed?.usage,
        costUsd: failed?.costUsd,
        attempts: failed?.attempts,
        error: e instanceof Error ? e.message : String(e),
        ...(failed ? { errorKind: failed.kind } : {}),
      });
      throw e;
    }
  }
}

export interface OrderPlaygroundOptions {
  /** The server's umpire config. Absent: only the canned parser runs. */
  config?: UmpireConfig;
  /** Builds the dry-run client. Defaults to `createUmpireClient`. */
  makeClient?: (config: UmpireConfig) => UmpireClient;
  /** The test provider, for the canned answer. Absent: the rules parser alone. */
  cannedClient?: UmpireClient;
  /** Dry runs allowed per rolling minute, across all games. */
  perMinute?: number;
  now?: () => number;
}

/**
 * Runs orders through the pipeline outside any game. Its client is its own: built per run from the
 * config with the edited route, with no budget, no game limits and no fallback provider, so a dry run
 * neither spends a game's budget nor hides a model failure behind the canned answer.
 */
export class OrderPlayground {
  private readonly now: () => number;
  private readonly perMinute: number;
  private readonly recent: number[] = [];
  private readonly redactor = new Redactor();
  private spent: DryRunUsage = { runs: 0, calls: 0, inputTokens: 0, outputTokens: 0, usd: 0 };

  constructor(private readonly o: OrderPlaygroundOptions = {}) {
    this.now = o.now ?? Date.now;
    this.perMinute = Math.max(1, o.perMinute ?? DEFAULT_DRY_RUNS_PER_MINUTE);
  }

  /** What the page needs to build the form. */
  describe() {
    const c = this.o.config;
    return {
      prompts: Object.fromEntries(
        Object.entries(PLAYGROUND_PROMPTS).map(([name, p]) => [name, { ...p }]),
      ),
      providers: c
        ? Object.entries(c.providers).map(([id, spec]) => ({
            id,
            type: spec.type,
            ...(spec.numCtx === undefined ? {} : { numCtx: spec.numCtx }),
          }))
        : [],
      route: c ? this.route({}) : undefined,
      perMinute: this.perMinute,
      usage: this.usage(),
    };
  }

  usage(): DryRunUsage {
    return { ...this.spent };
  }

  private route(over: Partial<PlaygroundRoute>): PlaygroundRoute {
    const base = this.o.config!.stages.parse;
    const spec = this.o.config!.providers[over.provider ?? base.provider];
    const temperature = over.temperature ?? base.params?.temperature;
    const maxTokens = over.maxTokens ?? base.params?.maxTokens;
    const numCtx = over.numCtx ?? spec?.numCtx;
    return {
      provider: over.provider ?? base.provider,
      model: over.model ?? base.model,
      ...(temperature === undefined ? {} : { temperature }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
      ...(numCtx === undefined ? {} : { numCtx }),
    };
  }

  private take(): void {
    const t = this.now();
    while (this.recent.length && this.recent[0]! <= t - 60_000) this.recent.shift();
    if (this.recent.length >= this.perMinute) {
      throw new PlaygroundError(
        'rate_limited',
        `at most ${this.perMinute} dry runs a minute`,
        this.recent[0]! + 60_000 - t,
      );
    }
    this.recent.push(t);
  }

  async run(req: DryRunRequest, ctx: ParseContext): Promise<DryRunResult> {
    const config = this.o.config;
    const route = config ? this.route(req.route ?? {}) : undefined;
    if (config && route && !config.providers[route.provider]) {
      throw new PlaygroundError(
        'unknown_provider',
        `provider "${route.provider}" is not configured`,
      );
    }
    this.take();
    const prompts: Partial<Record<string, string>> = {};
    for (const [name, system] of Object.entries(req.prompts ?? {})) {
      const p = PLAYGROUND_PROMPTS[name as PromptName];
      if (p && typeof system === 'string' && system !== p.system) prompts[p.version] = system;
    }
    const interpret = req.interpret !== false;

    let model: DryRunSide | undefined;
    if (config && route) {
      const spec = config.providers[route.provider]!;
      const runConfig: UmpireConfig = {
        ...config,
        providers: {
          ...config.providers,
          [route.provider]: {
            ...spec,
            ...(route.numCtx === undefined ? {} : { numCtx: route.numCtx }),
          },
        },
        stages: {
          ...config.stages,
          parse: {
            provider: route.provider,
            model: route.model,
            params: {
              ...(route.temperature === undefined ? {} : { temperature: route.temperature }),
              ...(route.maxTokens === undefined ? {} : { maxTokens: route.maxTokens }),
            },
          },
        },
        budget: undefined,
        gameBudget: undefined,
        fallbackProvider: undefined,
      };
      const make = this.o.makeClient ?? ((c: UmpireConfig) => createUmpireClient({ config: c }));
      const capture = new CapturingClient(
        make(runConfig),
        prompts,
        {
          ...(route.temperature === undefined ? {} : { temperature: route.temperature }),
          ...(route.maxTokens === undefined ? {} : { maxTokens: route.maxTokens }),
        },
        this.now,
      );
      const problems: string[] = [];
      // No fallback parser: the result is the model's own, or "restate" with the reason.
      let parser: OrderParser = new LlmOrderParser(capture, {
        onFallback: (f) => problems.push(`parse: ${f.reason}`),
      });
      if (interpret) {
        parser = new InterpretingParser(parser, capture, {
          onFallback: (reason) => problems.push(reason),
        });
      }
      const result = await parser.parse(req.text, ctx);
      model = { result, calls: capture.calls, problems };
      this.count(capture.calls);
    }

    const cannedProblems: string[] = [];
    let cannedCalls: DryRunCall[] = [];
    let cannedParser: OrderParser = new StubOrderParser();
    if (this.o.cannedClient) {
      const capture = new CapturingClient(this.o.cannedClient, {}, {}, this.now);
      cannedCalls = capture.calls;
      cannedParser = new LlmOrderParser(capture, {
        fallbackParser: new StubOrderParser(),
        onFallback: (f) => cannedProblems.push(`parse: ${f.reason}`),
      });
    }
    const cannedResult = await cannedParser.parse(req.text, ctx);
    this.spent.runs++;
    return this.redactor.value({
      ...(route ? { route } : {}),
      ...(model ? { model } : {}),
      canned: { result: cannedResult, calls: cannedCalls, problems: cannedProblems },
      usage: this.usage(),
    }) as DryRunResult;
  }

  private count(calls: DryRunCall[]): void {
    for (const c of calls) {
      const u = rec(c.usage);
      this.spent.calls++;
      this.spent.inputTokens += typeof u.inputTokens === 'number' ? u.inputTokens : 0;
      this.spent.outputTokens += typeof u.outputTokens === 'number' ? u.outputTokens : 0;
      this.spent.usd += typeof c.costUsd === 'number' ? c.costUsd : 0;
    }
  }
}

// --- Routes -------------------------------------------------------------------------------------

const Coord = z.object({ x: z.number().finite(), y: z.number().finite() });
const DryRunBody = z
  .object({
    side: z.string().min(1).max(64),
    text: z.string().min(1).max(4000),
    context: z
      .object({
        units: z
          .array(
            z.object({
              id: z.string().min(1),
              side: z.string().min(1),
              name: z.string(),
              center: Coord,
              personality: z.array(z.string()).optional(),
            }),
          )
          .max(500),
        map: z.object({
          features: z
            .array(
              z.object({
                id: z.string().min(1),
                kind: z.string(),
                name: z.string().optional(),
                anchor: Coord,
              }),
            )
            .max(2000),
        }),
        hidden: z.array(z.string()).max(500).optional(),
      })
      .optional(),
    prompts: z
      .object({
        parse: z.string().max(50_000).optional(),
        interpret: z.string().max(50_000).optional(),
      })
      .strict()
      .optional(),
    route: z
      .object({
        provider: z.string().min(1).max(64).optional(),
        model: z.string().min(1).max(200).optional(),
        temperature: z.number().min(0).max(2).optional(),
        maxTokens: z.number().int().min(1).max(32_000).optional(),
        numCtx: z.number().int().min(256).max(131_072).optional(),
      })
      .strict()
      .optional(),
    interpret: z.boolean().optional(),
  })
  .strict();

export interface OrderDebugOptions {
  host: GameHost;
  trace: TraceStore;
  store: GameStore;
  playground: OrderPlayground;
}

export function orderDebugRoutes(server: FastifyInstance, prefix: string, o: OrderDebugOptions) {
  const { host, trace, store } = o;

  const attempts = async (id: string): Promise<OrderAttemptDetail[] | undefined> => {
    const log = await store.inputLog(id).catch(() => [] as readonly InputLogEntry[]);
    const entries = trace.entries(id);
    if (!host.get(id) && entries.length === 0 && log.length === 0) return undefined;
    return orderAttempts(log, entries);
  };

  server.get<{ Params: { id: string } }>(`${prefix}/games/:id/orders`, async (req, reply) => {
    const list = await attempts(req.params.id);
    if (!list) return reply.code(404).send({ error: 'no_such_game' });
    return { attempts: list.map(attemptRow) };
  });

  server.get<{ Params: { id: string; key: string } }>(
    `${prefix}/games/:id/orders/:key`,
    async (req, reply) => {
      const list = await attempts(req.params.id);
      if (!list) return reply.code(404).send({ error: 'no_such_game' });
      const found = list.find((a) => a.key === req.params.key);
      if (!found) return reply.code(404).send({ error: 'no_such_order' });
      return found;
    },
  );

  server.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    `${prefix}/games/:id/orders-context`,
    async (req, reply) => {
      const actor = host.get(req.params.id);
      if (!actor) return reply.code(404).send({ error: 'no_such_game' });
      const side = req.query.side ?? actor.state.world.sides[0]?.id;
      if (!side || !actor.state.world.sides.some((s) => s.id === side)) {
        return reply.code(400).send({ error: 'bad_request', message: 'unknown side' });
      }
      return actor.orderContext(side);
    },
  );

  server.get(`${prefix}/orders/playground`, async () => o.playground.describe());

  server.post<{ Params: { id: string } }>(
    `${prefix}/games/:id/orders/dry-run`,
    async (req, reply) => {
      const body = DryRunBody.safeParse(req.body);
      if (!body.success)
        return reply.code(400).send({ error: 'bad_request', message: body.error.message });
      const b = body.data;
      let context: Omit<ParseContext, 'side'>;
      if (b.context) context = b.context;
      else {
        const actor = host.get(req.params.id);
        if (!actor) return reply.code(404).send({ error: 'no_such_game' });
        if (!actor.state.world.sides.some((s) => s.id === b.side)) {
          return reply.code(400).send({ error: 'bad_request', message: 'unknown side' });
        }
        context = actor.orderContext(b.side);
      }
      try {
        return await o.playground.run(b, { ...context, side: b.side });
      } catch (e) {
        if (e instanceof PlaygroundError) {
          if (e.code === 'rate_limited') {
            void reply.header('retry-after', String(Math.ceil((e.retryAfterMs ?? 0) / 1000)));
            return reply
              .code(429)
              .send({ error: e.code, message: e.message, retryAfterMs: e.retryAfterMs });
          }
          return reply.code(400).send({ error: e.code, message: e.message });
        }
        throw e;
      }
    },
  );
}
