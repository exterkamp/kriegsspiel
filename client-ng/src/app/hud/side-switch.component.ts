import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Hot-seat: a button per side to hand the desk over; each loads the page seated at that side. */
@Component({
  selector: 'ks-side-switch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div id="sides">
      @for (s of sides(); track s) {
        <button type="button" [disabled]="s === current()" (click)="go(s)">
          {{ s === current() ? 'Playing ' + s : 'Switch to ' + s }}
        </button>
      }
    </div>
  `,
  styles: `
    #sides {
      position: fixed;
      left: 8px;
      bottom: 8px;
      display: flex;
      gap: 8px;
      padding: 8px;
      box-sizing: border-box;
      background: rgba(42, 33, 24, 0.95);
      color: #efe6c8;
      font-size: 14px;
    }
  `,
})
export class SideSwitchComponent {
  readonly game = input.required<string>();
  readonly sides = input.required<readonly string[]>();
  readonly current = input<string | undefined>(undefined);

  protected go(side: string): void {
    window.location.assign(
      `/?game=${encodeURIComponent(this.game())}&side=${encodeURIComponent(side)}`,
    );
  }
}
