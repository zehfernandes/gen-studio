---
name: add-hot-reload
description: Keep params and size when a sketch file is edited and Vite reloads the page, by carrying them in the URL hash next to the sketch and version; adds a Reset button back to the code's defaults. Writes to plugins/ only, no dependencies.
---

# Add hot reload that preserves params (URL hash) + Reset to defaults

Today an edit to `sketches/<name>/sketch.js` makes Vite reload the page and the panel snaps back to the code's defaults. This plugin keeps the live `params` and `size` in the URL hash — `#s=poster&v=003&p={…}&size=2480x3508@1` — so they survive the reload, and a copied URL reproduces the exact panel state on another machine. It also adds **Reset params** (button + `Backspace`) that returns every slider to what the code declares, because once you have dragged everything there is otherwise no way back except reload.

It deliberately keeps the full page reload. Swapping the module in place would skip `load`/`setup`, which is exactly what heavy sketches (fonts, textures, GL state) cannot survive. See "Going further" if the user really wants in-place.

## Rules

- Write to `plugins/` only. Never edit `core/`.
- Restore is a merge: only keys that still exist in the new `params` are written, so a renamed or removed param falls back to the code's default instead of resurrecting stale state.
- The hash is the store — not `sessionStorage`, not `localStorage`. It is visible, copyable and dies with the tab. Persistence that should outlive a tab is what versions are for.
- Never write the hash from the render path. Write it when a slider is released (`gui.onFinishChange`) and when input settles, not on every frame.

## Steps

1. Write `plugins/hot-reload.ts` from the reference below.
2. Register it in `plugins/index.ts`, once — it self-registers via `hooks` and `keys`, so a bare import is enough:
   ```ts
   import './hot-reload';
   ```
3. Verify: `pnpm dev`, open a sketch, drag a slider away from its default: the URL gains `&p=…`. Edit and save the sketch file. The page reloads and the slider keeps the dragged value; the Size folder keeps its value; the sketch/version in the hash are unchanged. Rename that param in the code and save: it falls back to the new default (no stale key). Press `Backspace` (or the Reset params button): every slider returns to the code's value and `p`/`size` leave the hash. Switch sketches in the sidebar: the other sketch does not inherit the first one's `p`.

## How it works

- `core/hooks.ts` exposes `hooks.panel` (runs after the panel is built, **before** the stage loads — so a restored `size` is honored by the first `stage.load`) and `keys` (a plain map; add `Backspace`).
- `App.updateHash` (core) owns `s` and `v` and **keeps every other key**, so `p` and `size` ride along untouched when core rewrites the hash.
- At `hooks.panel` time, on a plain reload, `s` in the hash still names the current sketch; on a sidebar switch it still names the *previous* one (core rewrites it after the stage loads). That is the test for "does this `p` belong to me": restore only when `hash.s === sketch.name`, otherwise drop it.
- `LoadedSketch.defaults` (core) is a frozen clone of the flat params as the code declared them, taken before any version or plugin writes into `params`. Reset copies it back in and calls `app.paramsChanged()`, which refreshes the widgets and redraws.
- `updateParamsGUI` (exported from core) refreshes lil-gui after writing into `params`.

## Pitfalls

- `gui.onFinishChange` fires for every controller in the panel, including the Size folder. That is fine: `size` is written from `sketch.size`, which the folder already changed in place.
- Params a sketch writes during a gesture (orbit → `params.yaw`) do not go through lil-gui, so they don't fire `onFinishChange`. Wrap `app.stage.onInputEnd` to catch them, as the reference does; call the original, core relies on it.
- `location.hash = …` does not reload the page, but it does push a history entry. Use `history.replaceState` so Back still leaves the studio.
- Loading a version (sidebar click) writes the version's params into `sketch.params` and core rewrites `v` — the stale `p` stays in the hash until the next slider release. Clear `p`/`size` in `hooks.load` when `v` is present and the params equal the version's; or simply accept that `v` wins on the next reload because core applies the version *before* `hooks.panel` and the plugin merges `p` over it. The reference takes the second, simpler path: `p` always reflects the last thing the user touched.
- Writing versions or exports does **not** trigger a reload (those files are not in Vite's module graph), so nothing here fires on Save or Export.

## Reference implementation

```ts
// plugins/hot-reload.ts
import { hooks, keys, updateParamsGUI } from '../core';
import type { App, LoadedSketch } from '../core';

// The URL hash carries the live params/size next to core's `s`/`v`. A Vite full reload keeps the URL,
// so an edit to sketch.js comes back with the same sliders; a pasted URL reproduces the panel.
const hash = () => new URLSearchParams(location.hash.slice(1));
const setHash = (h: URLSearchParams) => history.replaceState(null, '', '#' + h.toString());

function write(sketch: LoadedSketch) {
  const h = hash();
  const { width, height, resolution } = sketch.size;
  h.set('p', JSON.stringify(sketch.params));
  h.set('size', `${width}x${height}@${resolution}`);
  setHash(h);
}

function clear() {
  const h = hash();
  h.delete('p');
  h.delete('size');
  setHash(h);
}

hooks.panel.push((gui, sketch, app) => {
  const h = hash();
  // Core rewrites `s` only after the stage loads, so here it still says which sketch `p` was written for.
  if (h.get('s') === sketch.name && h.has('p')) {
    const saved = JSON.parse(h.get('p')!);
    // Merge, don't replace: a param removed or renamed in the edit falls back to the code's default.
    for (const key of Object.keys(saved)) if (key in sketch.params) sketch.params[key] = saved[key];
    const m = /^(\d+)x(\d+)@([\d.]+)$/.exec(h.get('size') ?? '');
    if (m) Object.assign(sketch.size, { width: +m[1], height: +m[2], resolution: +m[3] });
    updateParamsGUI(gui);
  } else if (h.has('p')) clear();

  gui.onFinishChange(() => write(sketch));
  // Params a sketch writes during a gesture (orbitControl → params.yaw) bypass lil-gui.
  const inputEnd = app.stage.onInputEnd;
  app.stage.onInputEnd = () => {
    inputEnd?.();
    write(sketch);
  };

  const render = gui.folders.find((f) => (f as any)._title === 'Render') ?? gui;
  render.add({ reset: () => reset(app) }, 'reset').name('Reset params (Backspace)');
});

// Back to what the code declares. `sketch.defaults` is frozen at load, before versions or plugins touch `params`.
function reset(app: App) {
  const { sketch } = app;
  if (!sketch) return;
  Object.assign(sketch.params, sketch.defaults);
  clear();
  app.paramsChanged();
}

keys.Backspace = reset;
```

## Going further (only if asked)

In-place reload without a page refresh: a Vite plugin in `plugins/server.ts` with `handleHotUpdate(ctx)` that, for files under `sketches/`, sends `ctx.server.ws.send({ type: 'custom', event: 'gen-studio:sketch', data: { name } })` and returns `[]` to suppress the full reload; the client re-imports `/sketches/<name>/<entry>?t=<stamp>` (cache-buster, outside the render path so determinism is untouched), runs `splitParams` on the new `params`, merges old values in, swaps `sketch.module/config/params/controls`, and calls `app.setSize()` to rerun the lifecycle. It needs `App.buildParamsGUI` to be public, which is a core change — ask the user first.
