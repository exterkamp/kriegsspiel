import type { MarkTool } from '../table/markTools.js';
import { ALL_OVERLAYS, type Overlays } from '../table/types.js';

export interface MarksBarHandlers {
  onTool(tool: MarkTool): void;
  onDelete(): void;
  /** Pin the last opened report where it says the sighting was. */
  onPlotReport(): void;
  onOverlays(o: Overlays): void;
}

const TOOLS: ReadonlyArray<readonly [MarkTool, string, string]> = [
  ['view', 'Look', 'Move the camera; marks are left alone'],
  ['select', 'Move', 'Click a mark to select it, drag to move it'],
  ['pin', 'Pin', 'Click to place a pin'],
  ['line', 'Pencil', 'Drag to draw a pencil line'],
  ['arrow', 'Arrow', 'Drag from tail to head'],
  ['ring', 'Range ring', 'Drag out from the centre'],
];

/** At or below this width the toolbar would cover the units on the table, so it starts collapsed. */
export const COLLAPSE_BELOW_PX = 1200;

export const startsCollapsed = (viewportWidth: number): boolean =>
  viewportWidth <= COLLAPSE_BELOW_PX;

/** The marks toolbar: tool buttons, a note for the next mark, delete, plot-a-report and the overlay toggles. */
export class MarksBar {
  private readonly buttons = new Map<MarkTool, HTMLButtonElement>();
  private readonly labelEl: HTMLInputElement;
  private readonly deleteEl: HTMLButtonElement;
  private readonly plotEl: HTMLButtonElement;
  private overlays: Overlays = { ...ALL_OVERLAYS };

  constructor(
    root: HTMLElement,
    private readonly h: MarksBarHandlers,
    collapsed = startsCollapsed(globalThis.innerWidth ?? Infinity),
  ) {
    root.insertAdjacentHTML(
      'beforeend',
      `<section id="marks" aria-label="Map marks">
         <button id="marks-toggle" aria-controls="marks-body" aria-expanded="true">Tools</button>
         <div id="marks-body">
         <div id="marks-tools" role="toolbar">${TOOLS.map(
           ([t, name, hint]) => `<button data-tool="${t}" title="${hint}">${name}</button>`,
         ).join('')}</div>
         <input id="mark-label" maxlength="80" placeholder="Note for the next mark" aria-label="Note for the next mark" />
         <div id="marks-row"><button id="mark-delete" disabled>Delete mark</button><button id="mark-plot" disabled>Plot report</button></div>
         <div id="overlays"><label><input type="checkbox" data-overlay="orders" checked /> Order arrows</label>
           <label><input type="checkbox" data-overlay="routes" checked /> Planned routes</label>
           <label><input type="checkbox" data-overlay="lastKnown" checked /> Last known</label></div>
         </div>
       </section>`,
    );
    for (const b of root.querySelectorAll<HTMLButtonElement>('#marks-tools button')) {
      this.buttons.set(b.dataset.tool as MarkTool, b);
      b.addEventListener('click', () => this.setTool(b.dataset.tool as MarkTool));
    }
    this.labelEl = root.querySelector('#mark-label')!;
    this.deleteEl = root.querySelector('#mark-delete')!;
    this.plotEl = root.querySelector('#mark-plot')!;
    this.deleteEl.addEventListener('click', () => this.h.onDelete());
    this.plotEl.addEventListener('click', () => this.h.onPlotReport());
    for (const c of root.querySelectorAll<HTMLInputElement>('[data-overlay]')) {
      c.addEventListener('change', () => {
        this.overlays = { ...this.overlays, [c.dataset.overlay as keyof Overlays]: c.checked };
        this.h.onOverlays(this.overlays);
      });
    }
    this.buttons.get('view')?.setAttribute('aria-pressed', 'true');
    this.toggleEl = root.querySelector('#marks-toggle')!;
    this.bodyEl = root.querySelector('#marks-body')!;
    this.toggleEl.addEventListener('click', () => this.setCollapsed(!this.collapsed));
    this.setCollapsed(collapsed);
  }

  private readonly toggleEl: HTMLButtonElement;
  private readonly bodyEl: HTMLElement;
  collapsed = false;

  /** Fold the toolbar down to its Tools button, or open it again. */
  setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    this.bodyEl.hidden = collapsed;
    this.toggleEl.setAttribute('aria-expanded', String(!collapsed));
  }

  setTool(tool: MarkTool): void {
    for (const [t, b] of this.buttons) b.setAttribute('aria-pressed', String(t === tool));
    this.h.onTool(tool);
  }

  /** The note typed for the next mark; cleared once a mark has used it. */
  takeLabel(): string {
    const v = this.labelEl.value.trim();
    this.labelEl.value = '';
    return v;
  }

  peekLabel(): string {
    return this.labelEl.value.trim();
  }

  /** Enable Delete while a mark is selected, and Plot while there is a located report to plot. */
  setAvailable(opts: { selected: boolean; plottable: boolean }): void {
    this.deleteEl.disabled = !opts.selected;
    this.plotEl.disabled = !opts.plottable;
  }
}
