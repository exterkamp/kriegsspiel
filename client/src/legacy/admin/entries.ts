/**
 * Pure model for the Events and Requests panels (Epic #119, story 8.5): a store of trace entries
 * with precomputed rows, filtering and correlation lookup. The DOM wiring lives in `listPanel.ts`.
 * Entries arrive already redacted from the admin API; nothing here talks to a game client.
 */

export type TraceKind = 'request' | 'command' | 'engine' | 'clock' | 'error' | 'llm' | 'order';

/** Mirrors the server's `TraceEntry`. */
export interface TraceEntry {
  seq: number;
  ts: number;
  gameId: string;
  correlationId: string;
  kind: TraceKind;
  data: unknown;
}

export interface Row {
  entry: TraceEntry;
  /** Game time in ms (engine events only). */
  gameMs?: number;
  /** The event type, or the HTTP method / WebSocket message type for a request. */
  type: string;
  unit?: string;
  side?: string;
  summary: string;
  /** Lower-cased text the search box matches against. */
  search: string;
}

/** Correlation id the server uses when no request caused the entry; it links nothing. */
export const NO_CORRELATION = 'none';

const SUMMARY_MAX = 140;

function record(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : undefined;
}

function compact(v: unknown): string {
  let s: string;
  try {
    s = JSON.stringify(v) ?? '';
  } catch {
    s = String(v);
  }
  return s.length > SUMMARY_MAX ? `${s.slice(0, SUMMARY_MAX - 1)}…` : s;
}

/** Derive the table columns for one entry. */
export function toRow(entry: TraceEntry): Row {
  const d = record(entry.data);
  let type: string = entry.kind;
  let gameMs: number | undefined;
  let summary: string;
  let unit: string | undefined;
  let side: string | undefined;
  if (entry.kind === 'engine') {
    type = str(d.type) ?? 'event';
    gameMs = typeof d.time === 'number' ? d.time : undefined;
    const payload = record(d.payload);
    unit = str(payload.unitId) ?? str(payload.unit);
    side = str(payload.side);
    summary = compact(d.payload);
  } else if (entry.kind === 'request') {
    type = str(d.method) ?? 'request';
    summary = `${str(d.path) ?? ''} ${d.ok === false ? 'FAILED' : 'ok'}`.trim();
  } else {
    summary = compact(entry.data);
  }
  // Search the whole payload, not the truncated summary, so a late field still matches.
  const search =
    `${entry.kind} ${type} ${entry.correlationId} ${safeJson(entry.data)}`.toLowerCase();
  return { entry, gameMs, type, unit, side, summary, search };
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return '';
  }
}

export interface RowFilter {
  /** Entry kinds to include. */
  kinds: readonly TraceKind[];
  /** Exact `type` (event type, or method for requests). */
  type?: string;
  /** Substring of the unit id. */
  unit?: string;
  side?: string;
  /** Game-time window in ms, inclusive (engine events). */
  fromMs?: number;
  toMs?: number;
  /** Requests: `http` or `ws`. */
  transport?: string;
  /** Requests: only successful (`ok`) or failed (`error`). */
  outcome?: 'ok' | 'error';
  /** Requests: slowest-only threshold in ms. */
  minDurationMs?: number;
  /** Restrict to one correlation id. */
  correlationId?: string;
  /** Free text; every whitespace-separated word must appear. */
  text?: string;
}

export function matches(row: Row, f: RowFilter, words: readonly string[]): boolean {
  const e = row.entry;
  if (!f.kinds.includes(e.kind)) return false;
  if (f.correlationId && e.correlationId !== f.correlationId) return false;
  if (f.type && row.type !== f.type) return false;
  if (f.side && row.side !== f.side) return false;
  if (f.unit && !(row.unit ?? '').toLowerCase().includes(f.unit.toLowerCase())) return false;
  if (f.fromMs !== undefined && (row.gameMs === undefined || row.gameMs < f.fromMs)) return false;
  if (f.toMs !== undefined && (row.gameMs === undefined || row.gameMs > f.toMs)) return false;
  if (e.kind === 'request') {
    const d = record(e.data);
    if (f.transport && d.transport !== f.transport) return false;
    if (f.outcome && (d.ok === false) !== (f.outcome === 'error')) return false;
    if (f.minDurationMs !== undefined && !(Number(d.durationMs) >= f.minDurationMs)) return false;
  }
  for (const w of words) if (!row.search.includes(w)) return false;
  return true;
}

export class EntryStore {
  private readonly all: Row[] = [];
  private readonly seen = new Set<number>();
  private readonly byCorrelation = new Map<string, Row[]>();
  private maxSeq = 0;

  get size(): number {
    return this.all.length;
  }

  /** Highest `seq` held; a reopened stream resumes after it. */
  get lastSeq(): number {
    return this.maxSeq;
  }

  /** Add an entry. Returns false for a duplicate (a reconnecting stream replays the backlog). */
  add(entry: TraceEntry): boolean {
    if (this.seen.has(entry.seq)) return false;
    this.seen.add(entry.seq);
    const row = toRow(entry);
    this.all.push(row);
    if (entry.seq > this.maxSeq) this.maxSeq = entry.seq;
    if (entry.correlationId !== NO_CORRELATION) {
      const chain = this.byCorrelation.get(entry.correlationId);
      if (chain) chain.push(row);
      else this.byCorrelation.set(entry.correlationId, [row]);
    }
    return true;
  }

  clear(): void {
    this.all.length = 0;
    this.seen.clear();
    this.byCorrelation.clear();
    this.maxSeq = 0;
  }

  /** Distinct values of a column among rows of the given kinds, sorted, for filter dropdowns. */
  distinct(kinds: readonly TraceKind[], column: 'type' | 'side'): string[] {
    const out = new Set<string>();
    for (const r of this.all) {
      const v = r[column];
      if (v && kinds.includes(r.entry.kind)) out.add(v);
    }
    return [...out].sort();
  }

  filter(f: RowFilter): Row[] {
    const words = (f.text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    return this.all.filter((r) => matches(r, f, words));
  }

  /** Everything that shares the entry's correlation id, in arrival order; just the entry if it has none. */
  chain(entry: TraceEntry): Row[] {
    const linked =
      entry.correlationId === NO_CORRELATION
        ? undefined
        : this.byCorrelation.get(entry.correlationId);
    return linked ? [...linked].sort((a, b) => a.entry.seq - b.entry.seq) : [toRow(entry)];
  }
}

/** `mm:ss` of game time, hours when needed. */
export function formatGameTime(ms: number | undefined): string {
  if (ms === undefined) return '';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function formatWallTime(ts: number): string {
  return new Date(ts).toISOString().slice(11, 23);
}

export function formatBytes(n: unknown): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} kB`;
}
