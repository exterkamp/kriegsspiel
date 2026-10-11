import { Injectable, signal } from '@angular/core';
import type { TableScene } from '@legacy/table/TableScene';

/** The one live `TableScene` (set by `TableHostComponent`) and the line of text the HUD shows beside the camera buttons. */
@Injectable({ providedIn: 'root' })
export class TableService {
  readonly scene = signal<TableScene | undefined>(undefined);
  readonly status = signal('Click the map');
}
