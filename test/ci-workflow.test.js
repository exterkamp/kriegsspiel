import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const { scripts, workspaces } = JSON.parse(readFileSync(new URL('package.json', root)));
const workflow = readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8');

test('CI test groups cover every workspace exactly once and retain repository/catalog tests', () => {
  const groups = [scripts['test:ci-maps'], scripts['test:ci-application']];
  const selected = groups.flatMap((script) =>
    [...script.matchAll(/ -w ([\w/-]+)/g)].map((m) => m[1]),
  );
  assert.deepEqual(selected.toSorted(), workspaces.toSorted());
  assert.equal(new Set(selected).size, selected.length);
  for (const group of groups) assert.ok(group.startsWith('npm run verify:map-source && '));
  assert.ok(scripts['test:ci-application'].includes('--if-present && npm run test:repository'));
  assert.ok(scripts['test:ci-maps'].endsWith('&& npm run test:local-map-catalog'));
  assert.equal(
    scripts['test:repository'],
    'node --test "test/*.test.js" "scripts/maps-assessment/*.test.mjs"',
  );
  assert.equal(
    scripts.test,
    'npm run verify:map-source && npm run test --workspaces --if-present && npm run test:repository && npm run test:local-map-catalog',
  );
  for (const name of ['test:ci-maps', 'test:ci-application'])
    assert.ok(workflow.includes(`run: npm run ${name}`));
  for (const name of ['lint', 'typecheck', 'build'])
    assert.ok(workflow.includes(`run: npm run ${name}`));
});

test('required check rejects failed, cancelled, skipped and unknown dependency results', () => {
  const gate = workflow.slice(workflow.indexOf('\n  check:\n'));
  assert.match(gate, /if: always\(\)/);
  assert.match(gate, /needs: \[validation, test-effectiveness\]/);
  assert.match(gate, /VALIDATION_RESULT: \$\{\{ needs\.validation\.result }}/);
  assert.match(gate, /EFFECTIVENESS_RESULT: \$\{\{ needs\.test-effectiveness\.result }}/);
  const command = gate
    .split('        run: |\n')[1]
    .split('\n')
    .map((line) => line.trim())
    .join('\n');
  assert.ok(command);
  assert.match(gate, /RUN_CANCELLED: \$\{\{ cancelled\(\) }}/);
  for (const validation of ['success', 'failure', 'cancelled', 'skipped', '', 'unexpected']) {
    for (const effectiveness of ['success', 'failure', 'cancelled', 'skipped', '', 'unexpected']) {
      const run = spawnSync('bash', ['-e', '-c', command], {
        env: {
          ...process.env,
          RUN_CANCELLED: 'false',
          VALIDATION_RESULT: validation,
          EFFECTIVENESS_RESULT: effectiveness,
        },
      });
      assert.equal(
        run.status === 0,
        validation === 'success' && effectiveness === 'success',
        `${validation}/${effectiveness}`,
      );
    }
  }
});

test('cancelled workflow cannot leave a successful aggregate', () => {
  const gate = workflow.slice(workflow.indexOf('\n  check:\n'));
  const command = gate
    .split('        run: |\n')[1]
    .split('\n')
    .map((line) => line.trim())
    .join('\n');
  const run = spawnSync('bash', ['-e', '-c', command], {
    env: {
      ...process.env,
      RUN_CANCELLED: 'true',
      VALIDATION_RESULT: 'success',
      EFFECTIVENESS_RESULT: 'success',
    },
  });
  assert.notEqual(run.status, 0);
});

test('all validation groups finish independently; only superseded PR runs cancel', () => {
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /group: \[static-build, maps, application\]/);
  assert.match(workflow, /merge_group:/);
  assert.match(workflow, /HQ_REVIEW_HEAD: .*github\.event\.merge_group\.head_sha/);
  assert.match(workflow, /HQ_REVIEW_BASE: .*github\.event\.merge_group\.base_sha/);
  assert.match(workflow, /branches: \[main\]/);
  assert.match(
    workflow,
    /group: .*github\.event_name.*github\.event\.pull_request\.number \|\| github\.run_id/,
  );
  assert.match(workflow, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' }}/);
  assert.match(workflow, /name: hq-ordinary-\$\{\{ matrix\.group }}/);
  assert.equal((workflow.match(/if: always\(\)/g) ?? []).length, 3);
  assert.equal((workflow.match(/retention-days: 30/g) ?? []).length, 2);
  assert.equal((workflow.match(/Checkout does not match candidate source/g) ?? []).length, 2);
});

test('source selection retains distinct PR and merge-queue head/base provenance', () => {
  const select = (key, github) => {
    const expression = workflow.match(new RegExp(`^  ${key}: \\$\\{\\{ (.+) }}$`, 'm'))?.[1];
    assert.ok(expression);
    // These source expressions use property selection and || only. Empty
    // event objects model GitHub's missing-property fallback for other events.
    assert.match(expression, /^[\w. |]+$/);
    return Function('github', `return ${expression}`)(github);
  };
  for (const kind of ['pull_request', 'merge_group', 'push']) {
    const github = {
      sha: 'event-head',
      event: {
        pull_request: { head: {}, base: {} },
        merge_group: {},
      },
    };
    if (kind === 'pull_request')
      github.event.pull_request = { head: { sha: 'pr-head' }, base: { sha: 'pr-base' } };
    if (kind === 'merge_group')
      github.event.merge_group = { head_sha: 'queue-head', base_sha: 'queue-base' };
    assert.equal(
      select('HQ_REVIEW_HEAD', github),
      kind === 'push' ? 'event-head' : kind === 'pull_request' ? 'pr-head' : 'queue-head',
    );
    assert.equal(
      select('HQ_REVIEW_BASE', github),
      kind === 'push' ? 'event-head' : kind === 'pull_request' ? 'pr-base' : 'queue-base',
    );
  }
});
