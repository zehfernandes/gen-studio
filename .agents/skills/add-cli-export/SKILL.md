---
name: add-cli-export
description: Export a sketch from the terminal (`pnpm export poster --version 003`) with a headless browser, for batch runs over seeds, CI and machines without a screen. Adds Playwright as a dev dependency; writes to plugins/ only.
---

# Add a command-line export

The studio's exporters run in the browser on purpose (same renderer, same pixels as the preview). This skill keeps that and only removes the human: a Node script starts the Vite server, opens the studio in headless Chromium at `#s=<sketch>&v=<version>`, asks the app to export, and exits when the files are on disk. Output lands where the button puts it — `sketches/<name>/exports/` with its `.json` sidecar — so nothing downstream changes.

Batch is a shell loop, not a feature: `for s in 1 2 3; do pnpm export poster -- --set seed=$s; done`.

## Rules

- Write to `plugins/` only. Never edit `core/`. The browser half uses only `hooks.load`, `hooks.exported`, `app.export()`, `app.paramsChanged()`.
- The trigger is the URL: `?export=<exporter>` in the query string, `s`/`v` in the hash exactly as the UI already reads them. Nothing about a headless run is stored anywhere.
- Determinism is the sketch's job, not the runner's: same seed + same frame ⇒ same pixels whether a person or a script pressed E. Do not add per-run timestamps or randomness to `params` from here; `--set` writes plain values, that's all.
- No new server route. The script talks to the app through `page.evaluate`, and the app talks to the server through the routes it already has.

## Steps

1. `pnpm add -D playwright` (any 1.4x+; 1.47 has been out since 2024), then `pnpm exec playwright install chromium`.
2. Write `plugins/cli-export.ts` (browser) and `plugins/cli-export.mjs` (Node) from the references below.
3. Register the browser half in `plugins/index.ts`, once:
   ```ts
   import './cli-export';
   ```
4. Add the script to `package.json`:
   ```json
   "export": "node plugins/cli-export.mjs"
   ```
5. Verify: `pnpm export example-canvas2d` prints `sketches/example-canvas2d/exports/<base>.png` and `.json` and exits 0; the PNG is 2480×3508 and pixel-identical to pressing E in the UI with the same params. `pnpm export example-loop` produces an `.mp4` (needs ffmpeg like the UI does). `pnpm export example-canvas2d -- --version 001` uses that version's params and size (check the sidecar). `pnpm export example-canvas2d -- --set seed=42 --set count=8` shows `seed: 42, count: 8` in the sidecar. `pnpm export nope` exits 1 with the status-bar message (`Sketch not found: nope`).

## How it works

- `App` isn't on `window`; `hooks.load` receives it, so the plugin exports from there when `?export=` is present. `hooks.load` also fires after `setSize`, so a guard runs it once per page.
- `hooks.exported(files, sketch, app)` gives the written paths; the plugin parks them on `window.__cliExport`. On failure `App.export` writes `Export failed: …` to the status bar and does not throw — the plugin reads `app.statusEl.textContent` after `await app.export()` and parks that instead.
- The script `page.waitForFunction(() => window.__cliExport)` with a long timeout (prints are slow), then prints and exits. A load error (unknown sketch, syntax error) never reaches `hooks.load`, so the script also polls `#status` and fails on `Sketch not found` / `sketch.js:` messages.
- `--set key=value` becomes `?set=<json>`; the plugin `Object.assign`s it into `params` before exporting and calls `app.paramsChanged()`. Numbers and booleans are parsed, everything else stays a string (so `--set ink=#112233` works).

## Pitfalls

- WebGL under headless Chromium needs SwiftShader: launch with `args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']`. It is software rendering — a 3508×4961 p5-webgl export takes tens of seconds and the GPU-limit check in `makeExportRenderer` still applies (SwiftShader's max texture size is 8192 in most builds; larger prints still need `add-tiled-export`).
- Fonts: a headless machine has different system fonts. A sketch that draws text with an unbundled font will not match your laptop — bundle the font in the sketch folder and load it in `load` (`FontFace`), which is the right thing on the laptop too.
- `page.evaluate` timeouts: set `page.setDefaultTimeout(0)` and wait on `__cliExport` with your own `timeout` option; a 300-frame 4K video takes minutes.
- Start Vite in-process (`createServer` from `vite`) so the script owns its port and shutdown; do not assume `pnpm dev` is running. Pass `configFile: 'vite.config.ts'` so plugin server routes load.
- Exit code 1 on any failure and print the message; the sidecar is the success signal. Don't `process.exit` inside `finally` before `server.close()` — Vite holds the ffmpeg child until then.

## Reference implementation

```ts
// plugins/cli-export.ts — browser side
import { hooks } from '../core';

declare global {
  interface Window { __cliExport?: { files?: string[]; error?: string } }
}

// `?export=still|mp4|gif…` turns a page load into one export. `?set={"seed":42}` writes params first.
const query = new URLSearchParams(location.search);
const exporter = query.get('export');
let started = false;

if (exporter) {
  hooks.exported.push((files) => (window.__cliExport = { files }));
  hooks.load.push(async (sketch, app) => {
    if (started) return;
    started = true;
    const set = query.get('set');
    if (set) {
      Object.assign(sketch.params, JSON.parse(set));
      app.paramsChanged();
    }
    await app.export(exporter === 'default' ? undefined : exporter);
    const status = app.statusEl.textContent ?? '';
    if (!window.__cliExport) window.__cliExport = { error: status || 'export produced no files' };
  });
}
```

```js
// plugins/cli-export.mjs — Node side
// usage: node plugins/cli-export.mjs <sketch> [--version 003] [--exporter still|mp4|gif] [--set key=value ...]
import { createServer } from 'vite';
import { chromium } from 'playwright';

const [sketch, ...rest] = process.argv.slice(2);
if (!sketch) {
  console.error('usage: pnpm export <sketch> [-- --version 003] [--exporter mp4] [--set seed=42]');
  process.exit(1);
}
const opt = { exporter: 'default', set: {} };
for (let i = 0; i < rest.length; i++) {
  const [flag, value] = [rest[i], rest[i + 1]];
  if (flag === '--version') opt.version = rest[++i];
  else if (flag === '--exporter') opt.exporter = rest[++i];
  else if (flag === '--set') {
    const [k, v] = value.split('=');
    opt.set[k] = v === 'true' ? true : v === 'false' ? false : v !== '' && !isNaN(+v) ? +v : v;
    i++;
  }
}

const server = await createServer({ configFile: 'vite.config.ts', server: { port: 0 }, logLevel: 'error' });
await server.listen();
const port = server.config.server.port ?? server.httpServer.address().port;
const query = new URLSearchParams({ export: opt.exporter });
if (Object.keys(opt.set).length) query.set('set', JSON.stringify(opt.set));
const hash = new URLSearchParams({ s: sketch });
if (opt.version) hash.set('v', opt.version);
const url = `http://localhost:${port}/?${query}#${hash}`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(0);
  page.on('console', (m) => m.type() === 'error' && console.error(m.text()));
  await page.goto(url);
  // Either the export reports, or the status bar shows a load error the export could never reach.
  await page.waitForFunction(
    () => window.__cliExport || /^(Sketch not found|Export failed|.*\.(js|ts):)/.test(document.getElementById('status')?.textContent ?? ''),
    null,
    { timeout: 30 * 60 * 1000 },
  );
  const result = await page.evaluate(() => window.__cliExport ?? { error: document.getElementById('status')?.textContent });
  if (result.files) for (const f of result.files) console.log(`sketches/${f}`);
  else {
    console.error(result.error);
    code = 1;
  }
} finally {
  await browser.close();
  await server.close();
}
process.exit(code);
```
