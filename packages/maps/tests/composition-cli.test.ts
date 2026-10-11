import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/contract.js';
import { importAsset } from '../src/import.js';
import { canonicalGeometry } from '../src/canonical.js';
const cli = fileURLToPath(new URL('../dist/composition/headless-cli.js', import.meta.url));
it('headless CLI writes certified canonical/vector files and validates saved geometry without generation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'kriegsspiel-composition-'));
  try {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.widthM = settings.heightM = 200;
    settings.terrain.reliefM = 0;
    settings.cover.woodFraction = settings.cover.fieldFraction = 0;
    settings.settlements.villageCount = 0;
    settings.settlements.farmCount = 1;
    settings.settlements.minSpacingM = 25;
    settings.roads.extraLinks = 0;
    const config = join(dir, 'settings.json'),
      json = join(dir, 'map.json'),
      svg = join(dir, 'map.svg');
    writeFileSync(config, JSON.stringify(settings));
    const run = (args: string[]) =>
      spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    const first = run(['--settings', config, '--seed', '17', '--output', json]);
    expect(first.status, first.stderr).toBe(0);
    const second = run(['--settings', config, '--seed', '17', '--output', svg]);
    expect(second.status, second.stderr).toBe(0);
    expect(readFileSync(svg, 'utf8')).toContain('<svg');
    const asset = importAsset(readFileSync(json, 'utf8')),
      identity = canonicalGeometry(asset),
      validated = run(['--validate', json]);
    expect(validated.status, validated.stderr).toBe(0);
    expect(JSON.parse(validated.stdout)).toMatchObject({
      ok: true,
      value: { connected: true, assignedPopulation: 12 },
    });
    expect(canonicalGeometry(importAsset(readFileSync(json, 'utf8')))).toBe(identity);
    settings.settlements.minSpacingM = 1000;
    settings.settlements.farmCount = 2;
    writeFileSync(config, JSON.stringify(settings));
    const rejected = join(dir, 'rejected.json'),
      failure = run(['--settings', config, '--output', rejected]);
    expect(failure.status).toBe(1);
    expect(existsSync(rejected)).toBe(false);
    expect(JSON.parse(failure.stderr).ok).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
