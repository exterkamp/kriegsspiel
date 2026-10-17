// Generate and certify every seed of the default presets (#542).
// npm run build -w packages/maps
// node scripts/maps-render/sweep.mjs [--from 1] [--to 50] [--jobs 4] [preset ...]
// Prints one line per map (ok with a canonical hash, FAIL with diagnostics, or
// THROW with the stack) and exits non-zero unless every map certifies.
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';

const DIST = new URL('../../packages/maps/dist/', import.meta.url);
const PRESETS = ['flat-countryside', 'wooded-hills', 'river-valley'];

async function one(preset, seed) {
  const { battlefieldPreset, generateBattlefield, validateBattlefield } = await import(
    new URL('composition/index.js', DIST)
  );
  const { canonicalizeAsset } = await import(new URL('canonical.js', DIST));
  const { importAsset } = await import(new URL('import.js', DIST));
  const input = battlefieldPreset(preset);
  input.seed = seed;
  const start = performance.now();
  try {
    const result = generateBattlefield(input);
    const ms = Math.round(performance.now() - start);
    if (!result.ok) return `${preset} ${seed} FAIL ${ms}ms ${JSON.stringify(result.diagnostics)}`;
    const json = canonicalizeAsset(result.value),
      certified = validateBattlefield(importAsset(json));
    if (!certified.ok)
      return `${preset} ${seed} FAIL certify ${JSON.stringify(certified.diagnostics)}`;
    const hash = createHash('sha256').update(json).digest('hex').slice(0, 16);
    return `${preset} ${seed} ok ${hash} ${ms}ms`;
  } catch (e) {
    return `${preset} ${seed} THROW ${String(e?.stack ?? e)
      .split('\n')
      .slice(0, 6)
      .join(' | ')}`;
  }
}

if (process.send) {
  process.on('message', async ({ preset, seed }) => process.send(await one(preset, seed)));
} else {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      from: { type: 'string', default: '1' },
      to: { type: 'string', default: '50' },
      jobs: { type: 'string', default: String(Math.max(1, availableParallelism() - 1)) },
    },
  });
  const presets = positionals.length ? positionals : PRESETS,
    queue = [];
  for (const preset of presets)
    for (let seed = Number(values.from); seed <= Number(values.to); seed++)
      queue.push({ preset, seed });
  const total = queue.length,
    lines = [];
  await Promise.all(
    Array.from({ length: Math.min(Number(values.jobs), total) }, async () => {
      let child;
      for (let job = queue.shift(); job; job = queue.shift()) {
        child ??= fork(new URL(import.meta.url), [], { execArgv: ['--max-old-space-size=1024'] });
        const line = await new Promise((resolve) => {
          const crash = (code) => {
            child = undefined;
            resolve(`${job.preset} ${job.seed} CRASH exit ${code}`);
          };
          child.once('exit', crash);
          child.once('message', (message) => {
            child.off('exit', crash);
            resolve(message);
          });
          child.send(job);
        });
        console.log(line);
        lines.push(line);
      }
      child?.kill();
    }),
  );
  const ok = lines.filter((l) => / ok /.test(l)).length;
  console.log(`${ok} / ${total} maps generate and certify`);
  process.exitCode = ok === total ? 0 : 1;
}
