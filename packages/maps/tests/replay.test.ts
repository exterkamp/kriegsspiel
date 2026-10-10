import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('matches canonical geometry/asset/recipe SHA-256 and stage seeds in fresh processes', () => {
  const script = fileURLToPath(new URL('./fresh-process.mjs', import.meta.url));
  const a = execFileSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, TZ: 'UTC', LANG: 'C' },
  });
  const b = execFileSync(process.execPath, [script, '--reverse'], {
    encoding: 'utf8',
    env: { ...process.env, TZ: 'Pacific/Honolulu', LANG: 'en_US.UTF-8' },
  });
  expect(JSON.parse(b)).toEqual(JSON.parse(a));
});
