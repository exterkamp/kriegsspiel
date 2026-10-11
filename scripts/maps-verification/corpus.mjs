import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const output = process.argv[2];
if (!output) throw new Error('Usage: node scripts/maps-verification/corpus.mjs report.json');
const presets = ['flat-countryside', 'wooded-hills', 'river-valley'];
const seeds = {
  'flat-countryside': [0, 1, 2, 7, 17, 23, 41],
  'wooded-hills': [3, 5, 11, 19, 31, 43, 59],
  'river-valley': [13, 29, 47, 61, 73, 89, 97],
};
const records = [];
const runner = fileURLToPath(new URL('./case.mjs', import.meta.url));
for (const preset of presets) {
  for (const seed of seeds[preset]) {
    const child = spawnSync(
      process.execPath,
      ['--max-old-space-size=256', runner, preset, String(seed), '5000'],
      {
        encoding: 'utf8',
        timeout: 120_000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    if (child.error || child.status !== 0) {
      throw new Error(`${preset}/${seed}: ${child.error?.message ?? child.stderr}`);
    }
    const record = JSON.parse(child.stdout.trim());
    records.push(record);
    writeFileSync(output, `${JSON.stringify({ records }, null, 2)}\n`);
    console.log(
      `${preset}/${seed}: ${record.ok ? 'valid' : 'bounded infeasibility'} ${record.generationMs.toFixed(1)}ms`,
    );
  }
}
for (const [preset, seed] of presets.map((name, i) => [name, [17, 31, 97][i]])) {
  if (!records.find((r) => r.preset === preset && r.seed === seed)?.ok) {
    throw new Error(`Required representative failed: ${preset}/${seed}`);
  }
}
