#!/usr/bin/env node
// Runs the whole test suite repeatedly while burner processes occupy the CPUs, and fails on any
// failed run. A test that passes alone but fails here depends on timing, not on the code.
//
//   npm run test:stress                 5 runs, one burner per core
//   STRESS_RUNS=20 STRESS_BURNERS=8 npm run test:stress
//   STRESS_BURNERS=0 npm run test:stress   no artificial load
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';

const runs = Number(process.env.STRESS_RUNS ?? 5);
const burners = Number(process.env.STRESS_BURNERS ?? os.availableParallelism());
const spin = 'for(;;){}';

const load = Array.from({ length: burners }, () =>
  spawn(process.execPath, ['-e', spin], { stdio: 'ignore' }),
);
const stopLoad = () => load.forEach((p) => p.kill('SIGKILL'));
process.on('SIGINT', () => (stopLoad(), process.exit(130)));
process.on('SIGTERM', () => (stopLoad(), process.exit(143)));

const failed = [];
for (let i = 1; i <= runs; i++) {
  console.log(`\n=== stress run ${i}/${runs} (${burners} burners) ===`);
  const res = spawnSync('npm', ['test'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (res.status !== 0) {
    failed.push(i);
    const out = `${res.stdout}\n${res.stderr}`;
    const lines = out.split('\n').filter((l) => /^\s*(FAIL|×)|not ok|AssertionError/.test(l));
    console.log(`run ${i} FAILED\n${[...new Set(lines)].slice(0, 40).join('\n')}`);
  } else {
    console.log(`run ${i} passed`);
  }
}
stopLoad();
if (failed.length) {
  console.error(`\n${failed.length}/${runs} runs failed (${failed.join(', ')}): flaky tests`);
  process.exit(1);
}
console.log(`\nall ${runs} runs passed`);
