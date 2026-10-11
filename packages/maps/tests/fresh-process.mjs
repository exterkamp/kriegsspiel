import {
  assetIdentity,
  canonicalGeometry,
  createReferenceAsset,
  deriveSeed,
} from '../dist/index.js';
const asset = createReferenceAsset();
if (process.argv.includes('--reverse')) {
  asset.layers.cover.reverse();
  asset.layers.roadNodes.reverse();
}
console.log(
  JSON.stringify({
    geometry: canonicalGeometry(asset),
    hashes: await Promise.all(
      ['asset', 'geometry', 'recipe'].map((kind) => assetIdentity(asset, kind)),
    ),
    streams: ['terrain:v1', 'contours:v1', 'roads:v1'].map((stage) => deriveSeed(7, stage)),
  }),
);
