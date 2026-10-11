import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [entry, reference] = process.argv.slice(2);
if (!entry || !reference)
  throw new Error('Usage: node replay.mjs <pristine-dist/index.js> <reference-report.json>');
const temporary = mkdtempSync(join(tmpdir(), 'maps-assessment-replay-'));
try {
  const report = join(temporary, 'report.json');
  execFileSync(
    process.execPath,
    [fileURLToPath(new URL('./run.mjs', import.meta.url)), entry, report],
    { stdio: 'pipe' },
  );
  const expected = JSON.parse(readFileSync(reference));
  const actual = JSON.parse(readFileSync(report));
  const identity = (data) =>
    data.rows.map((r) => [
      r.seed,
      r.candidate,
      r.fixture,
      r.canonicalGeojsonSha256,
      r.assessment,
      r.diagnostics,
      r.contractCircleGaps,
    ]);
  assert.deepEqual(actual.provenance, expected.provenance);
  assert.deepEqual(actual.checks, expected.checks);
  assert.deepEqual(identity(actual), identity(expected));
  console.log(
    `PASS: ${actual.rows.length} fixture hashes, complete geometry diagnostics, joins and checks match across fresh Node processes; elapsed timings excluded.`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
