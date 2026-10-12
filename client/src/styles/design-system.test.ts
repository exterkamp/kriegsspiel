import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');
const tokens = readFileSync(join(__dirname, 'tokens.css'), 'utf8');

/** Skipped on purpose: the map tools are restyled in #308, the Three.js table and in-canvas labels keep their own look. */
const EXEMPT = [
  'app/map-authoring',
  'app/benchmarks',
  'app/map-table',
  'app/local-board',
  'legacy',
  'shared',
  'styles',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(css|ts)$/.test(name) && !/\.(spec|test)\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(SRC).filter((f) => !EXEMPT.some((e) => f.startsWith(join(SRC, e))));

describe('component styles use the design tokens (#327)', () => {
  it('finds the component files', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('has no hex colours, rgb() or font-family outside the token file', () => {
    const bad: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (/^\s*(\/\*|\*|\/\/)/.test(line)) return;
        const code = line;
        if (
          /(?:[:\s,(]|^|['"])#[0-9a-fA-F]{3,8}(?![\w-])(?!\s*\{)/.test(
            code.replace(/^\s*#[\w-]+[\s,{].*$/, ''),
          ) ||
          /\brgba?\(/.test(code) ||
          /font-family:(?!\s*var\()/.test(code)
        ) {
          bad.push(`${f.slice(SRC.length + 1)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(bad).toEqual([]);
  });
});

/** WCAG relative luminance contrast of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string): number => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
      number,
      number,
      number,
    ];
    const f = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function variant(block: RegExp): Map<string, string> {
  const m = new Map<string, string>();
  const base = /:root \{([\s\S]*?)\n\}/.exec(tokens)![1]!;
  const extra = block.exec(tokens)?.[1] ?? '';
  for (const text of [base, extra]) {
    for (const [, k, v] of text.matchAll(/(--ks-[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) m.set(k!, v!);
  }
  return m;
}

/** Text pairs: foreground, background. */
const PAIRS: Array<[string, string]> = [
  ['--ks-ink', '--ks-paper'],
  ['--ks-ink', '--ks-paper-raised'],
  ['--ks-ink', '--ks-paper-control'],
  ['--ks-ink', '--ks-paper-sunk'],
  ['--ks-ink', '--ks-paper-page'],
  ['--ks-ink', '--ks-paper-page-lo'],
  ['--ks-ink-muted', '--ks-paper'],
  ['--ks-ink-muted', '--ks-paper-page'],
  ['--ks-ink-muted', '--ks-paper-page-lo'],
  ['--ks-ink-muted', '--ks-paper-control'],
  ['--ks-ink', '--ks-brass'],
  ['--ks-wax', '--ks-paper'],
  ['--ks-wax', '--ks-paper-page-lo'],
  ['--ks-wax', '--ks-paper-raised'],
  ['--ks-ok', '--ks-paper'],
  ['--ks-warn', '--ks-paper'],
  ['--ks-paper-control', '--ks-ink'],
  ['--ks-paper-raised', '--ks-wax'],
  ['--ks-on-overlay', '--ks-table'],
  ['--ks-brass-hi', '--ks-table'],
  ['--ks-wax-on-dark', '--ks-table'],
  ['--ks-ok-on-dark', '--ks-night-panel'],
  ['--ks-warn-on-dark', '--ks-night-panel'],
  ['--ks-info-on-dark', '--ks-night-panel'],
  ['--ks-wax-on-dark', '--ks-night-panel'],
  ['--ks-night-dim', '--ks-night-panel'],
  ['--ks-on-overlay', '--ks-night-select'],
];

describe('token text pairs meet WCAG AA (4.5:1)', () => {
  for (const [name, block] of [
    ['default', /^$/],
    ['high contrast', /:root\[data-contrast='high'\] \{([\s\S]*?)\n\}/],
  ] as const) {
    it(name, () => {
      const t = variant(block);
      const low = PAIRS.map(([f, b]) => ({ f, b, r: contrast(t.get(f)!, t.get(b)!) })).filter(
        (p) => p.r < 4.5,
      );
      expect(low).toEqual([]);
    });
  }
});
