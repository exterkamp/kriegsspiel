import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  input,
  viewChild,
} from '@angular/core';

/**
 * A modal dialog (#327): scrim, a paper panel with a title, focus moved in when it opens, and Tab kept inside while it
 * is up. The owner decides when to render it (`@if`) and handles Escape, since some owners (the game menu) already do.
 */
@Component({
  selector: 'ks-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ks-modal-scrim">
      <div
        #panel
        class="ks-paper panel"
        role="dialog"
        aria-modal="true"
        [attr.aria-labelledby]="labelId()"
        (keydown)="trap($event)"
      >
        <h2 [id]="labelId()">{{ heading() }}</h2>
        <ng-content />
      </div>
    </div>
  `,
  styles: `
    .panel {
      width: min(var(--ks-modal-width, 360px), calc(100% - 32px));
      display: grid;
      gap: var(--ks-space-2);
    }
    h2 {
      margin: 0;
    }
  `,
})
export class ModalComponent {
  readonly heading = input.required<string>();
  readonly labelId = input('ks-modal-h');
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');

  constructor() {
    afterNextRender(() =>
      this.panel()
        .nativeElement.querySelector<HTMLElement>('button, input, select, textarea')
        ?.focus(),
    );
  }

  protected trap(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return;
    const items = [
      ...this.panel().nativeElement.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, a[href]',
      ),
    ];
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    const at = document.activeElement;
    if (e.shiftKey && at === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
