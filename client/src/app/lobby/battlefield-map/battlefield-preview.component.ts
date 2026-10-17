import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import type { BattlefieldMap, BattlefieldPoint } from '@kriegsspiel/protocol';

/** Geography only; callers supply a checked public descriptor. SVG units are metres. */
@Component({
  selector: 'ks-battlefield-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './battlefield-preview.component.html',
  styleUrl: './battlefield-preview.component.css',
})
export class BattlefieldPreviewComponent {
  readonly map = input.required<BattlefieldMap>();
  readonly interactive = input(false);
  protected readonly scale = signal(1);
  private readonly centre = signal<{ x: number; y: number } | null>(null);
  private drag: { id: number; x: number; y: number } | null = null;
  protected readonly features = computed(() =>
    [...this.map().preview].sort(
      // Higher layers win; on equal layers the engine gives the smaller ID precedence.
      (a, b) => a.layer - b.layer || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
    ),
  );
  protected readonly box = computed(() => {
    const map = this.map();
    const width = map.widthM / this.scale();
    const height = map.heightM / this.scale();
    const centre = this.centre() ?? { x: map.widthM / 2, y: map.heightM / 2 };
    const x = Math.max(0, Math.min(map.widthM - width, centre.x - width / 2));
    const y = Math.max(0, Math.min(map.heightM - height, centre.y - height / 2));
    return { x, y, width, height };
  });
  protected readonly viewBox = computed(() => {
    const b = this.box();
    return `${b.x} ${b.y} ${b.width} ${b.height}`;
  });

  protected points(points: readonly BattlefieldPoint[]): string {
    return points.map((p) => `${p.x},${p.y}`).join(' ');
  }

  protected fit(): void {
    this.scale.set(1);
    this.centre.set(null);
    this.drag = null;
  }

  protected zoom(factor: number): void {
    const b = this.box();
    this.centre.set({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
    this.scale.update((n) => Math.max(1, Math.min(8, n * factor)));
  }

  protected pan(dx: number, dy: number): void {
    const b = this.box();
    this.centre.set({
      x: Math.max(b.width / 2, Math.min(this.map().widthM - b.width / 2, b.x + b.width / 2 + dx)),
      y: Math.max(
        b.height / 2,
        Math.min(this.map().heightM - b.height / 2, b.y + b.height / 2 + dy),
      ),
    });
  }

  protected key(event: KeyboardEvent): void {
    if (!this.interactive()) return;
    const b = this.box();
    switch (event.key) {
      case '+':
      case '=':
        this.zoom(2);
        break;
      case '-':
      case '−':
        this.zoom(0.5);
        break;
      case 'f':
      case 'F':
        this.fit();
        break;
      case 'ArrowLeft':
        this.pan(-b.width / 10, 0);
        break;
      case 'ArrowRight':
        this.pan(b.width / 10, 0);
        break;
      case 'ArrowUp':
        this.pan(0, -b.height / 10);
        break;
      case 'ArrowDown':
        this.pan(0, b.height / 10);
        break;
      case 'Escape':
        if (this.scale() === 1) return;
        this.fit();
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  protected pointerDown(event: PointerEvent): void {
    if (!this.interactive() || this.scale() === 1 || !event.isPrimary || event.button !== 0) return;
    (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }

  protected pointerMove(event: PointerEvent): void {
    if (!this.drag || this.drag.id !== event.pointerId) return;
    const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
    const b = this.box();
    // Account for preserveAspectRatio letterboxing rather than stretching coordinates.
    const pixelsPerMetre = Math.min(rect.width / b.width, rect.height / b.height);
    if (pixelsPerMetre > 0)
      this.pan(
        (this.drag.x - event.clientX) / pixelsPerMetre,
        (this.drag.y - event.clientY) / pixelsPerMetre,
      );
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }

  protected pointerEnd(): void {
    this.drag = null;
  }
}
