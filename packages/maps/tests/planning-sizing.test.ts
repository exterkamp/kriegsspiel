import { expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type GenerationResult } from '../src/contract.js';
import { generatePlanning, validatePlanning, type PlanningInput } from '../src/planning/index.js';

function input(): PlanningInput {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.widthM = settings.heightM = 200;
  settings.settlements.villageCount = 0;
  settings.settlements.farmCount = 1;
  settings.settlements.minSpacingM = 25;
  settings.roads.extraLinks = 0;
  return {
    settings,
    seed: 17,
    water: [],
    bounds: { minX: 0, minY: 0, maxX: 200, maxY: 200 },
    elevation: { columns: 9, rows: 9, spacingM: 25, samples: Array(81).fill(0) },
  };
}
function value<T>(r: GenerationResult<T>): T {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.value;
}
it('selects a larger certified footprint within unchanged recorded limits', () => {
  const a = input();
  const baseline = value(generatePlanning(a));
  expect(baseline.sizes[0]!.extentM).toBe(25);
  a.preferredSiteExtentM = { farm: 50 };
  const planned = value(generatePlanning(a));
  expect(planned.sizes[0]).toMatchObject({ extentM: 50, areaM2: 2500 });
  expect(planned.sites[0]!.id).toBe(baseline.sites[0]!.id);
  expect(planned.sites[0]!.population.requested).toBe(12);
  expect(validatePlanning(a, planned).ok).toBe(true);
  expect(a.settings).toEqual(input().settings);
});
it.each([{ farm: 19 }, { farm: 101 }, { farm: NaN }, { farm: Infinity }, { city: 50 }, null, []])(
  'rejects invalid preferences instead of clamping or weakening limits: %j',
  (preferred) => {
    const a = input();
    a.preferredSiteExtentM = preferred as PlanningInput['preferredSiteExtentM'];
    expect(() => generatePlanning(a)).toThrow();
  },
);
it('rejects an accessor preference without invoking it', () => {
  const a = input();
  const getter = vi.fn(() => 50);
  a.preferredSiteExtentM = Object.defineProperty({}, 'farm', { enumerable: true, get: getter });
  expect(() => generatePlanning(a)).toThrow();
  expect(getter).not.toHaveBeenCalled();
});
