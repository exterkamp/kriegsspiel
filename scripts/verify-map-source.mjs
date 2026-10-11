import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Verify the attributed source payload before compiling or running it. */
export function verifyMapSource(directory, manifest) {
  if (
    manifest.schema !== 'kriegsspiel/settlemaker-source-snapshot' ||
    manifest.schemaVersion !== 1 ||
    !/^[0-9a-f]{40}$/.test(manifest.revision) ||
    !/^[0-9a-f]{40}$/.test(manifest.tree) ||
    !/^[0-9a-f]{64}$/.test(manifest.sourceArchiveSha256)
  )
    throw new Error('Invalid source snapshot identity');
  const files = Object.keys(manifest.files).sort();
  if (!files.length || files.length > 1000) throw new Error('Invalid source snapshot size');
  let bytes = 0;
  for (const name of files) {
    if (
      name.startsWith('/') ||
      name.includes('\\') ||
      name.split('/').some((part) => !part || part === '.' || part === '..') ||
      !/^[0-9a-f]{64}$/.test(manifest.files[name])
    )
      throw new Error(`Invalid source snapshot path/hash: ${name}`);
    const path = resolve(directory, name);
    if (!lstatSync(path).isFile())
      throw new Error(`Source snapshot is not a regular file: ${name}`);
    const data = readFileSync(path);
    if (createHash('sha256').update(data).digest('hex') !== manifest.files[name])
      throw new Error(`Source snapshot differs from its pin: ${name}`);
    bytes += data.length;
  }
  const actual = [];
  const walk = (name) => {
    for (const entry of readdirSync(resolve(directory, name), { withFileTypes: true })) {
      const child = `${name}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) actual.push(child);
      else throw new Error(`Unexpected source snapshot entry: ${child}`);
    }
  };
  walk('src');
  const expected = files.filter((name) => name.startsWith('src/'));
  if (JSON.stringify(actual.sort()) !== JSON.stringify(expected))
    throw new Error('Source snapshot has missing or unexpected engine files');
  return { revision: manifest.revision, files: files.length, bytes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = fileURLToPath(new URL('../vendor/settlemaker/', import.meta.url));
  const manifest = JSON.parse(
    readFileSync(new URL('../vendor/settlemaker.snapshot.json', import.meta.url), 'utf8'),
  );
  console.log(JSON.stringify(verifyMapSource(directory, manifest)));
}
