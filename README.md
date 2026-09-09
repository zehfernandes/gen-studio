# gen-studio

A small, hackable environment for generative art. You write a `draw` function; it gives you a live preview, a params panel, saved versions, and pixel-exact exports to PNG, SVG or MP4.

```bash
pnpm install
pnpm dev
```

Then open the printed URL. There is no production build — the app *is* the dev server; the API routes that read and write `sketches/` are Vite middleware. Run it locally, where your files are.

## Principles

**A sketch is a folder.** `sketches/<name>/` holds the code, its saved versions and its exports — everything that belongs to one piece, in one place you can `ls`, `cp -r`, zip or delete. There is no project file, no database, no hidden state.

**Small enough to read, and yours.** `core/` is ~3k lines of plain TypeScript in one Vite process. If something bothers you, open the file — or ask your coding agent to walk you through it. Fork it, change it, `git pull` when upstream moves.

**Customization = code changes.** There is no settings panel. Want JPEG exports, a different filename scheme, a bleed guide? That's a small edit, and the codebase is small enough that changing it is safe.

**Skills over features.** GIF export, three.js, a shader renderer, tiled prints are not in core — they live in `.agents/skills/add-*`, recipes your coding agent follows to add one module to `plugins/`, in a file you can read and delete. Say "add GIF export" and it happens.

## The sketch folder

Everything about one piece lives in `sketches/<name>/`:

```
sketches/poster/
├── sketch.js          ← your code (or index.js / .ts). The only file you write by hand.
├── versions/          ← saved parameter sets, committed
│   ├── 001/
│   │   ├── params.json
│   │   └── thumb.png
│   └── 002/…
└── exports/           ← rendered files + sidecars, gitignored
    ├── poster.2026.09.02-14.30.05.007.png
    └── poster.2026.09.02-14.30.05.007.json
```

Put whatever the sketch needs next to it — fonts, images, JSON data, helper modules — and reference it relative to the module: `import { palette } from './palette.js'`, or in `load`, `fetch(new URL('./data/points.json', import.meta.url))`. The folder is the unit; if it's in the folder, it moves with the sketch.

**Create a sketch** by making a folder with a `sketch.js` and reloading the browser. There is no "new sketch" button — your file manager and your shell already do this.

**Duplicate freely.** `cp -r sketches/poster sketches/poster-v2` is the way to branch: the copy takes the code and every version along (delete `exports/` in the copy if you don't want the old renders). Do this whenever you're about to change the code in a way that would make old versions meaningless — a version only stores params, so `poster/versions/003` is still exactly what you saved, and `poster-v2` is free to evolve. Twenty folders are fine. That's the whole model.

The example sketches are ordinary folders too — copy one to start, or delete them all:

- `example-canvas2d` — A4 print, on-screen-only guide.
- `example-loop` — Instagram-post animation, exports as MP4.
- `example-p5-webgl` — p5 in WEBGL mode.
- `example-plotter` — returns an SVG on export (see [Layers](#layers-returning-files-from-draw)).

## Writing a sketch

`sketch.js` is a plain ES module. The host reads a few optional exports and one required one, `draw`.

### With canvas 2D

```js
// sketches/poster/sketch.js
export const config = { size: { preset: 'A4 300dpi' } };

export const params = {
  seed: 1,
  count: { value: 18, min: 3, max: 48, step: 1 }, // slider
  ink: '#1c1612',                                  // color picker
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

`c` is a `CanvasRenderingContext2D`.

### With p5

Set `config.renderer` and `p` becomes a p5 instance (instance mode — call everything as `p.x`):

```js
// sketches/orbit/sketch.js
export const config = {
  renderer: 'p5',                  // or 'p5-webgl'
  size: { preset: 'Instagram post' },
  fps: 30,
  duration: 4,                     // fps + duration = animation, exports as MP4
};

export const params = { seed: 1, dots: { value: 40, min: 5, max: 200, step: 1 } };

export function draw(p, t, { width: w, height: h }) {
  p.background('#2c62c8');
  p.noStroke();
  p.fill(255);
  for (let i = 0; i < params.dots; i++) {
    const a = (i / params.dots + t) * p.TWO_PI;   // t goes 0→1 over the loop
    p.circle(w / 2 + p.cos(a) * w * 0.35, h / 2 + p.sin(a) * w * 0.35, w * 0.01);
  }
}
```

The host owns the loop: p5 runs with `noLoop()` and the host calls `redraw()` once per frame, so `frameCount`, `millis()` and p5's own timing never leak into your output. `api.random()`/`api.noise()` *are* p5's, seeded by the host, so using either is fine. `p.width`/`p.height` are canvas pixels — draw with `api.width`/`api.height` instead.

Everything p5 gives you for input works — `mouseX`, `mouseIsPressed`, `touches`, `keyIsPressed`, `orbitControl()`, and the callbacks (`p.mousePressed = () => …`, `p.keyPressed = …`, assigned in `setup`). The stage redraws whenever you interact with it, and **the export shows what you see**: when you press `E` the host snapshots the p5 instance's state — the camera you orbited, where the mouse is, which keys are down — and hands it to the hidden instance that renders the file (it is recorded in the sidecar as `view`). Two things to know: `p.mouseX`/`p.mouseY` are canvas pixels, so divide by `api.scale` to get design pixels; and the app's shortcuts (`S`, `E`, `R`, `G`, `Space`, `Enter`, `Esc`, arrows) also reach your `keyPressed`.

Versions are different: `S` saves `params`, not the p5 instance, so a view you want to come back to has to be a param — the recommended pattern for any interaction that is a decision rather than a hover (see *Interaction* below). `sketches/example-p5-webgl` shows that round-trip for `orbitControl()`: params set the camera, the mouse moves it, the sketch writes the result back into `params.yaw/pitch/distance`, and the sliders catch up when you release.

In WebGL the host gives the default camera a fixed 60° field of view with the eye at `height / 2 / tan(30°)`, so the perspective is the same on screen and in the file (p5 2.x's own default widens the FOV with the canvas height, which would make an A3 export look nothing like its preview). If you create your own camera, set its `perspective()` the same way — the example does.

Three things no snapshot can carry, and what to do instead:

- **Pixels that pile up.** Trails without `background()`, `createGraphics()`/`createFramebuffer()` feedback loops, a simulation that steps in `draw`. The preview has accumulated thousands of redraws; the export draws frame 0 once, at a different resolution. Record what made them (strokes, events) as data and replay it from `params` or a module array indexed by `api.frame`.
- **p5 DOM inputs.** `createSlider()`, `createButton()`, `createInput()` are instance state and come back at their defaults in the export. Declare the value in `params` instead — that is what the panel is.
- **Live devices.** `createCapture()`, p5.sound's mic/amplitude. The export would open the device again and see something else. Sample on screen, keep the value (or a per-frame recording) in module data, and guard the device with `if (!api.exporting)`.

### Lifecycle and `api`

```js
export async function load(p, api) { /* await fonts, images */ }
export function setup(p, api)      { /* one-time init */ }
export function draw(p, t, api)    { /* every frame; required */ }
export function dispose(p, api)    { /* free listeners, GL resources */ }
```

`api` gives you `random(min?, max?)`, `noise(x, y?, z?)`, `seed`, `frame`, `frames`, `fps`, `time` (seconds, `frame / fps`), `width`, `height` (design pixels), `scale` (device px per design px — the host already applies it), `tile` (the window of the artwork this canvas shows, in design px — the whole artwork unless a tiled export is running; see Big prints) and `exporting` (true while rendering to a file — hide guides with it). Changing the size reruns `load` and `setup`. If `draw` throws, the error shows in the status bar and the loop keeps running; so does a syntax error or a missing `draw` (`sketch.js: \`export function draw(p, t, api)\` is required`).

`t` runs from 0 towards 1 across the loop and never reaches it (`frame / frames`), so the last frame is not a copy of the first and `sin(t * 2π)` wraps seamlessly. `api.random()` is reseeded with `seed` before **every** frame: a layout drawn from it holds still while `t` animates. If you want a fresh draw per frame, say so — `api.randomSeed(api.seed + api.frame)` at the top of `draw`.

**Autocomplete.** `core/gen-studio.d.ts` + `sketches/jsconfig.json` type the arguments without any import. One JSDoc line on `draw` is enough:

```js
/** @param {GenStudio.Canvas2D} c  @param {number} t  @param {GenStudio.Api} api */
export function draw(c, t, api) { … }
```

Use `GenStudio.P5` for the first argument of a p5 sketch. In a `.ts` sketch `import type { Api } from '../../core'` works too — type imports are erased, so the sketch still has no runtime dependency on the host. `params` is left untyped on purpose (the host flattens `{ value, min, max }` to a number at load, which a type checker can't see).

### Three rules for preview = export

1. **Draw in `api.width` × `api.height`.** Never read `canvas.width` or multiply by a scale factor; the host scales the context for both the on-screen fit and the export resolution.
2. **Randomness from `api.random()` / `api.noise()`.** Not `Math.random()`.
3. **Time from `t` / `api.frame`.** Not `Date.now()`, `millis()` or `frameCount`.

Follow these and the exported file is the preview, pixel for pixel, at any size.

### Interaction: mouse, keyboard, anything

The stage redraws whenever you interact with it, so a sketch can react to the mouse, the keyboard, a MIDI knob or a microphone the way it would anywhere else. There is one rule for making that interaction reach the file: **the export never receives input — it only re-runs `draw`.** So an input's job is to become data that `draw` reads. Put it in `params` when it is a decision you want to keep; a plain variable is enough for a hover effect.

```js
export const params = { seed: 1, x: 0.5, y: 0.5 };   // where the user last clicked, as a fraction of the design

export function setup(p, api) {                       // p5 shown; canvas2d does the same with c.canvas.addEventListener
  p.mousePressed = () => {
    params.x = +(p.mouseX / p.width).toFixed(3);      // p5's mouse is canvas pixels: normalise by the canvas
    params.y = +(p.mouseY / p.height).toFixed(3);
  };
}

export function draw(p, t, api) {
  p.circle(params.x * api.width, params.y * api.height, api.width * 0.05);
}
```

Click → `params.x/y` change → the stage redraws and the panel catches up when you let go. Drag the same inputs in the panel and the circle moves too. `E` exports the circle where you clicked; `S` saves it; a version brings it back.

| The input writes to | Export shows it | In the sidecar | `S` saves it |
|---|---|---|---|
| `params` | yes | yes | yes |
| a module variable (`let pointer = …`) | yes — the export runs the same module | no | no |
| a p5 built-in (`mouseX`, the `orbitControl()` camera) | yes — snapshotted at `E` | as `view` | no |

Patterns that fall out of the rule: click to place things → `params.sites = [[x, y], …]` (an array is a fine param; the panel skips it, versions keep it); drag or wheel as a knob → a numeric param; a live signal (mic, sensor) → sample it on screen into a variable, and replay a per-frame recording by `api.frame` for animations; anything that must not be in the file (cursor, hit boxes) → draw it under `if (!api.exporting)`. The export renders in a hidden instance that nobody is touching, so during a video export your mouse cannot leak into the frames.

## Params

Every key in `params` becomes a control. The hints live next to the value:

```js
export const params = {
  seed: 1,                                              // number input
  count: { value: 18, min: 3, max: 48 },                // slider; whole-number bounds ⇒ whole-number steps
  amount: { value: 0.3, min: 0, max: 1, step: 0.01 },   // slider with an explicit step
  mode:  { value: 'top', options: ['top', 'bottom'] },  // dropdown
  ink:   '#1c1612',                                     // color picker (hex strings)
  guide: true,                                          // checkbox
};
```

On load the host flattens the descriptors, so your code always reads `params.count` as a plain value. Dragging a slider writes into `params` and re-renders. `seed` is special only in that `R` gives it a new random value — the fastest way to see another one. If the sketch is too heavy for that, set `config.autoRender = false`: edits then wait until you press the **Render** button at the top of the panel (or `Enter`). Plugins can register new widget types selected with `type:` in the hint — the extension contracts live in `AGENTS.md`.

## Size

Sizes are pixels. The **Size** folder has a preset dropdown plus `width`, `height`, `resolution`:

- `width × height` are the design pixels your code draws in.
- `resolution` multiplies the output: `2` gives a @2x file with the exact same picture, `0.5` a quick draft.
- Presets: print sizes pre-computed at 300 dpi (`A5`–`A1`, `Letter`, `Tabloid`, `18x24in`, `24x36in`) and social sizes (`Instagram post/portrait/story`, `TikTok`, `YouTube`, `YouTube short`, `X post`, `4K`).
- The code is the source: `config.size` if you set it, otherwise 1080 × 1080. Changing the size in the panel is for trying things out — it lasts until you reload. Once you like a size, put it in `config.size`. Saved versions remember the size they were saved at.

## Versions

`S` (or **Save**) writes `params.json` + `thumb.png` to `sketches/<name>/versions/NNN/`. Click a thumbnail to load it back; it restores params and size. Delete a folder to delete a version.

## Export

`E` (or **Export**). Animated sketches produce an MP4, everything else a PNG. `Escape` cancels. Everything lands in `sketches/<name>/exports/` as a pair:

```
poster.2026.09.02-14.30.05.007.png   ← the artifact
poster.2026.09.02-14.30.05.007.json  ← params (incl. seed), size, pixels, preset, fps, duration
```

The `.json` sidecar makes every export reproducible: same params, same seed, same size ⇒ same pixels.

Video frames stream straight into `ffmpeg` (needs `ffmpeg` on your PATH or `FFMPEG_PATH`).

### Big prints

A browser canvas has a ceiling, and it is lower than you'd think: Chrome silently caps a WebGL canvas at ~33 MP (roughly A2 at 300 dpi), and a 150 MP print makes the GPU drop the canvas altogether — which used to come out as a valid, perfectly blank PNG. The export now fails instead: `Canvas lost: 10630×14173 (151 MP) is over this GPU's limit. Lower size.resolution, or add the add-tiled-export skill.`

Two ways out. Lower `resolution` (a 90×120 cm print at 150 dpi is 38 MP and still sharp at arm's length). Or ask your agent to apply the `add-tiled-export` skill: the export then renders the artwork in 4096² tiles and `ffmpeg` stitches them into one file, pixel-identical to a single pass, at any size. Sketches that follow the three rules above need no change; a sketch with its own 3D camera or one that works in canvas pixels reads `api.tile` (the window of the artwork the canvas shows) — `sketches/example-p5-webgl` has the 8-line version.

### Layers: returning files from `draw`

If `draw` returns something, that is the artifact instead of the canvas:

```js
export function draw(c, t, api) {
  const paths = makePaths(api);
  strokePaths(c, paths);                                 // preview
  if (api.exporting) return { data: toSVG(paths), extension: '.svg' };
}
```

Return an array for several files with one base name — a canvas, a string, a `Blob` or an `ArrayBuffer` each:

```js
return [
  c.canvas,                                                  // poster.<stamp>-0.png
  { data: toSVG(paths), extension: '.svg' },                 // poster.<stamp>-1.svg
  { data: JSON.stringify(paths), extension: '.json', suffix: '.paths' }, // poster.<stamp>.paths.json
];
```

No format dropdown — the sketch decides. See `sketches/example-plotter`.

## Keyboard

`S` save · `E` export · `R` new seed · `Esc` cancel export · `Space` play/pause · `←` `→` step one frame (pauses) · `G` toggle panel · `Enter` re-render. The panel buttons show their key. Rebindable from a plugin.

## Extending

There is no plugin store and no settings panel. To extend the app — a new exporter, renderer, size preset, param widget, keybinding, `/api` route — you (or your coding agent) write a small module in `plugins/`. Common ones ship as ready-made skills in `.agents/skills/add-*` (`add-gif-export`, `add-three`, `add-shader`, `add-hot-reload`, `add-tiled-export`, `add-cli-export`).

The contracts, registries and examples live in [`AGENTS.md`](AGENTS.md) — it's written for coding agents, but it doubles as the extension documentation for humans.

Deliberately not in core: GIF, JPEG/WebP, batch/command-line export, hot reload that preserves params (and a Reset-to-defaults button), mm/cm/dpi calculators, tiled rendering for prints beyond the browser's canvas limit, MIDI, three.js.

## Commands

```bash
pnpm dev      # the app: Vite dev server + the /api middleware
pnpm check    # typecheck
pnpm test     # vitest on the pure modules in core/
pnpm verify   # typecheck, then test
```

## Inspiration

The way this repo is organised — small enough to read in an afternoon, customised by editing code rather than configuring it, extended by copying modules in rather than shipping features everyone pays for — comes from [NanoClaw](https://github.com/nanocoai/nanoclaw).

## License

MIT
