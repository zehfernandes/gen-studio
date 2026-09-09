# gen-studio — agent notes

Three ideas: a sketch is a folder, versions are files, exports render offline.

## How to work in this repo (NanoClaw-style)

This codebase is deliberately small so that the user — or you, on their behalf — changes the code instead of configuring it.

- **Prefer a code change over a new option.** If the user wants JPEG exports, edit `core/export.ts`; do not add `config.encoding` plus UI for it. Add a config key only when the same sketch legitimately needs both behaviours.
- **No dialogs, no wizards, no confirmations.** One action does one obvious thing (Export picks still vs video from `config`). Errors go to the status bar and the console; the app keeps running.
- **Core stays universal.** Anything not every user needs goes in `plugins/index.ts` or the user's fork: hot reload, GIF, batch-over-seeds, tiled prints, MIDI, three.js. When in doubt, plugin.
- **Non-universal features ship as skills, not code.** `.agents/skills/add-*/SKILL.md` teaches the agent how to add one thing to *this* codebase (contract, steps, pitfalls, verification, reference implementation). A skill writes to `plugins/`, appends to `plugins/index.ts` or `plugins/server.ts`, runs `pnpm add`, may create an obviously-named example under `sketches/`. It never edits `core/`. A skill that needs a large widget ships it as a file next to the SKILL.md. If a plugin needs a hook core lacks, the hook (a registry, not the feature) is an upstream change and the skill stops and says so.
- **Files are the UI.** New state should be a file or folder under `sketches/<name>/` that a human can read and delete, not app-internal storage.
- **Filesystem only, no git.** The app never reads or writes git (no hashes, no commits). Versions store params; if the user wants to preserve code they duplicate the sketch folder. Don't reintroduce git integration.
- **Protect determinism above all.** Same `seed` + same `frame` ⇒ same pixels, on screen and in the export. Never introduce `Date.now()`, `Math.random()`, or refresh-rate-dependent timing into the render path.
- **Credible exit.** Keep the sketch contract plain (`draw(ctx, t, api)`, `params` a flat object). Do not wrap params in objects or require host imports inside sketches.
- **Keep it readable.** `core/` is ~2.7k lines and should stay in that order of magnitude. Compact code, no speculative abstractions.

## Sketch module

A sketch is a plain JS/TS module in `sketches/<name>/sketch.js` (or `index.js`/`.ts`). The host reads these optional named exports:

```js
export const config = {
  renderer: 'canvas2d',          // 'canvas2d' | 'p5' | 'p5-webgl' (default 'canvas2d')
  size: { preset: 'A4 300dpi' }, // or { width: 1080, height: 1080 }, optional resolution (default 1)
  fps: 30,                       // if present with duration, the sketch is an animation
  duration: 8,
  scaleContext: true,            // default; false = draw in raw canvas pixels
  autoRender: true,              // default; false = param edits wait for the Render button / Enter (heavy sketches)
};

export const params = {
  seed: 1,                                        // bare value → free input
  count: { value: 18, min: 3, max: 48, step: 1 }, // → bounded slider
  mode: { value: 'top', options: ['top', 'bottom'] }, // → dropdown
  color: '#ff5c33',                               // hex string → color picker
};

export async function load(p, api) { /* await assets; before setup */ }
export function setup(p, api) { /* one-time init */ }
export function draw(p, t, api) { /* required; may return layers (see Export) */ }
export function dispose(p, api) { /* cleanup on sketch switch */ }
```

- `params` is a plain object. The host writes into it in place when the user drags a slider.
- `controlTypes.number` needs a `min` and a `max` to make a slider. A **bare number** (`seed: 1`, `margin: 15`) has neither, so it becomes a free text input that parses back to a number — the panel's only numeric widget is a slider, and a bare value has no bounds to give one. Garbage mid-edit (`''`, `'-'`, `'1e'`) keeps the last good value.
- `controlTypes.number` infers `step: 1` when value, `min` and `max` are all integers, or `{ value: 18, min: 3, max: 48 }` would hand a sketch `count = 17.325`; floats without a `step` get `(max - min) / 1000`. An explicit `step` always wins.
- Control hints live *inside* `params`, never in `config`. `core/controls.ts#splitParams` runs once on load: it strips `{ value, ...hints }` descriptors into `LoadedSketch.controls` and flattens `params` in place, so the sketch reads `params.count` as a plain value and versions/sidecars store flat values.
- A widget is picked per param by `core/params.ts#buildParamsGUI`: `control.type` if set, else inferred from **`LoadedSketch.defaults`** (`options` → `select`, hex → `color`, `number`, `boolean`, `string`). Inference reads the code's declared value, not the live one, so a version that stored a colour as `oklch(...)` still builds a colour picker. `controlTypes` is the registry; core's defaults live in it, so a plugin can add `controlTypes.curve` or replace `controlTypes.color`. Arrays/objects are skipped unless a `type` names a factory.
- Lifecycle order: `load → setup → draw*  → dispose`. Export renderers run the same lifecycle in a hidden container. A size change reruns the whole lifecycle.
- `p` is the renderer object (`CanvasRenderingContext2D` or `p5` instance); `t = loopT(frame, frames) = frame / frames`, so 0 ≤ t < 1 — the last frame is never a copy of frame 0 (`core/timing.ts`). Every exporter uses `loopT`, never `i / (frames - 1)`.
- `api`: seeded `random()`/`noise()`, `seed`, `frame`, `frames`, `fps` (0 for stills), `time` (`frame / fps`), `width`, `height` (design px), `scale` (device px per design px), `tile` (`{ x, y, width, height }` design px — the window this canvas shows; the whole artwork unless an exporter tiles it), `exporting` (bool).
- **Seed is stable across frames.** `api.randomSeed(seed)` seeds the backend with `seed` alone before every draw (`core/api.ts`), so `random()` yields the same layout on every frame and motion comes from `t`. It used to be `seed + frame` (jitter every frame, and `seed 1 / frame 5` collided with `seed 6 / frame 0`); don't bring that back. A sketch that wants per-frame variation calls `api.randomSeed(api.seed + api.frame)` itself.
- `core/validate.ts` checks the module once at load (`draw` present, `config`/`params` shapes, known renderer/preset, `fps` with `duration`) and throws a sentence naming the file; `App.loadSketch` and `App.loadStage` catch import/start failures into the status bar. A broken sketch never leaves a blank stage with an empty status.
- `LoadedSketch.defaults` is a frozen clone of the flat params as the code declared them (before a version or plugin writes into `params`). It is data for plugins (a Reset button lives in `add-hot-reload`), not a core feature.
- Types for sketch authors: `core/gen-studio.d.ts` declares a global `GenStudio` namespace aliasing core's types (`Api`, `Config`, `Params`, `DrawResult`, `P5`, `Canvas2D`) and `sketches/jsconfig.json` loads it, so a JSDoc `@param {GenStudio.Api} api` gives autocomplete with no import. `checkJs` stays off there: `params` descriptors are flattened at load, which TS cannot see. `SketchModule<P>` is generic in the renderer object for `.ts` sketches and plugin renderers.

## Size

Pixels only. `Size = { width, height, resolution }` (`core/size.ts`, `core/types.ts`):

- `width`/`height` are **design pixels** — what `api.width`/`api.height` report and what the sketch draws in.
- `resolution` is an output multiplier: the export is `round(width × resolution) × round(height × resolution)`. It never changes the composition, only the pixel density (`@2x`). Default 1.
- `presets` is a plain `Record<string, { width, height }>` (print presets pre-computed at 300 dpi: `'A4 300dpi'` = 2480×3508; social: `'Instagram story'`, `'YouTube'`, `'4K'`…). Plugins extend it like `renderers`. mm/cm/dpi calculators are plugin material — core never sees units.
- `config.size` accepts `{ width, height }`, `{ preset }`, or a preset with overrides. `resolveSize()` normalizes.
- The live size is `LoadedSketch.size`; the Size folder in the panel (`core/params.ts#addSizeFolder`) writes into it in place, like params, then `App.setSize()` reloads the stage.
- On load: `config.size` in code, else `DEFAULT_SIZE` (1080×1080). Code is the source; the panel's size changes are session-only and are **not** persisted (there used to be a `sketches/<name>/size.json` written by `App.setSize` — removed, don't reintroduce it). Versions store `size`; loading one restores it.
- Preview: `fitPixels()` — the canvas is the largest same-aspect box inside the stage × `devicePixelRatio`, capped at the export size. `api.scale = canvas.width / size.width`. Export: canvas = `outputPixels(size)`, `api.scale = resolution`.

## Three rules for export correctness

1. **Draw with `api.width`/`api.height`.** The host applies `ctx.scale(api.scale)` (or `p.scale`) so preview and export match. Don't read `canvas.width`, don't multiply by `api.scale` (unless `config.scaleContext === false`). Size strokes and shapes relative to `api.width` if the same sketch should look identical on A4, A2 and a 1080 post.
2. Seed randomness from `api.random()`/`api.noise()` so frames reproduce identically.
3. Take animation time from `t` / `api.frame`, never `Date.now()` / `millis()` / `frameCount`.

## Export model

- One action. `App.export()` runs `exporters.mp4` when `config.fps && config.duration`, else `exporters.still`. `Escape` aborts via `AbortSignal`.
- Output dir: `sketches/<name>/exports/` (gitignored). Base name from `core/export.ts#exportName`: `<sketch>.<yyyy.mm.dd-HH.MM.ss.SSS>`. Keep it short — reproducibility info belongs in the sidecar, not the filename.
- Every export writes a `.json` sidecar (params incl. seed, `size`, resolved `pixels`, matched `preset`, fps, duration, and `view` — the preview renderer's `getView()` when it has one) — the reproducibility record.
- **Layers**: `draw` may return `void | canvas | { data, extension, suffix? } | Layer[]`. `core/files.ts#toLayers` normalizes this; `layerFileName` names them (`-i` index for multiple layers unless `suffix` is set). Renderers must return `draw`'s result from `Renderer.draw(t)` — directly or as a Promise (p5 2.x `redraw()` is async, so the p5 renderer awaits it). Exporters `await renderer.draw(t)` before reading the canvas; the stage holds further frames while a draw is in flight.
- All exporters render at `outputPixels(sketch.size)` with `api.scale = size.resolution` — never at preview size.
- `still`: hidden renderer, `api.exporting = true`, one `draw(0)`, writes every layer.
- `mp4`: streams each PNG frame to the server, which pipes it into `ffmpeg -f image2pipe … libx264` (odd dimensions are padded to even). No frames touch disk. Abort kills ffmpeg and removes the partial file. `FFMPEG_PATH` overrides the binary; a missing binary yields a readable error. `core/server.ts#startFfmpeg(file, args)` is the generic form: any plugin can start an ffmpeg job that consumes PNGs through the same `/api/video/:id/frame|end|abort` routes.
- **Canvas limits fail loud.** Browsers drop a canvas that is too big for the GPU *silently*: Chrome caps a WebGL drawing buffer at ~33 MP, and somewhere above that (a 150 MP print is well past it) the GPU process runs out of memory, the 2D context is lost and restored blank, and `toBlob` encodes a valid transparent PNG. `makeExportRenderer.drawFrame` checks for this after every draw (`contextlost` event, `isContextLost()`, WebGL `drawingBufferWidth < canvas.width`) and throws `Canvas lost: W×H (N MP) is over this GPU's limit…`. Never write a file the check did not pass; never "fix" this by sampling pixels (a legitimately transparent layer is not an error).
- **Tiling** is how prints beyond that ceiling are made, and it is a skill (`add-tiled-export`), not core. Core provides the hook: `api.tile` is the window of the artwork the canvas shows; `makeExportRenderer(sketch, pixels)` accepts a canvas size other than the output; canvas2d/p5-2D renderers translate by `-tile.x, -tile.y` after the scale, and the p5 WebGL host camera offsets its projection (a clip-space scale + shift, three's `setViewOffset`). A sketch with its own camera or one working in canvas pixels applies the tile itself — `sketches/example-p5-webgl#tileProjection` is the 8-line reference. Same seed + same tile ⇒ same pixels, so a stitched print equals a single pass.

## Playback

`Stage` steps frames by wall clock: `frame = floor(elapsed * fps) % totalFrames` (`core/timing.ts`). Never advance one frame per `requestAnimationFrame` — that ties speed to the monitor's refresh rate. `draw` is wrapped in try/catch; the RAF is re-armed *before* drawing so a throwing sketch can't stop the loop. Errors surface through `Stage.onError` → status bar, deduplicated by message; `Stage.onRecover` fires once when a draw succeeds after an error so the message can be cleared (it does not fire on every frame — other statuses would vanish). `Stage.seek(frame)` shows one frame while paused; `App.export` uses it on each `onProgress` so the preview follows the frame being written, then restores the original frame. `App.step(±1)` (`←`/`→`) pauses and seeks with wrap-around. `App.reseed()` (`R`) writes a new random `params.seed` and calls `paramsChanged()` — the only `Math.random()` in core, and it is outside the render path (the seed is a param like any other).

Input: renderers track it themselves (p5 listens on `window`), so the host's only job is to redraw while it happens. Because p5's listeners are on `window`, `#sidebar` and `#params` stop `wheel` from bubbling out of them (`App` constructor) — otherwise scrolling the panel zoomed an `orbitControl()` camera. Only `wheel`: swallowing `pointerup` would leave p5 with the mouse stuck down when a canvas drag ends over a panel. Pointer/wheel events over `#stage` and key events outside inputs/the panel keep the stage dirty for `INPUT_SETTLE` (0.5 s) past the last event (`Stage.onInput`/`tickInput`) — long enough for p5's `orbitControl()` easing to play out instead of freezing and resuming on the next unrelated input. The RAF loop throttles to one draw per frame; `autoRender === false` opts out exactly as it does for slider edits. When input settles, `Stage.onInputEnd` → `updateParamsGUI`, so params a sketch wrote during a gesture show up in the panel (not on every move: `updateDisplay` writes into inputs and would clobber typing). Live input never reaches the export: `Stage.acceptInput` is false during `App.export` (the preview shares `params` with the export renderer), and the hidden p5 export instance aborts p5's window listeners after `setup` (`renderers.ts`). What the user *did* to the preview instance does reach it: `App.export` passes `stage.renderer.getView?.()` to the exporter, `makeExportRenderer(sketch, pixels, view)` calls `renderer.setView(view)` after `setup`, and the sidecar records `view`. The p5 renderer's view is the active camera (eye/center/up ÷ canvas height, so it fits any size), the mouse fields, key state and touches — so a bare `orbitControl()` or a `mouseX` sketch exports what the screen showed with no params. Versions store `params` only, so a view the user wants to *come back to* still has to be a param — `sketches/example-p5-webgl` is that round-trip. Module-level state in a sketch is shared between the preview and the export instance; key per-instance objects (a camera) by `p` (the example uses a `WeakMap`). Accumulated pixels, p5 DOM inputs and live devices cannot be carried; `docs/sketch.md` lists the three with their data-based alternative.

The p5 host camera (`hostCam`) is refitted only when canvas size or `api.tile` change (`fitKey`), never per frame — a per-frame refit would undo what `orbitControl()` just did. Its pose is kept in `hostView` (units of full canvas height) and read back from the camera before every refit, so an orbited view survives a window resize, a tile change and the hand-off to the export.

## Architecture

- `core/` is the host. Do not put user work here unless the user is intentionally forking it.
  - `app.ts` UI glue · `hooks.ts` `keys` map + `keyFor` + `hooks.load/panel/exported` · `validate.ts` load-time contract check · `controls.ts` inline param descriptors → hints · `stage.ts` preview loop + redraw on input · `renderers.ts` canvas2d/p5 (WebGL gets a size-independent default camera — fixed FOV, eye ∝ height — so preview = export; the export instance is deaf to window input) · `export.ts` exporters + their building blocks · `files.ts` pure naming/layer helpers · `timing.ts` frame math · `size.ts` presets + pixel math · `random.ts` seeded PRNG/noise · `server.ts` Vite middleware (fs, versions, ffmpeg) · `params.ts` the dialkit panel + `controlTypes` · `sidebar.ts`.
- `plugins/index.ts` (browser) and `plugins/server.ts` (Vite plugins, spread into `vite.config.ts`) are the extension points. `core/main.ts` imports `../plugins` before `new App()`, so plugins mutate registries at import time and get the running app later through `hooks`/`keys`.
- `.agents/skills/` holds the `add-*` skills (open `.agents` standard, committed, inherited by forks). They are documentation for the agent, not code the app loads.
- `sketches/` is the user's workspace. `cp -r` duplicates; rename renames; the user decides what to keep. There is no create/copy/rename in the app on purpose (it was a `+` button with two `prompt()`s; removed) — the filesystem is the UI for that.
- `sketches/**/exports/` is gitignored. `sketches/**/versions/` is committed.

## Plugin surface (`core/index.ts`)

Everything is a plain object with core's own entries inside it — add a key or overwrite one:

```js
renderers:    { canvas2d, p5, 'p5-webgl': p5 }                 // RendererFactory
exporters:    { still, mp4 }                                    // ExporterFactory; App.export(name) runs any key
presets:      { 'A4 300dpi': { width, height }, ... }
controlTypes: { number, select, color, boolean, string }        // ControlFactory, picked by control.type
keys:         { s, e, r, Escape, ' ', g, Enter, ArrowLeft, ArrowRight }  // (app) => void; letters lowercased, no modifiers
hooks:        { load: [(sketch, app)], panel: [(panel, sketch, app)], exported: [(files, sketch, app)] }  // panel runs before the stage loads
```

### The params panel

`core/params.ts` builds the panel out of [dialkit](https://www.dialkit.dev)'s individual controls (`mountSlider`, `mountToggle`, `mountSelectControl`, `mountColorControl`, `mountTextControl`, `mountButtonGroup`, `mountFolder`), not its `createDialKit` store. That is deliberate: the store turns every number into a slider, renders control types from a closed list, and mounts a presets/Copy toolbar on every panel — versions are files here, and `controlTypes` has to stay open. Mounting the controls ourselves keeps the look and drops all three.

`hooks.panel` receives a `Panel`:

```ts
interface Panel {
  element: HTMLElement;                                    // the `.dialkit-root` everything lives in
  folders: { render: HTMLElement; params: HTMLElement; size: HTMLElement };
  addFolder(title: string): HTMLElement;                   // a new section, returns its body
  update(): void;                                          // re-read every widget from `params`/`size`
  onEdit?: () => void;                                     // after any widget changed a value
  destroy(): void;
}
```

A `ControlFactory` is `(host, params, key, control, onChange) => { update, destroy }`. Two rules when wrapping a dialkit control:

- **Some are controlled.** `mountSelectControl` and `mountToggle` call `onChange` and then sit still until the parent hands the new props back, so those re-apply their own props after a change. The slider and colour picker keep their own DOM in sync; a text input already holds what was typed, and refreshing it mid-edit moves the caret.
- **There is no change/commit split.** Every control commits on each drag step and each keystroke. Anything expensive per edit must debounce — the Size section waits 400 ms before rerunning the lifecycle, and `add-hot-reload` debounces `onEdit` before writing the URL hash.

`keyFor('app.export()')` → `'E'` finds the key bound to an action by its handler's source text; `buildParamsGUI` uses it to put the shortcut in the button label, so a plugin that rebinds a key is reflected. `hooks.exported` fires after an exporter resolves with the files it wrote (paths under `sketches/`). `App.updateHash` owns `s`/`v` in the URL hash and keeps every other key, so a plugin can park state there (`add-hot-reload` keeps `p`/`size`).

An exporter is `async ({ sketch, onStatus, onProgress, signal }) => void | string[]` — resolve to the written paths so `hooks.exported` sees them. `makeExportRenderer(sketch, pixels?)` gives a hidden renderer at the export resolution (or at `pixels`, for exporters that render the artwork in pieces and set `api.tile` per draw) whose `drawFrame(frame, t)` returns the layers to write and throws if the browser dropped the canvas; `postFile`, `layerToBlob`, `sidecar`, `exportName` do the rest — the built-in `still`/`mp4` in `core/export.ts` are 20–45 lines each and the best templates. Bind it to a key with `keys.q = (app) => app.export('yourExporter')`, or to a panel button with `hooks.panel.push((panel, sketch, app) => mountButtonGroup(panel.addFolder('…'), { buttons: [{ label: 'Run', onClick: () => app.export('yourExporter') }] }))`. Size presets are pixels computed once (`presets['Gallery 50x70cm'] = { width: 5906, height: 8268 }` is 500×700 mm at 300 dpi).

`App` exposes `export(name?)`, `saveVersion()`, `setSize(size?)`, `paramsChanged()`, `reseed()`, `step(delta)`, `setStatus(text)`, `loadSketch(name)`, plus `stage`, `sketch`, `gui`, `statusEl`, `abortExport`. Exporter building blocks: `makeExportRenderer`, `frameCount` (`{ fps, frames, animated }`; a still is one frame), `loopT`, `postFile`, `sidecar`, `exportName`, `layerToBlob`, `isCanvas`, `EXPORTS_DIR`. Renderer helpers: `styleCanvas`, `createRandomBackend`. Server helpers (`core/server.ts`, Node side): `SKETCHES_DIR`, `safeJoin`, `readBody`, `json`, `text`, `startFfmpeg`.

A custom renderer is just another key. It owns `create/resize/dispose`, receives `load/setup/draw/dispose`, applies `api.scale` when `config.scaleContext !== false`, and returns `draw`'s result. If the library keeps state inside its own instance that the user changes on screen (a camera, `OrbitControls`), implement the optional `getView()`/`setView(view)` pair — JSON-able, size-independent — and the export shows that state too; canvas2d and a shader renderer have nothing to implement. Exporters written as plugins pass `opts.view` through to `makeExportRenderer` or the file falls back to the code's default view. Adding a registry here is the *only* kind of core change a plugin should ever need; features never land in core.

## Server routes

```
GET    /api/sketches                          → { sketches: [{ name, entry }] }
GET    /api/sketches/:s/versions
POST   /api/sketches/:s/versions              { params, size, thumb }
DELETE /api/sketches/:s/versions/:id
POST   /api/sketches/:s/video                 { file, fps } → { id }   spawns ffmpeg
POST   /api/video/:id/frame                   PNG body → ffmpeg stdin
POST   /api/video/:id/end                     close stdin, wait for exit
POST   /api/video/:id/abort                   kill, delete partial file
POST   /api/files/:path                       binary body → sketches/:path
```

## Commands

- `pnpm dev` — the app. There is no build/`dist/`: the `/api` routes are `configureServer` middleware, which only exists in `vite dev`; a static bundle would be an app without a filesystem. Don't add `vite build` back.
- `pnpm check` — typecheck (`tsc --noEmit`). This is the "does it compile" gate skills should end with.
- `pnpm test` — vitest (`core/*.test.ts`; pure modules only — nothing that imports p5 or touches DOM). `validate` lives in its own file for this reason: `sketch.ts` imports `renderers` (p5), so the registries' keys are passed in.

## Skills (`.agents/skills/`)

Available now: `add-three` (renderer), `add-shader` (WebGL2 fragment-shader renderer, no deps), `add-gif-export` (gifenc exporter + key `q`), `add-tiled-export` (prints beyond the GPU's canvas limit: tiles + ffmpeg stitch, no deps), `add-hot-reload` (params/size ride in the URL hash across Vite's full reload + Reset-to-defaults button/`Backspace`), `add-cli-export` (`pnpm export <sketch>` through headless Chromium; batch is a shell loop), `add-timeline` (dialkit's timeline dock; clips sampled from `api.time` per draw, never from a wall clock, so the export matches). Each SKILL.md is self-contained: rules, steps, the core contract it implements, pitfalls, a reference implementation that typechecks against current core, and how to verify.

When writing a new one, keep that shape, keep it to `plugins/`, end with `pnpm check` + a manual check in the running app, and make appends to `plugins/index.ts` idempotent (check the import line exists before adding).

## Deferred on purpose

- In-place sketch reload (no page refresh): needs `App.buildParamsGUI` public and a cache-busting import; `add-hot-reload` explains the design. Do it when a heavy sketch actually needs it.
- JPEG/WebP, PNG sequence export (was `exporters.sequence`; nothing bound it, removed), batch-over-seeds, bleed, mm/cm/dpi size calculators: one-line code changes or skills when someone needs them. Physical sizes are just presets computed once (see Plugin surface).
- Host-level input: `api.pointer` (design-px mouse for canvas2d), a `drag: 'x' | 'y' | 'wheel'` param hint, `hooks.input` for plugins. A sketch's own listeners already reach the export (module state is shared) and p5's built-ins travel via `getView`; add these when a canvas2d or three sketch actually needs the convenience, not before. `p.mouseX` is canvas px (`/ api.scale`) — a doc note, not a patch on p5 internals.
- Versions storing `view` (so `S` on a bare `orbitControl()` sketch keeps the angle): `saveVersion` + `VersionInfo.view` + `setView` on load, ~10 lines. Not done because the params round-trip already covers it and keeps versions as "params + size" — revisit if people keep losing views.
- p5 in core: the one non-universal thing trunk still ships (~100 lines of `renderers.ts`, a 1 MB dependency). Moving it to an `add-p5` skill is the honest application of the rule; kept for now because it is most artists' on-ramp.
