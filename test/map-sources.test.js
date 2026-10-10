import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../assets/maps/', import.meta.url);
const entries = JSON.parse(readFileSync(new URL('sources.json', dir), 'utf8'));
const required = [
  'file',
  'title',
  'holder',
  'itemUrl',
  'sha256',
  'verifiedOn',
  'licence',
  'usageTerms',
];
const scans = readdirSync(dir, { recursive: true }).filter((f) => /\.(jpe?g|png|tiff?)$/i.test(f));

test('every map entry is complete and matches its file', () => {
  for (const e of entries) {
    for (const k of required) assert.ok(e[k], `${e.file}: missing ${k}`);
    assert.match(e.itemUrl, /^https:\/\//, `${e.file}: itemUrl must be https`);
    const bytes = readFileSync(new URL(e.file, dir));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), e.sha256, `${e.file}: sha256`);
  }
});

test('every map scan has a sources entry', () => {
  const listed = new Set(entries.map((e) => e.file));
  for (const f of scans) assert.ok(listed.has(f), `${f} has no entry in assets/maps/sources.json`);
});
