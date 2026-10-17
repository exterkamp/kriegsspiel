import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The viewport bar's phone layout (#496), read from the component stylesheet: jsdom lays nothing out, so the specs
// cannot measure the row. The PR's 390 px and 320 px screenshots show the result in Chromium.
const css = readFileSync(join(__dirname, 'map-authoring.component.css'), 'utf8');

/** The body of the block opened by the first match of `head`, braces balanced. */
function block(text: string, head: RegExp): string {
  const match = head.exec(text);
  if (!match) throw new Error(`No block ${head}`);
  const start = text.indexOf('{', match.index);
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(start + 1, i);
  }
  throw new Error(`Unclosed block ${head}`);
}
/** The declarations of the first rule in `text` whose selector line is exactly `selector`. */
function rule(text: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = block(text, new RegExp(`^\\s*${escaped}\\s*\\{`, 'm'));
  return Object.fromEntries(
    body
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]),
  );
}

describe('map editor viewport bar at phone width (#496)', () => {
  const narrow = block(css, /@media \(max-width: 760px\)/);

  it('stays on one row: the bar does not wrap and the site select shrinks to make room', () => {
    expect(rule(narrow, 'nav')['flex-wrap']).toBe('nowrap');
    expect(rule(narrow, 'nav .site-selector')).toMatchObject({
      flex: '1 1 0',
      'min-width': '0',
      'max-width': 'none',
    });
  });

  it('never squeezes a button or splits the zoom pair', () => {
    expect(rule(css, 'nav button')).toMatchObject({ flex: 'none', 'white-space': 'nowrap' });
    expect(rule(css, 'nav .zoom')).toMatchObject({ display: 'flex', flex: 'none' });
  });

  it('tightens the phone padding and gaps with spacing tokens only', () => {
    for (const selector of ['nav', 'nav button', 'nav .zoom'])
      for (const [property, value] of Object.entries(rule(narrow, selector)))
        if (/padding|gap/.test(property))
          expect(value, `${selector} ${property}`).toMatch(
            /^var\(--ks-space-\d\)( var\(--ks-space-\d\))?$/,
          );
  });
});
