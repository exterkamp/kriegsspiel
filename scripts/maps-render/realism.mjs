// Print realism metrics for saved assets: node scripts/maps-render/realism.mjs <asset.json>...
// Uses the current package's report on any contract-valid asset (older generators included).
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { importAsset, realismReport } from '../../packages/maps/dist/index.js';

for (const file of process.argv.slice(2)) {
  const report = realismReport(importAsset(readFileSync(file, 'utf8')));
  console.log(JSON.stringify({ map: basename(file, '.json'), ...report }));
}
