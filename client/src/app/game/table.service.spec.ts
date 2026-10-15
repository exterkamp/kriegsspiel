import { computed, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import type { TableScene } from '@legacy/table/TableScene';
import type { BaseMap } from '@legacy/table/types';
import { fixtureMap, fixtureView } from '@legacy/table/fixture';
import { GameService } from './game.service';
import { TableService } from './table.service';

function setup() {
  const map = signal<BaseMap | undefined>(fixtureMap);
  const view = signal(fixtureView);
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: GameService, useValue: { map: map.asReadonly(), view: computed(() => view()) } },
    ],
  });
  const table = TestBed.inject(TableService);
  const scene = { snapTopDown: vi.fn(), dispose: vi.fn() } as unknown as TableScene;
  table.scene.set(scene);
  return { table, scene, map, view };
}

describe('TableService map lifetime', () => {
  it.each(['absent', 'same-ID replacement'])(
    'revokes the published scene synchronously for %s terrain before any consumer action/effect',
    (change) => {
      const b = setup();
      expect(b.table.scene()).toBe(b.scene);
      b.map.set(
        change === 'absent'
          ? undefined
          : { ...fixtureMap, features: fixtureMap.features.map((feature) => ({ ...feature })) },
      );
      // This is the HUD's direct camera-button expression; no change detection or host effect has run.
      b.table.scene()?.snapTopDown();
      expect(b.table.scene()).toBeUndefined();
      expect(b.scene.snapTopDown).not.toHaveBeenCalled();
      // Revoking a handle does not replace the host's explicit resource disposal ownership.
      expect(b.scene.dispose).not.toHaveBeenCalled();
    },
  );

  it('keeps the scene for ordinary view messages and accepts the next owner publication', () => {
    const b = setup();
    b.view.set({ ...fixtureView, atGame: fixtureView.atGame + 1 });
    expect(b.table.scene()).toBe(b.scene);
    b.map.set({ width: 8000, height: 3000, features: [] });
    expect(b.table.scene()).toBeUndefined();
    const replacement = { snapTopDown: vi.fn() } as unknown as TableScene;
    b.table.scene.set(replacement);
    b.table.scene()?.snapTopDown();
    expect(replacement.snapTopDown).toHaveBeenCalledTimes(1);
    expect(b.table.scene()).toBe(replacement);
  });
});
