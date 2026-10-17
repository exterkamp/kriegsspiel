import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRegistry, startingState } from './registry.js';
import { replayLog } from './replay.js';
import { initialWorldFromHeader } from './pinned-header.js';
import { parseInputLog } from './store.js';

/**
 * `npm run replay -w server -- <logfile> [--json] [--events] [--until <gameMs>]`
 *
 * Replays a game's input log (JSON lines) on a manual clock, with no wall-clock waits and no
 * parser calls, and prints the final state. `--json` prints the full engine state, `--events`
 * the emitted events instead of the summary. A relative `<logfile>` is resolved from the
 * directory npm was run in, not from `server/`.
 */
async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--until');
  if (!file) {
    console.error('usage: replay <logfile> [--json] [--events] [--until <gameMs>]');
    return 2;
  }
  const untilArg = args[args.indexOf('--until') + 1];
  const until = args.includes('--until') ? Number(untilArg) : undefined;
  if (until !== undefined && !Number.isFinite(until)) {
    console.error('--until needs a number of game milliseconds');
    return 2;
  }
  const { header, entries } = parseInputLog(
    await readFile(resolve(process.env.INIT_CWD ?? process.cwd(), file), 'utf8'),
  );
  const { state, emitted } = replayLog(
    header,
    initialWorldFromHeader(header),
    entries,
    createRegistry(),
    until,
    startingState,
  );
  if (args.includes('--json')) console.log(JSON.stringify(state, null, 2));
  else if (args.includes('--events')) console.log(JSON.stringify(emitted, null, 2));
  else {
    console.log(`game ${header.gameId} (${header.scenarioId}, seed ${header.seed})`);
    console.log(`${entries.length} inputs replayed to game time ${state.time} ms`);
    console.log(`${emitted.length} events emitted, ${state.queue.length} still queued`);
    console.log(`outcome: ${JSON.stringify(state.world.outcome)}`);
  }
  return 0;
}

process.exitCode = await main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  return 1;
});
