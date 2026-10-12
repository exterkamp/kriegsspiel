import { ChangeDetectionStrategy, Component } from '@angular/core';

/** A small fixed "Main menu" link for the developer tool pages, which have no other way back to the menu. */
@Component({
  selector: 'ks-menu-link',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<a href="/">Main menu</a>`,
  styles: `
    :host {
      position: fixed;
      right: var(--ks-space-2);
      bottom: var(--ks-space-2);
      z-index: 1000;
    }
    a {
      display: inline-block;
      padding: 6px 12px;
      font: var(--ks-text-sm) / 1.2 var(--ks-font);
      color: var(--ks-ink);
      background: var(--ks-paper-control);
      border: 1px solid var(--ks-rule);
      border-radius: var(--ks-radius);
      text-decoration: none;
    }
    a:hover {
      background: var(--ks-paper-sunk);
    }
    a:focus-visible {
      outline: var(--ks-focus-ring);
      outline-offset: 2px;
    }
  `,
})
export class MenuLinkComponent {}
