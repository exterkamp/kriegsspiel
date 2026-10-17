import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The header of a developer tool page (#308: the map editor and the benchmarks): "← Main menu", a small
 * "Developer tools" line and the page title, with room on the right for the page's status (projected content).
 * It is the tool pages' counterpart of `ks-page-frame`, for pages that fill the viewport instead of a paper column.
 * Use it under a `.ks-theme` host so the link and status pick up the shared controls.
 */
@Component({
  selector: 'ks-tool-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header>
      <div class="titles">
        <a class="ks-btn ks-quiet back" href="/">← Main menu</a>
        <p class="eyebrow ks-muted">Developer tools</p>
        @if (heading()) {
          <h1>{{ heading() }}</h1>
        }
      </div>
      <ng-content />
    </header>
  `,
  styles: `
    :host {
      display: block;
    }
    header {
      box-sizing: border-box;
      display: flex;
      flex-wrap: wrap;
      gap: var(--ks-space-2) var(--ks-space-6);
      align-items: center;
      justify-content: space-between;
      padding: var(--ks-space-3) var(--ks-space-5);
      background: var(--ks-page-bg);
      color: var(--ks-text);
      border-bottom: 1px solid var(--ks-rule);
    }
    .titles {
      display: grid;
      justify-items: start;
      gap: 2px;
      min-width: 0;
    }
    .back {
      margin-left: calc(-1 * var(--ks-space-1));
    }
    .eyebrow {
      margin: 0;
      font-size: var(--ks-text-xs);
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      font-size: var(--ks-text-xl);
      letter-spacing: 0.02em;
    }
    @media (max-width: 760px) {
      header {
        padding: var(--ks-space-2) var(--ks-space-4);
      }
    }
  `,
})
export class ToolHeaderComponent {
  /** The page title (the page's only `h1`); leave empty when the page writes its own. */
  readonly heading = input('');
}
