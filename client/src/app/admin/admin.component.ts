import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  ViewEncapsulation,
  afterNextRender,
  viewChild,
} from '@angular/core';
import { AdminPage } from '@legacy/admin/admin';
import { MenuLinkComponent } from '../shell/menu-link.component';

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
  imports: [MenuLinkComponent],
  template: `<div id="app" #root></div>
    <ks-menu-link />`,
})
export class AdminComponent implements OnDestroy {
  private readonly root = viewChild.required<ElementRef<HTMLElement>>('root');
  private page: AdminPage | undefined;

  constructor() {
    afterNextRender(() => {
      this.page = new AdminPage(this.root().nativeElement, location.search);
      this.page.start();
    });
  }

  ngOnDestroy(): void {
    this.page?.stop();
  }
}
