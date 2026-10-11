import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { PAGE_CSS } from './page-styles';

/** Guest start and the emailed-link form. */
@Component({
  selector: 'ks-sign-in',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <main>
        <h1>Kriegsspiel</h1>
        @if (onGuest()) {
          <p>
            <button type="button" class="primary" [disabled]="busy()" (click)="play()">
              Play as guest
            </button>
          </p>
          <p class="hint">No email needed. Sign in later to keep your games on other devices.</p>
        }
        <form (submit)="submit($event)" aria-labelledby="signin-h">
          <h2 id="signin-h">Sign in</h2>
          <label
            >Email
            <input
              type="email"
              required
              autocomplete="email"
              [value]="email()"
              (input)="email.set($any($event.target).value)"
          /></label>
          <button type="submit" [disabled]="busy()">Send me a login link</button>
          <p role="status" [class.err]="failed()">{{ message() }}</p>
        </form>
      </main>
    </div>
  `,
  styles: [
    PAGE_CSS,
    `
      main {
        max-width: 420px;
      }
      label {
        display: block;
        margin-bottom: 12px;
      }
      input {
        display: block;
        width: 100%;
        box-sizing: border-box;
        font: inherit;
        padding: 6px;
        margin-top: 4px;
      }
      h2 {
        border: 0;
        margin: 0 0 8px;
      }
      .hint {
        margin-top: -4px;
        font-size: 0.9rem;
      }
      .primary {
        font-weight: bold;
        background: #e3d09a;
        color: #2a2118;
        font-size: inherit;
        padding: 8px 14px;
      }
    `,
  ],
})
export class SignInComponent {
  /** Asks for a login link; resolves to an error message, or undefined once it was sent. */
  readonly onRequest = input.required<(email: string) => Promise<string | undefined>>();
  /** Starts a guest session; resolves to an error message, or undefined on success. Absent: no guest button. */
  readonly onGuest = input<(() => Promise<string | undefined>) | undefined>(undefined);
  protected readonly email = signal('');
  protected readonly message = signal('');
  protected readonly failed = signal(false);
  protected readonly busy = signal(false);

  protected async play(): Promise<void> {
    this.busy.set(true);
    const err = await this.onGuest()!();
    this.busy.set(false);
    if (err !== undefined) {
      this.failed.set(true);
      this.message.set(err);
    }
  }

  protected async submit(e: Event): Promise<void> {
    e.preventDefault();
    this.busy.set(true);
    const email = this.email().trim();
    const err = await this.onRequest()(email);
    this.busy.set(false);
    this.failed.set(err !== undefined);
    this.message.set(err ?? `Check ${email} for your login link, then open it in this browser.`);
  }
}
