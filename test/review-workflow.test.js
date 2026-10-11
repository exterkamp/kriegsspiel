import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  copyFile,
  symlink,
  realpath,
  lstat,
  cp,
  chmod,
  open,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import {
  digest,
  executeRecipe,
  replaceOnce,
  validateManifest,
  checkedFile,
  main,
  repoRoot,
  setupMapSource,
} from '../scripts/review/run-mutations.mjs';
import { runProcess } from '../scripts/review/process.mjs';
import { inspectPhase, classifyCase } from '../scripts/review/results.mjs';

const runtimeRoot = resolve(process.env.HQ_REVIEW_TEST_RUNTIME ?? join(repoRoot, 'node_modules'));
const vitest = join(runtimeRoot, 'vitest/vitest.mjs');
const api = join(runtimeRoot, 'vitest/dist/index.js');
const clone = (value) => structuredClone(value);

async function controlRoot(t, label) {
  const parent = process.env.HQ_REVIEW_CONTROL_EVIDENCE ?? tmpdir();
  await mkdir(parent, { recursive: true });
  const root = await realpath(await mkdtemp(join(parent, `hq-${label}-`)));
  if (!process.env.HQ_REVIEW_CONTROL_EVIDENCE)
    t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function fixture(t, source = 'export const value = 1;\n', testBody) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'hq-runner-control-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = 'client/src/hq/control.test.ts';
  const production = 'client/src/hq/control.ts';
  const body =
    testBody ??
    `import { it, expect } from ${JSON.stringify(api)};\nimport { value } from './control';\nit('rejects bad value', () => { expect(value).toBe(1); });\n`;
  await mkdir(join(root, 'client/src/hq'), { recursive: true });
  await writeFile(join(root, file), body);
  await writeFile(join(root, production), source);
  await writeFile(
    join(root, 'client/vitest.config.mjs'),
    'export default { test: { include: ["src/**/*.test.ts"] } };\n',
  );
  await copyFile(
    join(repoRoot, 'scripts/review/capture-reporter.mjs'),
    join(root, 'client/capture.mjs'),
  );
  const recipe = {
    id: 'control',
    invariant: 'Changed value is rejected',
    rationale: 'Behavioral control',
    source: production,
    sourceSha256: digest(source),
    before: 'value = 1',
    after: 'value = 2',
    selected: [{ file, name: 'rejects bad value' }],
    testSha256: [{ file, sha256: digest(body) }],
    expected: [
      {
        file,
        name: 'rejects bad value',
        line: 3,
        column: 47,
        message: 'expected 2 to be 1 // Object.is equality',
      },
    ],
    timeoutMs: 10000,
  };
  const inventory = [
    { path: production, sha256: digest(source) },
    { path: file, sha256: digest(body) },
  ];
  return { root, recipe, inventory, source, body, file };
}

async function controlPhase(root, recipe, phase, directory, signal) {
  await mkdir(directory);
  const runId = randomUUID();
  const args = [
    vitest,
    'run',
    '--config=vitest.config.mjs',
    '--maxWorkers=1',
    '--no-file-parallelism',
    '--reporter=json',
    '--reporter=./capture.mjs',
    `--outputFile.json=${join(directory, 'vitest.json')}`,
  ];
  const run = await runProcess(process.execPath, args, {
    cwd: join(root, 'client'),
    directory,
    env: {
      ...process.env,
      HQ_REVIEW_RUN_ID: runId,
      HQ_REVIEW_ERRORS_FILE: join(directory, 'errors.json'),
    },
    timeoutMs: recipe.timeoutMs,
    signal,
  });
  const json = JSON.parse(await readFile(join(directory, 'vitest.json')));
  const errors = JSON.parse(await readFile(join(directory, 'errors.json')));
  const input = { root, runId, process: run, json, errors };
  return { phase, process: run, result: inspectPhase(input), input };
}

test('real Vitest value fault reaches only the expected assertion; restoration follows reaping', async (t) => {
  const f = await fixture(t);
  const before = await readFile(f.root + '/' + f.recipe.source);
  const result = await executeRecipe({
    ...f,
    directory: join(f.root, 'evidence'),
    phase: controlPhase,
  });
  assert.equal(result.classification, 'detected', JSON.stringify(result));
  assert.deepEqual(await readFile(f.root + '/' + f.recipe.source), before);
  assert.equal(await readFile(f.root + '/' + f.file, 'utf8'), f.body);
  assert.ok(result.phases.mutant.process.reaped && result.phases.mutant.process.groupAbsent);
  assert.ok(result.restorationStartedAt >= result.phases.mutant.process.finishedAt);
  assert.ok(result.phases.restored.process.startedAt >= result.restorationFinishedAt);
  assert.equal(result.phases.baseline.result.tasks.length, 1);
  assert.equal(result.phases.restored.result.failed.length, 0);

  const { baseline, mutant, restored } = result.phases;
  const classify = (b = baseline.result, m = mutant.result, r = restored.result) =>
    classifyCase(f.recipe, b, m, r, result.hashes).classification;
  assert.equal(classify(), 'detected');
  const survivor = clone(baseline.result);
  assert.equal(classify(baseline.result, survivor), 'survived');
  for (const edit of [
    (x) => {
      x.tasks = [];
      x.selected = [];
    },
    (x) => {
      x.selected[0].name = 'unrelated';
      x.identities[0].name = 'unrelated';
    },
    (x) => {
      x.identities.push({ file: f.file, name: 'extra test', mode: 'skip' });
    },
    (x) => {
      x.failed[0].errors[0].message = 'unrelated assertion';
    },
    (x) => {
      for (const s of x.failed[0].errors[0].locations) s.line++;
    },
  ]) {
    const m = clone(mutant.result);
    edit(m);
    assert.notEqual(classify(baseline.result, m), 'detected');
  }
  for (const edit of [
    (x) => {
      x.errors.runId = 'stale';
    },
    (x) => {
      x.errors.pid++;
    },
    (x) => {
      x.json.startTime = x.process.startedAt - 1;
    },
    (x) => {
      delete x.errors.onTestRunEnd.unhandledErrors;
    },
    (x) => {
      x.errors.onFinished.files = [];
    },
    (x) => {
      x.json.testResults[0].assertionResults = [];
    },
    (x) => {
      x.json.numTotalTests = 0;
    },
    (x) => {
      x.process.code = 0;
    },
    (x) => {
      x.process.groupAbsent = false;
    },
  ]) {
    const input = clone(mutant.input);
    edit(input);
    assert.notEqual(inspectPhase(input).classification, 'complete');
  }
  assert.equal(
    classifyCase(f.recipe, baseline.result, mutant.result, restored.result, {
      ...result.hashes,
      restored: 'wrong',
    }).classification,
    'restore-failed',
  );
});

test('verified reporter captures actual mixed unhandled, collection and hook failures', async (t) => {
  for (const [kind, body, expected] of [
    [
      'mixed',
      `it('rejects bad value', async () => { Promise.reject(new Error('UNHANDLED_CONTROL')); await new Promise(r => setTimeout(r, 30)); expect(2).toBe(1); });`,
      'inconclusive',
    ],
    ['collection', `throw new Error('COLLECTION_CONTROL');`, 'invalid'],
    [
      'hook',
      `beforeEach(() => { throw new Error('HOOK_CONTROL'); }); it('rejects bad value', () => expect(1).toBe(1));`,
      'invalid',
    ],
  ]) {
    const f = await fixture(
      t,
      undefined,
      `import {it, expect, beforeEach} from ${JSON.stringify(api)};\n${body}\n`,
    );
    const report = await controlPhase(f.root, f.recipe, kind, join(f.root, 'phase'));
    assert.equal(report.result.classification, expected, JSON.stringify(report));
    if (kind === 'mixed') {
      assert.equal(report.input.errors.onTestRunEnd.unhandledErrors.length, 1);
      assert.match(
        report.input.errors.onTestRunEnd.unhandledErrors[0].message,
        /UNHANDLED_CONTROL/,
      );
      assert.equal(report.input.json.numFailedTests, 1);
    }
    if (kind === 'hook') assert.notEqual(report.result.hookErrors[0].state, 'pass');
    if (kind === 'collection')
      assert.match(report.result.collectionErrors[0].message, /COLLECTION_CONTROL/);
  }
});

test('invalid syntax cannot be detected and original source is restored and rerun', async (t) => {
  const f = await fixture(t);
  f.recipe.after = 'value = ; syntax error';
  const result = await executeRecipe({
    ...f,
    directory: join(f.root, 'evidence'),
    phase: controlPhase,
  });
  assert.equal(result.classification, 'invalid', JSON.stringify(result));
  assert.equal(await readFile(join(f.root, f.recipe.source), 'utf8'), f.source);
  assert.equal(result.phases.restored.result.classification, 'complete');
});

test('real skipped and foreign test identities cannot become a passing baseline', async (t) => {
  for (const [body, classification] of [
    ["it.skip('rejects bad value', () => expect(1).toBe(1));", 'invalid'],
    ["it('wrong selected test', () => expect(1).toBe(1));", 'complete'],
  ]) {
    const f = await fixture(
      t,
      undefined,
      `import {it, expect} from ${JSON.stringify(api)};\n${body}\n`,
    );
    const report = await controlPhase(f.root, f.recipe, 'baseline', join(f.root, 'phase'));
    assert.equal(report.result.classification, classification);
    if (classification === 'complete') {
      const result = await executeRecipe({
        ...f,
        directory: join(f.root, 'evidence'),
        phase: async () => report,
      });
      assert.equal(result.classification, 'setup-failed');
      assert.equal(await readFile(join(f.root, f.recipe.source), 'utf8'), f.source);
    }
  }
});

test('timeout escalates to KILL for a TERM-resistant owned process', async (t) => {
  const f = await fixture(t);
  const directory = join(f.root, 'process');
  await mkdir(directory);
  const run = await runProcess(
    process.execPath,
    ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000);"],
    { cwd: f.root, env: process.env, directory, timeoutMs: 200 },
  );
  assert.equal(run.timeout, true);
  assert.equal(run.signal, 'SIGKILL');
  assert.ok(run.reaped && run.groupAbsent);
  assert.equal(inspectPhase({ process: run }).classification, 'inconclusive');
});

test('path, digest and replacement validation refuses unsafe, unmatched or ambiguous source before test execution', async (t) => {
  const f = await fixture(t);
  const manifest = JSON.parse(await readFile(join(repoRoot, 'test/review/hq-mutations.json')));
  assert.equal(validateManifest(manifest).cases.length, 10);
  await assert.rejects(
    executeRecipe({ ...f, root: repoRoot, directory: join(f.root, 'canonical-refusal') }),
    /isolated source/,
  );
  for (const path of [
    '/tmp/outside.ts',
    '../outside.ts',
    'client/../../outside.ts',
    'client\\outside.ts',
    'client//source.ts',
  ]) {
    const m = clone(manifest);
    m.cases[0].source = path;
    assert.throws(() => validateManifest(m));
  }
  await symlink(join(repoRoot, 'package.json'), join(f.root, 'escape'));
  await assert.rejects(checkedFile(f.root, 'escape'));
  assert.throws(() => replaceOnce(Buffer.from(f.source), { ...f.recipe, before: 'absent' }));
  const twice = Buffer.from(f.source + f.source);
  assert.throws(() => replaceOnce(twice, { ...f.recipe, sourceSha256: digest(twice) }));
  assert.throws(() =>
    replaceOnce(Buffer.from(f.source), { ...f.recipe, sourceSha256: '0'.repeat(64) }),
  );
  const unmatched = { ...f.recipe, before: 'absent' };
  let calls = 0;
  const record = await executeRecipe({
    ...f,
    recipe: unmatched,
    directory: join(f.root, 'evidence'),
    phase: () => {
      calls++;
      throw new Error('Should never execute');
    },
  });
  assert.equal(record.classification, 'invalid');
  assert.equal(calls, 0);
  assert.equal(await readFile(join(f.root, f.recipe.source), 'utf8'), f.source);
});

test('real timeout and interruption reap parent and child before restoration and a successful rerun', async (t) => {
  for (const mode of ['timeout', 'interrupted']) {
    const f = await fixture(t);
    const controller = new AbortController();
    const phase = async (root, recipe, name, directory) => {
      if (name !== 'mutant') return controlPhase(root, recipe, name, directory);
      await mkdir(directory);
      // Parent explicitly reaps the owned child on TERM. Child ignores TERM, exercising KILL.
      const code = `const {spawn}=require('node:child_process'); const fs=require('node:fs');
        const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
        fs.writeFileSync(${JSON.stringify(join(f.root, 'child-pid'))},String(child.pid));
        process.on('SIGTERM',()=>{child.kill('SIGKILL');child.on('close',()=>process.exit(0));});setInterval(()=>{},1000);`;
      let timer;
      if (mode === 'interrupted') timer = setTimeout(() => controller.abort(), 300);
      const run = await runProcess(process.execPath, ['-e', code], {
        cwd: root,
        directory,
        env: process.env,
        timeoutMs: mode === 'timeout' ? 300 : 10000,
        signal: controller.signal,
      });
      clearTimeout(timer);
      return { process: run, result: inspectPhase({ process: run }) };
    };
    const result = await executeRecipe({ ...f, directory: join(f.root, 'evidence'), phase });
    assert.equal(result.classification, 'inconclusive', JSON.stringify(result));
    const run = result.phases.mutant.process;
    assert.equal(run[mode], true);
    assert.ok(run.reaped && run.groupAbsent);
    const childPid = Number(await readFile(join(f.root, 'child-pid'), 'utf8'));
    assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' });
    assert.ok(result.restorationStartedAt >= run.finishedAt);
    assert.ok(result.phases.restored.process.startedAt >= result.restorationFinishedAt);
    assert.equal(await readFile(join(f.root, f.recipe.source), 'utf8'), f.source);
  }
});

test('restoration failures stop transaction; absent reaping proof never permits restoration', async (t) => {
  for (const fault of [
    'unreaped',
    'write-failure',
    'test-change',
    'rerun-failure',
    'rerun-source-change',
  ]) {
    const f = await fixture(t);
    let restoredCalls = 0;
    const phase = async (root, recipe, name, directory) => {
      const result = await controlPhase(root, recipe, name, directory);
      if (name === 'restored') {
        restoredCalls++;
        if (fault === 'rerun-source-change')
          await writeFile(join(root, recipe.source), 'export const value = 99;\n');
        if (fault === 'rerun-failure')
          result.result = { classification: 'invalid', reason: 'Controlled failed rerun' };
      }
      if (name === 'mutant') {
        if (fault === 'unreaped') result.process.groupAbsent = false;
        if (fault === 'write-failure') {
          await rm(join(root, recipe.source));
          await mkdir(join(root, recipe.source));
        }
        if (fault === 'test-change') await writeFile(join(root, f.file), '// Changed test control');
      }
      return result;
    };
    const result = await executeRecipe({ ...f, directory: join(f.root, 'evidence'), phase });
    assert.equal(result.classification, 'restore-failed', JSON.stringify(result));
    assert.equal(restoredCalls, fault.startsWith('rerun-') ? 1 : 0);
    if (fault === 'unreaped') {
      assert.equal(result.restorationStartedAt, undefined);
      assert.match(await readFile(join(f.root, f.recipe.source), 'utf8'), /value = 2/);
    }
  }
});

test('baseline failure and zero/wrong selection prevent mutation; setup leaves bytes unchanged', async (t) => {
  for (const mode of ['zero', 'wrong', 'failed', 'source-change']) {
    const f = await fixture(t);
    let mutantCalls = 0;
    const phase = async (root, recipe, name, directory) => {
      if (name !== 'baseline') mutantCalls++;
      const report = await controlPhase(root, recipe, name, directory);
      if (mode === 'zero')
        report.result = { classification: 'invalid', reason: 'No selected tests' };
      if (mode === 'wrong') report.result.selected[0].name = 'Other test';
      if (mode === 'failed') report.result.failed = [report.result.selected[0]];
      if (mode === 'source-change')
        await writeFile(join(root, recipe.source), 'export const value = 99;\n');
      return report;
    };
    const result = await executeRecipe({ ...f, directory: join(f.root, 'evidence'), phase });
    assert.equal(result.classification, 'setup-failed');
    assert.equal(mutantCalls, 0);
    assert.equal(
      await readFile(join(f.root, f.recipe.source), 'utf8'),
      mode === 'source-change' ? 'export const value = 99;\n' : f.source,
    );
  }
});

test('CLI rejects mutable refs, internal output and existing evidence without overwriting it', async (t) => {
  const f = await fixture(t);
  const args = [
    '--head',
    'HEAD',
    '--base',
    '0'.repeat(40),
    '--manifest',
    'test/review/hq-mutations.json',
    '--output',
    join(f.root, 'out'),
  ];
  await assert.rejects(main(args), /Full lowercase commit SHAs/);
  args[1] = '1'.repeat(40);
  args[7] = join(repoRoot, 'forbidden-output');
  await assert.rejects(main(args), /outside reviewed source/);
  await symlink(repoRoot, join(f.root, 'canonical-link'));
  const forbidden = `review-output-refusal-${randomUUID()}`;
  args[7] = join(f.root, 'canonical-link', forbidden, 'evidence');
  await assert.rejects(main(args), /inside reviewed source/);
  await assert.rejects(lstat(join(repoRoot, forbidden)), { code: 'ENOENT' });
  args[7] = resolve(f.root);
  await writeFile(join(f.root, 'sentinel'), 'preserved');
  await assert.rejects(main(args), { code: 'EEXIST' });
  assert.equal(await readFile(join(f.root, 'sentinel'), 'utf8'), 'preserved');
});

test('real repeated soft assertion A,A cannot satisfy expected A,B; exact multiplicities can', async (t) => {
  const body = `import { it, expect } from ${JSON.stringify(api)};\nimport { value } from './control';\nit('rejects bad value', () => { for (let i = 0; i < 2; i++) expect.soft(value).toBe(1); });\n`;
  const f = await fixture(t, undefined, body);
  const directory = await controlRoot(t, 'multiset');
  const baseline = await controlPhase(f.root, f.recipe, 'baseline', join(directory, 'baseline'));
  const mutantSource = replaceOnce(Buffer.from(f.source), f.recipe);
  await writeFile(join(f.root, f.recipe.source), mutantSource);
  const mutant = await controlPhase(f.root, f.recipe, 'mutant', join(directory, 'mutant'));
  await writeFile(join(f.root, f.recipe.source), f.source);
  const restored = await controlPhase(f.root, f.recipe, 'restored', join(directory, 'restored'));
  assert.equal(mutant.result.failed[0].errors.length, 2);
  const error = mutant.result.failed[0].errors[0];
  const location = error.locations.find((s) => s.file === f.file);
  const a = { ...location, name: 'rejects bad value', message: error.message };
  const hashes = {
    original: digest(f.source),
    mutant: digest(mutantSource),
    restored: digest(f.source),
    testsUnchanged: true,
    inventoryRestored: true,
  };
  const classify = (expected) =>
    classifyCase({ ...f.recipe, expected }, baseline.result, mutant.result, restored.result, hashes)
      .classification;
  assert.equal(classify([a, a]), 'detected', 'A,A consumes two identical expectations');
  const b = { ...a, message: 'expected 2 to be 3 // Object.is equality' };
  await writeFile(
    join(directory, 'control.json'),
    JSON.stringify(
      {
        expected: [a, b],
        actualErrors: mutant.result.failed[0].errors,
        repeatedExpected: classify([a, a]),
        missingExpected: classify([a, b]),
        hashes,
      },
      null,
      2,
    ) + '\n',
  );
  assert.equal(classify([a, b]), 'invalid', 'Missing B must not reuse A');
  assert.equal(classify([b, a]), 'invalid', 'Expectation order does not hide missing B');
  const distinct = clone(mutant.result);
  distinct.failed[0].errors[1].message = b.message;
  assert.equal(
    classifyCase(
      { ...f.recipe, expected: [b, a] },
      baseline.result,
      distinct,
      restored.result,
      hashes,
    ).classification,
    'detected',
  );
  const overlapping = clone(mutant.result);
  const other = { ...location, line: location.line + 1 };
  overlapping.failed[0].errors[0].locations.push(other);
  overlapping.failed[0].errors[1].locations = [location];
  assert.equal(
    classifyCase(
      { ...f.recipe, expected: [a, { ...a, ...other }] },
      baseline.result,
      overlapping,
      restored.result,
      hashes,
    ).classification,
    'detected',
    'Ambiguous frames need complete matching',
  );
});

async function mapFixture(root, mode = 'success') {
  await mkdir(join(root, 'vendor'), { recursive: true });
  await mkdir(join(root, 'scripts'), { recursive: true });
  const payload = Buffer.from('owned map fixture payload');
  const bytes = gzipSync(payload);
  const artifact = {
    packageSha256: digest(bytes),
    packageIntegrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    tarSha256: digest(payload),
  };
  const script = `import {writeFileSync, mkdirSync, symlinkSync} from 'node:fs';\nimport {spawn} from 'node:child_process';\nconst mode=${JSON.stringify(mode)};\nif (mode==='hang') {\n  const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});\n  writeFileSync('vendor/child-pid',String(child.pid));\n  process.on('SIGTERM',()=>{child.kill('SIGKILL');child.on('close',()=>process.exit(0));});\n  writeFileSync('vendor/ready','ready');console.log('BOOTSTRAP_READY '+process.cwd());setInterval(()=>{},1000);\n} else {\n  writeFileSync('vendor/settlemaker-runtime.tgz',Buffer.from(${JSON.stringify(bytes.toString('base64'))},'base64'));\n  if(mode==='corrupt')writeFileSync('vendor/settlemaker-runtime.tgz','corrupt');\n  if(mode==='change')writeFileSync('pinned.txt','changed');\n  if(mode==='escape'){mkdirSync('node_modules');mkdirSync(${JSON.stringify(join(root, '..', 'outside'))});symlinkSync(${JSON.stringify(join(root, '..', 'outside'))},'node_modules/escape');}\n}\n`;
  await writeFile(join(root, 'scripts/setup-map-source.mjs'), script);
  await writeFile(join(root, 'vendor/settlemaker.snapshot.json'), JSON.stringify({ artifact }));
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      scripts: { 'setup:map-source': 'node scripts/setup-map-source.mjs' },
    }),
  );
  await writeFile(
    join(root, 'package-lock.json'),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/@kriegsspiel/settlemaker': {
          resolved: 'file:vendor/settlemaker-runtime.tgz',
          integrity: mode === 'lock-mismatch' ? 'sha512-wrong' : artifact.packageIntegrity,
        },
      },
    }),
  );
  await writeFile(join(root, 'pinned.txt'), 'pinned');
  return [
    'package.json',
    'package-lock.json',
    'pinned.txt',
    'scripts/setup-map-source.mjs',
    'vendor/settlemaker.snapshot.json',
  ];
}

async function pinnedInventory(root, paths) {
  return Promise.all(
    paths.map(async (path) => ({ path, sha256: digest(await readFile(join(root, path))) })),
  );
}

test('map bootstrap runs in scratch with retained integrity evidence and rejects changed inventory/artifacts/links', async (t) => {
  for (const mode of ['success', 'change', 'corrupt', 'lock-mismatch', 'escape']) {
    const directory = await controlRoot(t, `bootstrap-${mode}`);
    const root = join(directory, 'source');
    await mkdir(root);
    const paths = await mapFixture(root, mode);
    const record = await setupMapSource({
      root,
      inventory: await pinnedInventory(root, paths),
      directory: join(directory, 'evidence'),
    });
    assert.deepEqual(record.process.command, ['npm', 'run', 'setup:map-source']);
    assert.equal(record.process.cwd, root);
    assert.ok(record.process.reaped && record.process.groupAbsent);
    assert.equal(record.required, true);
    assert.equal(
      record.classification,
      mode === 'success' ? 'complete' : 'setup-failed',
      JSON.stringify(record),
    );
    assert.equal(record.pinnedInventoryUnchanged, mode !== 'change');
    if (mode === 'success') {
      assert.equal(record.status, 'bootstrapped');
      assert.deepEqual(record.artifact.actual, record.artifact.expected);
      assert.equal(record.artifact.actual.packageIntegrity, record.artifact.lockIntegrity);
    }
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'evidence/setup.json'))), record);
    await readFile(join(directory, 'evidence/process/stdout.log'));
    await readFile(join(directory, 'evidence/process/stderr.log'));
  }
});

test('absent map bootstrap is explicit only for legacy source without the required tarball', async (t) => {
  for (const required of ['none', 'lock', 'workspace']) {
    const directory = await controlRoot(t, `bootstrap-absent-${required}`);
    const root = join(directory, 'source');
    await mkdir(root);
    await writeFile(join(root, 'package.json'), '{"private":true}\n');
    await writeFile(
      join(root, 'package-lock.json'),
      JSON.stringify({
        lockfileVersion: 3,
        packages:
          required === 'lock' ? { map: { resolved: 'file:vendor/settlemaker-runtime.tgz' } } : {},
      }),
    );
    const paths = ['package.json', 'package-lock.json'];
    if (required === 'workspace') {
      await mkdir(join(root, 'packages/maps'), { recursive: true });
      await writeFile(
        join(root, 'packages/maps/package.json'),
        '{"dependencies":{"map":"file:../../vendor/settlemaker-runtime.tgz"}}',
      );
      paths.push('packages/maps/package.json');
    }
    const record = await setupMapSource({
      root,
      inventory: await pinnedInventory(root, paths),
      directory: join(directory, 'evidence'),
    });
    assert.equal(record.status, required === 'none' ? 'no-bootstrap-needed' : 'failed');
    assert.equal(record.classification, required === 'none' ? 'complete' : 'setup-failed');
    assert.equal(record.process, undefined);
    assert.equal(record.pinnedInventoryUnchanged, true);
  }
});

test('cancelled/timed out map bootstrap reaps its owned resistant child and blocks installation', async (t) => {
  for (const mode of ['interrupted', 'timeout']) {
    const directory = await controlRoot(t, `bootstrap-${mode}`);
    const root = join(directory, 'source');
    await mkdir(root);
    const paths = await mapFixture(root, 'hang');
    const controller = new AbortController();
    const running = setupMapSource({
      root,
      inventory: await pinnedInventory(root, paths),
      directory: join(directory, 'evidence'),
      signal: controller.signal,
      timeoutMs: mode === 'timeout' ? 1500 : 10000,
    });
    const deadline = Date.now() + 5000;
    while (!(await lstat(join(root, 'vendor/ready')).catch(() => null))) {
      assert.ok(Date.now() < deadline, 'Bootstrap reached child launch');
      await delay(25);
    }
    if (mode === 'interrupted') controller.abort();
    const record = await running;
    assert.equal(record.classification, 'inconclusive', JSON.stringify(record));
    assert.equal(record.status, 'failed');
    assert.equal(record.process[mode], true);
    assert.ok(record.process.reaped && record.process.groupAbsent);
    assert.equal(record.pinnedInventoryUnchanged, true);
    const pid = Number(await readFile(join(root, 'vendor/child-pid')));
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    await assert.rejects(lstat(join(root, 'node_modules')), { code: 'ENOENT' });
  }
});

// The CLI runs in an owned fixture with a read-only Git-object shim. It never
// initializes or mutates Git. npm's install boundary copies external runtime
// dependencies only; the real Vitest/reporter/runner perform all three phases.
async function cliControl(t, bootstrap = false) {
  const root = await controlRoot(t, 'cli');
  const source = join(root, 'pinned');
  const runner = join(root, 'runner');
  const bin = join(root, 'bin');
  await mkdir(join(source, 'client/src/hq'), { recursive: true });
  await mkdir(join(runner, 'scripts/review'), { recursive: true });
  await mkdir(bin);
  for (const file of ['run-mutations.mjs', 'results.mjs', 'process.mjs', 'capture-reporter.mjs'])
    await copyFile(join(repoRoot, 'scripts/review', file), join(runner, 'scripts/review', file));
  const production = 'client/src/hq/control.ts';
  const file = 'client/src/hq/control.test.ts';
  const bytes = 'export const value = 1;\n';
  const body = `import { it, expect } from 'vitest';\nimport { value } from './control';\nimport { existsSync, writeFileSync } from 'node:fs';\nit('rejects bad value', async () => {\n  if (process.env.HQ_REVIEW_ERRORS_FILE.includes('/restored/')) {\n    writeFileSync(process.env.CONTROL_READY, 'ready');\n    while (!existsSync(process.env.CONTROL_RELEASE)) await new Promise(r => setTimeout(r, 10));\n  }\n  expect(value).toBe(1);\n});\n`;
  await writeFile(join(source, production), bytes);
  await writeFile(join(source, file), body);
  await writeFile(
    join(source, 'client/vitest.config.mjs'),
    'export default { test: { include: ["src/**/*.test.ts"] } };\n',
  );
  await writeFile(join(source, 'package.json'), '{"private":true,"type":"module"}\n');
  await writeFile(join(source, 'package-lock.json'), '{"lockfileVersion":3}\n');
  const recipe = {
    id: 'control',
    invariant: 'Value fault fails',
    rationale: 'CLI control',
    source: production,
    sourceSha256: digest(bytes),
    before: 'value = 1',
    after: 'value = 2',
    selected: [{ file, name: 'rejects bad value' }],
    testSha256: [{ file, sha256: digest(body) }],
    expected: [
      {
        file,
        name: 'rejects bad value',
        line: 9,
        column: 17,
        message: 'expected 2 to be 1 // Object.is equality',
      },
    ],
    timeoutMs: 15000,
  };
  await writeFile(join(runner, 'manifest.json'), JSON.stringify({ schema: 1, cases: [recipe] }));
  const paths = [production, file, 'client/vitest.config.mjs', 'package.json', 'package-lock.json'];
  if (bootstrap)
    paths.push(...(await mapFixture(source, bootstrap === true ? 'success' : bootstrap)));
  const uniquePaths = [...new Set(paths)];
  const entries = uniquePaths.map((path, i) => ({
    path,
    blob: (i + 1).toString(16).padStart(40, '0'),
  }));
  await writeFile(join(root, 'objects.json'), JSON.stringify(entries));
  await mkdir(join(root, 'git-internals'));
  const gitCode = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const entries=JSON.parse(fs.readFileSync(${JSON.stringify(join(root, 'objects.json'))}));
const args=process.argv.slice(2).filter(a=>a!=='--no-optional-locks');
const i=args.indexOf('-C');if(i>=0)args.splice(i,2);
const emit=s=>process.stdout.write(s);
if(args[0]==='--version')emit('git fixture\\n');
else if(args[0]==='ls-files'||args[0]==='status')emit('');
else if(args[0]==='rev-parse')emit(['--absolute-git-dir','--git-common-dir'].includes(args[1])?${JSON.stringify(join(root, 'git-internals'))}+'\\n':'${'1'.repeat(40)}\\n');
else if(args[0]==='merge-base')emit('${'1'.repeat(40)}\\n');
else if(args[0]==='ls-tree')emit(entries.map(e=>'100644 blob '+e.blob+'\\t'+e.path+'\\0').join(''));
else if(args[0]==='cat-file'&&args[1]==='-t')emit('commit\\n');
else if(args[0]==='cat-file'&&args[1]==='--batch')for(const blob of fs.readFileSync(0,'utf8').trim().split('\\n')){const e=entries.find(e=>e.blob===blob);const b=fs.readFileSync(path.join(${JSON.stringify(source)},e.path));emit(blob+' blob '+b.length+'\\n');emit(b);emit('\\n');}
else throw new Error('Unexpected read-only Git command '+args);
`;
  await writeFile(join(bin, 'git'), gitCode);
  await chmod(join(bin, 'git'), 0o755);
  const runtime = join(root, 'runtime');
  await mkdir(runtime);
  const copied = new Set();
  async function copyDependency(name) {
    if (copied.has(name)) return;
    copied.add(name);
    const from = join(runtimeRoot, name);
    let pkg;
    try {
      pkg = JSON.parse(await readFile(join(from, 'package.json')));
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    assert.equal((await lstat(from)).isSymbolicLink(), false, `External dependency only: ${name}`);
    await cp(from, join(runtime, name), { recursive: true });
    for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies }))
      await copyDependency(dep);
  }
  await copyDependency('vitest');
  const npmCode = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
if(process.argv[2]==='--version')console.log('fixture-install-boundary');
else if(JSON.stringify(process.argv.slice(2))===JSON.stringify(['run','setup:map-source'])){
  const child=spawn(process.execPath,['scripts/setup-map-source.mjs'],{stdio:'inherit'});
  process.on('SIGTERM',()=>child.kill('SIGTERM'));
  child.on('close',code=>{process.exitCode=code??1;});
}
else {if(JSON.stringify(process.argv.slice(2))!==JSON.stringify(['ci','--ignore-scripts','--no-audit','--no-fund']))throw new Error('Unexpected install command');if(${Boolean(bootstrap)}&&!fs.existsSync('vendor/settlemaker-runtime.tgz'))throw new Error('Bootstrap must precede install');fs.cpSync(${JSON.stringify(runtime)},path.join(process.cwd(),'node_modules'),{recursive:true});}
`;
  await writeFile(join(bin, 'npm'), npmCode);
  await chmod(join(bin, 'npm'), 0o755);
  return { root, runner, bin, recipe };
}

async function launchCliControl(t, f) {
  const directory = join(f.root, 'cli-process');
  await mkdir(directory);
  const ready = join(f.root, 'ready');
  const release = join(f.root, 'release');
  const output = join(f.root, 'output');
  const stdout = await open(join(directory, 'stdout.log'), 'wx');
  const stderr = await open(join(directory, 'stderr.log'), 'wx');
  const args = [
    join(f.runner, 'scripts/review/run-mutations.mjs'),
    '--head',
    '1'.repeat(40),
    '--base',
    '2'.repeat(40),
    '--manifest',
    'manifest.json',
    '--output',
    output,
  ];
  const startedAt = Date.now();
  const cli = spawn(process.execPath, args, {
    cwd: f.runner,
    env: {
      ...process.env,
      PATH: f.bin + ':' + process.env.PATH,
      CONTROL_READY: ready,
      CONTROL_RELEASE: release,
    },
    stdio: ['ignore', stdout.fd, stderr.fd],
  });
  const running = new Promise((resolve, reject) => {
    cli.once('error', reject);
    cli.once('close', async (code, signal) => {
      const record = {
        command: [process.execPath, ...args],
        pid: cli.pid,
        cwd: f.runner,
        startedAt,
        finishedAt: Date.now(),
        code,
        signal,
        reaped: true,
      };
      try {
        await writeFile(join(directory, 'process.json'), JSON.stringify(record, null, 2) + '\n');
        resolve(record);
      } catch (error) {
        reject(error);
      }
    });
  });
  t.after(async () => {
    await running;
    await stdout.close();
    await stderr.close();
  });
  return { cli, running, ready, release, output };
}

for (const boundary of ['install', 'baseline']) {
  test(`CLI thrown ${boundary} call preserves scratch without complete persisted process proof`, async (t) => {
    for (const proof of ['group-unknown', 'parent-unreaped', 'record-missing', 'complete']) {
      const f = await cliControl(t);
      const processFile = join(f.runner, 'scripts/review/process.mjs');
      const original = await readFile(processFile, 'utf8');
      // Inject bookkeeping failure in the disposable copy only. No OS child is
      // launched at this boundary; these records are not real reaping evidence.
      const injected =
        original.replace('export async function runProcess(', 'async function actualRunProcess(') +
        `
export async function runProcess(command, args, options) {
  const target = ${JSON.stringify(boundary)};
  if ((target === 'install' && args[0] === 'ci') ||
      (target === 'baseline' && options.directory.endsWith('/baseline'))) {
    const proof = ${JSON.stringify(proof)};
    const record = { command: [command, ...args], cwd: options.cwd,
      startedAt: Date.now(), finishedAt: Date.now(), code: 0,
      reaped: proof !== 'parent-unreaped', groupAbsent: proof !== 'group-unknown',
      injectedBookkeepingFailure: true };
    await writeFile(join(options.directory, 'stdout.log'), 'INJECTED: no OS process launched\\n');
    await writeFile(join(options.directory, 'stderr.log'), 'INJECTED_PROCESS_BOOKKEEPING_FAILURE\\n');
    if (proof !== 'record-missing')
      await writeFile(join(options.directory, 'process.json'), JSON.stringify(record, null, 2) + '\\n');
    throw new Error('INJECTED_PROCESS_BOOKKEEPING_FAILURE');
  }
  return actualRunProcess(command, args, options);
}
`;
      await writeFile(processFile, injected);
      await writeFile(
        join(f.root, 'control.json'),
        JSON.stringify({
          boundary,
          proof,
          injectedBookkeepingFailure: true,
          osChildLaunched: false,
        }),
      );
      const { running, output } = await launchCliControl(t, f);
      const run = await running;
      const report = JSON.parse(await readFile(join(output, 'report.json')));
      assert.equal(run.code, 1);
      assert.notEqual(report.classification, 'detected');
      assert.match(report.error ?? report.cases[0]?.reason, /INJECTED_PROCESS_BOOKKEEPING_FAILURE/);
      const safe = proof === 'complete';
      assert.equal(report.scratchPreserved, !safe, `${boundary}/${proof}`);
      const processDirectory = join(
        output,
        boundary === 'install' ? 'install' : 'cases/control/baseline',
      );
      const recovered =
        boundary === 'install' ? report.install : report.cases[0].phases.baseline.process;
      if (proof !== 'record-missing') {
        const raw = JSON.parse(await readFile(join(processDirectory, 'process.json')));
        assert.deepEqual(recovered, raw, 'Persisted raw process proof is retained verbatim');
      } else {
        assert.equal(recovered, undefined);
        assert.equal(
          boundary === 'install'
            ? report.installProcessEvidenceMissing
            : report.cases[0].phases.baseline.processEvidenceMissing,
          true,
        );
        await assert.rejects(lstat(join(processDirectory, 'process.json')), { code: 'ENOENT' });
      }
      assert.match(await readFile(join(processDirectory, 'stderr.log'), 'utf8'), /INJECTED/);
      if (safe) await assert.rejects(lstat(report.scratch), { code: 'ENOENT' });
      else {
        assert.ok((await lstat(report.scratch)).isDirectory());
        assert.equal(
          await readFile(join(report.scratch, 'source', f.recipe.source), 'utf8'),
          'export const value = 1;\n',
        );
        // The injection launched no child, so the test owns and can clean this
        // retained scratch after observing the runner's conservative decision.
        t.after(() => rm(report.scratch, { recursive: true, force: true }));
      }
      if (boundary === 'install') assert.deepEqual(report.cases, []);
      else {
        const c = report.cases[0];
        assert.equal(c.classification, safe ? 'setup-failed' : 'restore-failed');
        assert.equal(c.restorationStartedAt, undefined);
        assert.equal(c.phases.mutant, undefined);
        assert.equal(c.phases.restored, undefined);
        await assert.rejects(lstat(join(output, 'cases/control/mutant')), { code: 'ENOENT' });
      }
      assert.equal(report.canonicalUnchanged, true);
    }
  });
}

for (const proof of ['group-unknown', 'record-missing', 'complete', 'normal-success']) {
  test(`CLI bootstrap setup.json write failure remains conservative: ${proof}`, async (t) => {
    const f = await cliControl(t, true);
    const fault = proof !== 'normal-success';
    if (fault) {
      const processFile = join(f.runner, 'scripts/review/process.mjs');
      const original = await readFile(processFile, 'utf8');
      // Only the complete-proof control launches bootstrap. Other controls
      // inject records without children; the directory induces a real EISDIR.
      await writeFile(
        processFile,
        original.replace('export async function runProcess(', 'async function actualRunProcess(') +
          `
export async function runProcess(command, args, options) {
  if (args[0] !== 'run' || args[1] !== 'setup:map-source')
    return actualRunProcess(command, args, options);
  const proof = ${JSON.stringify(proof)};
  let record;
  if (proof === 'complete') record = await actualRunProcess(command, args, options);
  else {
    record = { command: [command, ...args], cwd: options.cwd,
      startedAt: Date.now(), finishedAt: Date.now(), code: 0,
      reaped: true, groupAbsent: false, injectedBookkeepingFailure: true };
    await writeFile(join(options.directory, 'stdout.log'), 'INJECTED: no bootstrap process launched\\n');
    await writeFile(join(options.directory, 'stderr.log'), 'INJECTED_BOOTSTRAP_PROOF\\n');
    if (proof !== 'record-missing')
      await writeFile(join(options.directory, 'process.json'), JSON.stringify(record, null, 2) + '\\n');
  }
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(options.directory, '..', 'setup.json'));
  if (proof === 'record-missing') throw new Error('INJECTED_MISSING_BOOTSTRAP_PROOF');
  return record;
}
`,
      );
    }
    await writeFile(
      join(f.root, 'control.json'),
      JSON.stringify({
        control: 'bootstrap-diagnostic-write',
        proof,
        diagnosticWriteFailure: fault,
        bootstrapProcessLaunched: proof === 'complete' || !fault,
      }),
    );
    const { running, release, output } = await launchCliControl(t, f);
    await writeFile(release, 'release');
    const run = await running;
    const report = JSON.parse(await readFile(join(output, 'report.json')));
    const setup = join(output, 'map-source-setup');
    if (proof === 'record-missing')
      await assert.rejects(lstat(join(setup, 'process/process.json')), { code: 'ENOENT' });
    else {
      const raw = JSON.parse(await readFile(join(setup, 'process/process.json')));
      assert.equal(raw.reaped, true);
      assert.equal(raw.groupAbsent, proof !== 'group-unknown');
    }
    if (fault) {
      assert.equal(run.code, 1);
      assert.notEqual(report.classification, 'detected');
      assert.match(report.error, /EISDIR/);
      assert.ok((await lstat(join(setup, 'setup.json'))).isDirectory());
      assert.equal(
        report.mapSourceSetup,
        undefined,
        'Thrown diagnostics prevent returned decision',
      );
      assert.equal(report.install, undefined);
      assert.deepEqual(report.cases, []);
      assert.equal(report.scratchPreserved, true);
      assert.ok((await lstat(report.scratch)).isDirectory());
      assert.equal(
        await readFile(join(report.scratch, 'source', f.recipe.source), 'utf8'),
        'export const value = 1;\n',
      );
      // Injected paths launched no child; the complete path has actual cleanup
      // proof. Only the test hook reclaims this deliberately retained scratch.
      t.after(() => rm(report.scratch, { recursive: true, force: true }));
    } else {
      assert.equal(run.code, 0, JSON.stringify(report));
      assert.equal(report.classification, 'detected');
      assert.equal(report.mapSourceSetup.classification, 'complete');
      assert.ok(report.mapSourceSetup.process.reaped && report.mapSourceSetup.process.groupAbsent);
      assert.equal(report.scratchPreserved, false);
      await assert.rejects(lstat(report.scratch), { code: 'ENOENT' });
    }
    assert.equal(report.canonicalUnchanged, true);
    await readFile(join(setup, 'process/stdout.log'));
    await readFile(join(setup, 'process/stderr.log'));
  });
}

for (const interruption of [null, 'SIGINT', 'SIGTERM']) {
  test(`CLI interruption during final restored rerun: ${interruption ?? 'positive control'}`, async (t) => {
    const f = await cliControl(t, interruption === null);
    await writeFile(
      join(f.root, 'control.json'),
      JSON.stringify(
        {
          control: 'final-restored-rerun',
          interruption,
          bootstrap: interruption === null,
        },
        null,
        2,
      ) + '\n',
    );
    const { cli, running, ready, release, output } = await launchCliControl(t, f);
    try {
      const deadline = Date.now() + 20000;
      while (!(await lstat(ready).catch(() => null))) {
        assert.ok(Date.now() < deadline, `CLI did not reach restored run: ${f.root}`);
        await delay(25);
      }
      if (interruption) {
        const restored = JSON.parse(
          await readFile(join(output, 'cases/control/mutant/process.json')),
        );
        assert.equal(
          cli.kill(interruption),
          true,
          'Signal sent to owned CLI during restored rerun',
        );
        assert.ok(restored.reaped && restored.groupAbsent);
        await delay(75);
      }
    } finally {
      await writeFile(release, 'release');
    }
    const run = await running;
    const report = JSON.parse(await readFile(join(output, 'report.json')));
    const c = report.cases[0];
    assert.ok(run.reaped);
    assert.equal(c.phases.restored.result.classification, 'complete');
    assert.equal(c.phases.restored.result.failed.length, 0);
    assert.equal(c.hashes.original, c.hashes.restored);
    assert.ok(c.hashes.inventoryRestored);
    assert.ok(c.restorationStartedAt >= c.phases.mutant.process.finishedAt);
    assert.equal(report.scratchPreserved, false);
    await assert.rejects(lstat(report.scratch), { code: 'ENOENT' });
    assert.equal(report.canonicalUnchanged, true);
    assert.equal(
      report.mapSourceSetup.status,
      interruption === null ? 'bootstrapped' : 'no-bootstrap-needed',
    );
    assert.equal(report.mapSourceSetup.pinnedInventoryUnchanged, true);
    if (interruption === null)
      assert.ok(report.install.startedAt >= report.mapSourceSetup.process.finishedAt);
    assert.equal(run.code, interruption ? 1 : 0, JSON.stringify(report));
    assert.equal(report.classification, interruption ? 'inconclusive' : 'detected');
    assert.equal(c.classification, interruption ? 'inconclusive' : 'detected');
    assert.equal(report.interrupted, Boolean(interruption));
    if (interruption) assert.equal(c.interrupted, true);
    const summary = JSON.parse(await readFile(join(f.root, 'cli-process/stdout.log'), 'utf8'));
    assert.equal(summary.classification, report.classification);
  });
}

test('CLI cancellation of required map bootstrap reaps children, records setup, skips install and cleans scratch', async (t) => {
  const f = await cliControl(t, 'hang');
  await writeFile(
    join(f.root, 'control.json'),
    JSON.stringify(
      {
        control: 'required-bootstrap-interruption',
        interruption: 'SIGTERM',
      },
      null,
      2,
    ) + '\n',
  );
  const { cli, running, output } = await launchCliControl(t, f);
  let childPid;
  try {
    const deadline = Date.now() + 20000;
    for (;;) {
      const report = await readFile(join(output, 'report.json'))
        .then(JSON.parse)
        .catch(() => null);
      // The initial report is not written until setup completes; observe the
      // owned scratch cwd through the setup's raw npm script startup marker.
      const log = await readFile(join(output, 'map-source-setup/process/stdout.log'), 'utf8').catch(
        () => '',
      );
      const match = /^BOOTSTRAP_READY (.+)$/m.exec(log);
      if (match) {
        childPid = Number(await readFile(join(match[1], 'vendor/child-pid')));
        break;
      }
      assert.equal(report?.classification === 'setup-failed', false, 'Bootstrap remains active');
      assert.ok(Date.now() < deadline, `Bootstrap did not reach owned child: ${f.root}`);
      await delay(25);
    }
  } finally {
    cli.kill('SIGTERM');
  }
  const run = await running;
  const report = JSON.parse(await readFile(join(output, 'report.json')));
  assert.equal(run.code, 1);
  assert.equal(report.classification, 'inconclusive');
  assert.equal(report.interrupted, true);
  assert.equal(report.install, undefined);
  assert.deepEqual(report.cases, []);
  assert.equal(report.mapSourceSetup.required, true);
  assert.equal(report.mapSourceSetup.classification, 'inconclusive');
  assert.equal(report.mapSourceSetup.pinnedInventoryUnchanged, true);
  assert.ok(report.mapSourceSetup.process.reaped && report.mapSourceSetup.process.groupAbsent);
  assert.throws(() => process.kill(childPid, 0), { code: 'ESRCH' });
  assert.equal(report.scratchPreserved, false);
  await assert.rejects(lstat(report.scratch), { code: 'ENOENT' });
});

for (const persistent of [false, true]) {
  test(
    persistent
      ? 'persistent worker after parent exit stays an infrastructure failure'
      : 'normal late worker completes naturally before restoration is allowed',
    async (t) => {
      const root = await mkdtemp(join(tmpdir(), 'hq-worker-exit-'));
      t.after(() => rm(root, { recursive: true, force: true }));
      const directory = join(root, 'logs');
      await mkdir(directory);
      const marker = join(root, 'worker-completed');
      const pidFile = join(root, 'worker-pid');
      const childCode = persistent
        ? "process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000);"
        : `const fs=require('node:fs');process.send('ready');setTimeout(()=>{fs.writeFileSync(${JSON.stringify(marker)},'completed');process.exit(0)},75);`;
      const parentCode = `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:['ignore','ignore','ignore','ipc']});child.once('message',()=>{fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));process.exit(0)});`;
      const run = await runProcess(process.execPath, ['-e', parentCode], {
        cwd: root,
        env: process.env,
        directory,
        timeoutMs: 5000,
      });
      assert.equal(run.code, 0);
      assert.equal(run.reaped, true);
      assert.equal(run.groupAbsent, true);
      assert.equal(run.timeout, false);
      assert.equal(run.interrupted, false);
      const pid = Number(await readFile(pidFile, 'utf8'));
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
      if (persistent) assert.equal(run.strayChildren, true);
      else {
        assert.notEqual(run.strayChildren, true);
        assert.equal(await readFile(marker, 'utf8'), 'completed');
      }
    },
  );
}
