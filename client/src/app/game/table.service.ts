import { Injectable, InjectionToken, inject, linkedSignal, signal } from '@angular/core';
import { TableScene } from '@legacy/table/TableScene';
import type { BaseMap } from '@legacy/table/types';
import { GameService } from './game.service';

/** The one live `TableScene` (set by `TableHostComponent`) and the line of text the HUD shows beside the camera buttons. */
@Injectable({ providedIn: 'root' })
export class TableService {
  private readonly game = inject(GameService);
  /** Consumers must stop seeing the old scene before the host's disposal effect runs. The host owns disposal. */
  readonly scene = linkedSignal<BaseMap | undefined, TableScene | undefined>({
    source: () => this.game.map(),
    computation: () => undefined,
  });
  readonly status = signal('Click the map');
  /** Set when the browser could not make a WebGL context (#259): the host then shows a message and a unit list instead of the table. */
  readonly unavailable = signal<string | undefined>(undefined);
}

/** Builds the scene for a canvas. A spec provides a fake, because jsdom has no WebGL. */
export const TABLE_SCENE_FACTORY = new InjectionToken<(canvas: HTMLCanvasElement) => TableScene>(
  'TABLE_SCENE_FACTORY',
  { factory: () => (canvas) => new TableScene(canvas) },
);
