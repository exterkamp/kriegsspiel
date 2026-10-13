/**
 * Orders panel (Epic #119, story 8.10, #395): how each order of the game was interpreted, and a playground
 * that re-runs one without the game. History and detail are GETs; the playground's one POST is a dry run,
 * which the server keeps away from game state, the input log and the game's budget.
 *
 * Nothing here knows the shape of a prompt, an input or a reply: every call is shown as the server recorded
 * it (system prompt, input, schema, raw reply, parsed output), so the panel keeps working if the
 * interpretation design changes. All values are rendered as text, never as HTML.
 */
import { COLLAPSE_OVER, formatLatency, pretty } from './llm.js';
import { apiUrl, formatGameMs } from './model.js';

export type AnsweredBy = 'model' | 'canned' | 'rules' | 'none' | 'agent' | 'unknown';

/** One row of `GET /admin/api/games/:id/orders`. */
export interface OrderAttempt {
  key: string;
  seq?: number;
  wallMs: number;
  gameMs?: number;
  side: string;
  signer?: unknown;
  text: string;
  agent?: boolean;
  outcome: 'intents' | 'clarification' | 'rejection' | 'pending' | 'error';
  answeredBy: AnsweredBy;
  fallbacks: string[];
  error?: string;
  correlationId?: string;
  llmCalls: number;
  summary: string;
}

interface TraceEntryLike {
  seq: number;
  ts: number;
  kind: string;
  correlationId: string;
  data?: unknown;
}

export interface OrderAttemptDetail extends OrderAttempt {
  result?: unknown;
  calls: TraceEntryLike[];
  notes: TraceEntryLike[];
  chain: TraceEntryLike[];
}

export interface PlaygroundInfo {
  prompts: Record<string, { version: string; system: string }>;
  providers: { id: string; type: string; numCtx?: number }[];
  route?: Route;
  perMinute: number;
  usage: Usage;
}

interface Route {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  numCtx?: number;
}

interface Usage {
  runs: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

/** One call of a dry run, as the server captured it. */
export interface DryRunCall {
  request: {
    stage: string;
    promptVersion: string;
    system: string;
    input: unknown;
    schema: unknown;
  };
  ok: boolean;
  provider?: string;
  model?: string;
  response?: string;
  output?: unknown;
  latencyMs: number;
  error?: string;
  errorKind?: string;
}

export interface DryRunSide {
  result: unknown;
  calls: DryRunCall[];
  problems: string[];
}

export interface DryRunResult {
  route?: Route;
  model?: DryRunSide;
  canned: DryRunSide;
  usage: Usage;
}

/** What the playground form holds; `buildDryRun` turns it into the request body. */
export interface PlaygroundForm {
  side: string;
  text: string;
  /** The context as JSON text; empty means the game's own. */
  context: string;
  prompts: Record<string, string>;
  defaults: Record<string, string>;
  provider: string;
  model: string;
  temperature: string;
  maxTokens: string;
  numCtx: string;
  interpret: boolean;
}

const ANSWERED: Record<AnsweredBy, string> = {
  model: 'model',
  canned: 'canned',
  rules: 'rules',
  none: 'nobody (restate)',
  agent: 'agent (no parse)',
  unknown: 'not traced',
};

export function answeredLabel(a: AnsweredBy): string {
  return ANSWERED[a] ?? a;
}

/** The seat's role when the order was signed with roles, else nothing. */
export function signerLabel(signer: unknown): string {
  if (typeof signer === 'string') return signer;
  if (signer && typeof signer === 'object') {
    const s = signer as Record<string, unknown>;
    return [s.role, s.unitId].filter((x) => typeof x === 'string').join(' ');
  }
  return '';
}

export function matchesOrderFilter(a: OrderAttempt, text: string): boolean {
  const q = text.trim().toLowerCase();
  if (!q) return true;
  return [a.text, a.side, a.outcome, a.answeredBy, a.summary, signerLabel(a.signer), ...a.fallbacks]
    .join(' ')
    .toLowerCase()
    .includes(q);
}

const numberOr = (v: string): number | undefined => {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** The dry-run request body, or an error message for the form. Only edited prompts are sent. */
export function buildDryRun(
  f: PlaygroundForm,
): { body: Record<string, unknown> } | { error: string } {
  if (!f.text.trim()) return { error: 'Write an order to try.' };
  const body: Record<string, unknown> = { side: f.side, text: f.text, interpret: f.interpret };
  if (f.context.trim()) {
    try {
      body.context = JSON.parse(f.context);
    } catch {
      return { error: 'The context is not valid JSON.' };
    }
  }
  const prompts = Object.fromEntries(
    Object.entries(f.prompts).filter(([k, v]) => v !== f.defaults[k]),
  );
  if (Object.keys(prompts).length) body.prompts = prompts;
  const route: Record<string, unknown> = {};
  if (f.provider) route.provider = f.provider;
  if (f.model.trim()) route.model = f.model.trim();
  for (const [k, v] of [
    ['temperature', f.temperature],
    ['maxTokens', f.maxTokens],
    ['numCtx', f.numCtx],
  ] as const) {
    const n = numberOr(v);
    if (n !== undefined) route[k] = n;
  }
  if (Object.keys(route).length) body.route = route;
  return { body };
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  cls?: string,
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};

/** A collapsible block of text with a copy button; long ones start closed. */
function section(title: string, value: unknown): HTMLElement {
  const text = pretty(value);
  const d = el('details');
  d.open = text.length <= COLLAPSE_OVER;
  const sum = el('summary', `${title} (${text.length} chars)`);
  const copy = el('button', 'copy');
  copy.type = 'button';
  copy.addEventListener('click', (e) => {
    e.preventDefault();
    void navigator.clipboard?.writeText(text);
  });
  sum.append(' ', copy);
  d.append(sum, el('pre', text));
  return d;
}

const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

/** A traced `llm` call: the same sections the LLM panel shows, whatever the stage. */
function tracedCall(e: TraceEntryLike, i: number): HTMLElement {
  const d = rec(e.data);
  const box = el('div', undefined, 'or-call');
  const usage = rec(d.usage);
  box.append(
    el(
      'h3',
      `call ${i + 1} · ${String(d.stage ?? '?')} · ${String(d.provider ?? '?')}/${String(
        d.model ?? '?',
      )} · ${String(d.mode ?? 'live')} · prompt ${String(d.promptVersion ?? '?')} · ${formatLatency(
        typeof d.latencyMs === 'number' ? d.latencyMs : undefined,
      )} · ${Number(usage.inputTokens ?? 0)} in / ${Number(usage.outputTokens ?? 0)} out · ${Number(
        d.retries ?? 0,
      )} retries`,
    ),
  );
  const fb = rec(d.fallbackFor);
  if (typeof fb.reason === 'string')
    box.append(el('p', `answered by the fallback: ${fb.reason}`, 'bad'));
  if (d.ok === false) {
    const err = typeof d.error === 'string' ? d.error : String(rec(d.error).message ?? 'failed');
    box.append(el('p', `${String(d.errorKind ?? 'error')}: ${err}`, 'bad'));
  }
  for (const [title, key] of [
    ['system prompt', 'system'],
    ['input', 'input'],
    ['schema', 'schema'],
    ['raw reply', 'response'],
    ['parsed', 'output'],
  ] as const) {
    if (d[key] !== undefined) box.append(section(title, d[key]));
  }
  return box;
}

function dryCall(c: DryRunCall, i: number): HTMLElement {
  const box = el('div', undefined, 'or-call');
  box.append(
    el(
      'h3',
      `call ${i + 1} · ${c.request.stage} · ${c.provider ?? '?'}/${c.model ?? '?'} · prompt ${
        c.request.promptVersion
      } · ${formatLatency(c.latencyMs)}`,
    ),
  );
  if (!c.ok) box.append(el('p', `${c.errorKind ?? 'error'}: ${c.error ?? 'failed'}`, 'bad'));
  box.append(section('system prompt', c.request.system), section('input', c.request.input));
  box.append(section('schema', c.request.schema));
  if (c.response !== undefined) box.append(section('raw reply', c.response));
  if (c.output !== undefined) box.append(section('parsed', c.output));
  return box;
}

function verdict(problems: string[]): HTMLElement {
  if (!problems.length) return el('p', 'checks: passed', 'ok');
  const box = el('div');
  box.append(el('p', `checks: ${problems.length} problem${problems.length > 1 ? 's' : ''}`, 'bad'));
  const ul = el('ul', undefined, 'or-problems');
  for (const p of problems) ul.append(el('li', p));
  box.append(ul);
  return box;
}

const REFRESH_MS = 400;

export class OrdersPanel {
  private gameId: string | undefined;
  private attempts: OrderAttempt[] = [];
  private selected: string | undefined;
  private filter = '';
  private request = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private info: PlaygroundInfo | undefined;
  private defaults: Record<string, string> = {};
  private recorded: OrderAttemptDetail | undefined;
  private running = false;

  private readonly status = el('p', 'No game selected.', 'empty');
  private readonly body = el('tbody');
  private readonly detail = el('div', undefined, 'or-detail');
  private readonly pg = el('details', undefined, 'or-playground');
  private readonly out = el('div', undefined, 'or-results');

  constructor(
    private readonly root: HTMLElement,
    private readonly token: () => string | undefined,
    private readonly fetchFn: typeof fetch,
  ) {
    const table = el('table', undefined, 'llm-table or-table');
    const tr = el('tr');
    for (const h of ['time', 'game time', 'side', 'by', 'order', 'outcome', 'answered by', 'calls'])
      tr.append(el('th', h));
    const head = el('thead');
    head.append(tr);
    table.append(head, this.body);
    const list = el('div', undefined, 'or-list');
    list.append(table);
    const top = el('div', undefined, 'or-top');
    top.append(list, this.detail);
    this.body.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('tr[data-key]');
      if (row) void this.select(row.dataset.key);
    });
    this.body.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = (e.target as HTMLElement).closest<HTMLElement>('tr[data-key]');
      if (!row) return;
      e.preventDefault();
      void this.select(row.dataset.key);
    });
    this.buildPlayground();
    root.replaceChildren(this.status, top, this.pg);
  }

  /** Point the panel at a game (or none) and load its orders. */
  async setGame(id: string | undefined): Promise<void> {
    if (id !== this.gameId) {
      this.gameId = id;
      this.attempts = [];
      this.selected = undefined;
      this.recorded = undefined;
      this.detail.replaceChildren();
      this.out.replaceChildren();
      this.field<HTMLTextAreaElement>('context').value = '';
    }
    await this.load();
    if (id && !this.field<HTMLTextAreaElement>('context').value) void this.loadContext();
  }

  /** A trace entry arrived: refresh the list soon if it may concern an order. */
  notify(kind: string): void {
    if (!this.gameId || !['command', 'llm', 'order', 'error'].includes(kind)) return;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.load();
    }, REFRESH_MS);
  }

  setFilter(text: string): void {
    this.filter = text;
    this.renderList();
  }

  stop(): void {
    clearTimeout(this.timer);
  }

  private url(path: string, query: Record<string, string> = {}): string {
    return apiUrl(path, this.token(), query);
  }

  private async load(): Promise<void> {
    const id = this.gameId;
    if (!id) {
      this.status.textContent = 'No game selected.';
      this.renderList();
      return;
    }
    const ticket = ++this.request;
    try {
      const res = await this.fetchFn(this.url(`games/${encodeURIComponent(id)}/orders`));
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { attempts: OrderAttempt[] };
      if (ticket !== this.request || id !== this.gameId) return;
      this.attempts = body.attempts;
      this.status.textContent = `${body.attempts.length} order attempts · newest first`;
      this.renderList();
    } catch {
      if (ticket === this.request) this.status.textContent = 'Could not load the orders.';
    }
  }

  private renderList(): void {
    const rows = this.attempts.filter((a) => matchesOrderFilter(a, this.filter));
    if (!rows.length) {
      const tr = el('tr');
      const td = el('td');
      td.colSpan = 8;
      td.append(
        el('p', this.attempts.length ? 'No orders match the filter.' : 'No orders yet.', 'empty'),
      );
      tr.append(td);
      this.body.replaceChildren(tr);
      return;
    }
    this.body.replaceChildren(
      ...rows.map((a) => {
        const tr = el('tr');
        tr.dataset.key = a.key;
        tr.tabIndex = 0;
        if (a.key === this.selected) tr.setAttribute('aria-selected', 'true');
        if (a.fallbacks.length || a.outcome === 'error') tr.classList.add('bad');
        const cells = [
          new Date(a.wallMs).toLocaleTimeString(),
          a.gameMs === undefined ? '-' : formatGameMs(a.gameMs),
          a.side,
          a.agent ? 'agent' : signerLabel(a.signer) || 'player',
          a.text,
          a.outcome,
        ];
        for (const text of cells) tr.append(el('td', text));
        const by = el('td');
        by.append(el('span', answeredLabel(a.answeredBy), `badge ${a.answeredBy}`));
        tr.append(by, el('td', String(a.llmCalls)));
        return tr;
      }),
    );
  }

  private async select(key: string | undefined): Promise<void> {
    const id = this.gameId;
    this.selected = key;
    this.renderList();
    if (!id || !key) return;
    try {
      const res = await this.fetchFn(
        this.url(`games/${encodeURIComponent(id)}/orders/${encodeURIComponent(key)}`),
      );
      if (!res.ok) throw new Error(String(res.status));
      const d = (await res.json()) as OrderAttemptDetail;
      if (key !== this.selected) return;
      this.recorded = d;
      this.detail.replaceChildren(...this.detailOf(d));
    } catch {
      if (key === this.selected)
        this.detail.replaceChildren(el('p', 'Could not load the order.', 'bad'));
    }
  }

  private detailOf(d: OrderAttemptDetail): HTMLElement[] {
    const out: HTMLElement[] = [el('h2', `“${d.text}”`)];
    const facts: [string, string][] = [
      [
        'side',
        `${d.side}${d.agent ? ' (agent)' : ''}${signerLabel(d.signer) ? ` · ${signerLabel(d.signer)}` : ''}`,
      ],
      ['outcome', `${d.outcome}: ${d.summary}`],
      ['answered by', answeredLabel(d.answeredBy)],
      ['input log seq', d.seq === undefined ? '-' : String(d.seq)],
      ['correlation id', d.correlationId ?? 'none (not traced)'],
    ];
    for (const [k, v] of facts) {
      const row = el('div', undefined, 'kv');
      row.append(el('span', k, 'k'), el('span', v, 'v'));
      out.push(row);
    }
    out.push(verdict(d.fallbacks));
    if (d.error) out.push(el('p', d.error, 'bad'));
    const tryIt = el('button', 'Try in playground');
    tryIt.type = 'button';
    tryIt.addEventListener('click', () => this.prefill(d));
    out.push(tryIt);
    if (d.result !== undefined) out.push(section('handed to the engine', d.result));
    out.push(el('h3', d.calls.length ? `${d.calls.length} model calls` : 'No model calls traced.'));
    d.calls.forEach((c, i) => out.push(tracedCall(c, i)));
    if (d.chain.length) {
      out.push(
        section(
          `correlated trace (${d.chain.length} entries: ${[...new Set(d.chain.map((e) => e.kind))].join(', ')})`,
          d.chain.map((e) => ({ seq: e.seq, kind: e.kind, data: e.data })),
        ),
      );
    }
    return out;
  }

  // --- Playground -------------------------------------------------------------------------------

  private field<T extends HTMLElement>(name: string): T {
    return this.pg.querySelector<T>(`[name="${name}"]`)!;
  }

  private buildPlayground(): void {
    this.pg.innerHTML = `
      <summary>Playground: dry run (never changes the game, its log or its budget)</summary>
      <form class="or-form">
        <div class="or-row">
          <label>side <select name="side"><option>blue</option><option>red</option></select></label>
          <label class="or-grow">order <textarea name="text" rows="2"></textarea></label>
        </div>
        <div class="or-row">
          <label>provider <select name="provider"></select></label>
          <label>model <input name="model" /></label>
          <label>temperature <input name="temperature" type="number" step="0.1" min="0" max="2" /></label>
          <label>max tokens <input name="maxTokens" type="number" min="1" /></label>
          <label>context size <input name="numCtx" type="number" min="256" /></label>
          <label><input name="interpret" type="checkbox" checked /> interpret step</label>
        </div>
        <div class="or-row">
          <label class="or-grow">prompt
            <select name="prompt"></select>
            <textarea name="system" rows="8"></textarea>
          </label>
          <label class="or-grow">context (units, places, hidden; JSON, from the game)
            <textarea name="context" rows="8"></textarea>
          </label>
        </div>
        <div class="or-row">
          <button type="submit">Run dry run</button>
          <button type="button" data-act="reset-prompt">Reset prompt</button>
          <button type="button" data-act="reload-context">Reload context</button>
          <small class="or-usage" role="status"></small>
        </div>
      </form>`;
    this.pg.append(this.out);
    const form = this.pg.querySelector('form')!;
    const prompts: Record<string, string> = {};
    let current = '';
    const promptSel = this.field<HTMLSelectElement>('prompt');
    const system = this.field<HTMLTextAreaElement>('system');
    promptSel.addEventListener('change', () => {
      prompts[current] = system.value;
      current = promptSel.value;
      system.value = prompts[current] ?? this.defaults[current] ?? '';
    });
    this.field<HTMLSelectElement>('side').addEventListener('change', () => void this.loadContext());
    this.pg.addEventListener('toggle', () => {
      if (this.pg.open && !this.info) void this.loadInfo(prompts, (p) => (current = p));
    });
    form.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'reset-prompt') system.value = this.defaults[current] ?? '';
      if (act === 'reload-context') void this.loadContext();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      prompts[current] = system.value;
      void this.run({
        side: this.field<HTMLSelectElement>('side').value,
        text: this.field<HTMLTextAreaElement>('text').value,
        context: this.field<HTMLTextAreaElement>('context').value,
        prompts: { ...this.defaults, ...prompts },
        defaults: this.defaults,
        provider: this.field<HTMLSelectElement>('provider').value,
        model: this.field<HTMLInputElement>('model').value,
        temperature: this.field<HTMLInputElement>('temperature').value,
        maxTokens: this.field<HTMLInputElement>('maxTokens').value,
        numCtx: this.field<HTMLInputElement>('numCtx').value,
        interpret: this.field<HTMLInputElement>('interpret').checked,
      });
    });
  }

  private async loadInfo(
    prompts: Record<string, string>,
    setCurrent: (p: string) => void,
  ): Promise<void> {
    try {
      const res = await this.fetchFn(this.url('orders/playground'));
      if (!res.ok) throw new Error(String(res.status));
      const info = (await res.json()) as PlaygroundInfo;
      this.info = info;
      this.defaults = Object.fromEntries(
        Object.entries(info.prompts).map(([k, p]) => [k, p.system]),
      );
      const promptSel = this.field<HTMLSelectElement>('prompt');
      promptSel.replaceChildren(
        ...Object.entries(info.prompts).map(([k, p]) => new Option(`${k} (${p.version})`, k)),
      );
      const first = Object.keys(info.prompts)[0] ?? '';
      setCurrent(first);
      for (const k of Object.keys(prompts)) delete prompts[k];
      this.field<HTMLTextAreaElement>('system').value = this.defaults[first] ?? '';
      const provider = this.field<HTMLSelectElement>('provider');
      provider.replaceChildren(
        ...info.providers.map(
          (p) => new Option(`${p.id} (${p.type})`, p.id, false, p.id === info.route?.provider),
        ),
      );
      if (info.route) {
        this.field<HTMLInputElement>('model').value = info.route.model;
        if (info.route.temperature !== undefined)
          this.field<HTMLInputElement>('temperature').value = String(info.route.temperature);
        if (info.route.maxTokens !== undefined)
          this.field<HTMLInputElement>('maxTokens').value = String(info.route.maxTokens);
        if (info.route.numCtx !== undefined)
          this.field<HTMLInputElement>('numCtx').value = String(info.route.numCtx);
      }
      this.showUsage(info.usage);
    } catch {
      this.out.replaceChildren(el('p', 'Could not load the playground.', 'bad'));
    }
  }

  private async loadContext(): Promise<void> {
    const id = this.gameId;
    if (!id) return;
    const side = this.field<HTMLSelectElement>('side').value;
    try {
      const res = await this.fetchFn(
        this.url(`games/${encodeURIComponent(id)}/orders-context`, { side }),
      );
      if (!res.ok) throw new Error(String(res.status));
      const ctx = (await res.json()) as Record<string, unknown>;
      if (id !== this.gameId) return;
      delete ctx.side;
      this.field<HTMLTextAreaElement>('context').value = JSON.stringify(ctx, null, 2);
    } catch {
      // A closed game has no live context; the field stays editable.
    }
  }

  private prefill(d: OrderAttemptDetail): void {
    // Setting `.value` fires no `change`, so reload the context here; a hand-edited context is kept
    // when the side is the same.
    const side = this.field<HTMLSelectElement>('side');
    const changed = side.value !== d.side;
    side.value = d.side;
    this.field<HTMLTextAreaElement>('text').value = d.text;
    if (changed) void this.loadContext();
    this.pg.open = true;
    this.pg.scrollIntoView?.({ block: 'start' });
  }

  private showUsage(u: Usage): void {
    this.pg.querySelector('.or-usage')!.textContent =
      `dry runs: ${u.runs} · ${u.calls} calls · ${u.inputTokens} in / ${u.outputTokens} out tokens · ` +
      `$${u.usd.toFixed(4)} (not counted in any game's budget; stopped at the server's; at most ${this.info?.perMinute ?? '?'} a minute)`;
  }

  /** Send a dry run and show the model's answer beside the canned one and the recorded one. */
  async run(form: PlaygroundForm): Promise<void> {
    const id = this.gameId;
    // One dry run at a time: a double submit would spend two runs and could show the older answer.
    if (!id || this.running) return;
    const built = buildDryRun(form);
    if ('error' in built) {
      this.out.replaceChildren(el('p', built.error, 'bad'));
      return;
    }
    this.out.replaceChildren(el('p', 'Running…', 'empty'));
    this.running = true;
    const submit = this.pg.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const res = await this.fetchFn(this.url(`games/${encodeURIComponent(id)}/orders/dry-run`), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(built.body),
      });
      const body = (await res.json()) as DryRunResult & { error?: string; message?: string };
      if (!res.ok) {
        this.out.replaceChildren(
          el('p', `${body.error ?? res.status}: ${body.message ?? ''}`, 'bad'),
        );
        return;
      }
      this.showUsage(body.usage);
      const cols: HTMLElement[] = [];
      const col = (title: string, parts: HTMLElement[]) => {
        const c = el('div', undefined, 'or-col');
        c.append(el('h2', title), ...parts);
        cols.push(c);
      };
      if (body.model) {
        const r = body.route;
        col(`Model${r ? `: ${r.provider}/${r.model}` : ''}`, [
          verdict(body.model.problems),
          section('result', body.model.result),
          ...body.model.calls.map(dryCall),
        ]);
      } else col('Model', [el('p', 'No provider is configured.', 'empty')]);
      col('Canned parser', [
        verdict(body.canned.problems),
        section('result', body.canned.result),
        ...body.canned.calls.map(dryCall),
      ]);
      const rec = this.recorded;
      col(
        'Recorded',
        rec && rec.text === form.text
          ? [verdict(rec.fallbacks), section('result', rec.result ?? rec.outcome)]
          : [el('p', 'No recorded attempt with this exact text is selected.', 'empty')],
      );
      const wrap = el('div', undefined, 'cols');
      wrap.append(...cols);
      this.out.replaceChildren(wrap);
    } catch {
      this.out.replaceChildren(el('p', 'The dry run failed.', 'bad'));
    } finally {
      this.running = false;
      if (submit) submit.disabled = false;
    }
  }
}
