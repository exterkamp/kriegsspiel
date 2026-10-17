import { describe, expect, it } from 'vitest';
import {
  battlefieldPreset,
  generateBattlefield,
  validateBattlefield,
} from '../src/composition/index.js';
import type { BattlefieldPreset } from '../src/composition/types.js';
import { canonicalizeAsset } from '../src/canonical.js';
import { importAsset } from '../src/import.js';
import { gridAligned, realismReport } from '../src/realism.js';
import type { Road } from '../src/contract.js';

/**
 * Every default preset generates a certified map for every seed (#542). The
 * full sweep, seeds 1–50 of each preset at default size, takes about half an
 * hour of CPU, so CI runs the seeds that failed on main before #542 (each a
 * different root cause) plus the first seed of each preset. Run the full
 * sweep with `node scripts/maps-render/sweep.mjs` after `npm run build -w
 * packages/maps`.
 */
const SEEDS: [BattlefieldPreset, number, string][] = [
  ['flat-countryside', 1, 'baseline'],
  ['flat-countryside', 13, 'collinear roads through a junction read as an overlap'],
  ['wooded-hills', 1, 'baseline'],
  ['wooded-hills', 2, 'ford probe outside the map threw a RangeError'],
  ['wooded-hills', 11, 'ford probe outside the map threw a RangeError'],
  ['wooded-hills', 44, 'ford probe outside the map threw a RangeError'],
  ['river-valley', 1, 'baseline'],
  ['river-valley', 25, 'collinear roads through a junction read as an overlap'],
  ['river-valley', 35, 'touching reach components threw in cover'],
  ['river-valley', 44, 'boundary exit in a pocket no road reaches'],
];

/** Street and total road length on the grid angles, summed over the maps above (#545). */
const aligned: Record<'streets' | 'all', [number, number]> = { streets: [0, 0], all: [0, 0] };
function measure(roads: Road[]) {
  for (const road of roads)
    for (let i = 1; i < road.path.length; i++) {
      const [a, b] = [road.path[i - 1]!, road.path[i]!],
        len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (const k of road.kind === 'street' ? (['streets', 'all'] as const) : (['all'] as const)) {
        aligned[k][1] += len;
        if (gridAligned(a, b)) aligned[k][0] += len;
      }
    }
}

describe('default presets generate for every seed (#542)', () => {
  it.each(SEEDS)(
    '%s seed %i generates and certifies (%s)',
    (preset, seed) => {
      const input = battlefieldPreset(preset);
      input.seed = seed;
      let result: ReturnType<typeof generateBattlefield> | undefined;
      expect(() => (result = generateBattlefield(input))).not.toThrow();
      if (!result!.ok) expect.fail(JSON.stringify(result!.diagnostics));
      expect(result!.value.provenance.seed).toBe(seed);
      const saved = importAsset(canonicalizeAsset(result!.value)),
        certified = validateBattlefield(saved);
      if (!certified.ok) expect.fail(JSON.stringify(certified.diagnostics));
      // Turned sites (#545) keep their realism: gentle anchors, no summit or river flat.
      const report = realismReport(saved);
      expect(report.settlements.maxAnchorSlope).toBeLessThanOrEqual(
        saved.settings.settlements.maxBuildingGradient,
      );
      expect(report.settlements.summits).toBe(0);
      expect(report.settlements.lowRiverFlats).toBe(0);
      expect(saved.layers.sites.every((s) => Number.isInteger(s.rotationDeg))).toBe(true);
      measure(saved.layers.roads);
    },
    300_000,
  );

  it('turns settlements off the grid angles (#545)', () => {
    // Unturned sites put 99% of street length and about 34% of all road length
    // within 2.5° of 0°, 45°, 90° or 135°; uniform bearings give 11%.
    const share = (k: 'streets' | 'all') => aligned[k][0] / aligned[k][1];
    console.info(
      `grid-aligned streets ${(100 * share('streets')).toFixed(1)}%, all roads ${(100 * share('all')).toFixed(1)}%`,
    );
    expect(share('streets')).toBeLessThanOrEqual(0.25);
    expect(share('all')).toBeLessThanOrEqual(0.2);
  });
});
