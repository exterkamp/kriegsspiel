import { Injectable, InjectionToken, signal } from '@angular/core';
import { TableScene } from '@legacy/table/TableScene';

/** The one live `TableScene` (set by `TableHostComponent`) and the line of text the HUD shows beside the camera buttons. */
@Injectable({ providedIn: 'root' })
export class TableService {
  readonly scene = signal<TableScene | undefined>(undefined);
  readonly status = signal('Click the map');
}

/** Builds the scene for a canvas. A spec provides a fake, because jsdom has no WebGL. */
export const TABLE_SCENE_FACTORY = new InjectionToken<(canvas: HTMLCanvasElement) => TableScene>(
  'TABLE_SCENE_FACTORY',
  { factory: () => (canvas) => new TableScene(canvas) },
);
