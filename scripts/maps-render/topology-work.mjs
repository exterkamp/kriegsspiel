// Smallest import topology cap a saved asset needs (binary search on parseAsset):
//   node scripts/maps-render/topology-work.mjs <asset.json>...
// Saved maps must import under the 5,000,000-check hard limit; this shows the headroom.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseAsset } from '../../packages/maps/dist/index.js';

for (const file of process.argv.slice(2)) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  const fits = (cap) => {
    try {
      parseAsset(raw, { maxTopologyChecks: cap });
      return true;
    } catch (error) {
      if (/Topology work exceeds/.test(String(error))) return false;
      throw error;
    }
  };
  let lo = 1,
    hi = 5_000_000;
  if (!fits(hi)) {
    console.log(JSON.stringify({ map: basename(file, '.json'), topologyChecks: '>5000000' }));
    continue;
  }
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  const cover = raw.layers.cover;
  const vertices = cover.reduce(
    (n, f) => n + f.polygons.reduce((m, p) => m + p.outer.length + p.holes.flat().length, 0),
    0,
  );
  console.log(
    JSON.stringify({
      map: basename(file, '.json'),
      topologyChecks: hi,
      coverFeatures: cover.length,
      coverVertices: vertices,
      bytes: readFileSync(file).length,
    }),
  );
}
