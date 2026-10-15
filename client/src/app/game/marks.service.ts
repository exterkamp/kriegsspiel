import {
  Injectable,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import type { Dispatch, Mark } from '@kriegsspiel/protocol';
import { gameNowMs } from '@legacy/net/state';
import { Gesture, type MarkTool } from '@legacy/table/markTools';
import { newMarkId } from '@legacy/table/marks';
import { pickMinSize } from '@legacy/table/picking';
import { ALL_OVERLAYS, type BaseMap, type Overlays } from '@legacy/table/types';
import type { TableScene } from '@legacy/table/TableScene';
import { isDeskView } from '@legacy/desk/views';
import { DeskStore } from '../desk/desk.store';
import { GameService } from './game.service';
import { TableService } from './table.service';

/** What the marks code needs of a board: the map point (and piece) under a screen position. The 3D table and the flat board both do this. */
export type Picker = Pick<TableScene, 'pickAt'>;

/** The pointer state the table needs to turn drags into marks. */
export interface PointerLike {
  clientX: number;
  clientY: number;
  button: number;
  pointerId: number;
}

/**
 * The player's marks on the table: the tool, the selection, the mark being drawn and the gesture handlers for the
 * table canvas (port of the marks code in `liveClient.ts`). Edits show at once and go to the server through
 * `GameService`, which stores them as sent.
 */
@Injectable({ providedIn: 'root' })
export class MarksService {
  private readonly game = inject(GameService);
  private readonly desk = inject(DeskStore);
  private readonly table = inject(TableService);

  readonly tool = signal<MarkTool>('view');
  readonly selectedId = linkedSignal<BaseMap | undefined, string | undefined>({
    source: () => this.game.map(),
    computation: () => undefined,
  });
  readonly draft = linkedSignal<BaseMap | undefined, Mark | undefined>({
    source: () => this.game.map(),
    computation: () => undefined,
  });
  /** The note typed for the next mark; cleared once a mark has used it. */
  readonly label = signal('');
  readonly overlays = signal<Overlays>({ ...ALL_OVERLAYS });
  /** Bumped by the table host so marks that fade with game time are redrawn. */
  readonly tick = signal(0);
  /** The last located report the player opened in the desk viewer is the one Plot report pins. */
  private readonly lastReport = signal<Dispatch | undefined>(undefined);

  readonly deskOpen = computed(() => isDeskView(this.desk.activeView()));
  readonly windowShown = computed(() => this.desk.windowFrame() !== undefined);
  readonly plottable = computed(
    () =>
      !!this.game.map() && this.mapIdentity === this.game.map() && !!this.lastReport()?.location,
  );
  readonly shown = computed(() => {
    if (!this.game.map()) return [];
    const marks = this.game.state().marks;
    const d = this.draft();
    return d ? [...marks.filter((m) => m.id !== d.id), d] : marks;
  });

  private gesture: Gesture | undefined;
  private down: { x: number; y: number } | undefined;
  private seq = 0;
  private mapIdentity = this.game.map();
  private capture: { canvas: HTMLElement; pointerId: number } | undefined;

  constructor() {
    effect(() => {
      this.game.map();
      untracked(() => this.checkedMap());
    });
    // The toolbar and the drawing tools belong to the table: in a desk view, go back to Look.
    effect(() => {
      if (this.deskOpen()) untracked(() => this.setTool('view'));
    });
    effect(() => {
      const d = this.desk.viewedDispatch();
      if (d?.location) this.lastReport.set(d);
    });
  }

  nowGame(): number {
    this.tick();
    const s = this.game.state();
    return s.clock ? gameNowMs(s.clock, Date.now()) : (s.view?.atGame ?? 0);
  }

  setTool(t: MarkTool): void {
    this.tool.set(t);
    this.pointerCancel();
  }

  /** Also run at event entry: signal changes precede Angular's next render/effect. */
  private checkedMap(): BaseMap | undefined {
    const map = this.game.map();
    if (map !== this.mapIdentity) {
      this.mapIdentity = map;
      this.pointerCancel();
      this.selectedId.set(undefined);
      this.lastReport.set(undefined);
      this.desk.windowHover.set(undefined);
      this.table.status.set('Click the map');
    }
    return map;
  }

  deleteSelected(): void {
    if (!this.checkedMap() || this.windowShown()) return;
    const id = this.selectedId();
    if (!id) return;
    this.game.deleteMark(id);
    this.selectedId.set(undefined);
  }

  /** Pin the last opened report where it says the sighting was; plotting it again moves its pin. */
  plotReport(): void {
    if (!this.checkedMap() || this.windowShown()) return;
    const d = this.lastReport();
    if (!d?.location) return;
    const label = [d.sizeEstimate, d.unit].filter(Boolean).join(' ') || d.from;
    const already = this.game.state().marks.find((m) => m.sourceReport === d.id);
    this.commit({
      id: already?.id ?? newMarkId(++this.seq, Date.now()),
      kind: 'pin',
      at: d.location,
      label,
      madeAtGame: this.nowGame(),
      sourceReport: d.id,
    });
  }

  private commit(mark: Mark): void {
    if (!this.game.putMark(mark))
      this.table.status.set(
        'Not connected: that mark was not saved, and will be lost when the connection comes back.',
      );
  }

  private mapPoint(scene: Picker, e: PointerLike) {
    const r = scene.pickAt(e.clientX, e.clientY);
    return r.type === 'none' ? undefined : r.coord;
  }

  pointerDown(scene: Picker, canvas: HTMLElement, e: PointerLike): void {
    const map = this.checkedMap();
    this.pointerCancel();
    if (!map || this.deskOpen() || e.button !== 0) return;
    const c = this.mapPoint(scene, e);
    if (!c) return;
    this.down = { x: e.clientX, y: e.clientY };
    const tool = this.tool();
    if (this.windowShown() || tool === 'view') return;
    const span = pickMinSize(map);
    this.gesture = new Gesture(tool, c, {
      id: newMarkId(++this.seq, Date.now()),
      nowGame: this.nowGame(),
      label: this.label().trim(),
      marks: this.game.state().marks,
      tolerance: span,
      minStep: span / 3,
    });
    canvas.setPointerCapture?.(e.pointerId);
    this.capture = { canvas, pointerId: e.pointerId };
    if (tool === 'select') this.selectedId.set(this.gesture.grabbed?.id);
    this.draft.set(this.gesture.draft());
  }

  pointerMove(scene: Picker, e: PointerLike): void {
    if (!this.checkedMap()) return;
    if (this.windowShown()) {
      if (this.gesture) this.pointerCancel();
      const r = scene.pickAt(e.clientX, e.clientY);
      this.desk.windowHover.set(r.type === 'piece' && r.pieceKind === 'own' ? r.id : undefined);
      return;
    }
    if (!this.gesture) return;
    const c = this.mapPoint(scene, e);
    if (!c) return;
    this.gesture.update(c);
    this.draft.set(this.gesture.draft());
  }

  pointerUp(scene: Picker, e: PointerLike): void {
    if (!this.checkedMap()) return;
    if (this.windowShown() && this.gesture) {
      this.pointerCancel();
      return;
    }
    if (this.gesture) {
      const c = this.mapPoint(scene, e);
      const made = c ? this.gesture.finish(c) : this.gesture.draft();
      const wasSelect = this.gesture.tool === 'select';
      this.pointerCancel();
      if (made) {
        if (!wasSelect) this.label.set('');
        this.commit(made);
      }
      return;
    }
    if (!this.down || Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 4) return;
    this.down = undefined;
    const r = scene.pickAt(e.clientX, e.clientY);
    this.table.status.set(JSON.stringify(r));
    // In the umpire's window a click pins the unit's notes, so touch users can read them too.
    if (this.windowShown())
      this.desk.windowHover.set(r.type === 'piece' && r.pieceKind === 'own' ? r.id : undefined);
  }

  pointerCancel(): void {
    const capture = this.capture;
    this.capture = undefined;
    try {
      if (capture?.canvas.hasPointerCapture?.(capture.pointerId))
        capture.canvas.releasePointerCapture(capture.pointerId);
    } catch {
      // The browser may already have released capture while removing the old board.
    }
    this.down = undefined;
    this.gesture = undefined;
    this.draft.set(undefined);
  }

  /** Delete removes the selected mark, unless a desk view is open or the player is typing. */
  onKey(e: KeyboardEvent): void {
    if (
      e.key === 'Delete' &&
      !this.deskOpen() &&
      this.selectedId() &&
      !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
    )
      this.deleteSelected();
  }
}
