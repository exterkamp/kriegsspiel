/**
 * LLM panel (Epic #119, story 8.6): every umpire call the trace recorded, with totals and a detail
 * view. Read-only. The server redacts secrets before an entry is stored; this file additionally
 * renders every value with `textContent`, never as HTML.
 */

export interface TraceEntryLike {
  seq: number;
  ts: number;
  kind: string;
  correlationId?: string;
  data?: unknown;
}

export interface LlmCall {
  seq: number;
  ts: number;
  stage: string;
  provider: string;
  model?: string;
  mode: 'live' | 'playback';
  latencyMs?: number;
  inputTokens: number;
  outputTokens: number;
  /** `null` when the model has no known price. */
  costUsd: number | null | undefined;
  retries: number;
  ok: boolean;
  errorKind?: string;
  error?: string;
  promptVersion?: string;
  system?: unknown;
  input?: unknown;
  schema?: unknown;
  response?: unknown;
  output?: unknown;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** An `llm` trace entry as a row, or undefined for any other kind. */
export function toLlmCall(entry: TraceEntryLike): LlmCall | undefined {
  if (entry.kind !== 'llm') return undefined;
  const d = (entry.data && typeof entry.data === 'object' ? entry.data : {}) as Record<
    string,
    unknown
  >;
  const usage = (d.usage && typeof d.usage === 'object' ? d.usage : {}) as Record<string, unknown>;
  const err = d.error;
  const cost = d.costUsd;
  return {
    seq: entry.seq,
    ts: entry.ts,
    stage: str(d.stage) ?? '?',
    provider: str(d.provider) ?? 'unknown',
    model: str(d.model),
    mode: d.mode === 'playback' ? 'playback' : 'live',
    latencyMs: typeof d.latencyMs === 'number' ? d.latencyMs : undefined,
    inputTokens: num(usage.inputTokens),
    outputTokens: num(usage.outputTokens),
    costUsd: typeof cost === 'number' ? cost : cost === null ? null : undefined,
    retries: num(d.retries),
    ok: d.ok !== false,
    errorKind: str(d.errorKind),
    error:
      typeof err === 'string'
        ? err
        : err && typeof err === 'object'
          ? str((err as Record<string, unknown>).message)
          : undefined,
    promptVersion: str(d.promptVersion),
    system: d.system,
    input: d.input,
    schema: d.schema,
    response: d.response,
    output: d.output,
  };
}

export interface LlmTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Calls whose cost is unknown (no price for the model, or nothing recorded). */
  unpriced: number;
  retries: number;
  errors: number;
}

export function totalsOf(calls: readonly LlmCall[]): LlmTotals {
  const t: LlmTotals = {
    calls: calls.length,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    unpriced: 0,
    retries: 0,
    errors: 0,
  };
  for (const c of calls) {
    t.inputTokens += c.inputTokens;
    t.outputTokens += c.outputTokens;
    t.retries += c.retries;
    if (!c.ok) t.errors++;
    if (typeof c.costUsd === 'number') t.costUsd += c.costUsd;
    else t.unpriced++;
  }
  return t;
}

export function formatCost(usd: number | null | undefined): string {
  if (typeof usd !== 'number') return 'n/a';
  return `$${usd < 1 ? usd.toFixed(4) : usd.toFixed(2)}`;
}

export function formatLatency(ms: number | undefined): string {
  if (ms === undefined) return '-';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** Whether a row matches the shared filter text (case-insensitive, over its headline fields). */
export function matchesFilter(c: LlmCall, text: string): boolean {
  const q = text.trim().toLowerCase();
  if (!q) return true;
  return [c.stage, c.provider, c.model, c.mode, c.ok ? 'ok' : 'error', c.errorKind, c.error]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(q);
}

/** A value as text for the detail view: strings as they are, anything else as indented JSON. */
export function pretty(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v, null, 2) ?? '';
  } catch {
    return String(v);
  }
}

/** Sections longer than this start collapsed. */
export const COLLAPSE_OVER = 400;

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

export class LlmPanel {
  private calls: LlmCall[] = [];
  private seen = new Set<number>();
  private filter = '';
  private selected: number | undefined;
  /** Seq of the call the detail view currently shows; it is only rebuilt when this changes. */
  private detailSeq: number | undefined;
  private readonly totals = el('div', undefined, 'llm-totals');
  private readonly table = el('table', undefined, 'llm-table');
  private readonly body = el('tbody');
  private readonly detail = el('div', undefined, 'llm-detail');

  constructor(private readonly root: HTMLElement) {
    const head = el('thead');
    const tr = el('tr');
    for (const h of [
      'time',
      'stage',
      'provider',
      'model',
      'latency',
      'tokens in/out',
      'cost',
      'retries',
      'status',
      'mode',
    ]) {
      tr.append(el('th', h));
    }
    head.append(tr);
    this.table.append(head, this.body);
    this.body.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('tr[data-seq]');
      if (row) this.select(Number(row.dataset.seq));
    });
    this.body.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = (e.target as HTMLElement).closest<HTMLElement>('tr[data-seq]');
      if (!row) return;
      e.preventDefault();
      this.select(Number(row.dataset.seq));
    });
    root.replaceChildren(this.totals, this.table, this.detail);
    this.render();
  }

  /** Forget everything, for a game switch. */
  reset(): void {
    this.calls = [];
    this.seen.clear();
    this.selected = undefined;
    this.render();
  }

  /** Add a trace entry; non-LLM kinds and entries already shown are ignored. */
  add(entry: TraceEntryLike): void {
    const call = toLlmCall(entry);
    if (!call || this.seen.has(call.seq)) return;
    this.seen.add(call.seq);
    this.calls.push(call);
    this.render();
  }

  setFilter(text: string): void {
    this.filter = text;
    this.render();
  }

  select(seq: number | undefined): void {
    this.selected = seq;
    this.render();
  }

  private render(): void {
    const t = totalsOf(this.calls);
    this.totals.textContent =
      `${t.calls} calls · ${t.inputTokens} in / ${t.outputTokens} out tokens · ` +
      `${formatCost(t.costUsd)}${t.unpriced ? ` (+${t.unpriced} unpriced)` : ''} · ` +
      `${t.retries} retries · ${t.errors} errors`;

    const rows = this.calls.filter((c) => matchesFilter(c, this.filter));
    if (!rows.length) {
      const p = el('p', this.calls.length ? 'No calls match the filter.' : 'No LLM calls yet.');
      p.className = 'empty';
      const tr = el('tr');
      const td = el('td');
      td.colSpan = 10;
      td.append(p);
      tr.append(td);
      this.body.replaceChildren(tr);
    } else {
      this.body.replaceChildren(
        ...rows.map((c) => {
          const tr = el('tr');
          tr.dataset.seq = String(c.seq);
          tr.tabIndex = 0;
          if (c.seq === this.selected) tr.setAttribute('aria-selected', 'true');
          if (!c.ok) tr.classList.add('bad');
          const cells = [
            new Date(c.ts).toLocaleTimeString(),
            c.stage,
            c.provider,
            c.model ?? '-',
            formatLatency(c.latencyMs),
            `${c.inputTokens} / ${c.outputTokens}`,
            formatCost(c.costUsd),
            String(c.retries),
            c.ok ? 'ok' : `error${c.errorKind ? `: ${c.errorKind}` : ''}`,
          ];
          for (const text of cells) tr.append(el('td', text));
          const mode = el('td');
          mode.append(el('span', c.mode, `badge ${c.mode}`));
          tr.append(mode);
          return tr;
        }),
      );
    }

    // A recorded call never changes, so keep the detail (open sections, scroll, text selection) while
    // live entries arrive; rebuild it only when a different call is shown.
    const sel = this.calls.find((c) => c.seq === this.selected);
    if (sel?.seq !== this.detailSeq) {
      this.detail.replaceChildren(...(sel ? this.detailOf(sel) : []));
      this.detailSeq = sel?.seq;
    }
  }

  private detailOf(c: LlmCall): HTMLElement[] {
    const out: HTMLElement[] = [
      el(
        'h2',
        `${c.stage} · ${c.provider}/${c.model ?? '?'} · ${c.mode}${
          c.promptVersion ? ` · prompt ${c.promptVersion}` : ''
        }`,
      ),
    ];
    if (!c.ok) {
      out.push(el('p', `${c.errorKind ?? 'error'}: ${c.error ?? 'call failed'}`, 'bad'));
    }
    const sections: [string, unknown][] = [
      ['system prompt', c.system],
      ['input', c.input],
      ['schema', c.schema],
      ['raw response', c.response],
      ['parsed result', c.output],
    ];
    for (const [title, value] of sections) {
      if (value === undefined) continue;
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
      out.push(d);
    }
    return out;
  }
}
