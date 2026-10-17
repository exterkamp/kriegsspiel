// Generate and certify one canonical asset.
// node --max-old-space-size=256 scripts/maps-render/gen-one.mjs <preset> <seed> <sizeM|''> <outDir>
import { writeFileSync } from 'node:fs';
import {
  battlefieldPreset,
  generateBattlefield,
  exportBattlefield,
} from '../../packages/maps/dist/composition/index.js';

const [preset, seed, size, out] = process.argv.slice(2);
const input = battlefieldPreset(preset);
input.seed = Number(seed);
if (size) input.settings.widthM = input.settings.heightM = Number(size);
const start = performance.now();
const result = generateBattlefield(input);
const generateMs = performance.now() - start;
if (!result.ok) {
  console.log(JSON.stringify({ ok: false, generateMs, failure: result }).slice(0, 2000));
  process.exit(1);
}
const exported = exportBattlefield(result.value);
const totalMs = performance.now() - start;
if (!exported.ok) {
  console.log(JSON.stringify({ ok: false, exported }).slice(0, 2000));
  process.exit(1);
}
const name = `${preset}-${seed}${size ? `-${Number(size) / 1000}km` : ''}`;
writeFileSync(`${out}/${name}.json`, exported.value.json);
const l = result.value.layers;
console.log(
  JSON.stringify({
    ok: true,
    name,
    generateMs: Math.round(generateMs),
    generateAndCertifyMs: Math.round(totalMs),
    maxRSSMiB: Math.round(process.resourceUsage().maxRSS / 1024),
    water: l.water.length,
    roads: l.roads.length,
    crossings: l.crossings.length,
    buildings: l.buildings.length,
  }),
);
