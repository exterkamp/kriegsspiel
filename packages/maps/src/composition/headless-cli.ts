import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HARD_LIMITS, type MapOverride, type MapSettings } from '../contract.js';
import { importAsset } from '../import.js';
import { battlefieldPreset } from './identity.js';
import { generateBattlefield } from './generate.js';
import { validateBattlefield } from './validate.js';
import { exportBattlefield } from './export.js';
import type { BattlefieldPreset } from './types.js';

async function textFile(path: string): Promise<string> {
  if ((await stat(path)).size > HARD_LIMITS.maxBytes) throw new RangeError('Input exceeds64MiB');
  return readFile(path, 'utf8');
}
/** Node-only entry; deliberately absent from the browser-safe public index. */
export async function runBattlefieldCli(args: string[]): Promise<number> {
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const k = args[i]!,
      v = args[i + 1];
    if (
      !['--preset', '--seed', '--settings', '--overrides', '--output', '--validate'].includes(k) ||
      v === undefined ||
      options.has(k)
    )
      throw new TypeError(`Invalid CLI option ${k}`);
    options.set(k, v);
  }
  if (options.has('--validate')) {
    const r = validateBattlefield(importAsset(await textFile(options.get('--validate')!)));
    process.stdout.write(JSON.stringify(r) + '\n');
    return r.ok ? 0 : 1;
  }
  const input = battlefieldPreset(
    (options.get('--preset') ?? 'flat-countryside') as BattlefieldPreset,
  );
  if (options.has('--seed')) input.seed = Number(options.get('--seed'));
  if (options.has('--settings'))
    input.settings = JSON.parse(await textFile(options.get('--settings')!)) as MapSettings;
  if (options.has('--overrides'))
    input.overrides = JSON.parse(await textFile(options.get('--overrides')!)) as MapOverride[];
  const result = generateBattlefield(input);
  if (!result.ok) {
    process.stderr.write(JSON.stringify(result) + '\n');
    return 1;
  }
  const exported = exportBattlefield(result.value);
  if (!exported.ok) {
    process.stderr.write(JSON.stringify(exported) + '\n');
    return 1;
  }
  const output = options.get('--output');
  if (output) {
    const path = resolve(output);
    if (!/\.(json|svg)$/.test(path)) throw new TypeError('Output extension must be.json or.svg');
    await writeFile(path, path.endsWith('.svg') ? exported.value.svg : exported.value.json, 'utf8');
  } else process.stdout.write(exported.value.json + '\n');
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runBattlefieldCli(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(String(error) + '\n');
      process.exitCode = 2;
    });
}
