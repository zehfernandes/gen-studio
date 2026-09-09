---
name: add-gif-export
description: Add a GIF exporter (gifenc, in-browser) for animated sketches, triggered by a panel button and/or a key. Writes to plugins/ only.
---

# Add GIF export

An exporter is one key in the `exporters` map. This adds `exporters.gif`: it renders every frame offline with core's `makeExportRenderer` (so the GIF is the same pixels as the MP4), quantizes each frame to 256 colors with `gifenc`, and writes `sketches/<name>/exports/<base>.gif` plus the usual `.json` sidecar.

## Rules

- Write to `plugins/` only. Never edit `core/`. Core's `export.ts` exports its building blocks precisely so this needs none of its internals.
- One action, no dialogs. The GIF is triggered explicitly (button/key); `E` keeps meaning "still or video". Don't add a format dropdown.
- Every export writes a sidecar. Reuse `sidecar(sketch, { frames, fps, format: 'gif' })`.

## Steps

1. `pnpm add gifenc` (1.0.3 has been stable since 2022; it ships no types, hence the `.d.ts` below).
2. Write `plugins/gif-export.ts` and `plugins/gifenc.d.ts` from the reference below.
3. Register in `plugins/index.ts`, once. Button in the Render folder, key `q` (unbound in core; `e/s/r/g/Enter/Space/Escape/←/→` are taken — see `core/hooks.ts`):
   ```ts
   import { mountButtonGroup } from 'dialkit/vanilla';
   import gif from './gif-export';
   exporters.gif = gif;
   keys.q = (app) => app.export('gif');
   hooks.panel.push((panel, sketch, app) => {
     if (!(sketch.config.fps && sketch.config.duration)) return;
     mountButtonGroup(panel.folders.render, { buttons: [{ label: 'Export GIF (Q)', onClick: () => app.export('gif') }] });
   });
   ```
4. Verify: `pnpm check`; `pnpm dev`, open `example-loop`, press `Q`; the status bar counts frames, then `Saved sketches/example-loop/exports/<base>.gif`. Open the GIF: it loops seamlessly at the sketch's fps and matches the preview. Press `Q` then `Escape` mid-way: "GIF export cancelled", no partial file.

## Building blocks (all exported from `../core`)

- `makeExportRenderer(sketch, pixels?, view?)` → `{ renderer, api, drawFrame(frame, t), dispose }`. Hidden renderer at `outputPixels(size)`, `api.exporting = true`, seeds reset per frame; `view` (from `opts.view`) is the preview renderer's `getView()` so the file shows the camera/mouse state the user left on screen. `drawFrame` resolves to `FileLayer[]`; the canvas layer has `data: HTMLCanvasElement`.
- `frameCount(sketch)` → `{ fps, frames, animated }`; `t = loopT(i, frames)` (0 ≤ t < 1, so the last frame is not a copy of frame 0 — never `i / (frames - 1)`).
- `postFile('<sketch>/exports/<file>', blob)`, `sidecar(sketch, extra)`, `exportName(sketch)`, `EXPORTS_DIR`.
- `ExporterFactory = ({ sketch, onStatus, onProgress?, signal?, view? }) => Promise<void | string[]>` — resolve to the files you wrote (`<sketch>/exports/<file>`) so `hooks.exported` sees them; `App.export(name)` wraps it with pause/resume, status and an `AbortController` (`Escape`).

## Pitfalls

- Read pixels through a scratch 2D canvas (`drawImage` then `getImageData`). Calling `getContext('2d')` on a WebGL/p5-webgl canvas returns `null`.
- `renderer.canvas` on p5 is a getter that is only valid after `setup()`; read `width/height` after `makeExportRenderer` resolves.
- GIF delays are centiseconds: `delay: 1000 / fps` gets rounded, so 30 fps plays at 33 fps and 60 fps is impossible (~50 max). Say so in the status if `fps > 50`; do not "fix" the sketch's fps.
- Per-frame palettes (`palette` on every `writeFrame`) cost bytes but keep colors right across the loop; a single global palette from frame 0 is smaller and fine for flat graphics. Pick per the user's sketch, don't add an option.
- Encode on the main thread: it is a few seconds for a 1080² × 120-frame loop. Check `signal.aborted` inside the loop so `Escape` works; the encoder has no partial file to delete.
- Very large GIFs (`> ~50 MB`) freeze viewers; suggest `resolution: 0.5` in the Size folder instead of adding a scale option here.

## Reference implementation

```ts
// plugins/gifenc.d.ts
declare module 'gifenc' {
  export type Palette = number[][];
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, opts?: { format?: 'rgb565' | 'rgb444' | 'rgba4444' }): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: 'rgb565' | 'rgb444' | 'rgba4444'): Uint8Array;
  export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: { palette?: Palette; delay?: number; repeat?: number; transparent?: boolean; transparentIndex?: number; dispose?: number }): void;
    finish(): void;
    bytes(): Uint8Array<ArrayBuffer>;
    reset(): void;
  };
}
```

```ts
// plugins/gif-export.ts
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { EXPORTS_DIR, exportName, frameCount, loopT, makeExportRenderer, postFile, sidecar } from '../core';
import type { ExporterFactory } from '../core';

const gif: ExporterFactory = async ({ sketch, onStatus, onProgress, signal, view }) => {
  const { fps, frames } = frameCount(sketch);
  onStatus(`Preparing ${frames}-frame GIF...${fps > 50 ? ' (GIF caps at ~50 fps)' : ''}`);
  // `view`: what the user did to the preview instance (orbit, mouse) — without it the GIF shows the code's default view.
  const { renderer, drawFrame, dispose } = await makeExportRenderer(sketch, undefined, view);

  try {
    const { width, height } = renderer.canvas;
    // WebGL canvases have no 2d context; a scratch canvas reads pixels from any renderer.
    const scratch = document.createElement('canvas');
    scratch.width = width;
    scratch.height = height;
    const ctx = scratch.getContext('2d', { willReadFrequently: true })!;
    const encoder = GIFEncoder();

    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) return onStatus('GIF export cancelled');
      const layers = await drawFrame(i, loopT(i, frames));
      const canvas = layers.map((l) => l.data).find((d): d is HTMLCanvasElement => d instanceof HTMLCanvasElement);
      if (!canvas) throw new Error('GIF export needs a canvas layer');

      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(canvas, 0, 0);
      const { data } = ctx.getImageData(0, 0, width, height);
      const palette = quantize(data, 256);
      encoder.writeFrame(applyPalette(data, palette), width, height, { palette, delay: 1000 / fps });
      onProgress?.(i + 1, frames);
    }

    encoder.finish();
    const base = exportName(sketch);
    const dir = `${sketch.name}/${EXPORTS_DIR}`;
    await postFile(`${dir}/${base}.gif`, new Blob([encoder.bytes()], { type: 'image/gif' }));
    await postFile(`${dir}/${base}.json`, sidecar(sketch, { frames, fps, format: 'gif', view }));
    onStatus(`Saved sketches/${dir}/${base}.gif`);
  } finally {
    dispose();
  }
};

export default gif;
```
