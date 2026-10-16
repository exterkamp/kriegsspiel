#!/usr/bin/env node
// A stand-in for the `claude` CLI in the bridge tests. FAKE_CLAUDE picks what it does; it writes
// what it was given (args, cwd, env, stdin) to FAKE_CLAUDE_LOG so a test can check the call.
import { spawn } from 'node:child_process';
import { appendFileSync, readdirSync } from 'node:fs';

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (stdin += c));
process.stdin.on('end', () => {
  const mode = process.env.FAKE_CLAUDE ?? 'ok';
  // `hang` starts a grandchild that also ignores SIGTERM, as a tool or MCP server the CLI started
  // would be: only a kill of the whole process group ends it. No pipes, so it holds nothing open.
  const grandchild =
    mode === 'hang'
      ? spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], {
          stdio: 'ignore',
        })
      : undefined;
  if (process.env.FAKE_CLAUDE_LOG) {
    appendFileSync(
      process.env.FAKE_CLAUDE_LOG,
      JSON.stringify({
        args: process.argv.slice(2),
        cwd: process.cwd(),
        cwdEntries: readdirSync(process.cwd()),
        pid: process.pid,
        grandchildPid: grandchild?.pid ?? null,
        stdin,
        env: {
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? null,
          CLAUDE_BRIDGE_SECRET: process.env.CLAUDE_BRIDGE_SECRET ?? null,
          CLAUDE_CODE_MAX_OUTPUT_TOKENS: process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS ?? null,
        },
      }) + '\n',
    );
  }
  const usage = {
    input_tokens: 12,
    output_tokens: 5,
    cache_read_input_tokens: 100,
    cache_creation_input_tokens: 40,
  };
  const result = (extra) =>
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      stop_reason: 'end_turn',
      total_cost_usd: 0.0123,
      usage,
      result: '{"verdict":"ok"}',
      ...extra,
    });
  const delayMs = Number(process.env.FAKE_CLAUDE_DELAY_MS ?? 0);
  setTimeout(() => {
    switch (mode) {
      case 'ok':
        process.stdout.write(result({}));
        break;
      case 'stream': {
        // stream-json: NDJSON events, the result last.
        process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init' }) + '\n');
        process.stdout.write(
          JSON.stringify({
            type: 'assistant',
            message: { content: [{ type: 'text', text: '{"verdict":"no"}' }] },
          }) + '\n',
        );
        process.stdout.write(result({ result: '{"verdict":"no"}' }) + '\n');
        break;
      }
      case 'native':
        process.stdout.write(result({ result: 'done', structured_output: { verdict: 'ok' } }));
        break;
      case 'not-logged-in':
        process.stdout.write(
          result({ is_error: true, result: 'Not logged in · Please run /login', usage: {} }),
        );
        process.exitCode = 1;
        break;
      case 'rate-limited':
        process.stdout.write(
          result({ is_error: true, api_error_status: 429, result: 'API Error: 429 rate limited' }),
        );
        process.exitCode = 1;
        break;
      case 'bad-model':
        process.stdout.write(
          result({
            is_error: true,
            api_error_status: 404,
            result: 'There is an issue with the selected model',
          }),
        );
        process.exitCode = 1;
        break;
      case 'truncated':
        process.stdout.write(
          result({
            is_error: true,
            result: "API Error: Claude's response exceeded the 40 output token maximum.",
          }),
        );
        break;
      case 'error-exit':
        process.stderr.write('something broke\n');
        process.exitCode = 3;
        break;
      case 'bad-json':
        process.stdout.write('{"type":"result", not json');
        break;
      case 'hang':
        // Ignores SIGTERM, so only the bridge's SIGKILL ends it.
        process.on('SIGTERM', () => {});
        setInterval(() => {}, 1000);
        break;
    }
  }, delayMs);
});
