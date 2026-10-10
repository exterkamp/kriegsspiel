import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import Ajv from 'ajv/dist/2020.js';

const dir = new URL('../src/data/', import.meta.url);
const load = (f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
const sources = load('sources.json');
const tableFiles = readdirSync(dir).filter(
  (f) => f.endsWith('.json') && !f.endsWith('.schema.json') && f !== 'sources.json'
);

test('sources.json validates', () => {
  const validate = ajv.compile(load('sources.schema.json'));
  assert.ok(validate(sources), JSON.stringify(validate.errors));
});

const validateTable = ajv.compile(load('rules-table.schema.json'));

// Every {source, locator} reference anywhere in a table must name a known source.
function refs(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => refs(n, out));
  else if (node && typeof node === 'object') {
    if ('source' in node && 'locator' in node) out.push(node);
    Object.values(node).forEach((n) => refs(n, out));
  }
  return out;
}

for (const f of tableFiles) {
  test(`${f} validates and every citation resolves`, () => {
    const t = load(f);
    assert.ok(validateTable(t), JSON.stringify(validateTable.errors));
    assert.equal(t.id, f.replace('.json', ''));
    for (const r of refs(t)) {
      assert.ok(sources[r.source], `${f}: unknown source ${r.source}`);
      assert.ok(r.locator.trim().length > 0);
    }
  });
}

test('every number in data has a citation on itself or an enclosing object', () => {
  const walk = (node, cited, path, f) => {
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, cited, `${path}[${i}]`, f));
    if (node && typeof node === 'object') {
      const own = Object.values(node).some((v) => v && typeof v === 'object' && 'locator' in v);
      const c = cited || own;
      for (const [k, v] of Object.entries(node)) {
        if (k.endsWith('source') && v && typeof v === 'object') continue;
        walk(v, c, `${path}.${k}`, f);
      }
    } else if (typeof node === 'number') {
      assert.ok(cited, `${f}: uncited number at ${path}`);
    }
  };
  for (const f of tableFiles) {
    const t = load(f);
    walk(t.data, Boolean(t.source), 'data', f);
  }
});

test('dice and fire rows are well formed', () => {
  const cc = load('casualties.json').data.close_combat_faces;
  for (const k of ['die_1', 'die_2', 'die_3', 'die_5']) assert.equal(cc[k].length, 6, k);
  const fire = load('fire.json').data;
  for (const t of ['infantry_half_battalion', 'artillery_12pdr_good_effect', 'artillery_12pdr_bad_effect'])
    for (const r of fire[t].rows) {
      assert.equal(r.by_die_face.length, 6);
      assert.ok(r.range_paces[0] < r.range_paces[1]);
    }
});

test('spot values match the sources', () => {
  // 1824 scan, march ruler bands; 1 Decimalzoll = 400 Schritt
  assert.deepEqual(load('march.json').data.ruler_bands.map((b) => b.paces), [200, 250, 600, 800, 900]);
  assert.equal(load('scale.json').data.paces_per_decimal_zoll, 400);
  assert.deepEqual(load('fire.json').data.infantry_half_battalion.rows[2].by_die_face, [20, 20, 10, 25, 50, 6]);
});
