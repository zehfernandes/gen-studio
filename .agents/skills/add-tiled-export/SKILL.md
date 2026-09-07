---
name: add-tiled-export
description: Export prints larger than one GPU surface can hold (roughly above A2 at 300 dpi) by rendering the artwork in tiles and stitching them with ffmpeg. Writes to plugins/ only, no new dependencies.
---

# Add tiled print export

A browser canvas has a ceiling and crosses it silently: Chrome caps a WebGL drawing buffer at ~33 MP, and somewhere above that (a 150 MP print is well past it) the GPU process runs out of memory, drops the canvas, restores it blank, and `toBlob` encodes a perfectly valid transparent PNG. Core detects that and fails the export with a message that names this skill. This skill is the fix: `exporters.still` renders the artwork as a grid of ≤ 4096² tiles on one small hidden renderer, streams the PNGs to the dev server, and ffmpeg (already required for video) lays them out into a single file. Small exports still take core's single pass.

## Rules

- Write to `plugins/` only. Never edit `core/`. The hooks this needs already exist: `api.tile`, `makeExportRenderer(sketch, pixels)`, `startFfmpeg` and the `/api/video/:id/frame|end|abort` routes.
- One action. `E` still means "still or video"; tiling is decided by size, never by an option or a dialog.
- Same pixels as a single pass. If a tiled export differs from an untiled one at a size where both work, the sketch is reading canvas pixels without `api.tile` — fix the sketch, not the exporter (see "Sketches").
- Every export writes a sidecar; add `tiles: { cols, rows, width, height }` to it.

## Steps

1. Write `plugins/tiled-export.ts` from the reference below.
2. Add the stitch route to `plugins/server.ts` (reference below). It only *starts* the job; frames, end and abort reuse core's video routes because the job lives in the same table.
3. Register in `plugins/index.ts`, once (check for the import line before appending):
   ```ts
   import { exporters } from '../core';
   import tiled from './tiled-export';
   exporters.still = tiled;
   ```
4. Verify: `pnpm check`; restart `pnpm dev` (Vite plugins load at start). Open a sketch, set `resolution` in the Size folder so the output is above 16 MP (e.g. `example-canvas2d` at 1080² × 4 = 18.7 MP), press `E`: the status counts `Exporting n/N`, then `Stitching...`, then `Saved … (2×2 tiles)`. The file has the exact `pixels` of the sidecar and no seams. Press `Escape` mid-way: "Export cancelled", no partial file. At `resolution: 1` the export is unchanged (core's single pass).

## How the hook works

`api.tile = { x, y, width, height }` in design pixels is the window of the artwork the current canvas shows; it is the whole artwork on screen and in a normal export, so a sketch can always read it. The exporter sets it per tile before `drawFrame`, and:

- **canvas2d and p5 2D** (`scaleContext !== false`): core translates by `-tile.x, -tile.y` after the scale. A sketch that draws with `api.width`/`api.height` needs nothing.
- **p5 WebGL with the host's default camera**: core offsets the projection (scale + shift in clip space, three.js's `setViewOffset`). Nothing to do.
- **A sketch with its own camera**, or one that works in canvas pixels (`scaleContext: false`, `p.width`, `getImageData`, full-canvas buffers): it must apply the tile itself. Reference: `sketches/example-p5-webgl` (`tileProjection`, 8 lines, call it after `perspective()` and before `setCamera()`); for a whole port with offscreen buffers, field and grain, see `viewOf()` in the user's `sketch-07`. The recipe is always the same: compute the full artwork's pixel size (`api.width * api.scale`) and the tile's pixel offset, use the artwork's aspect for the camera, and draw full-artwork layers at `-offset` so the canvas clips them.

Anything that inherently needs the whole raster at once (a global blur, a simulation that reads back pixels) cannot be tiled; that sketch should lower `resolution` instead.

## Pitfalls

- ffmpeg's `tile` filter wants equal-size inputs: tiles are `ceil(W / cols) × ceil(H / rows)`, the grid overshoots, and `crop=W:H:0:0` trims it. Send tiles row-major, one PNG per `frame` POST.
- `MAX_TILE = 4096` is deliberately conservative (16.7 MP): the point is to stay far from the cliff on every GPU. Bigger tiles are not faster in any meaningful way.
- `SINGLE_PASS_PIXELS = 16e6` keeps small exports on core's path so nothing changes for them. If a sketch already fails below that (an old GPU), lower it; don't add an option.
- `onProgress` makes the stage `seek` the current frame, so the preview redraws once per tile. For a heavy still that is a preview draw per tile — acceptable; if it matters, call `onStatus` instead of `onProgress` inside the loop.
- A 150 MP PNG takes ffmpeg several seconds and ~600 MB of RAM to stitch; the browser never holds more than one tile. Abort kills ffmpeg and removes the partial file (core's `abortVideo`).
- The seam test is the truth: export once tiled and once with `resolution` low enough for a single pass, downscale both to the same size and diff. Differences confined to anti-aliased edges are normal; anything else is a sketch reading canvas pixels without `api.tile`.

## Reference implementation

```ts
// plugins/tiled-export.ts
import { EXPORTS_DIR, exportName, exporters, isCanvas, layerToBlob, makeExportRenderer, outputPixels, postFile, sidecar } from '../core';
import type { ExporterFactory } from '../core';

// One GPU surface above this is where browsers start dropping canvases silently (Chrome caps a WebGL
// drawing buffer at ~33 MP; the GPU process dies well before 150 MP). Below it, core's still is fine.
const SINGLE_PASS_PIXELS = 16e6;
// Tile side in device pixels. 4096² is 16.7 MP and every desktop GPU allocates it.
const MAX_TILE = 4096;

async function postJson(url: string, body?: unknown): Promise<any> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.text()) || `${url}: ${res.status}`);
  return res.json();
}

const singlePass = exporters.still;

const tiled: ExporterFactory = async (opts) => {
  const { sketch, onStatus, onProgress, signal, view } = opts;
  const out = outputPixels(sketch.size);
  if (out.width * out.height <= SINGLE_PASS_PIXELS) return singlePass(opts);

  const cols = Math.ceil(out.width / MAX_TILE);
  const rows = Math.ceil(out.height / MAX_TILE);
  // Equal tiles (ffmpeg's tile filter needs them); the grid overshoots and the final crop trims it.
  const tw = Math.ceil(out.width / cols);
  const th = Math.ceil(out.height / rows);
  const total = cols * rows;
  const { resolution } = sketch.size;

  onStatus(`Preparing ${cols}×${rows} tiles of ${tw}×${th}...`);
  // `view` is what the user did to the preview instance (orbit, mouse); every tile must see the same one.
  const { api, drawFrame, dispose } = await makeExportRenderer(sketch, { width: tw, height: th }, view);

  let jobId: string | null = null;
  try {
    const base = exportName(sketch);
    const dir = `${sketch.name}/${EXPORTS_DIR}`;
    const file = `${EXPORTS_DIR}/${base}.png`;
    ({ id: jobId } = await postJson(`/api/sketches/${encodeURIComponent(sketch.name)}/stitch`, { file, cols, rows, ...out }));

    for (let i = 0; i < total; i++) {
      if (signal?.aborted) break;
      const col = i % cols;
      const row = Math.floor(i / cols);
      api.tile = { x: (col * tw) / resolution, y: (row * th) / resolution, width: tw / resolution, height: th / resolution };
      const png = (await drawFrame(0, 0)).find((l) => isCanvas(l.data));
      if (!png) throw new Error('Tiled export needs a canvas layer');
      const res = await fetch(`/api/video/${jobId}/frame`, { method: 'POST', body: await layerToBlob(png) });
      if (!res.ok) throw new Error(await res.text());
      onProgress?.(i + 1, total);
    }

    if (signal?.aborted) {
      await postJson(`/api/video/${jobId}/abort`);
      jobId = null;
      onStatus('Export cancelled');
      return;
    }

    onStatus('Stitching...');
    await postJson(`/api/video/${jobId}/end`);
    jobId = null;
    await postFile(`${dir}/${base}.json`, sidecar(sketch, { tiles: { cols, rows, width: tw, height: th }, view }));
    onStatus(`Saved ${dir}/${base}.png (${cols}×${rows} tiles)`);
  } catch (err) {
    if (jobId) await postJson(`/api/video/${jobId}/abort`).catch(() => {});
    throw err;
  } finally {
    dispose();
  }
};

export default tiled;
```

```ts
// plugins/server.ts — add to the exported array
import type { Plugin } from 'vite';
import { promises as fs } from 'fs';
import path from 'path';
import { SKETCHES_DIR, json, readBody, safeJoin, startFfmpeg, text } from '../core/server';

// POST /api/sketches/:name/stitch  { file, cols, rows, width, height } → { id }
// Starts an ffmpeg job that lays `cols × rows` equal PNG tiles (streamed row-major through
// /api/video/:id/frame) into one image and crops it to width × height. `end`/`abort` are core's.
const stitch: Plugin = {
  name: 'gen-studio-stitch',
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const m = req.url?.match(/^\/api\/sketches\/([^/]+)\/stitch$/);
      if (!m || req.method !== 'POST') return next();
      try {
        const { file, cols, rows, width, height } = JSON.parse((await readBody(req, 1024 * 1024)).toString());
        if (!file || !cols || !rows || !width || !height) return text(res, 'file, cols, rows, width, height are required', 400);
        const target = safeJoin(SKETCHES_DIR, decodeURIComponent(m[1]), ...String(file).split('/'));
        await fs.mkdir(path.dirname(target), { recursive: true });
        const { id } = await startFfmpeg(target, ['-i', '-', '-vf', `tile=${cols}x${rows},crop=${width}:${height}:0:0`, '-frames:v', '1']);
        return json(res, { id });
      } catch (err: any) {
        console.error('[gen-studio-stitch]', err);
        return text(res, err.message || 'server error', 500);
      }
    });
  },
};

export default [stitch] as Plugin[];
```

```js
// In a sketch with its own p5 camera (from sketches/example-p5-webgl). Call after perspective(), before setCamera().
function tileProjection(cam, api) {
  const { tile, width, height } = api;
  const m = cam.projMatrix.mat4;
  const sx = width / tile.width, sy = height / tile.height;
  m[0] *= sx; m[8] = (m[8] + (2 * tile.x + tile.width) / width - 1) * sx;
  m[5] *= sy; m[9] = (m[9] + 1 - (2 * tile.y + tile.height) / height) * sy;
}
```
