import { describe, expect, it } from 'vitest';
import {
  battlefieldPreset,
  generateBattlefield,
  validateBattlefield,
} from '../src/composition/index.js';
import type { BattlefieldPreset } from '../src/composition/types.js';
import { canonicalizeAsset } from '../src/canonical.js';
import { importAsset } from '../src/import.js';

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
    },
    300_000,
  );
});
