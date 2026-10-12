import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { MarkTool } from '@legacy/table/markTools';
import type { Overlays } from '@legacy/table/types';
import { startsCollapsed } from '@legacy/hud/marksBar';
import { MarksService } from '../game/marks.service';

const TOOLS: ReadonlyArray<readonly [MarkTool, string, string]> = [
  ['view', 'Look', 'Move the camera; marks are left alone'],
  ['select', 'Move', 'Click a mark to select it, drag to move it'],
  ['pin', 'Pin', 'Click to place a pin'],
  ['line', 'Pencil', 'Drag to draw a pencil line'],
  ['arrow', 'Arrow', 'Drag from tail to head'],
  ['ring', 'Range ring', 'Drag out from the centre'],
];

const OVERLAYS: ReadonlyArray<readonly [keyof Overlays, string]> = [
  ['orders', 'Order arrows'],
  ['routes', 'Planned routes'],
  ['lastKnown', 'Last known'],
];

/** The marks toolbar (port of `hud/marksBar.ts`): tool buttons, a note for the next mark, delete, plot-a-report and the overlay toggles. */
@Component({
  selector: 'ks-marks-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      id="marks"
      class="ks-overlay"
      aria-label="Map marks"
      [hidden]="marks.deskOpen() || marks.windowShown()"
    >
      <button
        id="marks-toggle"
        type="button"
        aria-controls="marks-body"
        [attr.aria-expanded]="!collapsed()"
        (click)="collapsed.set(!collapsed())"
      >
        Tools
      </button>
      <div id="marks-body" [hidden]="collapsed()">
        <div id="marks-tools" role="toolbar">
          @for (t of tools; track t[0]) {
            <button
              type="button"
              [attr.data-tool]="t[0]"
              [title]="t[2]"
              [attr.aria-pressed]="marks.tool() === t[0]"
              (click)="marks.setTool(t[0])"
            >
              {{ t[1] }}
            </button>
          }
        </div>
        <input
          id="mark-label"
          maxlength="80"
          placeholder="Note for the next mark"
          aria-label="Note for the next mark"
          [value]="marks.label()"
          (input)="marks.label.set($any($event.target).value)"
        />
        <div id="marks-row">
          <button
            id="mark-delete"
            type="button"
            [disabled]="!marks.selectedId()"
            (click)="marks.deleteSelected()"
          >
            Delete mark
          </button>
          <button
            id="mark-plot"
            type="button"
            [disabled]="!marks.plottable()"
            (click)="marks.plotReport()"
          >
            Plot report
          </button>
        </div>
        <div id="overlays">
          @for (o of overlays; track o[0]) {
            <label
              ><input
                type="checkbox"
                [attr.data-overlay]="o[0]"
                [checked]="marks.overlays()[o[0]]"
                (change)="setOverlay(o[0], $any($event.target).checked)"
              />
              {{ o[1] }}</label
            >
          }
        </div>
      </div>
    </section>
  `,
  styles: `
    #marks[hidden],
    #marks-body[hidden] {
      display: none;
    }
    #marks {
      position: fixed;
      left: 8px;
      top: 44px;
      width: min(300px, calc(100% - 16px));
    }
    #marks:has(#marks-body[hidden]) {
      width: auto;
      display: inline-block;
    }
    #marks-toggle {
      margin-bottom: 4px;
    }
    #marks-tools,
    #marks-row,
    #overlays {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 4px;
    }
    #mark-label {
      width: 100%;
      box-sizing: border-box;
      margin-bottom: 4px;
    }
  `,
})
export class MarksBarComponent {
  protected readonly marks = inject(MarksService);
  protected readonly tools = TOOLS;
  protected readonly overlays = OVERLAYS;
  protected readonly collapsed = signal(startsCollapsed(globalThis.innerWidth ?? Infinity));

  protected setOverlay(key: keyof Overlays, on: boolean): void {
    this.marks.overlays.update((o) => ({ ...o, [key]: on }));
  }
}
