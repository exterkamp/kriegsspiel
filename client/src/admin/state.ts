/**
 * State panel (Epic #119, story 8.4): the true master state next to each side's `SideView`, with
 * every field that exists only in master state marked. Read-only; it renders what
 * `GET /admin/api/games/:id/state` returns and shares no code with the game client.
 */

type Rec = Record<string, unknown>;

export interface AdminState {
  id: string;
  clock?: { rate?: number; status?: string; [k: string]: unknown };
  staffAtWork?: { working: boolean; needAtMs?: number };
  engine: {
    time: number;
    rng: number;
    nextSeq: number;
    queue: { time: number; seq: number; type: string; payload: unknown }[];
    world: Rec & { units: Rec[]; seed?: number };
  };
  sideViews: Record<string, SideViewLike>;
}

export interface SideViewLike {
  side: string;
  atGame: number;
  ownUnits: Rec[];
  visibleEnemies: Rec[];
  [k: string]: unknown;
}

/**
 * Master unit field -> the field of the wire view that carries it. Anything absent here has no wire form.
 * Hand-kept: it must follow how `toSideView` in `server/src/api/sideView.ts` renames fields. A new wire
 * field reads as master only until it is added here. It tests presence, not value, so a field the view
 * carries with a fuzzed value still counts as seen.
 */
const WIRE_FIELD: Record<string, string> = {
  id: 'id',
  name: 'name',
  center: 'position',
  facing: 'facing',
  formation: 'formation',
  footprint: 'footprint',
  shape: 'shape',
  strength: 'strength',
  morale: 'morale',
};

/** World fields that exist only in master state (the views carry a filtered derivative of `intel`). */
export const MASTER_ONLY_WORLD = [
  'seed',
  'intel',
  'rulings',
  'combatActive',
  'sightFactor',
  'victory',
  'outcome',
] as const;

/** Top-level engine fields with no counterpart in any view. */
export const MASTER_ONLY_ENGINE = ['rng', 'queue', 'nextSeq'] as const;

export interface FieldExposure {
  field: string;
  value: unknown;
  /** Sides whose view carries this field for this unit. Empty: master only. */
  visibleTo: string[];
}

export interface UnitExposure {
  id: string;
  side: string;
  fields: FieldExposure[];
  /** Sides that have no entry for this unit at all (an unseen enemy). */
  unseenBy: string[];
}

function viewEntry(view: SideViewLike, id: string): Rec | undefined {
  return [...(view.ownUnits ?? []), ...(view.visibleEnemies ?? [])].find((u) => u.id === id);
}

/** For one master unit, which of its fields each side's view actually carries. */
export function unitExposure(unit: Rec, views: Record<string, SideViewLike>): UnitExposure {
  const entries = Object.entries(views).map(
    ([side, v]) => [side, viewEntry(v, String(unit.id))] as const,
  );
  const fields = Object.entries(unit).map(([field, value]) => ({
    field,
    value,
    visibleTo: entries
      .filter(([, e]) => {
        if (!e) return false;
        // `side` is implied by which list the unit sits in.
        if (field === 'side') return true;
        const wire = WIRE_FIELD[field];
        return wire !== undefined && wire in e;
      })
      .map(([side]) => side),
  }));
  return {
    id: String(unit.id),
    side: String(unit.side),
    fields,
    unseenBy: entries.filter(([, e]) => !e).map(([side]) => side),
  };
}

export function masterOnlyFields(x: UnitExposure): string[] {
  return x.fields.filter((f) => f.visibleTo.length === 0).map((f) => f.field);
}

const fmt = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v));

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

function badge(text: string): HTMLElement {
  return el('span', 'badge', text);
}

export class StatePanel {
  private filterText = '';

  constructor(private readonly root: HTMLElement) {
    this.root.replaceChildren(el('p', 'empty', 'No game selected.'));
  }

  setFilter(text: string): void {
    this.filterText = text.trim().toLowerCase();
    for (const card of this.root.querySelectorAll<HTMLElement>('.unit')) {
      card.hidden =
        !!this.filterText && !(card.textContent ?? '').toLowerCase().includes(this.filterText);
    }
  }

  /** Dims the panel: a refresh failed, so what is shown is the last good state, not the current one. */
  markStale(): void {
    this.root.dataset.stale = 'true';
  }

  showMessage(text: string): void {
    delete this.root.dataset.stale;
    this.root.replaceChildren(el('p', 'empty', text));
  }

  update(s: AdminState): void {
    delete this.root.dataset.stale;
    const { engine, sideViews } = s;
    const world = engine.world;
    const out: HTMLElement[] = [];

    const head = el('div', 'block');
    head.append(
      el('h2', undefined, 'Clock and engine'),
      this.kv('game time', `${engine.time} ms`),
      this.kv('clock', `×${s.clock?.rate ?? '?'} ${s.clock?.status ?? ''}`.trim()),
      this.kv(
        'LLM barrier',
        s.staffAtWork?.working ? `held at ${s.staffAtWork.needAtMs} ms (umpire working)` : 'none',
      ),
      this.kv('seed', String(world.seed), true),
      this.kv('rng state', String(engine.rng), true),
      this.kv('next seq', String(engine.nextSeq), true),
      this.kv('outcome', world.outcome ? fmt(world.outcome) : 'in progress', true),
    );
    out.push(head);

    const q = el('div', 'block');
    q.append(el('h2', undefined, `Event queue (${engine.queue.length})`));
    q.firstElementChild!.append(badge('master only'));
    const list = el('ol', 'queue');
    for (const ev of engine.queue.slice(0, 200)) {
      list.append(el('li', undefined, `${ev.time} ms  #${ev.seq}  ${ev.type}  ${fmt(ev.payload)}`));
    }
    if (engine.queue.length > 200)
      list.append(el('li', 'empty', `… ${engine.queue.length - 200} more`));
    q.append(list);
    out.push(q);

    const units = el('div', 'block');
    units.append(el('h2', undefined, `Units (${world.units.length})`));
    units.append(
      el('p', 'legend', 'Each field lists the sides whose view carries it. Amber: master only.'),
    );
    for (const u of world.units) units.append(this.unitCard(unitExposure(u, sideViews)));
    out.push(units);

    const views = el('div', 'block');
    views.append(el('h2', undefined, 'Side views (as sent to clients)'));
    const cols = el('div', 'cols');
    for (const [side, v] of Object.entries(sideViews)) {
      const col = el('div', 'col');
      col.append(
        el('h3', undefined, `${side} @ ${v.atGame} ms`),
        el('pre', undefined, JSON.stringify(v, null, 2)),
      );
      cols.append(col);
    }
    views.append(cols);
    out.push(views);

    const rest = el('div', 'block');
    rest.append(el('h2', undefined, 'Other master-only world state'));
    for (const key of MASTER_ONLY_WORLD) {
      if (key === 'seed' || key === 'outcome') continue;
      const d = el('details', 'masteronly');
      d.dataset.key = `world:${key}`;
      d.append(
        el('summary', undefined, key),
        el('pre', undefined, JSON.stringify(world[key], null, 2)),
      );
      d.querySelector('summary')!.append(badge('master only'));
      rest.append(d);
    }
    out.push(rest);

    // Keep open <details> across live refreshes. Inner scroll positions and text selection are not kept.
    const open = new Set(
      [...this.root.querySelectorAll<HTMLDetailsElement>('details[open]')].map(
        (d) => d.dataset.key,
      ),
    );
    this.root.replaceChildren(...out);
    for (const d of this.root.querySelectorAll<HTMLDetailsElement>('details')) {
      if (open.has(d.dataset.key)) d.open = true;
    }
    this.setFilter(this.filterText);
  }

  private kv(k: string, v: string, masterOnly = false): HTMLElement {
    const row = el('div', masterOnly ? 'kv master-only' : 'kv');
    row.append(el('span', 'k', k), el('span', 'v', v));
    if (masterOnly) row.append(badge('master only'));
    return row;
  }

  private unitCard(x: UnitExposure): HTMLElement {
    const d = el('details', 'unit');
    d.dataset.key = `unit:${x.id}`;
    d.dataset.side = x.side;
    const sum = el('summary', undefined, `${x.id} (${x.side})`);
    const hidden = masterOnlyFields(x).length;
    if (hidden) sum.append(badge(`${hidden} master-only fields`));
    for (const s of x.unseenBy) sum.append(badge(`unseen by ${s}`));
    d.append(sum);
    for (const f of x.fields) {
      const row = el('div', f.visibleTo.length ? 'field' : 'field master-only');
      row.dataset.field = f.field;
      row.append(
        el('span', 'k', f.field),
        el('span', 'v', fmt(f.value)),
        el('span', 'vis', f.visibleTo.length ? `seen by ${f.visibleTo.join(', ')}` : 'master only'),
      );
      d.append(row);
    }
    return d;
  }
}
