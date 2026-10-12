import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PersonalStore, type ManualTool } from './personal-store';

@Component({
  selector: 'ks-personal-tools',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './personal-tools.component.html',
  styleUrl: './personal-tools.component.css',
  host: { '(keydown)': 'handleKeydown($event)' },
})
export class PersonalToolsComponent {
  readonly store = input.required<PersonalStore>();
  readonly tools: readonly { value: ManualTool; label: string }[] = [
    { value: 'pin', label: 'Pin' },
    { value: 'symbol', label: 'Symbol' },
    { value: 'ring', label: 'Ring' },
    { value: 'polyline', label: 'Line' },
    { value: 'arrow', label: 'Arrow' },
  ];
  readonly editable = computed(() => {
    const store = this.store();
    return store.interactionEnabled() && !store.disposed() && !store.marks().busy;
  });
  readonly multipoint = computed(() => {
    const tool = this.store().markForm().tool;
    return tool === 'polyline' || tool === 'arrow';
  });

  field(event: Event, name: 'label' | 'x' | 'y' | 'radiusM'): void {
    if (!this.editable()) return;
    this.store().setMarkFields({ [name]: (event.target as HTMLInputElement).value });
  }
  symbol(event: Event): void {
    if (!this.editable()) return;
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'cross' || value === 'dot' || value === 'flag')
      this.store().setMarkFields({ symbol: value });
  }
  begin(tool: ManualTool): void {
    if (this.editable()) this.store().beginTool(tool);
  }
  edit(id: string): void {
    if (this.editable()) this.store().beginEdit(id);
  }
  remove(id: string): void {
    if (this.editable()) this.store().removeMark(id);
  }
  appendPoint(): void {
    if (this.editable()) this.store().appendNumericPoint();
  }
  removePoint(index: number): void {
    if (this.editable()) this.store().removeDraftPoint(index);
  }
  replacePoint(index: number): void {
    if (!this.editable() || !this.multipoint()) return;
    const store = this.store();
    const form = store.markForm();
    if (!Number.isInteger(index) || index < 0 || index >= form.points.length) return;
    // Make room at the 256-point limit and validate through the frozen numeric seam.
    // All intermediate changes are synchronous; the entire draft remains store-owned.
    store.removeDraftPoint(index);
    const accepted = store.appendNumericPoint();
    const replacement = store.markForm().points.at(-1)!;
    const points = accepted.ok
      ? form.points.map((point, at) => (at === index ? replacement : point))
      : form.points;
    for (let at = store.markForm().points.length - 1; at >= 0; at--) store.removeDraftPoint(at);
    for (const point of points) {
      store.setMarkFields({ x: String(point.x), y: String(point.y) });
      store.appendNumericPoint();
    }
    store.setMarkFields({ x: form.x, y: form.y });
    // Restore a visible validation error after restoring the original ordered list.
    if (!accepted.ok) store.appendNumericPoint();
  }
  commit(): void {
    if (this.editable()) this.store().commitMark();
  }
  finish(): void {
    if (this.editable()) this.store().finishDrawing();
  }
  start(): void {
    if (this.editable()) this.store().startDrawing();
  }
  stop(): void {
    if (this.editable()) this.store().stopDrawing();
  }
  save(): void {
    if (this.editable() && this.store().marks().writable) void this.store().saveMarks();
  }
  reload(): void {
    if (this.editable()) void this.store().reloadMarks();
  }

  /** The parent may route exposed-canvas keys here; no document listener is installed. */
  handleKeydown(event: KeyboardEvent): void {
    if (
      !this.editable() ||
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;
    if (
      event
        .composedPath()
        .some(
          (target) =>
            target instanceof Element &&
            (target.matches('input, textarea, select') ||
              target.closest('[contenteditable]:not([contenteditable="false"])')),
        )
    )
      return;
    const store = this.store();
    let handled = false;
    if (event.key === 'Escape' && store.drawingActive()) {
      store.stopDrawing();
      handled = true;
    } else if (event.key === 'Delete') {
      const id = store.markForm().editingId;
      if (id) handled = store.removeMark(id).ok;
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
}
