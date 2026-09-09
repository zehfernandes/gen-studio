# gen-studio

A small, hackable environment for making generative art.

![gen-studio: sketch preview with the params panel and saved versions](docs/studio.png)

```bash
pnpm install
pnpm dev
```

## Why

A sketch is just a folder.

```
sketches/poster/
├── sketch.js
├── versions/
└── exports/
```

No project file, no database, no hidden state. You can `ls` it, `cp -r` it, zip it, delete it.

The core is intentionally small — plain TypeScript in one Vite process, on two dependencies: [p5](https://p5js.org) for the renderer and [dialkit](https://github.com/joshpuckett/dialkit) for the panel. Want different export formats, renderers, controls or workflows? Change the code or add a plugin, instead of configuring a large framework.

## Write a sketch

```js
// sketches/poster/sketch.js
export const config = { size: { preset: 'A4 300dpi' } };

export const params = {
  seed: 1,
  count: { value: 18, min: 3, max: 48 },
  ink: '#1c1612',
};

export function draw(c, t, { width: w, height: h, random }) {
  c.fillStyle = '#f4f1e8';
  c.fillRect(0, 0, w, h);

  c.fillStyle = params.ink;
  for (let i = 0; i < params.count; i++) {
    c.beginPath();
    c.arc(random(w * 0.1, w * 0.9), random(0, h), w * random(0.005, 0.02), 0, 2 * Math.PI);
    c.fill();
  }
}
```

Every value in `params` becomes a control in the panel. `c` is a `CanvasRenderingContext2D`; set `config.renderer` to `'p5'` or `'p5-webgl'` and you get a p5 instance instead. Add `fps` and `duration` and the sketch is an animation that exports as MP4.

The rest of the sketch API — lifecycle, the `api` object, params, sizes, mouse and keyboard input — is in [`docs/sketch.md`](docs/sketch.md).

## Versions and exports

`S` saves a version:

```
versions/001/
├── params.json
└── thumb.png
```

Click a thumbnail to load it back, params and size both. Delete the folder to delete the version.

`E` exports:

```
exports/
├── poster.2026.09.02-14.30.05.007.png
└── poster.2026.09.02-14.30.05.007.json
```

The JSON sidecar holds the params, seed and size needed to reproduce the file. Video goes through `ffmpeg`, which needs to be on your PATH or at `FFMPEG_PATH`.

## Examples

| | |
|---|---|
| `example-canvas2d` | Canvas 2D print |
| `example-loop` | animation, exports as MP4 |
| `example-p5-webgl` | p5 in WEBGL mode |
| `example-plotter` | returns an SVG on export |

## Extend it

Anything that doesn't need to live in core goes in `plugins/` — an exporter, a renderer, a size preset, a param widget, a keybinding, an `/api` route.

Recipes your coding agent can follow live in `.agents/skills/add-*`: GIF export, three.js, shaders, hot reload, tiled export, CLI export, keyframe timeline. Say "add GIF export" and it happens.

The contracts and internals are in [`AGENTS.md`](AGENTS.md). It's written for coding agents, but it doubles as the extension docs for humans.

## Commands

```bash
pnpm dev      # the app: Vite dev server + the /api middleware
pnpm check    # typecheck
pnpm test     # vitest on the pure modules in core/
pnpm verify   # typecheck, then test
```

## Inspiration

The way this repo is organised — small enough to read in an afternoon, customised by editing code rather than configuring it, extended by copying modules in rather than shipping features everyone pays for — comes from [NanoClaw](https://github.com/nanocoai/nanoclaw).

The sketch itself — a `draw` function with a seeded API, size and time handed to it, and the same code path for preview and export — is [canvas-sketch](https://github.com/mattdesl/canvas-sketch). The idea that the tool around it should be a live studio, with params you turn and exports a keystroke away, is [fragment](https://github.com/raphaelameaume/fragment).

## License

MIT
