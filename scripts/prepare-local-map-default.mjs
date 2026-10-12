import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Angular assets must be inside its workspace. Only development/test builds use this ignored copy.
const source = fileURLToPath(new URL('../data/maps/countryside-rectangle.json', import.meta.url));
const directory = fileURLToPath(new URL('../client/.local/local-defaults/', import.meta.url));
const destination = fileURLToPath(
  new URL('../client/.local/local-defaults/countryside-rectangle.json', import.meta.url),
);
const expected = '26c444cba00bb0320aaaf7605007d9a3557d317d4a3e989e69d3e75146de7c84';
const bytes = await readFile(source);
if (createHash('sha256').update(bytes).digest('hex') !== expected)
  throw new Error('The local default map differs from the pinned canonical rectangle');
await mkdir(directory, { recursive: true });
await writeFile(destination, bytes);
