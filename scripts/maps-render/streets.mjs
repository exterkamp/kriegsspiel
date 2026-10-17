// Settlement orientation measurements (#545): full battlefields over a seed corpus,
// with the share of road length within 2.5° of 0°, 45°, 90° or 135°.
// Build packages/maps first.
//   node scripts/maps-render/streets.mjs [--jobs 2] [--from 1] [--to 20] [preset ...]
// GENERATOR=<path to another packages/maps/dist/> generates with that build
// (e.g. main) and measures with this checkout's code. Each map also reports its
// generation time, so two runs interleaved give a benchmark.
import { fork } from 'node:child_process';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const HERE = new URL('../../packages/maps/dist/', import.meta.url);
const DIST = process.env.GENERATOR
  ? pathToFileURL(resolve(process.env.GENERATOR) + '/').href
  : HERE.href;

async function one(preset, seed) {
  const { battlefieldPreset, generateBattlefield } = await import(
    new URL('composition/index.js', DIST)
  );
  const { gridAligned, realismReport } = await import(new URL('realism.js', HERE));
  const input = battlefieldPreset(preset);
  input.seed = seed;
  const start = performance.now();
  const result = generateBattlefield(input);
  const ms = Math.round(performance.now() - start);
  if (!result.ok) return { preset, seed, ms, failed: result.diagnostics[0]?.code ?? 'FAIL' };
  const asset = result.value,
    report = realismReport(asset),
    sums = { street: [0, 0], track: [0, 0], all: [0, 0] };
  for (const road of asset.layers.roads)
    for (let i = 1; i < road.path.length; i++) {
      const a = road.path[i - 1],
        b = road.path[i],
        len = Math.hypot(b[0] - a[0], b[1] - a[1]),
        on = gridAligned(a, b) ? len : 0;
      for (const k of [
        road.kind === 'street' ? 'street' : road.kind === 'track' ? 'track' : null,
        'all',
      ])
        if (k) {
          sums[k][0] += on;
          sums[k][1] += len;
        }
    }
  return {
    preset,
    seed,
    ms,
    regional: [report.roads.gridAlignedShare * report.roads.lengthM, report.roads.lengthM],
    ...sums,
    rotations: asset.layers.sites.map((s) => s.rotationDeg),
    settlements: report.settlements,
  };
}

if (process.send) {
  process.on('message', async ({ preset, seed }) => {
    try {
      process.send(await one(preset, seed));
    } catch (e) {
      process.send({ preset, seed, failed: String(e?.stack ?? e).split('\n')[0] });
    }
  });
} else {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      from: { type: 'string', default: '1' },
      to: { type: 'string', default: '20' },
      jobs: { type: 'string', default: '2' },
    },
  });
  const presets = positionals.length ? positionals : ['river-valley', 'wooded-hills'],
    queue = [];
  for (const preset of presets)
    for (let seed = Number(values.from); seed <= Number(values.to); seed++)
      queue.push({ preset, seed });
  const rows = [];
  const pct = (s) => (s[1] ? `${((100 * s[0]) / s[1]).toFixed(1)}%` : '-');
  await Promise.all(
    Array.from({ length: Math.min(Number(values.jobs), queue.length) }, async () => {
      const child = fork(new URL(import.meta.url), [], {
        execArgv: ['--max-old-space-size=1024'],
      });
      for (let job = queue.shift(); job; job = queue.shift()) {
        const row = await new Promise((done) => {
          child.once('message', done);
          child.send(job);
        });
        rows.push(row);
        console.log(
          row.failed
            ? `${row.preset} ${row.seed} FAIL ${row.failed}`
            : `${row.preset} ${String(row.seed).padStart(2)} ${String(row.ms).padStart(6)}ms streets ${pct(row.street)} tracks ${pct(row.track)} regional ${pct(row.regional)} all ${pct(row.all)} rotations ${row.rotations.join(',')}`,
        );
      }
      child.kill();
    }),
  );
  for (const preset of [...presets, 'all']) {
    const set = rows.filter((r) => !r.failed && (preset === 'all' || r.preset === preset)),
      add = (k) => set.reduce((s, r) => [s[0] + r[k][0], s[1] + r[k][1]], [0, 0]),
      ms = set.map((r) => r.ms).sort((a, b) => a - b);
    console.log(
      `== ${preset} (${set.length} maps): streets ${pct(add('street'))} of ${(add('street')[1] / 1000).toFixed(1)} km, tracks ${pct(add('track'))}, regional ${pct(add('regional'))}, all roads ${pct(add('all'))} of ${(add('all')[1] / 1000).toFixed(1)} km; generate median ${ms[ms.length >> 1]} ms, total ${(ms.reduce((a, b) => a + b, 0) / 1000).toFixed(1)} s; max anchor slope ${Math.max(...set.map((r) => r.settlements.maxAnchorSlope)).toFixed(3)}, summits ${set.reduce((n, r) => n + r.settlements.summits, 0)}, low river flats ${set.reduce((n, r) => n + r.settlements.lowRiverFlats, 0)}`,
    );
  }
  const failed = rows.filter((r) => r.failed).length;
  if (failed) console.log(`${failed} maps failed`);
  process.exitCode = failed ? 1 : 0;
}
