import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import type { Me } from '@legacy/auth';
import { SHELL_API } from './shell-api';

/** A small bar with the user's address, a link to their games, sign-out and delete-account. */
@Component({
  selector: 'ks-account-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div id="account">
      <span>{{ me().email }}</span>
      <a href="/?lobby=1">Games</a>
      <button type="button" (click)="signOut()">Sign out</button>
      <button type="button" (click)="remove()">Delete account</button>
    </div>
  `,
  styles: `
    #account {
      position: fixed; right: 8px; bottom: 8px; z-index: 20; display: flex; gap: 8px; align-items: center;
      padding: 6px 8px; background: rgba(42, 33, 24, 0.95); color: #efe6c8; font: 13px Georgia, serif;
    }
    a { color: #f2c94c; }
    button { font: inherit; cursor: pointer; }
    a:focus-visible, button:focus-visible { outline: 3px solid #f2c94c; outline-offset: 2px; }
  `,
})
export class AccountBarComponent {
  readonly me = input.required<Me>();
  /** Called once the session or account is gone. */
  readonly gone = output();
  private readonly api = inject(SHELL_API);

  protected signOut(): void {
    void this.api.signOut().then(() => this.gone.emit());
  }

  protected remove(): void {
    if (!confirm('Delete your account and leave your games? This cannot be undone.')) return;
    void this.api.deleteAccount().then((ok) => ok && this.gone.emit());
  }
}
