// Grain and lattice-angle measurements (#540) over a seed corpus, from terrain
// and hydrology only (no roads or settlements). Build packages/maps first.
//   node scripts/maps-render/grain.mjs [presets=wooded-hills,river-valley] [seeds=1-20]
// GENERATOR=<path to another packages/maps/dist/index.js> generates with that
// build (e.g. main) and measures with this checkout's realism code.
import { grainRealism, summarizeGrain } from '../../packages/maps/dist/index.js';

const { generateElevation, generateHydrology, geographyPreset } = await import(
  process.env.GENERATOR ?? '../../packages/maps/dist/index.js'
);
const presets = (process.argv[2] ?? 'wooded-hills,river-valley').split(',');
const [first, last = first] = (process.argv[3] ?? '1-20').split('-').map(Number);
const pct = (v) => `${(100 * v).toFixed(1)}%`;
const all = [];
for (const preset of presets) {
  const reports = [];
  for (let seed = first; seed <= last; seed++) {
    const settings = geographyPreset(preset),
      bounds = { minX: 0, minY: 0, maxX: settings.widthM, maxY: settings.heightM },
      elevation = generateElevation(settings, seed);
    if (!elevation.ok) {
      console.log(`${preset} ${seed}: terrain failed`);
      continue;
    }
    const hydro = generateHydrology(elevation.value, bounds, settings, seed);
    const r = grainRealism({
      bounds,
      elevation: hydro.ok ? hydro.value.elevation : elevation.value,
      layers: { water: hydro.ok ? hydro.value.water : [] },
    });
    reports.push(r);
    const grid = r.riverGridShare.reduce((a, b) => a + b, 0);
    console.log(
      `${preset} ${String(seed).padStart(2)}: anisotropy ${r.anisotropy.toFixed(2)}  aspect ${r.aspectLatticeShare.map(pct).join(' ')}  rivers ${hydro.ok ? '' : '(hydrology failed) '}align ${r.riverGrainAlignment.toFixed(2)} grid ${pct(grid)}`,
    );
  }
  all.push(...reports);
  print(preset, summarizeGrain(reports));
}
if (presets.length > 1) print('all', summarizeGrain(all));
function print(name, s) {
  console.log(
    `== ${name} (${s.maps} maps): anisotropy mean ${s.meanAnisotropy.toFixed(3)} max ${s.maxAnisotropy.toFixed(2)}; aspect 0/45/90/135 ${s.aspectLatticeShare.map(pct).join(' / ')} (uniform 8.3%); river alignment ${s.riverGrainAlignment.toFixed(3)} (uniform 0.64), near grain ${pct(s.riverNearGrainShare)} (uniform 16.7%), grid ${s.riverGridShare.map(pct).join(' / ')} = ${pct(s.riverGridTotal)} (uniform 11.1%)`,
  );
}
