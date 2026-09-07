---
name: add-three
description: Add a three.js renderer to this gen-studio fork so sketches can set `config.renderer = 'three'`. Writes to plugins/ only.
---

# Add a three.js renderer

A renderer is one key in the `renderers` map (`core/index.ts`). This skill adds `renderers.three`, whose sketches receive `{ THREE, renderer, scene, camera, api }` as `p` and get their scene rendered after every `draw`.

## Rules

- Write to `plugins/` only. Never edit `core/`. If core lacks something you need, stop and tell the user — the hook is an upstream change, the feature is not.
- Same `seed` + same `frame` ⇒ same pixels. No `Date.now()`, no `Math.random()`, no clock-based animation; time comes from `t`.
- Composition must not depend on canvas pixels: preview and export render at different sizes. Only the camera aspect follows the canvas.

## Steps

1. `pnpm add three @types/three` — pick the latest release that is at least a week old (`pnpm view three time`).
2. Write `plugins/three-renderer.ts` from the reference below. Adapt it (orthographic default, post-processing, shadow maps) to what the user asked for; do not add options they did not ask for.
3. Register it in `plugins/index.ts`, once (check the import is not already there):
   ```ts
   import three from './three-renderer';
   renderers.three = three;
   ```
4. If the user has no three sketch yet, create `sketches/example-three/sketch.js` from the example below so the renderer can be seen working. Name it so it is obviously deletable.
5. Verify: `pnpm check` passes; `pnpm dev`, open the sketch, drag a param, press `E` and check `sketches/<name>/exports/` holds a PNG (or MP4) that matches the preview.

## The contract (from `core/types.ts`)

```ts
type RendererFactory = (opts: {
  container: HTMLElement; width: number; height: number;   // canvas pixels
  config: SketchConfig; params: SketchParams; api: Api;
  load?, setup?, draw, dispose?                            // the sketch's exports
}) => Renderer;

interface Renderer {
  canvas: HTMLCanvasElement; width: number; height: number;
  setup(): Promise<void> | void;        // run load then setup
  draw(t: number): DrawResult | Promise<DrawResult>;  // MUST return what the sketch's draw returned (layers)
  resize(width: number, height: number): void;
  dispose(): void;
  getView?(): unknown;                  // optional: library state the user changed on screen (camera)
  setView?(view: unknown): void;        // the export renderer applies it after setup → file = screen
}
```

`api.width/height` are design pixels; `width/height` here are canvas pixels (`api.scale` = ratio). Core's canvas2d renderer applies `ctx.scale(api.scale)`; for three the equivalent is "camera aspect follows the canvas, nothing else does".

## Pitfalls

- `preserveDrawingBuffer: true` is required. Exporters read the canvas with `toBlob()` after `draw` returns, outside the render call; without it WebGL may have cleared the buffer.
- `renderer.setPixelRatio(1)` and `setSize(w, h, false)`: the host already decided the pixel size and sets CSS size via `styleCanvas` (exported from core). Letting three read `devicePixelRatio` doubles the export.
- Seed the random backend: `api.setBackend(createRandomBackend(api.seed))`, exactly like core's canvas2d. Without it `api.random()` still works but is not tied to the seed the way the other renderers are.
- `api.random()` is reseeded with `api.seed` before every draw, so a layout drawn from it in `draw` is the same on every frame; a sketch that wants a fresh draw per frame calls `api.randomSeed(api.seed + api.frame)` itself. Building the scene in `setup` is still cheaper for heavy geometry.
- Return `draw`'s result from `Renderer.draw`, and **`await` it** — a sketch's `draw` may be async. Rendering before it settles exports the previous frame (the p5 bug core already had). A sketch may also return layers (`{ data, extension }`) to export an OBJ or JSON next to the PNG.
- Dispose geometry/materials in the sketch's `dispose`; call `renderer.dispose()` and remove the canvas in yours. Size changes rerun the whole lifecycle.
- `OrbitControls` works on screen: the stage keeps redrawing for half a second after pointer/wheel input, so `controls.update()` in `draw` is enough (damping settles within that window). The exporter builds a fresh hidden renderer, so the orbited camera reaches the file only through `getView/setView` (in the reference below: position, quaternion, zoom — world units, nothing to rescale). Versions store `params` only; a view the user wants to *return to* is the params round-trip from `sketches/example-p5-webgl`: set `camera.position` from `params.yaw/pitch/distance` at the top of `draw`, then (when `!api.exporting`) let the controls move it and write the spherical coordinates back.
- The sketch creates `OrbitControls` on `p.renderer.domElement`; guard it with `if (!api.exporting)` — the hidden export canvas has no mouse, and controls with damping would fight `setView`.

## Reference implementation

```ts
// plugins/three-renderer.ts
import * as THREE from 'three';
import { createRandomBackend, styleCanvas } from '../core';
import type { Api, Renderer, RendererFactory } from '../core';

/** What a three sketch receives as `p`. Fill `scene` (replace `camera` if you like) in `setup`; the host renders after every `draw`. */
export interface ThreeContext {
  THREE: typeof THREE;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  api: Api;
}

const three: RendererFactory = ({ container, width, height, api, load, setup, draw, dispose }) => {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  const canvas = renderer.domElement;
  styleCanvas(canvas, width, height);
  container.appendChild(canvas);
  api.setBackend(createRandomBackend(api.seed));

  const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
  camera.position.z = 5;
  const p: ThreeContext = { THREE, renderer, scene: new THREE.Scene(), camera, api };

  const fitCamera = (w: number, h: number) => {
    const c = p.camera as THREE.PerspectiveCamera;
    if (!c.isPerspectiveCamera) return;
    c.aspect = w / h;
    c.updateProjectionMatrix();
  };

  const r: Renderer = {
    canvas,
    width,
    height,
    async setup() {
      await load?.(p, api);
      setup?.(p, api);
    },
    // Await the sketch's draw: it may be async, and the scene must be final before we render.
    async draw(t) {
      const result = await draw(p, t, api);
      renderer.render(p.scene, p.camera);
      return result;
    },
    resize(w, h) {
      renderer.setSize(w, h, false);
      styleCanvas(canvas, w, h);
      fitCamera(w, h);
      r.width = w;
      r.height = h;
    },
    // The camera is the one thing three keeps that the sketch's params don't: hand it to the export.
    getView() {
      const c = p.camera as THREE.PerspectiveCamera;
      return { position: c.position.toArray(), quaternion: c.quaternion.toArray(), zoom: c.zoom };
    },
    setView(view) {
      const v = view as { position: number[]; quaternion: number[]; zoom: number };
      const c = p.camera as THREE.PerspectiveCamera;
      c.position.fromArray(v.position);
      c.quaternion.fromArray(v.quaternion as [number, number, number, number]);
      c.zoom = v.zoom;
      c.updateProjectionMatrix();
    },
    dispose() {
      dispose?.(p, api);
      renderer.dispose();
      canvas.remove();
    },
  };
  return r;
};

export default three;
```

## Example sketch

```js
// sketches/example-three/sketch.js
export const config = { renderer: 'three', size: { preset: 'Instagram post' }, fps: 30, duration: 6 };

export const params = {
  seed: 7,
  count: { value: 40, min: 1, max: 200, step: 1 },
  spread: { value: 3, min: 0.5, max: 8, step: 0.1 },
  color: '#ff5c33',
  bg: '#101010',
};

let group;

// Scene is built once, from seeded randoms, so the cloud is identical on screen and in the export.
export function setup(p, api) {
  const { THREE, scene } = p;
  scene.clear();
  scene.background = new THREE.Color(params.bg);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.position.set(3, 4, 5);
  scene.add(key);

  group = new THREE.Group();
  const geo = new THREE.BoxGeometry(0.4, 0.4, 0.4);
  const mat = new THREE.MeshStandardMaterial({ color: params.color });
  for (let i = 0; i < params.count; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(api.random(-1, 1) * params.spread, api.random(-1, 1) * params.spread, api.random(-1, 1) * params.spread);
    m.rotation.set(api.random(Math.PI), api.random(Math.PI), 0);
    group.add(m);
  }
  scene.add(group);
}

export function draw(p, t) {
  group.rotation.y = t * Math.PI * 2; // one full turn per loop: seamless video
  group.rotation.x = Math.sin(t * Math.PI * 2) * 0.3;
  p.scene.background.set(params.bg);
  group.children.forEach((m) => m.material.color.set(params.color));
}

export function dispose(p) {
  p.scene.traverse((o) => {
    o.geometry?.dispose();
    o.material?.dispose();
  });
}
```

Note `count` and `spread` only apply after `setup` reruns (size change or reload) — that is the host's model for setup-time params, not a bug to fix here.
