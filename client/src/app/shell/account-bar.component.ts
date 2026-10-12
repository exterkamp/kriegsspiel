import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import type { Me } from '@legacy/auth';
import { SHELL_API } from './shell-api';

/** Who is playing ("Guest" for a guest), a link to their games and delete-account; it sits in the in-game menu, off the map. */
@Component({
  selector: 'ks-account-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div id="account">
      <span>{{ me().guest ? 'Guest' : me().email }}</span>
      <a href="/?lobby=1">Games</a>
      <button type="button" class="ks-danger" (click)="remove()">Delete account</button>
    </div>
  `,
  styles: `
    #account {
      display: flex;
      flex-wrap: wrap;
      gap: var(--ks-space-2);
      align-items: center;
      font-size: var(--ks-text-sm);
    }
    span {
      flex: 1 0 100%;
      overflow-wrap: anywhere;
    }
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
