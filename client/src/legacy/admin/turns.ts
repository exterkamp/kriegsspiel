/**
 * Turn panel (D39, story 11.11): one turn of a turn-mode game at a time, as its log records it.
 * Read-only: it only GETs `/admin/api/games/:id/turns`, which rebuilds the turns from the input log
 * with no model call. Everything here is master state; no game client ever receives it.
 */
import { apiUrl, formatGameMs } from './model.js';

type Rec = Record<string, unknown>;

/** How long a burst of traced commands waits before one reload. */
const REFRESH_MS = 500;

interface Order {
  orderId: string;
  side?: string;
  to: string;
  text: string;
  courier?: string;
}

interface Ruling {
  id: string;
  unitId: string;
  field: string;
  proposed: unknown;
  applied: unknown;
  reason: string;
}

interface Call {
  stage: string;
  provider?: string;
  model: string;
  promptVersion: string;
  input: unknown;
  rawOutput: string;
  attempts: number;
  costUsd: number | null;
  canned?: boolean;
  fallbackFor?: { reason: string };
}

interface Journal {
  notes: { turn: number; note: string; condensed?: boolean }[];
  dropped?: number;
  precedents: { turn: number; ruling: string }[];
}

/** One turn as `GET /turns` returns it (`server/src/admin/turnView.ts`). */
export interface AdminTurn {
  n: number;
  startMs: number;
  endMs: number;
  endedAtMs: number;
  cause: string;
  adjudicator: string;
  error?: string;
  sent: string[];
  orders: Order[];
  unsent: Record<string, Order[]>;
  read?: { orderId: string; side: string; engineId: string; intents?: unknown[]; none?: string }[];
  couriers?: {
    orderId: string;
    outcome: string;
    atMs?: number;
    dueMs?: number;
    garbled?: boolean;
  }[];
  projection?: { events: string[]; units: Rec[]; outcome?: Rec };
  calls: Call[];
  proposal?: Rec;
  resent?: string[];
  rolls?: { id: string; why: string; chance: number; roll: number; success: boolean }[];
  refusedRolls?: string[];
  rulings: Ruling[];
  clampedUnits?: number;
  fallback?: { error: string; attempts: number };
  journal?: Journal;
}

export interface AdminTurns {
  mode: 'turns' | 'realtime';
  turns: AdminTurn[];
  open?: {
    n: number;
    startMs: number;
    endMs: number;
    held: Record<string, Order[]>;
    sent: string[];
  };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const json = (v: unknown) => JSON.stringify(v, null, 2);
const short = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

/** A model's raw reply, pretty-printed when it is JSON. */
function pretty(raw: string): string {
  try {
    return json(JSON.parse(raw));
  } catch {
    return raw;
  }
}

/** Who decided the turn, in the panel's words. */
export function decidedBy(t: AdminTurn): string {
  if (t.fallback) return 'tables (fallback)';
  if (t.adjudicator === 'engine') return 'tables';
  return t.adjudicator;
}

/** The one-line label of a turn in the list. */
export function turnLabel(t: AdminTurn): string {
  const parts = [
    `Turn ${t.n}`,
    `${formatGameMs(t.startMs)}–${formatGameMs(t.endedAtMs)}`,
    decidedBy(t),
  ];
  if (t.rulings.length)
    parts.push(`${t.rulings.length} ruling${t.rulings.length === 1 ? '' : 's'}`);
  if (t.rolls?.length) parts.push(`${t.rolls.length} roll${t.rolls.length === 1 ? '' : 's'}`);
  if (t.error) parts.push('not applied');
  return parts.join(' · ');
}

function badge(text: string, cls = 'state-badge'): HTMLElement {
  return el('span', cls, text);
}

function block(title: string, ...children: Node[]): HTMLElement {
  const b = el('div', 'block');
  b.append(el('h2', undefined, title), ...children);
  return b;
}

function kv(k: string, v: string): HTMLElement {
  const row = el('div', 'kv');
  row.append(el('span', 'k', k), el('span', 'v', v));
  return row;
}

function list(items: string[], empty: string, cls?: string): HTMLElement {
  const ol = el('ol', cls);
  for (const i of items) ol.append(el('li', undefined, i));
  if (items.length === 0) ol.append(el('li', 'empty', empty));
  return ol;
}

function details(title: string, body: string, key: string): HTMLDetailsElement {
  const d = el('details');
  d.dataset.key = key;
  d.append(el('summary', undefined, title), el('pre', undefined, body));
  return d;
}

function orderLine(o: Order): string {
  return `${o.side ? `${o.side} ` : ''}${o.orderId} → ${o.to}${o.courier ? ` (${o.courier})` : ''}: ${o.text}`;
}

export class TurnsPanel {
  private gameId: string | undefined;
  private data: AdminTurns | undefined;
  /** The turn shown: a turn number, `open` for the turn being played, or the latest when unset. */
  private selected: number | 'open' | undefined;
  private request = 0;
  private readonly status: HTMLElement;
  private readonly picker: HTMLElement;
  private readonly out: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly token: () => string | undefined,
    private readonly fetchFn: typeof fetch,
  ) {
    root.innerHTML = `
      <p class="legend">Every turn as the log records it: master state, never sent to a side.</p>
      <p class="empty" role="status"></p>
      <div class="turn-picker ks-cluster" role="group" aria-label="Turns"></div>
      <div class="turn-detail"></div>`;
    this.status = root.querySelector('.empty')!;
    this.picker = root.querySelector('.turn-picker')!;
    this.out = root.querySelector('.turn-detail')!;
    this.picker.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-turn]');
      if (!b) return;
      this.selected = b.dataset.turn === 'open' ? 'open' : Number(b.dataset.turn);
      this.render();
    });
    this.status.textContent = 'No game selected.';
  }

  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  /** A command was traced (a turn may have opened, been sent or resolved): reload soon, once. */
  notify(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.setGame(this.gameId, true);
    }, REFRESH_MS);
  }

  stop(): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
  }

  /** Point the panel at a game (or none) and load its turns; `reload` refetches a loaded one. */
  async setGame(id: string | undefined, reload = false): Promise<void> {
    if (id === this.gameId && this.data && !reload) return;
    if (id !== this.gameId) this.selected = undefined;
    this.gameId = id;
    if (!id) {
      this.data = undefined;
      this.status.textContent = 'No game selected.';
      this.render();
      return;
    }
    if (!this.data) this.status.textContent = 'Loading turns…';
    const ticket = ++this.request;
    try {
      const res = await this.fetchFn(apiUrl(`games/${encodeURIComponent(id)}/turns`, this.token()));
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as AdminTurns;
      if (ticket !== this.request) return;
      this.data = body;
      this.status.textContent =
        body.mode === 'turns'
          ? `${body.turns.length} turns resolved · rebuilt from the input log, no model calls`
          : 'A real-time game has no turns.';
      this.render();
    } catch {
      if (ticket !== this.request) return;
      this.data = undefined;
      this.status.textContent = 'The turns of this game cannot be read.';
      this.render();
    }
  }

  private current(): AdminTurn | 'open' | undefined {
    const d = this.data;
    if (!d) return undefined;
    if (this.selected === 'open' && d.open) return 'open';
    return (
      d.turns.find((t) => t.n === this.selected) ?? d.turns.at(-1) ?? (d.open ? 'open' : undefined)
    );
  }

  private render(): void {
    const d = this.data;
    const shown = this.current();
    this.picker.replaceChildren();
    if (d) {
      for (const t of d.turns) {
        const b = el('button', 'ks-btn', turnLabel(t));
        b.type = 'button';
        b.dataset.turn = String(t.n);
        b.dataset.adjudicator = t.fallback ? 'fallback' : t.adjudicator;
        b.setAttribute('aria-pressed', String(shown !== 'open' && shown?.n === t.n));
        this.picker.append(b);
      }
      if (d.open) {
        const b = el('button', 'ks-btn', `Turn ${d.open.n} · open`);
        b.type = 'button';
        b.dataset.turn = 'open';
        b.setAttribute('aria-pressed', String(shown === 'open'));
        this.picker.append(b);
      }
    }
    // Keep open <details> across reloads, as the State panel does.
    const open = new Set(
      [...this.out.querySelectorAll<HTMLDetailsElement>('details[open]')].map((x) => x.dataset.key),
    );
    if (!d || !shown) this.out.replaceChildren();
    else if (shown === 'open') this.out.replaceChildren(...this.openTurn(d.open!));
    else this.out.replaceChildren(...this.turn(shown));
    for (const x of this.out.querySelectorAll<HTMLDetailsElement>('details')) {
      if (open.has(x.dataset.key)) x.open = true;
    }
  }

  private openTurn(o: NonNullable<AdminTurns['open']>): HTMLElement[] {
    const head = block(`Turn ${o.n} (open)`);
    head.querySelector('h2')!.append(badge('master only'));
    head.append(
      kv('game time', `${formatGameMs(o.startMs)}–${formatGameMs(o.endMs)}`),
      kv('sent', o.sent.length ? o.sent.join(', ') : 'nobody yet'),
    );
    const held = Object.entries(o.held).flatMap(([side, orders]) =>
      orders.map((x) => `${orderLine({ ...x, side })}${o.sent.includes(side) ? ' (sent)' : ''}`),
    );
    return [head, block('Held orders', list(held, 'None held.', 'turn-orders'))];
  }

  private turn(t: AdminTurn): HTMLElement[] {
    const key = (s: string) => `${t.n}:${s}`;
    const out: HTMLElement[] = [];

    const head = block(`Turn ${t.n}`);
    head.querySelector('h2')!.append(badge('master only'));
    head.append(
      kv('game time', `${formatGameMs(t.startMs)}–${formatGameMs(t.endMs)}`),
      kv('closed by', t.cause === 'all-sent' ? 'every side sent' : 'the deadline'),
      kv('sent', t.sent.length ? t.sent.join(', ') : 'nobody'),
      kv('decided by', decidedBy(t)),
    );
    if (t.endedAtMs !== t.endMs) head.append(kv('game ended', formatGameMs(t.endedAtMs)));
    if (t.error) {
      const e = kv('not applied', t.error);
      e.classList.add('bad');
      head.append(e);
    }
    out.push(head);

    // The fallback first: it decides how to read the rest.
    const fb = block('Fallback');
    fb.classList.add('turn-fallback');
    if (t.fallback) {
      fb.append(kv('reason', t.fallback.error), kv('attempts', String(t.fallback.attempts)));
      fb.dataset.state = 'fell-back';
    } else fb.append(el('p', 'empty', 'None: the turn was decided as the dial asks.'));
    out.push(fb);

    const read = new Map((t.read ?? []).map((r) => [`${r.side}:${r.orderId}`, r]));
    const orders = t.orders.map((o) => {
      const r = read.get(`${o.side}:${o.orderId}`);
      const rules = r
        ? r.none
          ? `rules: no new order (${r.none})`
          : `rules: ${short(r.intents)}`
        : '';
      return `${orderLine(o)}${rules ? `  ⟶ ${rules}` : ''}`;
    });
    const unsent = Object.entries(t.unsent).flatMap(([side, os]) =>
      os.map((o) => `${orderLine({ ...o, side })} (held, not sent)`),
    );
    out.push(block('Held orders', list([...orders, ...unsent], 'No orders sent.', 'turn-orders')));

    if (t.couriers) {
      const lines = t.couriers.map((c) => {
        const when =
          c.atMs !== undefined
            ? ` at ${formatGameMs(c.atMs)}`
            : c.dueMs !== undefined
              ? `, due ${formatGameMs(c.dueMs)}`
              : '';
        return `${c.orderId}: ${c.outcome}${when}${c.garbled ? ' (garbled)' : ''}`;
      });
      out.push(block('Couriers', list(lines, 'No courier rode.', 'turn-couriers')));
    }

    if (t.projection) {
      const p = block(
        'Projection',
        list(t.projection.events, 'Nothing happened in the projection.', 'turn-events'),
        details('Projected units', json(t.projection.units), key('projection')),
      );
      if (t.projection.outcome) p.append(kv('outcome', short(t.projection.outcome)));
      out.push(p);
    }

    const calls = block('Adjudicate input and output');
    if (t.calls.length === 0) calls.append(el('p', 'empty', 'No model call: the tables decided.'));
    t.calls.forEach((c, i) => {
      const cost = c.costUsd === null ? 'price unknown' : `$${c.costUsd.toFixed(4)}`;
      const tags = [
        c.provider,
        c.model,
        c.promptVersion,
        `${c.attempts} attempt${c.attempts === 1 ? '' : 's'}`,
        cost,
      ]
        .filter(Boolean)
        .join(' · ');
      const d = el('details', 'turn-call');
      d.dataset.key = key(`call${i}`);
      const sum = el('summary', undefined, `${i + 1}. ${c.stage} · ${tags}`);
      if (c.canned) sum.append(badge('canned', 'badge playback'));
      if (c.fallbackFor) sum.append(badge(`fallback: ${c.fallbackFor.reason}`, 'badge fallback'));
      d.append(sum, el('h3', undefined, 'Input'), el('pre', undefined, json(c.input)));
      d.append(el('h3', undefined, 'Output'), el('pre', undefined, pretty(c.rawOutput)));
      calls.append(d);
    });
    if (t.proposal)
      calls.append(details('Final proposal (as applied)', json(t.proposal), key('proposal')));
    if (t.resent?.length) {
      calls.append(
        el('h3', undefined, 'Problems sent back with the resend'),
        list(t.resent, '', 'turn-resent'),
      );
    }
    out.push(calls);

    const rolls = (t.rolls ?? []).map(
      (r) =>
        `${r.id}: ${r.why} — ${Math.round(r.chance * 100)}% asked, drew ${r.roll.toFixed(3)}: ${r.success ? 'success' : 'failure'}`,
    );
    const dice = block('Rolls', list(rolls, 'No roll made.', 'turn-rolls'));
    if (t.refusedRolls?.length) {
      dice.append(el('h3', undefined, 'Refused'), list(t.refusedRolls, '', 'turn-refused'));
    }
    out.push(dice);

    const rulings = block(`Clamps and rulings (${t.rulings.length})`);
    if (t.clampedUnits !== undefined) rulings.append(kv('units clamped', String(t.clampedUnits)));
    if (t.rulings.length === 0) rulings.append(el('p', 'empty', 'No correction.'));
    else {
      const table = el('table', 'llm-table turn-rulings');
      const headRow = el('tr');
      for (const h of ['unit', 'field', 'proposed', 'applied', 'reason'])
        headRow.append(el('th', undefined, h));
      table.append(el('thead'), el('tbody'));
      table.tHead!.append(headRow);
      for (const r of t.rulings) {
        const row = el('tr');
        row.dataset.ruling = r.id;
        for (const v of [r.unitId, r.field, short(r.proposed), short(r.applied), r.reason]) {
          row.append(el('td', undefined, v));
        }
        table.tBodies[0]!.append(row);
      }
      const wrap = el('div', 'turn-table');
      wrap.append(table);
      rulings.append(wrap);
    }
    out.push(rulings);

    const j = t.journal;
    const journal = block("Umpire's journal after this turn");
    if (!j) journal.append(el('p', 'empty', 'No journal yet: no umpire turn so far.'));
    else {
      if (j.dropped)
        journal.append(
          el('p', 'legend', `${j.dropped} older notes dropped to keep it under its cap.`),
        );
      journal.append(
        el('h3', undefined, 'Notes'),
        list(
          j.notes.map((n) => `Turn ${n.turn}${n.condensed ? ' (condensed)' : ''}: ${n.note}`),
          'No notes.',
          'journal-notes',
        ),
        el('h3', undefined, 'Precedents'),
        list(
          j.precedents.map((p) => `Turn ${p.turn}: ${p.ruling}`),
          'None set.',
          'journal-precedents',
        ),
      );
    }
    out.push(journal);
    return out;
  }
}
