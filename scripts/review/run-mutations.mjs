import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  realpath,
  lstat,
  readdir,
  readlink,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { runProcess } from './process.mjs';
import { inspectPhase, classifyCase } from './results.mjs';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const jsonWrite = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n');
const git = (root, ...args) =>
  execFileSync('git', ['--no-optional-locks', '-C', root, ...args], {
    maxBuffer: 256 * 1024 * 1024,
  });
const inside = (root, path) => path === root || path.startsWith(root + sep);

export function safePath(path) {
  if (
    typeof path !== 'string' ||
    !path ||
    path.includes('\\') ||
    path.includes('\0') ||
    isAbsolute(path) ||
    path.split('/').some((p) => !p || p === '.' || p === '..') ||
    path.startsWith('-')
  )
    throw new Error(`Unsafe repository path: ${path}`);
  return path;
}
function keys(value, allowed) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !allowed.includes(k)) ||
    allowed.some((k) => !(k in value))
  )
    throw new Error('Unexpected or missing manifest fields');
}
export function validateManifest(manifest) {
  keys(manifest, ['schema', 'cases']);
  if (
    manifest.schema !== 1 ||
    !Array.isArray(manifest.cases) ||
    !manifest.cases.length ||
    manifest.cases.length > 10
  )
    throw new Error('Manifest requires 1–10 reviewed cases');
  const ids = new Set();
  for (const c of manifest.cases) {
    keys(c, [
      'id',
      'invariant',
      'rationale',
      'source',
      'sourceSha256',
      'before',
      'after',
      'selected',
      'testSha256',
      'expected',
      'timeoutMs',
    ]);
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(c.id) || ids.has(c.id))
      throw new Error('Invalid or duplicate case ID');
    ids.add(c.id);
    safePath(c.source);
    if (!/^client\/src\/hq\/.*\.(ts|svelte)$/.test(c.source) || /\.(test|spec)\./.test(c.source))
      throw new Error('Only HQ production sources may be mutated');
    if (
      ![c.invariant, c.rationale, c.before].every((v) => typeof v === 'string' && v.length) ||
      typeof c.after !== 'string' ||
      c.before === c.after ||
      !/^[a-f0-9]{64}$/.test(c.sourceSha256) ||
      !Number.isInteger(c.timeoutMs) ||
      c.timeoutMs < 100 ||
      c.timeoutMs > 120000
    )
      throw new Error('Invalid recipe content/digest/timeout');
    if (
      !Array.isArray(c.selected) ||
      !c.selected.length ||
      !Array.isArray(c.expected) ||
      !c.expected.length
    )
      throw new Error('Explicit selected tests and expected assertions required');
    const selected = new Set();
    for (const t of c.selected) {
      keys(t, ['file', 'name']);
      safePath(t.file);
      if (
        !/^client\/src\/hq\/.*\.test\.ts$/.test(t.file) ||
        typeof t.name !== 'string' ||
        !t.name.length ||
        selected.has(`${t.file}\0${t.name}`)
      )
        throw new Error('Invalid or duplicate selected test');
      selected.add(`${t.file}\0${t.name}`);
    }
    const files = [...new Set(c.selected.map((t) => t.file))].sort();
    if (!c.testSha256 || !Array.isArray(c.testSha256) || c.testSha256.length !== files.length)
      throw new Error('Test digests required');
    for (let i = 0; i < files.length; i++) {
      keys(c.testSha256[i], ['file', 'sha256']);
      if (c.testSha256[i].file !== files[i] || !/^[a-f0-9]{64}$/.test(c.testSha256[i].sha256))
        throw new Error('Test digests must match selected files in sorted order');
    }
    for (const e of c.expected) {
      keys(e, ['file', 'name', 'line', 'column', 'message']);
      if (
        !selected.has(`${e.file}\0${e.name}`) ||
        !Number.isInteger(e.line) ||
        e.line < 1 ||
        !Number.isInteger(e.column) ||
        e.column < 1 ||
        typeof e.message !== 'string' ||
        !e.message
      )
        throw new Error('Invalid expected assertion');
    }
  }
  return manifest;
}
export async function checkedFile(root, path) {
  const target = resolve(root, safePath(path));
  if (
    !inside(root, target) ||
    !inside(await realpath(root), await realpath(target)) ||
    !(await lstat(target)).isFile()
  )
    throw new Error(`Non-regular or escaping file: ${path}`);
  return target;
}
export function replaceOnce(original, recipe) {
  const text = original.toString('utf8');
  if (digest(original) !== recipe.sourceSha256 || text.split(recipe.before).length !== 2)
    throw new Error('Source digest mismatch or unmatched/ambiguous replacement');
  return Buffer.from(text.replace(recipe.before, () => recipe.after));
}

// Extract only pinned regular Git blobs; no worktree, branch, source link or tar dependency.
async function extract(root, head, target) {
  const entries = git(root, 'ls-tree', '-rz', head)
    .toString()
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line);
      if (!match)
        throw new Error('Extraction rejects symlinks, submodules and non-regular entries');
      return { mode: match[1], blob: match[2], path: safePath(match[3]) };
    });
  const blobs = execFileSync('git', ['-C', root, 'cat-file', '--batch'], {
    input: entries.map((e) => e.blob).join('\n') + '\n',
    maxBuffer: 256 * 1024 * 1024,
  });
  let offset = 0;
  const inventory = [];
  for (const e of entries) {
    const end = blobs.indexOf(10, offset);
    const header = blobs.subarray(offset, end).toString();
    const match = /^([a-f0-9]{40}) blob (\d+)$/.exec(header);
    if (!match || match[1] !== e.blob) throw new Error('Git blob extraction failed');
    const bytes = blobs.subarray(end + 1, end + 1 + Number(match[2]));
    offset = end + 2 + bytes.length;
    await mkdir(dirname(join(target, e.path)), { recursive: true });
    await writeFile(join(target, e.path), bytes, {
      flag: 'wx',
      mode: e.mode === '100755' ? 0o755 : 0o644,
    });
    inventory.push({ ...e, sha256: digest(bytes) });
  }
  return inventory;
}
async function inventoryMatches(root, inventory) {
  for (const e of inventory) {
    try {
      if (digest(await readFile(await checkedFile(root, e.path))) !== e.sha256) return false;
    } catch {
      return false;
    }
  }
  return true;
}
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function verifyLinks(root) {
  let links = 0;
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        if (!inside(root, await realpath(path)))
          throw new Error(`Dependency link escapes scratch: ${relative(root, path)}`);
        links++;
      } else if (entry.isDirectory()) await walk(path);
    }
  }
  await walk(root);
  return { checked: true, internalLinks: links, escapingLinks: 0 };
}

/** Reproduce accepted map bootstrap from pinned scratch, before locked install. */
export async function setupMapSource({ root, inventory, directory, signal, timeoutMs = 180000 }) {
  if (inside(await realpath(repoRoot), await realpath(root)))
    throw new Error('Map bootstrap requires isolated source outside the canonical checkout');
  await mkdir(directory);
  const record = { status: 'failed', classification: 'setup-failed', required: false };
  const processDirectory = join(directory, 'process');
  let processStarted = false;
  try {
    if (!(await inventoryMatches(root, inventory)))
      throw new Error('Unchanged pinned input required');
    record.isolationBefore = await verifyLinks(root);
    const pkg = JSON.parse(await readFile(await checkedFile(root, 'package.json')));
    const lock = JSON.parse(await readFile(await checkedFile(root, 'package-lock.json')));
    record.required = JSON.stringify(lock).includes('settlemaker-runtime.tgz');
    // Inspect pinned package declarations too: an incomplete/stale lock must not
    // turn a required workspace tarball into a silent legacy skip.
    for (const { path } of inventory.filter((e) => /(^|\/)package\.json$/.test(e.path))) {
      const declaration = JSON.parse(await readFile(await checkedFile(root, path)));
      if (JSON.stringify(declaration).includes('settlemaker-runtime.tgz')) record.required = true;
    }
    if (!Object.hasOwn(pkg.scripts ?? {}, 'setup:map-source')) {
      if (record.required) throw new Error('Required map tarball has no setup:map-source script');
      record.status = 'no-bootstrap-needed';
      record.classification = 'complete';
    } else {
      if (
        typeof pkg.scripts['setup:map-source'] !== 'string' ||
        !pkg.scripts['setup:map-source'].trim()
      )
        throw new Error('Invalid setup:map-source script');
      await mkdir(processDirectory);
      processStarted = true;
      record.process = await runProcess('npm', ['run', 'setup:map-source'], {
        cwd: root,
        env: process.env,
        directory: processDirectory,
        timeoutMs,
        signal,
      });
      if (!record.process.reaped || !record.process.groupAbsent) {
        record.classification = 'restore-failed';
        throw new Error('Map bootstrap children not reaped');
      }
      if (signal?.aborted || record.process.timeout || record.process.interrupted) {
        record.classification = 'inconclusive';
        throw new Error('Map bootstrap cancelled or timed out');
      }
      if (
        record.process.code !== 0 ||
        record.process.signal ||
        record.process.spawnError ||
        record.process.strayChildren
      )
        throw new Error('Map bootstrap process failed');
      record.isolationAfter = await verifyLinks(root);
      const snapshot = JSON.parse(
        await readFile(await checkedFile(root, 'vendor/settlemaker.snapshot.json')),
      );
      const bytes = await readFile(await checkedFile(root, 'vendor/settlemaker-runtime.tgz'));
      record.artifact = {
        path: 'vendor/settlemaker-runtime.tgz',
        expected: snapshot.artifact,
        actual: {
          packageSha256: digest(bytes),
          packageIntegrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
        },
      };
      record.artifact.actual.tarSha256 = digest(gunzipSync(bytes));
      const expected = record.artifact.expected;
      if (
        !expected ||
        Object.entries(record.artifact.actual).some(([key, value]) => expected[key] !== value)
      )
        throw new Error('Map bootstrap artifact integrity mismatch');
      const dependency = lock.packages?.['node_modules/@kriegsspiel/settlemaker'];
      record.artifact.lockIntegrity = dependency?.integrity ?? null;
      if (dependency && dependency.integrity !== record.artifact.actual.packageIntegrity)
        throw new Error('Map bootstrap artifact differs from locked dependency integrity');
      record.status = 'bootstrapped';
      record.classification = 'complete';
    }
  } catch (error) {
    record.error = error.message;
    if (processStarted && !record.process) {
      // runProcess persists its finally record even if signalling/probing throws.
      // Never discard scratch on a thrown process call without reaping proof.
      try {
        record.process = JSON.parse(await readFile(join(processDirectory, 'process.json')));
      } catch {
        record.processEvidenceMissing = true;
      }
    }
    if (processStarted && (!record.process?.reaped || !record.process?.groupAbsent))
      record.classification = 'restore-failed';
  } finally {
    record.pinnedInventoryUnchanged = await inventoryMatches(root, inventory);
    if (!record.pinnedInventoryUnchanged) {
      record.status = 'failed';
      if (record.classification !== 'restore-failed') record.classification = 'setup-failed';
      record.inventoryError = 'Map bootstrap changed pinned source';
    }
    if (signal?.aborted && record.classification !== 'restore-failed') {
      record.status = 'failed';
      record.classification = 'inconclusive';
    }
    await jsonWrite(join(directory, 'setup.json'), record);
  }
  return record;
}

async function canonicalSnapshot(root) {
  const paths = [
    ...new Set(
      git(root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard')
        .toString()
        .split('\0')
        .filter(Boolean),
    ),
  ].sort();
  const files = [];
  for (const path of [...paths, '.git']) {
    try {
      const stat = await lstat(join(root, path));
      files.push({
        path,
        mode: stat.mode & 0o777,
        sha256: stat.isFile()
          ? digest(await readFile(join(root, path)))
          : stat.isSymbolicLink()
            ? digest(await readlink(join(root, path)))
            : 'directory',
      });
    } catch (error) {
      files.push({ path, unavailable: error.code });
    }
  }
  return {
    head: git(root, 'rev-parse', 'HEAD').toString().trim(),
    status: git(root, 'status', '--porcelain=v1', '-uall').toString(),
    files,
  };
}

export async function runPhase(root, recipe, phase, directory, signal) {
  await mkdir(directory); // Exclusive directory: old evidence can never be reused.
  const runId = randomUUID();
  const jsonFile = join(directory, 'vitest.json');
  const errorsFile = join(directory, 'errors.json');
  const args = [
    join(root, 'node_modules/vitest/vitest.mjs'),
    'run',
    ...new Set(recipe.selected.map((t) => relative(join(root, 'client'), join(root, t.file)))),
    '-t',
    `^(?:${recipe.selected.map((t) => escapeRegex(t.name)).join('|')})$`,
    '--maxWorkers=1',
    '--no-file-parallelism',
    '--retry=0',
    '--reporter=json',
    '--reporter=./.hq-review-capture.mjs',
    `--outputFile.json=${jsonFile}`,
  ];
  const run = await runProcess(process.execPath, args, {
    cwd: join(root, 'client'),
    env: { ...process.env, HQ_REVIEW_RUN_ID: runId, HQ_REVIEW_ERRORS_FILE: errorsFile },
    directory,
    timeoutMs: recipe.timeoutMs,
    signal,
  });
  let json;
  let errors;
  try {
    json = JSON.parse(await readFile(jsonFile, 'utf8'));
    errors = JSON.parse(await readFile(errorsFile, 'utf8'));
  } catch {
    /* Missing reports remain inconclusive with raw logs. */
  }
  let result;
  try {
    result = inspectPhase({ process: run, json, errors, runId, root });
  } catch (error) {
    result = { classification: 'inconclusive', reason: `Malformed reports: ${error.message}` };
  }
  const record = {
    phase,
    runId,
    process: run,
    result,
    sourceSha256: digest(await readFile(await checkedFile(root, recipe.source))),
    testSha256: await Promise.all(
      recipe.testSha256.map(async ({ file }) => ({
        file,
        sha256: digest(await readFile(await checkedFile(root, file))),
      })),
    ),
  };
  await jsonWrite(join(directory, 'phase.json'), record);
  return record;
}

/** One bounded mutation transaction. The phase callback is the process boundary for controls. */
export async function executeRecipe({
  root,
  recipe,
  directory,
  inventory,
  phase = runPhase,
  signal,
}) {
  if (inside(await realpath(repoRoot), await realpath(root)))
    throw new Error('Mutation transactions require isolated source outside the canonical checkout');
  await mkdir(directory);
  const record = { id: recipe.id, phases: {}, hashes: {}, classification: 'invalid' };
  let original;
  let source;
  let mutated = false;
  let canRestore = true;
  let baselineStarted = false;
  async function restore() {
    if (!canRestore) throw new Error('Owned children remain; source restoration is unsafe');
    record.restorationStartedAt = Date.now();
    await writeFile(source, original);
    record.hashes.restored = digest(await readFile(source));
    record.hashes.testsUnchanged = true;
    for (const t of recipe.testSha256)
      if (digest(await readFile(await checkedFile(root, t.file))) !== t.sha256)
        record.hashes.testsUnchanged = false;
    record.hashes.inventoryRestored = await inventoryMatches(root, inventory);
    if (
      record.hashes.restored !== record.hashes.original ||
      !record.hashes.testsUnchanged ||
      !record.hashes.inventoryRestored
    )
      throw new Error('Restoration inventory/hash failure');
    record.restorationFinishedAt = Date.now();
    // A cancelled mutant still requires a fresh restored run. Do not inherit its aborted signal.
    record.phases.restored = await phase(root, recipe, 'restored', join(directory, 'restored'));
    if (!(await inventoryMatches(root, inventory)))
      throw new Error('Restored rerun changed pinned source or tests');
    if (record.phases.mutant)
      Object.assign(
        record,
        classifyCase(
          recipe,
          record.phases.baseline.result,
          record.phases.mutant.result,
          record.phases.restored.result,
          record.hashes,
        ),
      );
    if (
      record.phases.restored.result.classification !== 'complete' ||
      record.phases.restored.result.failed.length
    )
      Object.assign(record, {
        classification: 'restore-failed',
        reason: 'Restored test rerun failed',
      });
  }
  try {
    source = await checkedFile(root, recipe.source);
    original = await readFile(source);
    const mutant = replaceOnce(original, recipe);
    for (const t of recipe.testSha256)
      if (digest(await readFile(await checkedFile(root, t.file))) !== t.sha256)
        throw new Error('Test digest mismatch');
    await writeFile(join(directory, 'original'), original);
    await writeFile(join(directory, 'mutated'), mutant);
    await jsonWrite(join(directory, 'recipe.json'), recipe);
    record.hashes.original = digest(original);
    record.hashes.mutant = digest(mutant);
    baselineStarted = true;
    record.phases.baseline = await phase(
      root,
      recipe,
      'baseline',
      join(directory, 'baseline'),
      signal,
    );
    if (!record.phases.baseline.process?.reaped || !record.phases.baseline.process?.groupAbsent) {
      record.classification = 'restore-failed';
      record.reason = 'Baseline children not reaped';
      return record;
    }
    const baseline = record.phases.baseline.result;
    if (
      baseline.classification !== 'complete' ||
      baseline.failed.length ||
      JSON.stringify(
        baseline.selected
          .map(({ file, name }) => ({ file, name }))
          .sort((a, b) => (a.file + a.name).localeCompare(b.file + b.name)),
      ) !==
        JSON.stringify(
          [...recipe.selected].sort((a, b) => (a.file + a.name).localeCompare(b.file + b.name)),
        )
    ) {
      record.classification =
        baseline.classification === 'restore-failed' ? 'restore-failed' : 'setup-failed';
      record.reason = 'Baseline did not cleanly pass the exact selection';
      return record;
    }
    if (!(await inventoryMatches(root, inventory))) {
      record.classification = 'setup-failed';
      record.reason = 'Baseline changed pinned source or tests';
      return record;
    }
    mutated = true; // A partial write also requires restoration.
    await writeFile(source, mutant);
    if (digest(await readFile(source)) !== record.hashes.mutant)
      throw new Error('Mutation write hash mismatch');
    canRestore = false;
    record.phases.mutant = await phase(root, recipe, 'mutant', join(directory, 'mutant'), signal);
    canRestore = record.phases.mutant.process.reaped && record.phases.mutant.process.groupAbsent;
  } catch (error) {
    record.reason = error.message;
    record.classification = baselineStarted ? 'setup-failed' : 'invalid';
    if (baselineStarted && !record.phases.baseline) {
      const baseline = {
        phase: 'baseline',
        result: { classification: 'setup-failed', reason: error.message },
      };
      // A thrown phase can still own children. Recover runProcess's finally
      // record; missing proof must stop mutation and preserve scratch.
      try {
        baseline.process = JSON.parse(await readFile(join(directory, 'baseline', 'process.json')));
      } catch {
        baseline.processEvidenceMissing = true;
      }
      if (!baseline.process?.reaped || !baseline.process?.groupAbsent)
        record.classification = baseline.result.classification = 'restore-failed';
      record.phases.baseline = baseline;
    }
  } finally {
    if (mutated) {
      try {
        await restore();
      } catch (error) {
        record.classification = 'restore-failed';
        record.reason = error.message;
      }
    }
    if (signal?.aborted) {
      record.interrupted = true;
      if (record.classification !== 'restore-failed') {
        record.classification = 'inconclusive';
        record.reason = 'Cancellation retained after restoration and rerun';
      }
    }
    await jsonWrite(join(directory, 'result.json'), record);
  }
  return record;
}

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (
      !['--head', '--base', '--manifest', '--output'].includes(key) ||
      options[key] ||
      !args[i + 1]
    )
      throw new Error(
        'Usage: node scripts/review/run-mutations.mjs --head FULL_SHA --base FULL_SHA --manifest PATH --output ABSOLUTE_EVIDENCE_DIR',
      );
    options[key] = args[i + 1];
  }
  if (Object.keys(options).length !== 4) throw new Error('All four CLI arguments are required');
  for (const key of ['--head', '--base'])
    if (!/^[a-f0-9]{40}$/.test(options[key]))
      throw new Error('Full lowercase commit SHAs required');
  return options;
}

export async function main(args) {
  const options = parseArgs(args);
  const root = await realpath(repoRoot);
  const output = options['--output'];
  if (!isAbsolute(output) || inside(root, output) || inside(root, resolve(output)))
    throw new Error('Evidence must be absolute and outside reviewed source');
  // Resolve the nearest existing ancestor BEFORE creating directories; an output
  // parent symlink must not create even an empty directory in reviewed source.
  let ancestor = dirname(resolve(output));
  const missingParents = [];
  let actualParent;
  for (;;) {
    try {
      actualParent = await realpath(ancestor);
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missingParents.unshift(basename(ancestor));
      ancestor = dirname(ancestor);
    }
  }
  const actualOutput = join(actualParent, ...missingParents, basename(resolve(output)));
  if (inside(root, actualOutput)) throw new Error('Evidence symlink points inside reviewed source');
  for (const path of [
    git(root, 'rev-parse', '--absolute-git-dir').toString().trim(),
    resolve(root, git(root, 'rev-parse', '--git-common-dir').toString().trim()),
  ])
    if (inside(await realpath(path), actualOutput))
      throw new Error('Evidence may not write Git internals');
  await mkdir(dirname(actualOutput), { recursive: true });
  await mkdir(actualOutput); // Fail on reuse, including stale/partial evidence.
  const report = {
    schema: 1,
    head: options['--head'],
    base: options['--base'],
    startedAt: Date.now(),
    cases: [],
    classification: 'setup-failed',
    output: actualOutput,
    retries: 0,
    tokenCost: null,
  };
  let scratch;
  let preserve = false;
  let before;
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  try {
    before = await canonicalSnapshot(root);
    await jsonWrite(join(actualOutput, 'canonical-before.json'), before);
    for (const [label, sha] of [
      ['head', report.head],
      ['base', report.base],
    ]) {
      if (git(root, 'cat-file', '-t', sha).toString().trim() !== 'commit')
        throw new Error('SHA must name a commit');
      report[`${label}Tree`] = git(root, 'rev-parse', `${sha}^{tree}`).toString().trim();
    }
    report.mergeBase = git(root, 'merge-base', report.head, report.base).toString().trim();
    report.mergeBaseTree = git(root, 'rev-parse', `${report.mergeBase}^{tree}`).toString().trim();
    const manifestPath = await checkedFile(root, options['--manifest']);
    const bytes = await readFile(manifestPath);
    report.manifestSha256 = digest(bytes);
    const manifest = validateManifest(JSON.parse(bytes));
    await writeFile(join(actualOutput, 'manifest.json'), bytes);
    report.runnerSha256 = {};
    for (const path of ['run-mutations.mjs', 'process.mjs', 'results.mjs', 'capture-reporter.mjs'])
      report.runnerSha256[path] = digest(await readFile(join(repoRoot, 'scripts/review', path)));
    report.versions = {
      node: process.version,
      git: git(root, '--version').toString().trim(),
      npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
    };
    scratch = await mkdtemp(join(await realpath(tmpdir()), 'hq-mutations-'));
    report.scratch = scratch;
    const sourceRoot = join(scratch, 'source');
    await mkdir(sourceRoot);
    const inventory = await extract(root, report.head, sourceRoot);
    await jsonWrite(join(actualOutput, 'source-inventory.json'), inventory);
    // Validate every recipe against pinned bytes before installing or starting any case.
    for (const c of manifest.cases) {
      replaceOnce(await readFile(await checkedFile(sourceRoot, c.source)), c);
      for (const t of c.testSha256)
        if (digest(await readFile(await checkedFile(sourceRoot, t.file))) !== t.sha256)
          throw new Error(`Test digest mismatch: ${c.id}`);
    }
    report.lockSha256 = digest(await readFile(join(sourceRoot, 'package-lock.json')));
    // Bootstrap can throw while writing diagnostics after starting a process.
    // Preserve scratch until its returned cleanup decision is available.
    preserve = true;
    report.mapSourceSetup = await setupMapSource({
      root: sourceRoot,
      inventory,
      directory: join(actualOutput, 'map-source-setup'),
      signal: controller.signal,
    });
    preserve = report.mapSourceSetup.classification === 'restore-failed';
    if (report.mapSourceSetup.classification !== 'complete') {
      report.classification = report.mapSourceSetup.classification;
      throw new Error(report.mapSourceSetup.error ?? report.mapSourceSetup.inventoryError);
    }
    const install = join(actualOutput, 'install');
    await mkdir(install);
    // Until the process returns or its persisted record proves cleanup, even
    // an exception must leave the owned scratch intact.
    preserve = true;
    try {
      report.install = await runProcess(
        'npm',
        ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
        {
          cwd: sourceRoot,
          env: process.env,
          directory: install,
          timeoutMs: 180000,
          signal: controller.signal,
        },
      );
    } catch (error) {
      try {
        report.install = JSON.parse(await readFile(join(install, 'process.json')));
      } catch {
        report.installProcessEvidenceMissing = true;
      }
      preserve = !report.install?.reaped || !report.install?.groupAbsent;
      if (preserve) report.classification = 'restore-failed';
      throw error;
    }
    if (!report.install.reaped || !report.install.groupAbsent) {
      report.classification = 'restore-failed';
      throw new Error('Install children not reaped');
    }
    preserve = false;
    if (
      report.install.code !== 0 ||
      report.install.timeout ||
      report.install.interrupted ||
      report.install.strayChildren
    )
      throw new Error('Locked dependency setup failed');
    const vitest = JSON.parse(
      await readFile(join(sourceRoot, 'node_modules/vitest/package.json')),
    ).version;
    const vite = JSON.parse(
      await readFile(join(sourceRoot, 'node_modules/vite/package.json')),
    ).version;
    report.versions = { ...report.versions, vitest, vite };
    if (!vitest.startsWith('4.'))
      throw new Error('Reporter capture is verified only against Vitest 4');
    if (!(await inventoryMatches(sourceRoot, inventory)))
      throw new Error('Install changed pinned source');
    report.isolation = await verifyLinks(sourceRoot);
    const reporterPath = join(sourceRoot, 'client/.hq-review-capture.mjs');
    await writeFile(
      reporterPath,
      await readFile(join(repoRoot, 'scripts/review/capture-reporter.mjs')),
      { flag: 'wx' },
    );
    await mkdir(join(actualOutput, 'cases'));
    for (const recipe of manifest.cases) {
      if (controller.signal.aborted) {
        report.classification = 'inconclusive';
        break;
      }
      // executeRecipe normally returns its cleanup decision. If it throws
      // while writing diagnostics, retain scratch rather than lose that proof.
      preserve = true;
      const result = await executeRecipe({
        root: sourceRoot,
        recipe,
        inventory,
        signal: controller.signal,
        directory: join(actualOutput, 'cases', recipe.id),
      });
      preserve = result.classification === 'restore-failed';
      report.cases.push(result);
      await jsonWrite(join(actualOutput, 'report.json'), report);
      if (['setup-failed', 'restore-failed'].includes(result.classification)) {
        preserve = result.classification === 'restore-failed';
        break;
      }
    }
    report.classification = controller.signal.aborted
      ? 'inconclusive'
      : report.cases.length === manifest.cases.length &&
          report.cases.every((c) => c.classification === 'detected')
        ? 'detected'
        : 'non-success';
    report.notRun = manifest.cases
      .filter((c) => !report.cases.some((r) => r.id === c.id))
      .map((c) => c.id);
  } catch (error) {
    report.error = error.stack;
  } finally {
    if (scratch && !preserve) await rm(scratch, { recursive: true, force: true });
    if (before) {
      const after = await canonicalSnapshot(root);
      await jsonWrite(join(actualOutput, 'canonical-after.json'), after);
      report.canonicalUnchanged = JSON.stringify(before) === JSON.stringify(after);
      if (!report.canonicalUnchanged) {
        report.classification = 'non-success';
        report.canonicalDifference =
          'Canonical files/HEAD/status changed during run; inspect snapshots (including concurrent owner edits)';
      }
    }
    report.scratchPreserved = preserve;
    report.finishedAt = Date.now();
    report.durationMs = report.finishedAt - report.startedAt;
    // Cancellation can arrive while final evidence is being written. Its state
    // is monotonic, so at most one additional write records a late signal.
    do {
      report.interrupted = controller.signal.aborted;
      if (report.interrupted) report.classification = 'inconclusive';
      await jsonWrite(join(actualOutput, 'report.json'), report);
    } while (report.interrupted !== controller.signal.aborted);
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
  process.stdout.write(
    JSON.stringify({
      classification: report.classification,
      cases: report.cases.map(({ id, classification }) => ({ id, classification })),
      output: actualOutput,
    }) + '\n',
  );
  return !controller.signal.aborted && report.classification === 'detected' ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(error.message + '\n');
      process.exitCode = 1;
    },
  );
}
