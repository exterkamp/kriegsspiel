import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FORBIDDEN = [
  /\bDate\.now\b/,
  /\bnew Date\b/,
  /\bperformance\.now\b/,
  /\bprocess\.hrtime\b/,
  /\bsetTimeout\b/,
  /\bsetInterval\b/,
  /\bMath\.random\b/,
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : [];
  });
}

describe('engine purity', () => {
  it('never touches the wall clock or ambient randomness', () => {
    const files = sources(import.meta.dirname);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const re of FORBIDDEN) expect(text, `${f} matches ${re}`).not.toMatch(re);
    }
  });
});
