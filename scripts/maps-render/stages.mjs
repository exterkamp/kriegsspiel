// Per-stage timing probe: node scripts/maps-render/stages.mjs <preset> <seed> [sizeM]
import { battlefieldPreset } from '../../packages/maps/dist/composition/index.js';
import { generateElevation, extractContours } from '../../packages/maps/dist/terrain/index.js';
import { generateGeography } from '../../packages/maps/dist/geography/index.js';
import { generatePlanning } from '../../packages/maps/dist/planning/index.js';

const [preset, seed, size] = process.argv.slice(2);
const input = battlefieldPreset(preset);
input.seed = Number(seed);
if (size) input.settings.widthM = input.settings.heightM = Number(size);
const s = input.settings;
const bounds = { minX: 0, minY: 0, maxX: s.widthM, maxY: s.heightM };
const times = {};
let t = performance.now();
const lap = (k) => {
  const now = performance.now();
  times[k] = Math.round(now - t);
  t = now;
};
const ground = generateElevation(s, input.seed);
lap('elevation');
if (!ground.ok) throw new Error(JSON.stringify(ground));
const geo = generateGeography(ground.value, bounds, s, input.seed);
lap('geography');
if (!geo.ok) throw new Error(JSON.stringify(geo));
const contours = extractContours(geo.value.elevation, bounds, s);
lap('contours');
const plan = generatePlanning({
  settings: s,
  seed: input.seed,
  bounds,
  elevation: geo.value.elevation,
  water: geo.value.water,
  cover: geo.value.cover,
  crossingCandidates: geo.value.crossingCandidates,
  overrides: [],
  requireBridge: s.hydrology.requireRiver,
  preferredSiteExtentM: { farm: 50 },
});
lap('planning');
const water = geo.value.water;
console.log(
  JSON.stringify({
    times,
    water: {
      rivers: water.filter((w) => w.kind === 'river').length,
      lakes: water.filter((w) => w.kind === 'lake').length,
    },
    candidates: geo.value.crossingCandidates.length,
    contours: contours.ok ? contours.value.length : contours,
    plan: plan.ok
      ? {
          roads: plan.value.roads.length,
          crossings: plan.value.crossings.length,
          evidence: plan.value.evidence,
        }
      : plan.diagnostics,
  }),
);
