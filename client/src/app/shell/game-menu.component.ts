import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  inject,
  Injector,
  DestroyRef,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { isTypingTarget } from '@legacy/desk/views';
import { DeskStore } from '../desk/desk.store';
import { ModalComponent } from '../ui/modal.component';

/** The in-game menu: Esc at the table opens it; resume, leave to the main menu, or sign out. */
@Component({
  selector: 'ks-game-menu',
  imports: [ModalComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button #opener type="button" class="open" aria-haspopup="dialog" (click)="setOpen(true)">
      Menu (Esc)
    </button>
    @if (open()) {
      <div>
        <ks-modal heading="Menu" labelId="gm-h">
          <button #resume type="button" (click)="setOpen(false)">Resume</button>
          <button type="button" (click)="leave.emit()">Leave to main menu</button>
          <button type="button" class="ks-danger" (click)="signOut.emit()">Sign out</button>
          <ng-content />
          <p class="note ks-muted">
            Leaving does not end the game. It keeps running on the server.
          </p>
        </ks-modal>
      </div>
    }
  `,
  styles: `
    .open {
      position: fixed;
      top: var(--ks-space-2);
      left: 50%;
      transform: translateX(-50%);
      z-index: 30;
      font-size: var(--ks-text-sm);
      padding: 6px 12px;
    }
    @media (max-width: 600px) {
      .open {
        left: auto;
        right: var(--ks-space-2);
        transform: none;
      }
    }
    .note {
      margin: 0;
      font-size: var(--ks-text-sm);
    }
  `,
})
export class GameMenuComponent {
  readonly leave = output();
  readonly signOut = output();
  private readonly desk = inject(DeskStore);
  private readonly injector = inject(Injector);
  private readonly keys = (e: KeyboardEvent): void => this.onKey(e);

  constructor() {
    // Capture phase, so it sees the view as it was before the desk handles the same key.
    window.addEventListener('keydown', this.keys, true);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('keydown', this.keys, true));
  }
  protected readonly open = signal(false);
  private readonly resume = viewChild<ElementRef<HTMLButtonElement>>('resume');
  private readonly opener = viewChild<ElementRef<HTMLButtonElement>>('opener');

  protected setOpen(v: boolean): void {
    this.open.set(v);
    afterNextRender(() => (v ? this.resume() : this.opener())?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  /**
   * Esc closes the menu if it is open. Otherwise it opens it, but only from the table: in a desk view Esc belongs to
   * the desk (back to the table), and in a text field to the field. Runs in the capture phase so it sees the view as
   * it was before the desk handles the same key.
   */
  protected onKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    if (this.open()) {
      e.preventDefault();
      e.stopPropagation();
      this.setOpen(false);
    } else if (this.desk.activeView() === 'table' && !isTypingTarget(e.target)) {
      this.setOpen(true);
    }
  }
}
