# Writing a sketch

`sketch.js` is a plain ES module in `sketches/<name>/` (or `index.js` / `.ts`). The host reads a few optional exports and one required one, `draw`. The [README](../README.md) has the short version; this is the whole surface.

## Renderers

Canvas 2D is the default — `c` is a `CanvasRenderingContext2D`:

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

Set `config.renderer` and `p` becomes a p5 instance in instance mode — call everything as `p.x`:

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

## Lifecycle and `api`

```js
export async function load(p, api) { /* await fonts, images */ }
export function setup(p, api)      { /* one-time init */ }
export function draw(p, t, api)    { /* every frame; required */ }
export function dispose(p, api)    { /* free listeners, GL resources */ }
```

`api` gives you:

| | |
|---|---|
| `random(min?, max?)`, `noise(x, y?, z?)`, `seed` | seeded randomness |
| `frame`, `frames`, `fps`, `time` | where you are in the loop (`time` is `frame / fps`) |
| `width`, `height` | design pixels |
| `scale` | device px per design px; the host already applied it |
| `exporting` | true while rendering to a file — hide guides with it |

Changing the size reruns `load` and `setup`. If `draw` throws, the error goes to the status bar and the loop keeps running. So does a syntax error or a missing `draw`.

`t` runs from 0 toward 1 across the loop and never reaches it, so the last frame is not a copy of the first and `sin(t * 2π)` wraps seamlessly.

`api.random()` is reseeded with `seed` before **every** frame, so a layout drawn from it holds still while `t` animates. Want a fresh draw per frame? Call `api.randomSeed(api.seed + api.frame)` at the top of `draw`.

## Three rules for preview = export

1. **Draw in `api.width` × `api.height`.** Never read `canvas.width`, never multiply by a scale factor.
2. **Randomness from `api.random()` / `api.noise()`.** Not `Math.random()`.
3. **Time from `t` / `api.frame`.** Not `Date.now()`, `millis()` or `frameCount`.

## Params

Every key in `params` becomes a control. The hints live next to the value:

```js
export const params = {
  seed: 1,                                              // number input
  count: { value: 18, min: 3, max: 48 },                // slider; integer bounds ⇒ integer steps
  amount: { value: 0.3, min: 0, max: 1, step: 0.01 },   // slider with an explicit step
  mode:  { value: 'top', options: ['top', 'bottom'] },  // dropdown
  ink:   '#1c1612',                                     // color picker
  guide: true,                                          // checkbox
  angle: { value: 0.6, min: -3.14, max: 3.14, group: 'Camera' }, // its own folder
};
```

`group` sorts a long panel: params that name one get a folder of that name, the rest stay in **Params**.

The host flattens the descriptors at load, so your code always reads `params.count` as a plain value. Dragging a slider writes into `params` and re-renders.

`seed` is ordinary except that `R` gives it a new random value — the fastest way to see another one.

Too heavy to re-render on every edit? Set `config.autoRender = false`. Edits then wait for the **Render** button or `Enter`.

The panel is [dialkit](https://github.com/joshpuckett/dialkit). A plugin can wrap one of its controls, or render its own DOM, and select it with `type:` in the hint — see [`AGENTS.md`](../AGENTS.md).

## Size

Sizes are pixels. The **Size** folder has a preset dropdown plus `width`, `height`, `resolution`.

- `width × height` are the design pixels your code draws in.
- `resolution` multiplies the output. `2` gives a @2x file of the same picture; `0.5` a quick draft.
- Presets are print at 300 dpi (`A4`, `A3`, `A2`, `18 × 24 in`, `24 × 36 in`) and screen (`Instagram post`, `Instagram story`, `YouTube`, `X post`, `4K`). Add your own from a plugin: `presets['Gallery 50x70cm'] = { width, height }`.

The code is the source of truth: `config.size` if you set it, otherwise 1080 × 1080. Changing the size in the panel is for trying things out and lasts until you reload. Once you like a size, put it in `config.size`. Saved versions remember the size they were saved at.

## Interaction

The stage redraws whenever you touch it, so a sketch can react to the mouse, the keyboard, a MIDI knob or a microphone. Only the canvas is yours: a gesture that starts on the panel — a slider drag — never reaches `mousePressed`, and one that starts on the canvas keeps reporting even if you drag off it.

One rule makes that reach the file: **the export receives no input — it only re-runs `draw`.** So an input's job is to become data that `draw` reads. Use `params` for a decision you want to keep; a plain variable is enough for a hover.

```js
export const params = { seed: 1, x: 0.5, y: 0.5 };   // where you last clicked, as a fraction

export function setup(p, api) {                      // canvas2d: c.canvas.addEventListener
  p.mousePressed = () => {
    params.x = +(p.mouseX / p.width).toFixed(3);     // p5's mouse is canvas pixels
    params.y = +(p.mouseY / p.height).toFixed(3);
  };
}

export function draw(p, t, api) {
  p.circle(params.x * api.width, params.y * api.height, api.width * 0.05);
}
```

Click, and `params.x/y` change, the stage redraws, the panel catches up when you release. Drag those sliders and the circle moves too. `E` exports the circle where you clicked; `S` saves it; a version brings it back.

| The input writes to | Export shows it | In the sidecar | `S` saves it |
|---|---|---|---|
| `params` | yes | yes | yes |
| a module variable | yes — same module | no | no |
| a p5 built-in (`mouseX`, the `orbitControl()` camera) | yes — snapshotted at `E` | as `view` | no |

The patterns follow from the rule:

- Click to place things → `params.sites = [[x, y], …]`. An array is a fine param; the panel skips it, versions keep it.
- Drag or wheel as a knob → a numeric param.
- A live signal → sample it into a variable on screen, and replay a per-frame recording by `api.frame` for animations.
- Anything that must stay out of the file → draw it under `if (!api.exporting)`.

The export runs in a hidden instance nobody is touching, so your mouse cannot leak into a video.

## Layers

`draw` may return a file instead of only painting the canvas — that is how `example-plotter` writes an SVG on export. The contract is in [`AGENTS.md`](../AGENTS.md).
