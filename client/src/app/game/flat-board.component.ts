import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { Mark } from '@kriegsspiel/protocol';
import { battlefieldPoints } from '@legacy/table/battlefieldMap';
import { dashPolyline } from '@legacy/table/dash';
import {
  arrowHead,
  longSide,
  pieceCorners,
  pointsAttr,
  screenToMap,
  stackLabels,
} from '@legacy/table/flatBoard';
import { pieceAtPoint } from '@legacy/table/picking';
import { markAgeFactor } from '@legacy/table/marks';
import { buildSceneState } from '@legacy/table/sceneState';
import type { BaseFeature, BaseMap, SceneState } from '@legacy/table/types';
import {
  GLIDE_MS,
  NO_GLIDES,
  drawnAt,
  gliding,
  nextGlides,
  type GlideState,
} from '@legacy/table/glide';
import type { PickResult } from '@legacy/table/picking';
import { boardLines } from '@legacy/table/boardText';
import { buildWindowScene } from '@legacy/window/model';
import { DeskStore } from '../desk/desk.store';
import { GameService } from './game.service';
import { MarksService, type Picker } from './marks.service';

/**
 * A flat, top-down board for when the browser cannot make a WebGL context (#343): the river, bridge and woods, the
 * side's units with their facing, the enemy it knows of, order arrows, dotted planned routes and the player's marks.
 * It reads the same scene state as the 3D table and takes the same mark tools, so orders and marks can still be given
 * by picking places on it. SVG in map metres (x east, y south); all colours come from the design tokens.
 */
@Component({
  selector: 'ks-flat-board',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ks-theme' },
  template: `
    @for (map of maps(); track map) {
      <svg
        #svg
        role="img"
        aria-label="Flat map board. The units on it are listed in the map summary."
        aria-describedby="board-summary"
        preserveAspectRatio="xMidYMid meet"
        [attr.viewBox]="'0 0 ' + map.width + ' ' + map.height"
        [style.font-size.px]="fontSize"
        (pointerdown)="marks.pointerDown(picker(map), svg, $event)"
        (pointermove)="marks.pointerMove(picker(map), $event)"
        (pointerup)="marks.pointerUp(picker(map), $event)"
        (pointercancel)="marks.pointerCancel()"
      >
        <rect class="ground" x="0" y="0" [attr.width]="map.width" [attr.height]="map.height" />
        @for (f of map.features; track f.id) {
          @switch (f.geometry.shape) {
            @case ('polygon') {
              <polygon
                [class]="'feature ' + f.kind"
                [attr.points]="terrainPoints(f, f.geometry.points)"
              />
            }
            @case ('polyline') {
              <polyline
                [class]="'feature ' + f.kind"
                [attr.points]="terrainPoints(f, f.geometry.points)"
                [attr.stroke-width]="f.geometry.width"
                [class.native]="f.layer !== undefined"
              />
            }
            @case ('point') {
              <circle
                [class]="'feature ' + f.kind"
                [attr.cx]="f.geometry.at.x"
                [attr.cy]="f.geometry.at.y"
                [attr.r]="f.geometry.radius"
              />
            }
          }
        }
        @for (g of ghosts(); track g.id) {
          @if (g.uncertaintyRadius > 0) {
            <circle
              class="uncertainty"
              [class.hidden]="!marks.overlays().lastKnown"
              [attr.cx]="g.position.x"
              [attr.cy]="g.position.y"
              [attr.r]="g.uncertaintyRadius"
            />
          }
        }
        @for (r of routes(); track r.id) {
          @if (r.kind === 'order') {
            <polyline
              class="order"
              [attr.points]="pts(r.points)"
              [attr.stroke-width]="stroke * 2"
            />
            <polygon class="order-head" [attr.points]="pts(head(r.points))" />
          } @else {
            @for (d of dashes(r.points); track $index) {
              <polyline class="route" [attr.points]="pts(d)" [attr.stroke-width]="stroke * 5" />
            }
            <circle
              class="route-end"
              [attr.cx]="r.points[r.points.length - 1]!.x"
              [attr.cy]="r.points[r.points.length - 1]!.y"
              [attr.r]="fontSize * 0.45"
            />
          }
        }
        @for (c of couriers(); track c.id) {
          <g class="courier" [attr.data-courier]="c.id">
            <circle [attr.cx]="c.position.x" [attr.cy]="c.position.y" [attr.r]="fontSize * 0.6" />
            <text [attr.x]="c.position.x" [attr.y]="c.position.y - fontSize * 1">
              {{ c.etaMin > 0 ? 'Courier, ' + c.etaMin + ' min' : 'Courier' }}
            </text>
          </g>
        }
        @for (p of own(); track p.id) {
          <polygon class="piece own" [attr.points]="pts(corners(p))" />
          <line
            class="front own"
            [attr.x1]="corners(p)[0]!.x"
            [attr.y1]="corners(p)[0]!.y"
            [attr.x2]="corners(p)[1]!.x"
            [attr.y2]="corners(p)[1]!.y"
            [attr.stroke-width]="stroke * 3"
          />
        }
        @for (p of ghosts(); track p.id) {
          <polygon
            class="piece enemy"
            [class.stale]="p.ageMs > 0"
            [attr.points]="pts(corners(p))"
          />
        }
        @for (f of fights(); track f.id) {
          <circle
            class="fight"
            [attr.cx]="f.position.x"
            [attr.cy]="f.position.y"
            [attr.r]="fontSize * 1.4"
            [attr.stroke-width]="stroke * 2"
          />
        }
        @for (m of markList(); track m.mark.id) {
          <g
            class="mark"
            [class.selected]="m.mark.id === marks.selectedId()"
            [style.opacity]="m.fade"
          >
            @switch (m.mark.kind) {
              @case ('pin') {
                <circle [attr.cx]="m.mark.at.x" [attr.cy]="m.mark.at.y" [attr.r]="stroke * 5" />
              }
              @case ('line') {
                <polyline [attr.points]="pts(m.mark.points)" [attr.stroke-width]="stroke * 2" />
              }
              @case ('arrow') {
                <line
                  [attr.x1]="m.mark.from.x"
                  [attr.y1]="m.mark.from.y"
                  [attr.x2]="m.mark.to.x"
                  [attr.y2]="m.mark.to.y"
                  [attr.stroke-width]="stroke * 2"
                />
                <polygon class="mark-head" [attr.points]="pts(head([m.mark.from, m.mark.to]))" />
              }
              @case ('ring') {
                <circle
                  class="ring"
                  [attr.cx]="m.mark.at.x"
                  [attr.cy]="m.mark.at.y"
                  [attr.r]="m.mark.radius"
                  [attr.stroke-width]="stroke * 2"
                />
              }
            }
          </g>
        }
        @for (t of tags(); track t.id) {
          <text class="tag" [class.enemy]="t.enemy" [attr.x]="t.at.x" [attr.y]="t.at.y">
            {{ t.text }}
          </text>
        }
      </svg>
      <ul id="board-summary" class="ks-sr-only" aria-label="Map summary">
        @for (line of summary(); track $index) {
          <li>{{ line }}</li>
        }
      </ul>
    }
  `,
  styles: `
    :host {
      display: block;
      position: absolute;
      inset: 0;
      background: var(--ks-table);
    }
    svg {
      display: block;
      width: 100%;
      height: 100%;
      touch-action: none;
      font-family: var(--ks-font);
      /* Keep the map's south edge, and a courier's label near it, clear of the desk bar (#364). */
      box-sizing: border-box;
      padding-bottom: 3.5rem;
    }
    @media (max-width: 600px) {
      svg {
        padding-bottom: 8.5rem;
      }
    }
    .ground {
      fill: var(--ks-map-ground);
    }
    .feature {
      stroke-linecap: butt;
      stroke-linejoin: round;
    }
    polyline.feature.native {
      stroke-linecap: round;
    }
    polygon.wood {
      fill: var(--ks-map-wood);
    }
    polygon.marsh {
      fill: var(--ks-map-marsh);
    }
    polygon.water {
      fill: var(--ks-map-water);
    }
    polygon.field {
      fill: var(--ks-map-ground);
    }
    polyline.feature {
      fill: none;
    }
    polyline.river,
    polyline.stream {
      stroke: var(--ks-map-water);
    }
    polyline.road {
      stroke: var(--ks-map-road);
    }
    circle.bridge,
    circle.ford,
    circle.building {
      fill: var(--ks-map-road);
      stroke: var(--ks-ink);
      stroke-width: 8;
    }
    .uncertainty {
      fill: var(--ks-map-enemy);
      fill-opacity: 0.15;
      stroke: var(--ks-map-enemy);
      stroke-dasharray: 30 20;
      stroke-width: 6;
    }
    .hidden {
      display: none;
    }
    .order {
      fill: none;
      stroke: var(--ks-ink);
    }
    .order-head {
      fill: var(--ks-ink);
    }
    .courier circle {
      fill: var(--ks-brass-hi);
      stroke: var(--ks-ink);
      stroke-width: 4;
    }
    .courier text {
      fill: var(--ks-ink);
      stroke: var(--ks-paper);
      stroke-width: 3;
      paint-order: stroke;
      text-anchor: middle;
      font-size: inherit;
    }
    .route-end {
      fill: var(--ks-map-route);
      stroke: var(--ks-paper);
      stroke-width: 4;
    }
    .route {
      fill: none;
      stroke: var(--ks-map-route);
      stroke-linecap: round;
    }
    .piece {
      stroke: var(--ks-ink);
      stroke-width: 6;
    }
    .piece.own {
      fill: var(--ks-map-own);
    }
    .piece.enemy {
      fill: var(--ks-map-enemy);
      /* Side is not colour alone: enemy outlines are dashed, your own are solid. */
      stroke-dasharray: 24 12;
    }
    .piece.stale {
      fill-opacity: 0.45;
    }
    .front {
      stroke: var(--ks-paper);
    }
    .fight {
      fill: none;
      stroke: var(--ks-map-enemy);
    }
    .mark {
      fill: none;
      stroke: var(--ks-brass-hi);
    }
    .mark circle:not(.ring) {
      fill: var(--ks-brass-hi);
      stroke: var(--ks-ink);
      stroke-width: 6;
    }
    .mark .mark-head {
      fill: var(--ks-brass-hi);
      stroke: none;
    }
    .mark.selected {
      stroke: var(--ks-paper);
    }
    .tag {
      fill: var(--ks-ink);
      stroke: var(--ks-paper);
      stroke-width: 4;
      paint-order: stroke;
      text-anchor: middle;
    }
    .tag.enemy {
      fill: var(--ks-map-enemy);
    }
  `,
})
export class FlatBoardComponent {
  private readonly game = inject(GameService);
  private readonly desk = inject(DeskStore);
  protected readonly marks = inject(MarksService);
  private readonly svg = viewChild<ElementRef<SVGSVGElement>>('svg');

  protected readonly map = this.game.map;
  protected readonly maps = computed(() => {
    const map = this.map();
    return map ? [map] : [];
  });
  protected get fontSize(): number {
    const map = this.map();
    return map ? longSide(map) / 60 : 0;
  }
  protected get stroke(): number {
    const map = this.map();
    return map ? longSide(map) / 900 : 0;
  }

  /** The player's picture, or after the game the umpire's window at the scrubbed time (as the 3D table shows). */
  private readonly scene = computed(() => {
    const map = this.map();
    if (!map) return undefined;
    const frame = this.desk.windowFrame();
    if (frame) return buildWindowScene(frame, this.desk.windowBelief(), map);
    const view = this.game.view();
    return view ? buildSceneState(view, map) : undefined;
  });
  protected readonly summary = computed(() => {
    const map = this.map();
    return map ? boardLines(this.scene(), map) : [];
  });
  /**
   * In a turn-mode game (D39) the pieces glide to where a turn left them, as on the 3D table. `frameNow`
   * is the wall time of the frame being drawn; it only ticks while a glide is running.
   */
  private readonly frameNow = signal(0);
  private readonly glide = linkedSignal<
    { scene: SceneState | undefined; frame: boolean; map: BaseMap | undefined },
    GlideState
  >({
    source: () => ({
      scene: this.scene(),
      frame: this.desk.windowFrame() !== undefined,
      map: this.map(),
    }),
    computation: ({ scene: s, frame, map }, prev) => {
      const at = new Map([
        ...(s?.own ?? []).map((o) => [`own:${o.id}`, o.position] as const),
        ...(s?.ghosts ?? []).map((g) => [`ghost:${g.id}`, g.position] as const),
      ]);
      const still =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      // Only a new scene starts a glide; the mode is read, not tracked. The umpire's window's frames, and the way
      // back from them to the live picture, are set down at once.
      const turns = untracked(() => this.game.state().turnMode) && !frame && !prev?.source.frame;
      const ms = turns && !still && prev?.source.map === map ? GLIDE_MS : 0;
      return nextGlides(prev?.value ?? NO_GLIDES, at, performance.now(), ms);
    },
  });
  protected readonly own = computed(() => {
    const g = this.glide();
    const now = this.frameNow();
    return (this.scene()?.own ?? []).map((p) =>
      g.glides.size === 0 ? p : { ...p, position: drawnAt(g, `own:${p.id}`, p.position, now) },
    );
  });
  protected readonly ghosts = computed(() => {
    const g = this.glide();
    const now = this.frameNow();
    return (this.scene()?.ghosts ?? []).map((p) =>
      g.glides.size === 0 ? p : { ...p, position: drawnAt(g, `ghost:${p.id}`, p.position, now) },
    );
  });
  protected readonly fights = computed(() => this.scene()?.engagements ?? []);
  protected readonly routes = computed(() => {
    const o = this.marks.overlays();
    return (this.scene()?.orderRoutes ?? []).filter((r) =>
      r.kind === 'order' ? o.orders : o.routes,
    );
  });
  protected readonly couriers = computed(() =>
    this.marks.overlays().orders ? (this.scene()?.couriers ?? []) : [],
  );
  protected readonly markList = computed(() => {
    const now = this.marks.nowGame();
    return this.marks
      .shown()
      .map((mark: Mark) => ({ mark, fade: markAgeFactor(mark.madeAtGame, now) }));
  });
  protected readonly tags = computed(() => {
    const h = this.fontSize * 1.5;
    const below = (
      p: { position: { x: number; y: number } },
      id: string,
      text: string,
      enemy: boolean,
    ) => ({
      id,
      text,
      enemy,
      w: text.length * this.fontSize * 0.55,
      at: { x: p.position.x, y: p.position.y + this.fontSize * 1.8 },
    });
    const all = [
      ...this.own().map((p) => below(p, p.id, p.label, false)),
      ...this.ghosts().map((g) => below(g, g.id, `${g.id} ${g.ageTag}`, true)),
    ];
    const placed = stackLabels(all, h);
    return all.map((t) => ({ ...t, at: placed.get(t.id)! }));
  });

  /** Screen position to map point and piece, for the mark tools (the same contract as the 3D table's `pickAt`). */
  protected picker(map: BaseMap): Picker {
    return {
      pickAt: (clientX, clientY): PickResult => {
        const el = this.svg()?.nativeElement;
        // An event from an old SVG can arrive before Angular renders the replacement.
        if (map !== this.map() || !el) return { type: 'none' };
        const coord = screenToMap(map, el.getBoundingClientRect(), clientX, clientY);
        if (!coord) return { type: 'none' };
        const scene = this.scene();
        const piece = scene && pieceAtPoint(scene, coord);
        return piece ? { type: 'piece', ...piece, coord } : { type: 'point', coord };
      },
    };
  }

  constructor() {
    let raf = 0;
    effect(() => {
      const g = this.glide();
      cancelAnimationFrame(raf);
      const frame = (): void => {
        const now = performance.now();
        this.frameNow.set(now);
        if (gliding(g, now)) raf = requestAnimationFrame(frame);
      };
      if (g.glides.size > 0) frame();
    });
    inject(DestroyRef).onDestroy(() => {
      cancelAnimationFrame(raf);
      this.marks.pointerCancel();
    });
  }

  protected pts = pointsAttr;
  protected terrainPoints(
    feature: BaseFeature,
    points: readonly { x: number; y: number }[],
  ): string {
    return feature.layer === undefined ? pointsAttr(points) : battlefieldPoints(points);
  }
  protected corners(p: Parameters<typeof pieceCorners>[0]) {
    const map = this.map();
    return map ? pieceCorners(p, map) : [];
  }
  protected head(points: readonly { x: number; y: number }[]) {
    return arrowHead(points[points.length - 2]!, points[points.length - 1]!, this.fontSize * 1.2);
  }
  protected dashes(points: readonly { x: number; y: number }[]) {
    return dashPolyline(points, this.fontSize * 1.6, this.fontSize * 0.9);
  }
}
