import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewEncapsulation,
  afterNextRender,
  signal,
  viewChild,
} from '@angular/core';
import { adminMode } from '@legacy/auth';
import { AdminPage } from '@legacy/admin/admin';

/**
 * Hosts the existing imperative `AdminPage` (read-only operator console). It builds its own DOM inside `#app`, so the
 * styles are unencapsulated (scoped under `ks-admin`) and the page is created once after render and stopped on
 * destroy. A rewrite is later work.
 */
@Component({
  selector: 'ks-admin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './admin.component.css',
  host: { class: 'ks-theme' },
  template: `<div>
      <p class="admin-bar"><a class="ks-btn" href="/">← Main menu</a></p>
      @if (open()) {
        <p class="ks-status ks-warn open-banner" role="alert">
          Admin is open: anyone who can reach this port can read all hidden game state and LLM
          prompts.
        </p>
      }
    </div>
    <div id="app" #root class="ks-dense"></div>`,
})
export class AdminComponent implements OnDestroy {
  private readonly root = viewChild.required<ElementRef<HTMLElement>>('root');
  private page: AdminPage | undefined;
  protected readonly open = signal(false);

  constructor() {
    adminMode().then(
      (m) => this.open.set(m === 'open'),
      () => undefined,
    );
    afterNextRender(() => {
      this.page = new AdminPage(this.root().nativeElement, location.search);
      this.page.start();
    });
  }

  ngOnDestroy(): void {
    this.page?.stop();
  }
}
