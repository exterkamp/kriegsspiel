import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import {
  DEFAULT_SETTINGS,
  assetIdentity,
  battlefieldPreset,
  canonicalizeAsset,
  generateBattlefield,
  validateBattlefield,
} from '../../packages/maps/dist/index.js';

// Run one case per fresh process so maxRSS includes the complete pipeline,
// without carrying allocations from earlier recipes. Node reports maxRSS in KiB.
const [preset = 'flat-countryside', seedText = '17', extentText = '5000', output] =
  process.argv.slice(2);
const seed = Number(seedText);
const extent = Number(extentText);
const recipe =
  preset === 'default'
    ? { seed, settings: structuredClone(DEFAULT_SETTINGS), overrides: [] }
    : { ...battlefieldPreset(preset), seed };
recipe.settings.widthM = recipe.settings.heightM = extent;
const ambientRandom = Math.random;
const wallClock = Date.now;
Math.random = () => {
  throw new Error('Generation accessed ambient randomness');
};
Date.now = () => {
  throw new Error('Generation accessed the wall clock');
};
const start = performance.now();
let result;
try {
  result = generateBattlefield(recipe);
} finally {
  Math.random = ambientRandom;
  Date.now = wallClock;
}
const generationMs = performance.now() - start;
const record = {
  preset,
  seed,
  extent,
  recipe,
  generationMs,
  generationPeakRssMiB: process.resourceUsage().maxRSS / 1024,
  ok: result.ok,
};
if (result.ok) {
  const validationStart = performance.now();
  const checked = validateBattlefield(result.value);
  record.validationMs = performance.now() - validationStart;
  if (!checked.ok)
    throw new Error(`Independent validation failed: ${JSON.stringify(checked.diagnostics)}`);
  record.validation = checked.value;
  record.geometryIdentity = await assetIdentity(result.value, 'geometry');
  record.assetIdentity = await assetIdentity(result.value, 'asset');
  record.features = Object.fromEntries(
    Object.entries(result.value.layers).map(([name, rows]) => [name, rows.length]),
  );
  if (output) writeFileSync(output, canonicalizeAsset(result.value));
} else record.diagnostics = result.diagnostics;
record.peakRssMiB = process.resourceUsage().maxRSS / 1024;
record.node = process.version;
record.nodeExecArgv = process.execArgv;
record.nodeOptionsUsed = Boolean(process.env.NODE_OPTIONS);
record.oldSpaceProfileMiB = process.execArgv.includes('--max-old-space-size=256') ? 256 : null;
record.v8HeapLimitMiB = getHeapStatistics().heap_size_limit / 1024 / 1024;
console.log(JSON.stringify(record));
