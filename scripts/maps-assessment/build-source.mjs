import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

// Assessment only: archive committed objects, never build the dirty checkout.
const [repository, output] = process.argv.slice(2);
if (!repository || !output) {
  throw new Error('Usage: node build-source.mjs <local-git-repository> <new-output-directory>');
}
const revision = 'd5cf3590cf59e1d382110d25a6910f12507299e2';
const repo = resolve(repository);
const out = resolve(output);
mkdirSync(out); // Refuse an existing output, so stale build files cannot enter evidence.
const source = join(out, 'source');
mkdirSync(source);
const run = (command, args, cwd = source) => {
  execFileSync(command, args, { cwd, stdio: 'inherit' });
};
run('git', [
  '-C',
  repo,
  'archive',
  '--format=tar',
  `--output=${join(out, 'source.tar')}`,
  revision,
]);
run('tar', ['-xf', join(out, 'source.tar'), '-C', source]);
const dependencyRoot = join(repo, 'node_modules');
symlinkSync(dependencyRoot, join(source, 'node_modules'), 'dir');
const lockBytes = readFileSync(join(source, 'package-lock.json'));
const lock = JSON.parse(lockBytes);
const versions = {};
for (const name of [
  'typescript',
  'esbuild',
  'polygon-clipping',
  'splaytree',
  'robust-predicates',
  '@types/geojson',
]) {
  const installed = JSON.parse(readFileSync(join(dependencyRoot, name, 'package.json'))).version;
  const locked = lock.packages[`node_modules/${name}`];
  if (installed !== locked.version || !locked.integrity)
    throw new Error(`Installed ${name} does not match an integrity-bearing lock entry`);
  versions[name] = installed;
}
run(process.execPath, [
  join(dependencyRoot, 'typescript/bin/tsc'),
  '--project',
  join(source, 'tsconfig.json'),
]);
run(join(dependencyRoot, '.bin/esbuild'), [
  'src/index.ts',
  '--bundle',
  '--format=esm',
  '--target=es2022',
  '--minify',
  '--outfile=dist/settlemaker.browser.js',
  `--banner:js=/* settlemaker — GPL-3.0-only. Corresponding source: https://github.com/dfezzie/settlemaker/tree/${revision} */`,
]);
const provenance = {
  revision,
  tree: execFileSync('git', ['-C', repo, 'rev-parse', `${revision}^{tree}`], {
    encoding: 'utf8',
  }).trim(),
  lockSha256: createHash('sha256').update(lockBytes).digest('hex'),
  node: process.version,
  platform: `${process.platform}/${process.arch}`,
  versions,
  sourceStrategy: 'pristine git archive; existing dependencies reused, no install or network',
};
writeFileSync(
  join(source, 'dist/assessment-provenance.json'),
  `${JSON.stringify(provenance, null, 2)}\n`,
);
console.log(JSON.stringify({ entrypoint: join(source, 'dist/index.js'), provenance }, null, 2));
