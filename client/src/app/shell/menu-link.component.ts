import { ChangeDetectionStrategy, Component } from '@angular/core';

/** A small fixed "Main menu" link for the developer tool pages, which have no other way back to the menu. */
@Component({
  selector: 'ks-menu-link',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<a href="/">Main menu</a>`,
  styles: `
    :host {
      position: fixed;
      right: 8px;
      bottom: 8px;
      z-index: 1000;
    }
    a {
      display: inline-block;
      padding: 6px 12px;
      font:
        14px/1.2 Georgia,
        serif;
      color: #2a2118;
      background: #f6edd0;
      border: 1px solid #8a7a52;
      border-radius: 4px;
      text-decoration: none;
    }
    a:hover {
      background: #fff6da;
    }
    a:focus-visible {
      outline: 3px solid #1a5fb4;
      outline-offset: 2px;
    }
  `,
})
export class MenuLinkComponent {}
