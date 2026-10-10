/**
 * A filterable, virtualised table of trace entries with a detail pane, shared by the Events and
 * Requests panels (Epic #119, story 8.5). Only the rows in view are in the DOM, so a
 * 10,000-entry game filters and scrolls without lag. Read-only.
 */
import {
  type EntryStore,
  type Row,
  type RowFilter,
  type TraceEntry,
  type TraceKind,
} from './entries.js';

export const ROW_HEIGHT = 20;
const OVERSCAN = 6;
/** Used where layout is unavailable (hidden panel, jsdom). */
const FALLBACK_VIEWPORT = 400;
export const ALL_KINDS: readonly TraceKind[] = [
  'request',
  'command',
  'engine',
  'clock',
  'error',
  'llm',
];

export interface Column {
  label: string;
  width: string;
  cell(row: Row): string;
}

export interface Control {
  id: string;
  label: string;
  type: 'select' | 'text' | 'number';
  /** Options for a select, read each time the list refreshes. */
  options?(store: EntryStore): string[];
  /** Fold the control's current value into the filter. Empty values are skipped. */
  apply(filter: RowFilter, value: string): void;
}

export interface PanelConfig {
  kinds: readonly TraceKind[];
  columns: readonly Column[];
  controls: readonly Control[];
  noun: string;
}

export class ListPanel {
  private readonly toolbar: HTMLElement;
  private readonly viewport: HTMLElement;
  private readonly spacer: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly count: HTMLElement;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly chip: HTMLElement;
  private readonly inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();

  private text = '';
  private correlationId: string | undefined;
  private paused = false;
  /** Highest seq shown when paused: later arrivals stay hidden, but filters still apply. */
  private frozenSeq: number | undefined;
  private rows: Row[] = [];
  private selected: TraceEntry | undefined;
  private shownInDetail: TraceEntry | undefined;
  private frame: number | undefined;
  private following = true;

  constructor(
    private readonly el: HTMLElement,
    private readonly store: EntryStore,
    private readonly config: PanelConfig,
  ) {
    el.innerHTML = `
      <div class="lp-toolbar"></div>
      <div class="lp-body">
        <div class="lp-list" tabindex="0" role="grid" aria-label="${config.noun}"><div class="lp-spacer"></div></div>
        <aside class="lp-detail" aria-live="polite"><p class="empty">Select a row to see its raw JSON and everything sharing its correlation id.</p></aside>
      </div>`;
    this.toolbar = el.querySelector('.lp-toolbar')!;
    this.viewport = el.querySelector('.lp-list')!;
    this.spacer = el.querySelector('.lp-spacer')!;
    this.detail = el.querySelector('.lp-detail')!;

    for (const c of config.controls) {
      const label = document.createElement('label');
      label.append(`${c.label} `);
      const input =
        c.type === 'select' ? document.createElement('select') : document.createElement('input');
      if (input instanceof HTMLInputElement) {
        input.type = c.type;
        input.size = c.type === 'number' ? 6 : 10;
      }
      input.dataset.control = c.id;
      input.setAttribute('aria-label', c.label);
      input.addEventListener('input', () => this.refresh());
      label.append(input);
      this.toolbar.append(label);
      this.inputs.set(c.id, input);
    }
    this.chip = document.createElement('span');
    this.chip.className = 'lp-chip';
    this.chip.hidden = true;
    this.pauseBtn = document.createElement('button');
    this.pauseBtn.type = 'button';
    this.pauseBtn.addEventListener('click', () => this.setPaused(!this.paused));
    this.count = document.createElement('small');
    this.count.setAttribute('role', 'status');
    this.toolbar.append(this.chip, this.pauseBtn, this.count);

    this.viewport.addEventListener('scroll', () => this.onScroll());
    this.viewport.addEventListener('keydown', (e) => this.onKey(e));
    this.refresh();
  }

  /** Free-text search from the shared filter bar. */
  setText(text: string): void {
    if (text === this.text) return;
    this.text = text;
    this.refresh();
  }

  /** Show only the entries sharing `id` (across all kinds), or lift the restriction. */
  setCorrelation(id: string | undefined): void {
    this.correlationId = id;
    this.chip.hidden = id === undefined;
    this.chip.replaceChildren();
    if (id !== undefined) {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.textContent = '×';
      clear.setAttribute('aria-label', 'Clear correlation filter');
      clear.addEventListener('click', () => this.setCorrelation(undefined));
      this.chip.append(`chain ${id.slice(0, 8)} `, clear);
    }
    this.refresh();
  }

  /** Forget everything shown, for a new game. */
  reset(): void {
    this.selected = undefined;
    this.shownInDetail = undefined;
    this.frozenSeq = undefined;
    this.paused = false;
    this.autoPaused = false;
    this.following = true;
    this.detail.innerHTML =
      '<p class="empty">Select a row to see its raw JSON and everything sharing its correlation id.</p>';
    this.setCorrelation(undefined);
  }

  /** Coalesces bursts of new entries into one render per frame. */
  refresh(): void {
    if (this.frame !== undefined) return;
    const run = () => {
      this.frame = undefined;
      this.renderNow();
    };
    this.frame =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(run)
        : (setTimeout(run, 0) as unknown as number);
  }

  /** Render synchronously (tests, and the first paint). */
  renderNow(): void {
    this.updateOptions();
    const live = this.store.filter(this.currentFilter());
    const cutoff = this.paused ? this.frozenSeq : undefined;
    this.rows = cutoff === undefined ? live : live.filter((r) => r.entry.seq <= cutoff);
    const fresh = live.length - this.rows.length;
    this.pauseBtn.textContent = this.paused ? `resume${fresh ? ` (${fresh} new)` : ''}` : 'pause';
    this.pauseBtn.setAttribute('aria-pressed', String(this.paused));
    this.count.textContent = `${this.rows.length.toLocaleString()} of ${this.store.size.toLocaleString()} entries`;
    this.spacer.style.height = `${this.rows.length * ROW_HEIGHT}px`;
    if (this.following && !this.paused) this.viewport.scrollTop = this.maxScroll();
    this.paint();
  }

  /** The rows currently in the table (after filters), for tests and callers. */
  get visibleRows(): readonly Row[] {
    return this.rows;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.autoPaused = false;
    this.paused = paused;
    this.frozenSeq = paused ? this.store.lastSeq : undefined;
    if (!paused) this.following = true;
    this.renderNow();
  }

  select(entry: TraceEntry | undefined): void {
    this.selected = entry;
    this.shownInDetail = entry;
    this.paint();
    this.paintDetail();
  }

  private currentFilter(): RowFilter {
    const f: RowFilter = {
      kinds: this.correlationId ? ALL_KINDS : this.config.kinds,
      correlationId: this.correlationId,
      text: this.text,
    };
    for (const c of this.config.controls) {
      const v = this.inputs.get(c.id)!.value.trim();
      if (v) c.apply(f, v);
    }
    return f;
  }

  /** Keep select options in step with the values seen so far, preserving the choice. */
  private updateOptions(): void {
    for (const c of this.config.controls) {
      if (c.type !== 'select' || !c.options) continue;
      const sel = this.inputs.get(c.id) as HTMLSelectElement;
      const opts = c.options(this.store);
      const have = [...sel.options].slice(1).map((o) => o.value);
      if (sel.options.length > 0 && have.join('\n') === opts.join('\n')) continue;
      const keep = sel.value;
      sel.replaceChildren(new Option('any', ''), ...opts.map((o) => new Option(o, o)));
      sel.value = opts.includes(keep) ? keep : '';
    }
  }

  private viewHeight(): number {
    return this.viewport.clientHeight || FALLBACK_VIEWPORT;
  }

  private maxScroll(): number {
    return Math.max(0, this.rows.length * ROW_HEIGHT - this.viewHeight());
  }

  private onScroll(): void {
    this.paintSoon();
    const atBottom = this.maxScroll() - this.viewport.scrollTop <= ROW_HEIGHT * 2;
    this.following = atBottom;
    // Scrolling up to read stops the list following the tail; scrolling back down resumes it.
    if (!atBottom && !this.paused) {
      this.setPaused(true);
      this.autoPaused = true;
    } else if (atBottom && this.paused && this.autoPaused) this.setPaused(false);
  }

  private autoPaused = false;
  private paintFrame: number | undefined;

  /** Scrolling only moves the window of rows; it does not need to re-filter. */
  private paintSoon(): void {
    if (this.paintFrame !== undefined) return;
    const run = () => {
      this.paintFrame = undefined;
      this.paint();
    };
    this.paintFrame =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(run)
        : (setTimeout(run, 0) as unknown as number);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const i = this.selected ? this.rows.findIndex((r) => r.entry === this.selected) : -1;
    const next =
      this.rows[Math.max(0, Math.min(this.rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    if (!next) return;
    this.select(next.entry);
    const top = this.rows.indexOf(next) * ROW_HEIGHT;
    if (top < this.viewport.scrollTop) this.viewport.scrollTop = top;
    else if (top + ROW_HEIGHT > this.viewport.scrollTop + this.viewHeight())
      this.viewport.scrollTop = top + ROW_HEIGHT - this.viewHeight();
    e.preventDefault();
  }

  private paint(): void {
    const top = this.viewport.scrollTop;
    const first = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN);
    const last = Math.min(
      this.rows.length,
      Math.ceil((top + this.viewHeight()) / ROW_HEIGHT) + OVERSCAN,
    );
    const nodes: HTMLElement[] = [];
    for (let i = first; i < last; i++) {
      const row = this.rows[i]!;
      const div = document.createElement('div');
      div.className = 'lp-row';
      div.setAttribute('role', 'row');
      div.dataset.seq = String(row.entry.seq);
      div.dataset.kind = row.entry.kind;
      div.style.top = `${i * ROW_HEIGHT}px`;
      if (row.entry === this.selected) div.setAttribute('aria-selected', 'true');
      div.addEventListener('click', () => this.select(row.entry));
      for (const col of this.config.columns) {
        const cell = document.createElement('span');
        cell.setAttribute('role', 'gridcell');
        cell.style.width = col.width;
        cell.textContent = col.cell(row);
        cell.title = cell.textContent;
        div.append(cell);
      }
      nodes.push(div);
    }
    this.spacer.replaceChildren(...nodes);
  }

  private paintDetail(): void {
    const entry = this.selected;
    if (!entry) return;
    const chain = this.store.chain(entry);
    const shown = this.shownInDetail ?? entry;
    this.detail.replaceChildren();
    const head = document.createElement('div');
    head.className = 'lp-detail-head';
    head.append(`#${shown.seq} · ${shown.kind} · `);
    const corr = document.createElement('code');
    corr.textContent = entry.correlationId;
    head.append(corr);
    if (chain.length > 1) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = `show chain in table (${chain.length})`;
      btn.addEventListener('click', () => this.setCorrelation(entry.correlationId));
      head.append(' ', btn);
    }
    const list = document.createElement('ol');
    list.className = 'lp-chain';
    list.setAttribute('aria-label', 'Correlated entries');
    for (const r of chain) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.seq = String(r.entry.seq);
      if (r.entry === shown) b.setAttribute('aria-current', 'true');
      b.textContent =
        `${r.entry.kind} ${r.type === r.entry.kind ? '' : r.type} ${r.summary}`.replace(
          /\s+/g,
          ' ',
        );
      b.addEventListener('click', () => {
        this.shownInDetail = r.entry;
        this.paintDetail();
      });
      li.append(b);
      list.append(li);
    }
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(shown, null, 2);
    this.detail.append(head, list, pre);
  }

  destroy(): void {
    if (this.frame !== undefined && typeof cancelAnimationFrame === 'function')
      cancelAnimationFrame(this.frame);
  }
}
