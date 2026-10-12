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
  for (const validation of ['success', 'failure', 'cancelled', 'skipped', '', 'unexpected']) {
    for (const effectiveness of ['success', 'failure', 'cancelled', 'skipped', '', 'unexpected']) {
      const run = spawnSync('bash', ['-e', '-c', command], {
        env: { ...process.env, VALIDATION_RESULT: validation, EFFECTIVENESS_RESULT: effectiveness },
      });
      assert.equal(
        run.status === 0,
        validation === 'success' && effectiveness === 'success',
        `${validation}/${effectiveness}`,
      );
    }
  }
});

test('all validation groups finish independently; only superseded PR runs cancel', () => {
  assert.match(workflow, /fail-fast: false/);
  assert.match(workflow, /group: \[static-build, maps, application\]/);
  assert.match(workflow, /merge_group:/);
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
