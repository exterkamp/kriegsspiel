import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * The frame of a full-page screen (#327): the aged-paper page, one column, a title, and optionally a way back to the
 * main menu. The back control is a link to `/` unless the page handles it (`(back)`), as the shell's own screens do.
 */
@Component({
  selector: 'ks-page-frame',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <main [class.narrow]="narrow()">
        @if (back()) {
          <p class="back">
            <button type="button" class="ks-quiet" (click)="backClick.emit()">← Main menu</button>
          </p>
        }
        @if (heading()) {
          <h1>{{ heading() }}</h1>
        }
        <ng-content />
      </main>
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100%;
    }
    .page {
      box-sizing: border-box;
      min-height: 100%;
      overflow: auto;
      background: var(--ks-page-bg);
      color: var(--ks-text);
      font-family: var(--ks-font);
    }
    main {
      box-sizing: border-box;
      max-width: 560px;
      margin: 0 auto;
      padding: var(--ks-space-6) var(--ks-space-4);
    }
    main.narrow {
      max-width: 420px;
    }
    .back {
      margin: 0 0 var(--ks-space-2);
    }
    h1 {
      margin: 0 0 var(--ks-space-4);
    }
  `,
})
export class PageFrameComponent {
  readonly heading = input('');
  readonly narrow = input(false);
  /** Show "← Main menu"; the page listens to `(backClick)`. */
  readonly back = input(false);
  readonly backClick = output();
}
