import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { spikeScenario } from './fixture';
import { detailFor, separate, type Detail } from './layout';
import { chiefOfStaffReport, enemyLabel, placeName, type Report } from './report';
import {
  Battle,
  CONTACT_M,
  clock,
  dist,
  stageOf,
  type Contact,
  type Order,
  type Point,
  type Stage,
  type Turn,
  type Unit,
  type Verb,
} from './sim';

/** The variants the spike compares; each is a query parameter so a screenshot can be taken of any of them. */
export interface Variants {
  /** `labels`: the current board's look (footprint boxes and name tags); `counters`: compact counters. */
  pieces: 'labels' | 'counters';
  trails: 'off' | 'on';
  /** `overlap`: units march into each other, as the engine lets them now; `line`: they stop at the contact line. */
  contact: 'overlap' | 'line';
  /** `ghost`: enemies as faint grey boxes, as now; `strong`: seen, last known and unknown drawn distinctly. */
  enemy: 'ghost' | 'strong';
}

const DEFAULTS: Variants = { pieces: 'counters', trails: 'on', contact: 'line', enemy: 'strong' };
const VERBS: Verb[] = ['move', 'hold', 'attack', 'withdraw', 'screen'];
const VERB_HELP: Record<Verb, string> = {
  move: 'Click the map to set where; shift-click to add a waypoint.',
  hold: 'Holds where it stands and fires at what comes into range.',
  attack: 'Click an enemy to close with it, or the map for a place to take.',
  withdraw: 'Click the map for where to fall back to; it does not stop to fight.',
  screen: 'Click the map for where to watch from; it gives ground to keep 500 m off.',
};
const ARM_NAME = { infantry: 'Infantry', cavalry: 'Cavalry', artillery: 'Artillery' } as const;
const STAGE_NAME = {
  fresh: 'Fresh',
  engaged: 'Engaged',
  losses: 'Taking losses',
  wavering: 'Wavering',
  broken: 'Broken',
} as const;

interface Piece {
  id: string;
  own: boolean;
  /** Seen this minute (always true for own units). */
  seen: boolean;
  /** Minutes since last seen. */
  age: number;
  arm: Unit['arm'];
  at: Point;
  true: Point;
  facing: number;
  name: string;
  short: string;
  stage: Stage;
  /** Own units only: strength share and morale. */
  strength?: number;
  morale?: number;
  size?: string;
}

/**
 * The board spike (#443) at `/spike/board`: a top-down 2D board over a small local simulation, no server. It tries the
 * answers to the owner's seven problems side by side; docs/board-spike.md records what was tried and what to keep.
 */
@Component({
  selector: 'ks-spike-board',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ks-theme', '(window:keydown.escape)': 'select(null)' },
  templateUrl: './spike-board.component.html',
  styleUrl: './spike-board.component.css',
})
export class SpikeBoardComponent {
  private readonly router = inject(Router);
  private readonly svg = viewChild<ElementRef<SVGSVGElement>>('board');

  readonly scenario = spikeScenario();
  readonly verbs = VERBS;
  readonly verbHelp = VERB_HELP;
  readonly armName = ARM_NAME;
  readonly stageName = STAGE_NAME;
  readonly clock = clock;
  readonly stageOf = stageOf;
  readonly placeName = placeName;
  readonly contactM = CONTACT_M;

  readonly variants = signal<Variants>({ ...DEFAULTS });
  /** Orders the player gave, by turn they were given for; replayed when a variant rebuilds the battle. */
  private readonly given = new Map<number, Record<string, Order>>();
  private battle = new Battle(this.scenario, { contactLine: true });
  /** Bumped when the battle advances, since the battle itself is not a signal. */
  private readonly version = signal(0);
  /** The turn on show; the latest unless the player scrubbed back. */
  readonly shown = signal(0);
  readonly selected = signal<string | null>(null);
  readonly hovered = signal<string | null>(null);
  /** The order being written for the selected unit, before it is given. */
  readonly draft = signal<Order | null>(null);
  readonly pending = signal<Record<string, Order>>({});
  readonly reportOpen = signal(true);
  readonly flash = signal<string | null>(null);
  /** The view in map metres: x, y, width (height follows the map's aspect). */
  readonly view = signal({ x: 0, y: 0, w: this.scenario.width });

  readonly turns = computed(() => {
    this.version();
    return [...this.battle.turns];
  });
  readonly latest = computed(() => this.turns().length - 1);
  readonly turn = computed<Turn>(() => this.turns()[Math.min(this.shown(), this.latest())]!);
  readonly prevTurn = computed<Turn>(() => this.turns()[Math.max(0, this.turn().n - 1)]!);
  readonly atLatest = computed(() => this.turn().n === this.latest());
  readonly detail = computed<Detail>(() => detailFor(this.view().w));
  readonly viewBox = computed(() => {
    const v = this.view();
    return `${v.x} ${v.y} ${v.w} ${(v.w * this.scenario.height) / this.scenario.width}`;
  });
  /** Counter size in metres, so counters keep one size on the screen whatever the zoom. */
  readonly cw = computed(() => this.view().w * 0.03);
  readonly ch = computed(() => this.cw() * 0.66);

  readonly report = computed<Report | null>(() =>
    this.turn().n === 0 ? null : chiefOfStaffReport(this.scenario, this.prevTurn(), this.turn()),
  );

  readonly pieces = computed<Piece[]>(() => {
    const t = this.turn();
    const v = this.variants();
    const own: Piece[] = t.units
      .filter((u) => u.side === 'blue')
      .map((u) => ({
        id: u.id,
        own: true,
        seen: true,
        age: 0,
        arm: u.arm,
        at: u.pos,
        true: u.pos,
        facing: u.facing,
        name: u.name,
        short: u.short,
        stage: stageOf(u),
        strength: u.strength / u.startStrength,
        morale: u.morale,
      }));
    const enemy: Piece[] = t.contacts.map((c) => ({
      id: c.id,
      own: false,
      seen: c.seenAt === t.to,
      age: t.to - c.seenAt,
      arm: c.arm,
      at: c.pos,
      true: c.pos,
      facing: c.facing,
      name: enemyLabel(c),
      short: `${c.letter} ${c.size[0]}–${c.size[1]}`,
      stage: c.stage,
      size: `${c.size[0]}–${c.size[1]}`,
    }));
    const all = [...own, ...enemy];
    if (v.pieces === 'labels') return all;
    const pin = new Set(this.selected() ? [this.selected()!] : []);
    const placed = separate(all, this.cw(), this.ch() * 1.5, pin);
    return all.map((p, i) => ({ ...p, at: placed[i]!.at }));
  });

  /** Pairs in contact, with the contact line drawn across the midpoint. */
  readonly contacts = computed(() => {
    const t = this.turn();
    const seen = new Set(t.contacts.filter((c) => c.seenAt === t.to).map((c) => c.id));
    const out: Array<{ key: string; mid: Point; angle: number; gap: number }> = [];
    for (const u of t.units) {
      if (u.side !== 'blue' || !u.contact || !seen.has(u.contact)) continue;
      const e = t.units.find((x) => x.id === u.contact)!;
      const mid = { x: (u.pos.x + e.pos.x) / 2, y: (u.pos.y + e.pos.y) / 2 };
      const angle = (Math.atan2(e.pos.y - u.pos.y, e.pos.x - u.pos.x) * 180) / Math.PI;
      out.push({ key: `${u.id}-${e.id}`, mid, angle, gap: dist(u.pos, e.pos) });
    }
    return out;
  });

  /** Own trails (where each unit went this turn) and seen enemy trails, as SVG point lists. */
  readonly trails = computed(() => {
    const t = this.turn();
    if (this.variants().trails === 'off' || t.n === 0) return [];
    const line = (pts: Point[]) => pts.map((p) => `${round(p.x)},${round(p.y)}`).join(' ');
    const out: Array<{ id: string; own: boolean; points: string; head: Point; angle: number }> = [];
    const add = (id: string, own: boolean, pts: Point[]) => {
      const metres = pts.slice(1).reduce((s, p, i) => s + dist(p, pts[i]!), 0);
      if (metres < 40) return;
      // The arrowhead sits on the end of the trail, turned along its last real stretch.
      const end = pts[pts.length - 1]!;
      const from = [...pts].reverse().find((p) => dist(p, end) > 5) ?? pts[0]!;
      const angle = (Math.atan2(end.y - from.y, end.x - from.x) * 180) / Math.PI;
      out.push({ id, own, points: line(pts), head: end, angle });
    };
    for (const u of t.units) if (u.side === 'blue') add(u.id, true, t.tracks[u.id]!);
    for (const [id, pts] of Object.entries(t.enemyTracks)) add(id, false, pts);
    return out;
  });

  readonly selectedOwn = computed(() => {
    const id = this.selected();
    return this.turn().units.find((u) => u.id === id && u.side === 'blue') ?? null;
  });
  readonly selectedEnemy = computed<Contact | null>(() => {
    const id = this.selected();
    return this.turn().contacts.find((c) => c.id === id) ?? null;
  });
  /** The order the selected unit is under or will be: the draft, else the one given for next turn, else its own. */
  readonly shownOrder = computed<Order | null>(() => {
    const u = this.selectedOwn();
    if (!u) return null;
    return this.draft() ?? this.pending()[u.id] ?? u.order;
  });
  /** The selected unit's route: from where it stands through its waypoints. */
  readonly route = computed(() => {
    const u = this.selectedOwn();
    const o = this.shownOrder();
    if (!u || !o) return null;
    let pts = o.waypoints;
    if (o.verb === 'attack' && o.target && pts.length === 0) {
      const c = this.turn().contacts.find((x) => x.id === o.target);
      if (c) pts = [c.pos];
    }
    if (pts.length === 0) return null;
    return {
      points: [u.pos, ...pts].map((p) => `${round(p.x)},${round(p.y)}`).join(' '),
      stops: pts,
      draft: this.draft() !== null || this.pending()[u.id] !== undefined,
    };
  });
  /** The newest line from the reports about the selected unit. */
  readonly lastWord = computed(() => {
    const u = this.selectedOwn();
    if (!u) return null;
    for (let i = this.turn().n; i > 0; i--) {
      const t = this.turns()[i]!;
      const e = [...t.events].reverse().find((x) => x.unit === u.id);
      if (e) return `${clock(e.minute)}: ${eventLine(e.kind, e.other ? this.nameOf(t, e.other) : '', e.metres, e.lost)}`;
    }
    return null;
  });

  readonly pendingCount = computed(() => Object.keys(this.pending()).length);
  readonly worldLabel = computed(() => `${clock(this.turn().from)}–${clock(this.turn().to)}`);

  private drag: { x: number; y: number; vx: number; vy: number; moved: boolean } | null = null;

  constructor() {
    const q = inject(ActivatedRoute).snapshot.queryParamMap;
    const pick = <K extends keyof Variants>(k: K, allowed: Variants[K][]): Variants[K] => {
      const v = q.get(k) as Variants[K] | null;
      return v && allowed.includes(v) ? v : DEFAULTS[k];
    };
    this.variants.set({
      pieces: pick('pieces', ['labels', 'counters']),
      trails: pick('trails', ['off', 'on']),
      contact: pick('contact', ['overlap', 'line']),
      enemy: pick('enemy', ['ghost', 'strong']),
    });
    this.rebuild();
    const turns = Math.min(8, Math.max(0, Number(q.get('turn') ?? 0) || 0));
    for (let i = 0; i < turns; i++) this.battle.play();
    this.version.update((n) => n + 1);
    this.shown.set(this.battle.turns.length - 1);
    const sel = q.get('select');
    if (sel) this.select(sel);
    const zoom = q.get('zoom');
    if (zoom) {
      const [x, y, w] = zoom.split(',').map(Number);
      if ([x, y, w].every((n) => Number.isFinite(n))) this.view.set({ x: x!, y: y!, w: w! });
    }
    if (q.get('report') === '0') this.reportOpen.set(false);
  }

  /** Make the battle again under the current rules and replay the orders given so far. */
  private rebuild(): void {
    const turns = this.battle.turns.length - 1;
    this.battle = new Battle(this.scenario, { contactLine: this.variants().contact === 'line' });
    for (let n = 1; n <= turns; n++) this.battle.play(this.given.get(n) ?? {});
    this.version.update((n) => n + 1);
  }

  setVariant<K extends keyof Variants>(k: K, v: Variants[K]): void {
    this.variants.update((s) => ({ ...s, [k]: v }));
    if (k === 'contact') this.rebuild();
    void this.router.navigate([], { queryParams: { [k]: v }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  select(id: string | null): void {
    this.selected.set(id);
    this.draft.set(null);
  }

  nameOf(t: Turn, id: string): string {
    const u = t.units.find((x) => x.id === id);
    if (u?.side === 'blue') return u.name;
    const c = t.contacts.find((x) => x.id === id);
    return c ? enemyLabel(c) : 'the enemy';
  }

  /** A click on a counter: select it, or make it the target of an attack being written. */
  clickPiece(ev: MouseEvent, p: Piece): void {
    ev.stopPropagation();
    if (this.drag?.moved) return;
    const d = this.draft();
    if (!p.own && d && d.verb === 'attack' && this.selectedOwn()) {
      this.draft.set({ ...d, target: p.id, waypoints: [] });
      return;
    }
    this.select(p.id === this.selected() ? null : p.id);
  }

  /** A click on the map: set or extend the destination of the order being written. */
  clickMap(ev: MouseEvent): void {
    if (this.drag?.moved) return;
    const u = this.selectedOwn();
    if (!u || !this.atLatest()) {
      this.select(null);
      return;
    }
    const o = this.draft() ?? { verb: 'move' as Verb, waypoints: [] };
    if (o.verb === 'hold') return;
    const at = this.toMap(ev);
    const waypoints = ev.shiftKey ? [...o.waypoints, at] : [at];
    this.draft.set({ ...o, waypoints, target: o.verb === 'attack' && ev.shiftKey ? o.target : undefined });
  }

  setVerb(v: Verb): void {
    const o = this.draft() ?? this.pending()[this.selected() ?? ''] ?? null;
    this.draft.set({ verb: v, waypoints: v === 'hold' ? [] : (o?.waypoints ?? []), target: v === 'attack' ? o?.target : undefined, note: o?.note });
  }

  setNote(note: string): void {
    const o = this.draft() ?? this.pending()[this.selected() ?? ''] ?? this.selectedOwn()?.order;
    if (o) this.draft.set({ ...o, note: note || undefined });
  }

  /** Hold the draft as this unit's order for the next turn. */
  giveOrder(): void {
    const u = this.selectedOwn();
    const d = this.draft();
    if (!u || !d) return;
    this.pending.update((p) => ({ ...p, [u.id]: d }));
    this.draft.set(null);
    this.flash.set(`Order for ${u.name} held for the next turn.`);
  }

  cancelDraft(): void {
    this.draft.set(null);
  }

  /** The structured intent the order becomes, as the umpire would receive it. */
  intent(o: Order): string {
    const parts: Record<string, unknown> = { verb: o.verb };
    if (o.target) parts['target'] = o.target;
    if (o.waypoints.length) parts['waypoints'] = o.waypoints.map((p) => [round(p.x), round(p.y)]);
    if (o.note) parts['note'] = o.note;
    return JSON.stringify(parts);
  }

  orderLine(o: Order): string {
    const where = o.waypoints.length ? placeName(this.scenario, o.waypoints[o.waypoints.length - 1]!) : '';
    const via = o.waypoints.length > 1 ? ` via ${o.waypoints.length - 1} waypoint${o.waypoints.length > 2 ? 's' : ''}` : '';
    switch (o.verb) {
      case 'hold':
        return 'Hold';
      case 'attack':
        return o.target ? `Attack ${this.nameOf(this.turn(), o.target)}` : `Attack, take ground ${where}${via}`;
      default:
        return `${o.verb[0]!.toUpperCase()}${o.verb.slice(1)} to ${where}${via}`;
    }
  }

  endTurn(): void {
    const n = this.battle.turns.length;
    const orders = this.pending();
    this.given.set(n, orders);
    this.battle.play(orders);
    this.pending.set({});
    this.draft.set(null);
    this.flash.set(null);
    this.version.update((v) => v + 1);
    this.shown.set(n);
    this.reportOpen.set(true);
  }

  step(by: number): void {
    this.shown.set(Math.max(0, Math.min(this.latest(), this.turn().n + by)));
  }

  /** Find a unit named in the report: select it and bring it into view. */
  find(id: string): void {
    this.select(id);
    const p = this.pieces().find((x) => x.id === id);
    if (!p) {
      this.flash.set('Not on the board: nothing is known of it now.');
      return;
    }
    const v = this.view();
    const h = (v.w * this.scenario.height) / this.scenario.width;
    const inside = p.at.x > v.x && p.at.x < v.x + v.w && p.at.y > v.y && p.at.y < v.y + h;
    if (!inside) this.view.set({ ...v, x: p.at.x - v.w / 2, y: p.at.y - h / 2 });
  }

  zoom(factor: number, around?: Point): void {
    const v = this.view();
    const w = Math.max(600, Math.min(this.scenario.width * 1.2, v.w * factor));
    const c = around ?? { x: v.x + v.w / 2, y: v.y + (v.w * this.scenario.height) / this.scenario.width / 2 };
    const k = w / v.w;
    this.view.set({ x: c.x - (c.x - v.x) * k, y: c.y - (c.y - v.y) * k, w });
  }

  resetView(): void {
    this.view.set({ x: 0, y: 0, w: this.scenario.width });
  }

  wheel(ev: WheelEvent): void {
    ev.preventDefault();
    this.zoom(ev.deltaY > 0 ? 1.15 : 1 / 1.15, this.toMap(ev));
  }

  down(ev: PointerEvent): void {
    const v = this.view();
    this.drag = { x: ev.clientX, y: ev.clientY, vx: v.x, vy: v.y, moved: false };
  }

  move(ev: PointerEvent): void {
    const d = this.drag;
    if (!d || ev.buttons === 0) return;
    const dx = ev.clientX - d.x;
    const dy = ev.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true;
    const k = this.metresPerPixel();
    this.view.update((v) => ({ ...v, x: d.vx - dx * k, y: d.vy - dy * k }));
  }

  up(): void {
    // A drag swallows the click that follows it; clear on the next tick so later clicks count.
    setTimeout(() => (this.drag = null));
  }

  private metresPerPixel(): number {
    const el = this.svg()?.nativeElement;
    return el ? this.view().w / el.getBoundingClientRect().width : 1;
  }

  private toMap(ev: MouseEvent): Point {
    const el = this.svg()?.nativeElement;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const v = this.view();
    const k = v.w / r.width;
    return { x: round(v.x + (ev.clientX - r.left) * k), y: round(v.y + (ev.clientY - r.top) * k) };
  }

  // Geometry for the template.
  readonly riverPoints = this.scenario.features.find((f) => f.kind === 'river')!.points.map((p) => `${p.x},${round(p.y)}`).join(' ');
  readonly roadPoints = this.scenario.features.find((f) => f.kind === 'road')!.points.map((p) => `${p.x},${round(p.y)}`).join(' ');
  readonly woodPoints = this.scenario.features.find((f) => f.kind === 'wood')!.points.map((p) => `${p.x},${p.y}`).join(' ');
  readonly bridge = this.scenario.features.find((f) => f.kind === 'bridge')!.points[0]!;

  deg(rad: number): number {
    return (rad * 180) / Math.PI;
  }

  /** The old look: the unit's footprint, a battalion line about 180 m by 40 m. */
  footprint(p: Piece): { w: number; h: number } {
    return p.arm === 'artillery' ? { w: 120, h: 40 } : p.arm === 'cavalry' ? { w: 140, h: 50 } : { w: 180, h: 40 };
  }

  /** The uncertainty ring of a last-known enemy: 12 m for every minute since it was seen, at most 300 m. */
  uncertainty(p: Piece): number {
    return Math.min(300, 40 + p.age * 12);
  }
}

function round(n: number): number {
  return Math.round(n);
}

function eventLine(kind: string, other: string, metres?: number, lost?: number): string {
  switch (kind) {
    case 'moved':
      return `moved ${metres} m`;
    case 'contact':
      return `in contact with ${other}`;
    case 'halted':
      return `halted at the contact line with ${other}`;
    case 'losses':
      return `lost ${lost} men`;
    case 'wavering':
      return 'wavering';
    case 'broken':
      return 'broke';
    default:
      return kind;
  }
}
