import { relative } from 'node:path';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const key = (t) => `${t.file}\0${t.name}`;
const sorted = (items) => [...items].sort((a, b) => key(a).localeCompare(key(b)));
const outcome = (classification, reason) => ({ classification, reason });

/** Normalize the actual task tree, never infer collection failures from suite counts. */
export function inspectPhase({ process: run, errors, json, runId, root }) {
  if (!run?.reaped || !run.groupAbsent)
    return outcome('restore-failed', 'Owned process group was not reaped');
  if (run.timeout || run.interrupted || run.signal || run.spawnError || run.strayChildren)
    return outcome('inconclusive', 'Process timeout, interruption or infrastructure failure');
  if (
    !errors ||
    !json ||
    errors.schema !== 1 ||
    errors.runId !== runId ||
    errors.pid !== run.pid ||
    !(errors.writtenAt >= run.startedAt && errors.writtenAt <= run.finishedAt) ||
    !(json.startTime >= run.startedAt && json.startTime <= run.finishedAt)
  )
    return outcome('inconclusive', 'Missing, stale or foreign reports');
  const end = errors.onTestRunEnd;
  if (!end || !Array.isArray(end.unhandledErrors) || !Array.isArray(end.files))
    return outcome('inconclusive', 'Incomplete or inconsistent error channels');
  if (end.unhandledErrors.length)
    return outcome('inconclusive', 'Unhandled errors (including mixed assertion failures)');
  const tests = [];
  const collectionErrors = [];
  const hookErrors = [];
  function withLocations(error) {
    // JSON-only runs preserve the raw stack but need not populate `stacks`.
    const locations = [
      ...(error.stacks ?? []).map((s) => ({
        file: relative(root, s.file),
        line: s.line,
        column: s.column,
      })),
    ];
    for (const match of (error.stack ?? '').matchAll(
      /^\s*at (?:.*?\()?((?:file:\/\/)?\/.*?):(\d+):(\d+)\)?$/gm,
    ))
      locations.push({
        file: relative(root, match[1].replace(/^file:\/\//, '')),
        line: Number(match[2]),
        column: Number(match[3]),
      });
    return { ...error, locations };
  }
  function visit(task, file, ancestors = []) {
    for (const [hook, state] of Object.entries(task.result?.hooks ?? {}))
      if (state !== 'pass') hookErrors.push({ file, hook, state });
    if (task.type === 'test') {
      tests.push({
        file,
        name: [...ancestors, task.name].join(' '),
        mode: task.mode,
        state: task.result?.state,
        errors: (task.result?.errors ?? []).map(withLocations),
        retries: task.result?.retryCount ?? 0,
        repeats: task.result?.repeatCount ?? 0,
      });
    } else {
      if (task.result?.errors?.length) collectionErrors.push(...task.result.errors);
      for (const child of task.tasks ?? [])
        visit(child, file, task.filepath ? [] : [...ancestors, task.name]);
    }
  }
  for (const file of end.files) {
    if (!file.filepath) return outcome('inconclusive', 'Missing task file identity');
    visit(file, relative(root, file.filepath));
  }
  if (collectionErrors.length || hookErrors.length)
    return { ...outcome('invalid', 'Collection or hook error'), collectionErrors, hookErrors };
  if (!Array.isArray(json.testResults)) return outcome('inconclusive', 'Missing JSON task results');
  const jsonTests = sorted(
    json.testResults.flatMap((file) =>
      (file.assertionResults ?? []).map((t) => ({
        file: relative(root, file.name),
        name: t.fullName,
        status: t.status,
        messages: t.failureMessages,
      })),
    ),
  );
  const tasks = sorted(tests);
  if (
    !tasks.length ||
    new Set(tasks.map(key)).size !== tasks.length ||
    jsonTests.length !== tasks.length ||
    json.numTotalTests !== tasks.length
  )
    return outcome('invalid', 'Zero, duplicate or inconsistent collected tests');
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const j = jsonTests[i];
    const status =
      t.state === 'pass'
        ? 'passed'
        : t.state === 'fail'
          ? 'failed'
          : t.mode === 'todo'
            ? 'todo'
            : 'skipped';
    if (
      key(t) !== key(j) ||
      status !== j.status ||
      !Array.isArray(j.messages) ||
      j.messages.length !== t.errors.length ||
      t.errors.some((e, index) => !j.messages[index].includes(e.message))
    )
      return outcome('inconclusive', 'JSON/task assertion channels disagree');
  }
  const selected = tasks.filter((t) => t.mode === 'run');
  if (
    !selected.length ||
    selected.some((t) => !['pass', 'fail'].includes(t.state) || t.retries || t.repeats)
  )
    return outcome('invalid', 'Zero or incomplete selected tests, retries or repeats');
  const failed = selected.filter((t) => t.state === 'fail');
  const passed = selected.filter((t) => t.state === 'pass');
  if (
    json.numFailedTests !== failed.length ||
    json.numPassedTests !== passed.length ||
    json.success !== (failed.length === 0) ||
    run.code !== (failed.length ? 1 : 0) ||
    end.reason !== (failed.length ? 'failed' : 'passed')
  )
    return outcome('inconclusive', 'Exit status or report counts disagree');
  return {
    classification: 'complete',
    collectionErrors,
    hookErrors,
    unhandledErrors: end.unhandledErrors,
    tasks,
    selected,
    failed,
    identities: tasks.map(({ file, name, mode }) => ({ file, name, mode })),
  };
}

export function classifyCase(recipe, baseline, mutant, restored, hashes) {
  if (
    !hashes ||
    hashes.original !== recipe.sourceSha256 ||
    hashes.restored !== hashes.original ||
    hashes.mutant === hashes.original ||
    !hashes.testsUnchanged ||
    !hashes.inventoryRestored
  )
    return outcome('restore-failed', 'Source or test restoration hashes disagree');
  for (const [phase, report] of [
    ['baseline', baseline],
    ['restored', restored],
  ]) {
    if (report.classification !== 'complete')
      return outcome(report.classification, `${phase}: ${report.reason}`);
    if (
      !same(
        report.selected.map(({ file, name }) => ({ file, name })),
        sorted(recipe.selected),
      ) ||
      report.failed.length
    )
      return outcome('setup-failed', `${phase}: designated tests did not pass`);
  }
  if (mutant.classification !== 'complete')
    return outcome(mutant.classification, `mutant: ${mutant.reason}`);
  if (
    !same(
      mutant.selected.map(({ file, name }) => ({ file, name })),
      sorted(recipe.selected),
    )
  )
    return outcome('invalid', 'Mutant did not run the exact designated selection');
  if (
    !same(baseline.identities, mutant.identities) ||
    !same(baseline.identities, restored.identities)
  )
    return outcome('invalid', 'Collected or selected identities/counts changed');
  if (!mutant.failed.length)
    return outcome('survived', 'Meaningful production fault passed designated tests');
  const failures = mutant.failed.flatMap((t) => t.errors.map((error) => ({ test: t, error })));
  if (failures.length !== recipe.expected.length)
    return outcome('invalid', 'Unexpected assertion count');
  const matches = failures.map(({ test, error }) =>
    recipe.expected.flatMap((expected, index) =>
      expected.file === test.file &&
      expected.name === test.name &&
      error.name === 'AssertionError' &&
      error.message === expected.message &&
      error.locations?.some(
        (s) => s.file === expected.file && s.line === expected.line && s.column === expected.column,
      )
        ? [index]
        : [],
    ),
  );
  // Assign each expected occurrence once. Augmenting paths also handle errors
  // with multiple matching frames without making the result depend on order.
  const assigned = new Map();
  function consume(actual, seen = new Set()) {
    for (const expected of matches[actual]) {
      if (seen.has(expected)) continue;
      seen.add(expected);
      if (!assigned.has(expected) || consume(assigned.get(expected), seen)) {
        assigned.set(expected, actual);
        return true;
      }
    }
    return false;
  }
  for (let actual = 0; actual < failures.length; actual++) {
    if (!consume(actual))
      return outcome('invalid', 'Unrelated assertion or wrong expected assertion/location');
  }
  return outcome(
    'detected',
    'Only the exact designated behavioral assertions failed; baseline/restored passed',
  );
}
