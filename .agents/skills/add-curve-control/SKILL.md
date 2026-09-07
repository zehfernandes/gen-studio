---
name: add-curve-control
description: Add a curve editor widget (tone/easing curve with draggable points) as a param control type. Copies one file into plugins/, no dependencies.
---

# Add a curve control

A control type is one key in the `controlTypes` map (`core/params.ts`). This adds `controlTypes.curve`: a lil-gui widget that edits a list of `[x, y]` points in 0..1 with a smooth monotone curve through them. The value stored in `params` (and in versions, sidecars) is the plain point array.

```js
export const params = {
  tone: { value: [[0, 0], [0.5, 0.5], [1, 1]], type: 'curve' },
};
```

Unlike most skills this one copies a file: the widget is ~200 lines of pointer math that is not worth regenerating. `curve-control.ts` sits next to this SKILL.md.

## Rules

- Write to `plugins/` only. Never edit `core/`.
- The param value stays a plain JSON array. Never store a class instance or a function in `params`; versions must round-trip through `JSON.stringify`.
- Sketches don't import from the host. The sketch that reads the curve copies the 30-line `curveAt` function (below) instead of importing it from `plugins/`.

## Steps

1. Copy `curve-control.ts` from this skill's folder to `plugins/curve-control.ts`.
2. Register in `plugins/index.ts`, once:
   ```ts
   import { curve } from './curve-control';
   controlTypes.curve = curve;
   ```
3. Add a `type: 'curve'` param to the user's sketch and paste `curveAt` into it (see example), or create `sketches/example-curve/sketch.js` from the example below.
4. Verify: `pnpm check`; `pnpm dev`. Drag a point → the sketch re-renders live. Click on the curve → a point is added; double-click a point → removed; ↺ → back to the code's default. Press `S`, change the curve, click the saved version → the widget and the render return to the saved shape. Press `E` → export matches the preview.

## How the control registry works

`core/params.ts#addControllers` picks a widget per param: `control.type` if set, else inferred from the value (`options` → `select`, hex string → `color`, `number`, `boolean`, `string`). Arrays are skipped unless a `type` names a registered factory:

```ts
type ControlFactory = (folder: GUI, params: SketchParams, key: string, control: Control, onChange: () => void) => unknown;
```

Write the new value into `params[key]` (in place or by assignment) and call `onChange()` → `Stage.renderOnce()`. Build on lil-gui's `Controller` so it lands in `gui.controllersRecursive()`: that is what `updateParamsGUI` walks when a version is loaded or a plugin writes params, so the widget redraws by itself.

## Pitfalls

- `Controller` stores `initialValue = getValue()` — the live array reference. Clone it, or "reset" hands the live array back into `params` and every drag mutates the default.
- Loading a version does `Object.assign(sketch.params, version.params)`: the array reference changes. Read `getValue()` on every redraw; never cache the array.
- Keep points sorted by x and endpoints pinned to `x = 0` and `x = 1`, or the curve stops being a function and `curveAt` misbehaves.
- The widget sits under the label (column layout) because lil-gui's row is 20 px high. Size the canvas from `clientWidth` on the next animation frame — it is 0 during construction.
- `dispose`: nothing to do; the panel is rebuilt from scratch on every sketch load (`container.innerHTML = ''`).

## Example sketch

```js
// sketches/example-curve/sketch.js
export const config = { size: { preset: 'Instagram post' } };

export const params = {
  seed: 1,
  cells: { value: 48, min: 8, max: 160, step: 1 },
  tone: { value: [[0, 0], [0.5, 0.5], [1, 1]], type: 'curve' },
  ink: '#f4f1e8',
  paper: '#101010',
};

export function draw(c, t, api) {
  const { width: w, height: h } = api;
  c.fillStyle = params.paper;
  c.fillRect(0, 0, w, h);
  c.fillStyle = params.ink;
  const n = params.cells;
  const cell = w / n;
  for (let j = 0; j < Math.ceil(h / cell); j++) {
    for (let i = 0; i < n; i++) {
      const v = api.noise(i * 0.08, j * 0.08);           // 0..1 field
      const r = curveAt(params.tone, v) * cell * 0.5;     // the curve remaps it
      c.beginPath();
      c.arc(i * cell + cell / 2, j * cell + cell / 2, r, 0, Math.PI * 2);
      c.fill();
    }
  }
}

// Same function as plugins/curve-control.ts. Copied, not imported: a sketch stays a plain module.
function curveAt(pts, x) {
  const n = pts.length;
  if (n === 0) return x;
  if (n === 1) return pts[0][1];
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[n - 1][0]) return pts[n - 1][1];
  const d = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    d.push(dx > 0 ? (pts[i + 1][1] - pts[i][1]) / dx : 0);
  }
  const m = [d[0]];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  m[n - 1] = d[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const tau = 3 / Math.sqrt(s); m[i] = tau * a * d[i]; m[i + 1] = tau * b * d[i]; }
  }
  let i = 0;
  while (x > pts[i + 1][0]) i++;
  const h = pts[i + 1][0] - pts[i][0], s = (x - pts[i][0]) / h, s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * pts[i][1] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * pts[i + 1][1] + (s3 - s2) * h * m[i + 1];
}
```
