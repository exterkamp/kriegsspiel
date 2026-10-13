import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import {
  copyFileSync,
  cpSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyMapSource } from './verify-map-source.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'vendor/settlemaker');
const manifest = JSON.parse(readFileSync(join(root, 'vendor/settlemaker.snapshot.json'), 'utf8'));
verifyMapSource(source, manifest);
if (
  !manifest.artifact ||
  !/^[0-9a-f]{64}$/.test(manifest.artifact.packageSha256) ||
  !/^sha512-[A-Za-z0-9+/]{86}==$/.test(manifest.artifact.packageIntegrity) ||
  !/^[0-9a-f]{64}$/.test(manifest.artifact.tarSha256)
)
  throw new Error('Missing or invalid consumed engine artifact integrity');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
// Node refuses to spawn .cmd files without a shell (CVE-2024-27980).
const shell = process.platform === 'win32';
execFileSync(
  npm,
  ['ci', '--workspaces=false', '--ignore-scripts', '--cache', join(root, '.cache/maps-npm')],
  { cwd: source, stdio: 'inherit', shell },
);
execFileSync(npm, ['run', 'build', '--workspaces=false'], {
  cwd: source,
  stdio: 'inherit',
  shell,
});

// Install the exact measured runtime tarball, never an ignored source checkout
// or a floating workspace link. Only engine source/object code enters this pack.
const temporary = mkdtempSync(join(tmpdir(), 'kriegsspiel-map-package-'));
try {
  for (const name of Object.keys(manifest.files))
    cpSync(join(source, name), join(temporary, name), { recursive: true });
  cpSync(join(source, 'dist'), join(temporary, 'dist'), { recursive: true });
  const packageJson = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
  packageJson.name = '@kriegsspiel/settlemaker';
  packageJson.scripts = { build: 'tsc -p tsconfig.json' };
  delete packageJson.devDependencies;
  writeFileSync(join(temporary, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
  const [packed] = JSON.parse(
    execFileSync(npm, ['pack', '--ignore-scripts', '--json'], {
      cwd: temporary,
      encoding: 'utf8',
      shell,
    }),
  );
  const tarball = join(temporary, packed.filename);
  const rebuiltBytes = readFileSync(tarball);
  const tarSha256 = createHash('sha256').update(gunzipSync(rebuiltBytes)).digest('hex');
  if (tarSha256 !== manifest.artifact.tarSha256)
    throw new Error(`Rebuilt SettleMaker tar payload differs: ${tarSha256}`);
  // Node ships different zlib implementations on macOS and Linux. Verify the
  // entire rebuilt tar byte-for-byte, then use the original canonical gzip
  // encoding to preserve the already certified consumed package identity.
  const canonical = join(root, 'vendor/settlemaker-runtime.canonical.tgz');
  const bytes = readFileSync(canonical);
  if (createHash('sha256').update(gunzipSync(bytes)).digest('hex') !== tarSha256)
    throw new Error('Canonical gzip does not encode the rebuilt source package');
  const identity = {
    packageSha256: createHash('sha256').update(bytes).digest('hex'),
    packageIntegrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  };
  if (
    identity.packageSha256 !== manifest.artifact.packageSha256 ||
    identity.packageIntegrity !== manifest.artifact.packageIntegrity
  )
    throw new Error('Canonical SettleMaker runtime package differs from its recorded integrity');
  const destination = join(root, 'vendor/settlemaker-runtime.tgz');
  copyFileSync(canonical, `${destination}.tmp`);
  renameSync(`${destination}.tmp`, destination);
  console.log(
    JSON.stringify({ ...identity, tarSha256, node: process.version, zlib: process.versions.zlib }),
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
