import {
  HARD_LIMITS,
  type MapAsset,
  type Polygon,
  type Point,
  type GenerationResult,
} from '../contract.js';
import { canonicalizeAsset } from '../canonical.js';
import { importAsset } from '../import.js';
import { utf8Bytes } from '../resources.js';
import { bounded, CompositionFailure } from './budget.js';
import { validateBattlefield } from './validate.js';

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
const line = (points: Point[]) => points.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
const polygon = (p: Polygon) => [p.outer, ...p.holes].map((r) => `${line(r)}Z`).join(' ');
/** Vector paths refer to the certified asset coordinates, never renderer geometry. */
export function exportBattlefield(
  asset: MapAsset,
): GenerationResult<{ json: string; svg: string }> {
  return bounded(() => {
    const json = canonicalizeAsset(asset),
      canonical = importAsset(json),
      validation = validateBattlefield(canonical);
    if (!validation.ok) return validation;
    const chunks: string[] = [];
    let bytes = 0;
    const add = (s: string) => {
      bytes += utf8Bytes(s);
      if (bytes > HARD_LIMITS.maxBytes)
        throw new CompositionFailure(
          'EXPORT_RESOURCE_LIMIT',
          'SVG bytes',
          'Vector output exceeds64MiB.',
        );
      chunks.push(s);
    };
    add(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canonical.bounds.maxX} ${canonical.bounds.maxY}" role="img"><title>${escape(canonical.name)}</title><desc>Local metres: x east, y south, z up. Complete-map-v1 certified geometry. GPL-3.0-only SettleMaker constrained layouts; distribution remains gated.</desc>`,
    );
    const polygons = (id: string, fill: string, rows: { id: string; polygons: Polygon[] }[]) => {
      add(`<g id="${id}" fill="${fill}" fill-rule="evenodd">`);
      for (const feature of rows)
        for (const p of feature.polygons)
          add(`<path data-feature="${feature.id}" d="${polygon(p)}"/>`);
      add('</g>');
    };
    add('<rect width="100%" height="100%" fill="#eee8d5"/>');
    for (const kind of ['open', 'field', 'wood'] as const)
      polygons(
        `cover-${kind}`,
        { open: '#eee8d5', field: '#d9cda3', wood: '#b1bea3' }[kind],
        canonical.layers.cover.filter((c) => c.kind === kind),
      );
    polygons('water', '#91b6c7', canonical.layers.water);
    add('<g id="contours" fill="none" stroke="#85795d">');
    for (const c of canonical.layers.contours)
      add(
        `<path data-feature="${c.id}" d="${line(c.path)}" stroke-width="${c.index ? 1.5 : 0.6}"/>`,
      );
    add('</g>');
    add(
      '<g id="roads" fill="none" stroke="#a37e59" stroke-linecap="round" stroke-linejoin="round">',
    );
    for (const r of canonical.layers.roads)
      add(`<path data-feature="${r.id}" d="${line(r.path)}" stroke-width="${r.surfaceWidthM}"/>`);
    add('</g>');
    polygons(
      'crossings',
      '#c7b59d',
      canonical.layers.crossings.map((c) => ({ id: c.id, polygons: [c.deck] })),
    );
    polygons(
      'buildings',
      '#70584b',
      canonical.layers.buildings.map((b) => ({ id: b.id, polygons: [b.footprint] })),
    );
    add('<g id="landmarks" fill="#302a20" font-family="serif" font-size="20">');
    for (const l of canonical.layers.landmarks)
      add(
        `<text data-feature="${l.id}" x="${l.position[0]}" y="${l.position[1]}">${escape(l.name)}</text>`,
      );
    add('</g></svg>');
    return { json, svg: chunks.join('') };
  });
}
