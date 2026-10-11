import { spawn } from 'node:child_process';
import { open, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

function groupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
}
function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

/** POSIX process-group ownership: resolve only after parent close AND group absence. */
export async function runProcess(command, args, { cwd, env, directory, timeoutMs, signal }) {
  if (process.platform === 'win32') throw new Error('POSIX process groups are required');
  const stdout = await open(join(directory, 'stdout.log'), 'wx');
  const stderr = await open(join(directory, 'stderr.log'), 'wx');
  const record = {
    command: [command, ...args],
    cwd,
    startedAt: Date.now(),
    timeout: false,
    interrupted: false,
    reaped: false,
    groupAbsent: false,
  };
  let child;
  let timer;
  let killTimer;
  const stop = (reason) => {
    record[reason] = true;
    if (child?.pid) {
      signalGroup(child.pid, 'SIGTERM');
      killTimer ??= setTimeout(() => signalGroup(child.pid, 'SIGKILL'), 500);
    }
  };
  const abort = () => stop('interrupted');
  try {
    child = spawn(command, args, {
      cwd,
      env,
      detached: true,
      stdio: ['ignore', stdout.fd, stderr.fd],
    });
    record.pid = child.pid;
    const closed = new Promise((resolve) => {
      child.once('error', (error) => {
        record.spawnError = error.message;
      });
      child.once('close', (code, exitSignal) => {
        record.code = code;
        record.signal = exitSignal;
        record.reaped = true;
        resolve();
      });
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    timer = setTimeout(() => stop('timeout'), timeoutMs);
    await closed;
    clearTimeout(timer);
    clearTimeout(killTimer);
    // A closed parent can precede normal worker exit, especially on Linux.
    // Wait for that owned group to drain naturally before classifying leftovers.
    const drainStartedAt = Date.now();
    for (let i = 0; child.pid && i < 10 && groupExists(child.pid); i++) await delay(50);
    record.naturalDrainMs = Date.now() - drainStartedAt;
    // Workers remaining after the bounded grace are still infrastructure failure.
    if (child.pid && groupExists(child.pid)) {
      record.strayChildren = true;
      signalGroup(child.pid, 'SIGTERM');
      for (let i = 0; i < 10 && groupExists(child.pid); i++) await delay(50);
      if (groupExists(child.pid)) signalGroup(child.pid, 'SIGKILL');
      for (let i = 0; i < 40 && groupExists(child.pid); i++) await delay(50);
    }
    record.groupAbsent = !child.pid || !groupExists(child.pid);
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
    signal?.removeEventListener('abort', abort);
    await stdout.close();
    await stderr.close();
    record.finishedAt = Date.now();
    record.durationMs = record.finishedAt - record.startedAt;
    await writeFile(join(directory, 'process.json'), JSON.stringify(record, null, 2) + '\n', {
      flag: 'wx',
    });
  }
  return record;
}
