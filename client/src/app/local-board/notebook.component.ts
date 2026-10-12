import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { PersonalStore } from './personal-store';

@Component({
  selector: 'ks-personal-notebook',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './notebook.component.html',
  styleUrl: './notebook.component.css',
})
export class NotebookComponent {
  readonly store = input.required<PersonalStore>();
  readonly returnToTable = output<void>();
  readonly editable = computed(() => {
    const store = this.store();
    return (
      store.interactionEnabled() &&
      !store.disposed() &&
      !store.notebook().busy &&
      store.notebook().writable
    );
  });
  readonly actionable = computed(() => {
    const store = this.store();
    return store.interactionEnabled() && !store.disposed() && !store.notebook().busy;
  });
  text(event: Event): void {
    const element = event.target as HTMLTextAreaElement;
    if (this.editable()) this.store().setNotebookText(element.value);
    // Rejected oversized/programmatic input must show the retained draft without truncation.
    if (element.value !== this.store().notebook().draft)
      element.value = this.store().notebook().draft;
  }
  search(event: Event): void {
    this.store().setNotebookQuery((event.target as HTMLInputElement).value);
  }
  save(): void {
    if (this.editable()) void this.store().saveNotebook();
  }
  reload(): void {
    if (this.actionable()) void this.store().reloadNotebook();
  }
  back(): void {
    if (this.store().interactionEnabled() && !this.store().disposed()) this.returnToTable.emit();
  }
}
