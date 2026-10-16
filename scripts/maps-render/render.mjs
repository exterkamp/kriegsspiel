// Render saved map assets to JPEG with the authoring preview renderer in headless Chrome.
// Build packages/maps first. Usage:
//   node scripts/maps-render/render.mjs <out.jpg> <asset.json>[=caption] [<asset.json>[=caption]]
// Two assets are drawn side by side (for before/after comparisons).
// Environment: CHROME (default google-chrome), SIZE (default 1000 px per map).
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const [out, ...inputs] = process.argv.slice(2);
if (!out || !inputs.length)
  throw new Error('Usage: render.mjs <out.jpg> <asset.json>[=caption]...');
const size = Number(process.env.SIZE ?? 1000);
const chrome = process.env.CHROME ?? 'google-chrome';
const bundle = await build({
  entryPoints: [join(here, 'entry.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  logLevel: 'error',
});
const script = bundle.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const assets = inputs.map((arg) => {
  const [file, caption = ''] = arg.split('=');
  return { json: readFileSync(file, 'utf8'), caption };
});
const work = mkdtempSync(join(tmpdir(), 'maps-render-'));
try {
  const html = join(work, 'page.html');
  writeFileSync(
    html,
    `<!doctype html><meta charset="utf-8"><body><script>const ASSETS=[${assets.map((a) => a.json).join(',')}];const CAPTIONS=${JSON.stringify(assets.map((a) => a.caption))};const SIZE=${size};</script><script>${script}</script></body>`,
  );
  const r = spawnSync(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      `--user-data-dir=${join(work, 'profile')}`,
      '--dump-dom',
      `file://${html}`,
    ],
    { encoding: 'utf8', timeout: 300_000, maxBuffer: 256 * 1024 * 1024 },
  );
  const match = /data:image\/jpeg;base64,([A-Za-z0-9+/=]+)/.exec(r.stdout ?? '');
  if (!match) throw new Error(`Render failed (${r.status}): ${(r.stderr ?? '').slice(-500)}`);
  writeFileSync(resolve(out), Buffer.from(match[1], 'base64'));
  console.log(resolve(out));
} finally {
  rmSync(work, { recursive: true, force: true });
}
