import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifyMapSource } from '../scripts/verify-map-source.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'kriegsspiel-source-integrity-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'src'));
  const contents = 'export const answer = 42;\n';
  writeFileSync(join(directory, 'src/index.ts'), contents);
  const manifest = {
    schema: 'kriegsspiel/settlemaker-source-snapshot',
    schemaVersion: 1,
    revision: '1'.repeat(40),
    tree: '2'.repeat(40),
    sourceArchiveSha256: '3'.repeat(64),
    files: { 'src/index.ts': createHash('sha256').update(contents).digest('hex') },
  };
  return { directory, manifest, contents };
}

test('accepts the exact recorded payload and rejects a source edit before compilation', (t) => {
  const { directory, manifest, contents } = fixture(t);
  assert.deepEqual(verifyMapSource(directory, manifest), {
    revision: manifest.revision,
    files: 1,
    bytes: Buffer.byteLength(contents),
  });
  writeFileSync(join(directory, 'src/index.ts'), contents.replace('42', '43'));
  assert.throws(() => verifyMapSource(directory, manifest), /differs from its pin/);
});

test('rejects an extra engine file that was never part of the pinned payload', (t) => {
  const { directory, manifest } = fixture(t);
  writeFileSync(join(directory, 'src/experimental.ts'), 'export const hidden = true;\n');
  assert.throws(() => verifyMapSource(directory, manifest), /unexpected engine files/);
});

test('rejects source manifest traversal paths', (t) => {
  const { directory, manifest } = fixture(t);
  manifest.files = { '../outside.ts': '4'.repeat(64) };
  assert.throws(() => verifyMapSource(directory, manifest), /Invalid source snapshot path/);
});
