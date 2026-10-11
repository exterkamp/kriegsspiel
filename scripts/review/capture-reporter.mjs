import { writeFileSync } from 'node:fs';

const snapshot = (task) => ({
  id: task.id,
  type: task.type,
  name: task.name,
  filepath: task.filepath,
  mode: task.mode,
  result: task.result,
  tasks: task.tasks?.map(snapshot),
});

// Verified against installed Vitest 3.2.7: JSON omits the top-level error list.
// Keep both supported run-end and legacy finished hooks to detect incomplete capture.
export default class CaptureReporter {
  data = { schema: 1, runId: process.env.HQ_REVIEW_RUN_ID, pid: process.pid };
  flush() {
    this.data.writtenAt = Date.now();
    writeFileSync(
      process.env.HQ_REVIEW_ERRORS_FILE,
      JSON.stringify(
        this.data,
        (_, value) => (typeof value === 'bigint' ? `${value}n` : value),
        2,
      ) + '\n',
    );
  }
  onFinished(files, errors) {
    this.data.onFinished = { unhandledErrors: errors, files: files.map(snapshot) };
    this.flush();
  }
  onTestRunEnd(modules, unhandledErrors, reason) {
    this.data.onTestRunEnd = {
      reason,
      unhandledErrors,
      files: modules.map((m) => snapshot(m.task)),
    };
    this.flush();
  }
}
