import p5 from 'p5';
import { createRandomBackend } from './random';
import { TYPING } from './hooks';
import type { Renderer, RendererFactory, ApiBackend, DrawResult } from './types';

// The stage sizes canvases in device pixels; show them at CSS size so retina previews are sharp, not huge.
export function styleCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const dpr = window.devicePixelRatio || 1;
  Object.assign(canvas.style, { display: 'block', width: `${width / dpr}px`, height: `${height / dpr}px` });
}

const canvas2d: RendererFactory = ({
  container,
  width,
  height,
  config,
  api,
  load,
  setup,
  draw,
  dispose,
}) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  styleCanvas(canvas, width, height);
  container.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2d context not supported');

  const backend = createRandomBackend(api.seed);
  api.setBackend(backend);
  (ctx as any).api = api;

  const renderer: Renderer = {
    canvas,
    width,
    height,
    async setup() {
      await load?.(ctx, api);
      setup?.(ctx, api);
    },
    draw(t) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Sketch draws in design units; the host maps them to canvas pixels (offset by the tile, if any).
      if (config.scaleContext !== false) {
        const { scale, tile } = api;
        ctx.setTransform(scale, 0, 0, scale, -tile.x * scale, -tile.y * scale);
      }
      return draw(ctx, t, api);
    },
    resize(w, h) {
      canvas.width = w;
      canvas.height = h;
      styleCanvas(canvas, w, h);
      renderer.width = w;
      renderer.height = h;
    },
    dispose() {
      dispose?.(ctx, api);
      canvas.remove();
    },
  };

  return renderer;
};

/** A p5 camera's pose in units of canvas height, so it fits any canvas size. */
interface CamView {
  eye: number[];
  center: number[];
  up: number[];
}
const readCam = (cam: any, h: number): CamView => ({
  eye: [cam.eyeX / h, cam.eyeY / h, cam.eyeZ / h],
  center: [cam.centerX / h, cam.centerY / h, cam.centerZ / h],
  up: [cam.upX, cam.upY, cam.upZ],
});
const applyCam = (cam: any, v: CamView, h: number) =>
  cam.camera(v.eye[0] * h, v.eye[1] * h, v.eye[2] * h, v.center[0] * h, v.center[1] * h, v.center[2] * h, v.up[0], v.up[1], v.up[2]);

/**
 * What a p5 instance knows that a fresh one would not: the active camera (after `orbitControl()`, or a
 * `camera()` call from an event handler) and the input state p5 tracks on `window`. Pixel values are
 * stored as fractions of the canvas height; `mouseButton`/`touches` are copied as p5 2.x shapes them.
 */
interface P5View {
  camera?: CamView;
  mouse: { x: number; y: number; px: number; py: number; pressed: boolean; button: unknown };
  keys: { pressed: boolean; key: string; keyCode: number; code: string };
  touches: { x: number; y: number; id: unknown }[];
}

// p5's own random/noise already handle the missing arguments (`random(a)` is
// `random(0, a)`, `noise` defaults y/z to 0), so plain forwarding is enough.
const p5Backend = (p: p5): ApiBackend => ({
  random: (min, max) => p.random(min, max),
  noise: (x, y, z) => p.noise(x, y, z),
  randomSeed: (seed) => p.randomSeed(seed),
  noiseSeed: (seed) => p.noiseSeed(seed),
});

const p5Factory: RendererFactory = ({
  container,
  width,
  height,
  config,
  api,
  load,
  setup,
  draw,
  dispose,
}) => {
  const isWebgl = config.renderer === 'p5-webgl';
  let pInstance: p5 | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let frameT = 0;
  // p5 calls `p.draw` synchronously, so an async sketch leaves a pending promise here;
  // `Renderer.draw` is async and returns it, which resolves it before the caller reads the canvas.
  let lastResult: DrawResult | Promise<DrawResult>;

  let resolveReady: () => void;
  let rejectReady: (err: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  // p5 2.x parks the default eye at 800 px and widens the FOV with the canvas height, so a preview
  // and an export of different sizes would get different perspectives. Fix the FOV instead and put
  // the eye where 1 unit is 1 px at z = 0: the view then scales with the canvas like the geometry.
  const FOV = Math.PI / 3;
  let hostCam: any;
  // Where the host camera is, in units of the full canvas height (so the same numbers fit any size),
  // and the height those numbers were last applied at. `orbitControl()` moves hostCam in place; reading
  // it back before every refit is what lets an orbited view survive a resize, a tile change or an export.
  let hostView: CamView = { eye: [0, 0, 1 / (2 * Math.tan(FOV / 2))], center: [0, 0, 0], up: [0, 1, 0] };
  let hostH = 0;
  let fitKey = '';
  const fitCamera = (w: number, h: number) => {
    const { tile, width, height } = api;
    // Canvas pixels of the whole artwork; equals w × h unless an exporter is tiling.
    const fullW = (w * width) / tile.width;
    const fullH = (h * height) / tile.height;
    if (hostH) hostView = readCam(hostCam, hostH);
    const eyeZ = fullH / 2 / Math.tan(FOV / 2);
    hostCam.perspective(FOV, fullW / fullH, eyeZ / 10, eyeZ * 10);
    applyCam(hostCam, hostView, fullH);
    hostH = fullH;
    fitKey = `${w}x${h}:${tile.x},${tile.y},${tile.width},${tile.height}`;
    if (tile.width === width && tile.height === height) return;
    // Off-center projection for one tile (three.js's setViewOffset): scale and shift clip space so
    // the tile's window fills the canvas. Done in NDC, so it is independent of p5's y-flip.
    const m = hostCam.projMatrix.mat4;
    const sx = width / tile.width;
    const sy = height / tile.height;
    const cx = (2 * tile.x + tile.width) / width - 1;
    const cy = 1 - (2 * tile.y + tile.height) / height;
    m[0] *= sx;
    m[8] = (m[8] + cx) * sx;
    m[5] *= sy;
    m[9] = (m[9] + cy) * sy;
  };
  // The renderer's active camera; only ours is refitted, a sketch's own camera is left alone.
  const hostCamActive = (p: p5) => hostCam && (p as any)._renderer.states.curCamera === hostCam;

  const sketch = (p: p5) => {
    // p5 binds its input handlers to `window` (p5 2.3), so anything the user touched anywhere on the
    // page was the sketch's: dragging a slider in the panel moved `mouseX` and fired `mousePressed`/
    // `mouseDragged`, and typing in a number field fired `keyPressed` per keystroke. Wrapped here,
    // inside the sketch closure, because p5 binds them in `presetup`, right after this runs.
    const q = p as any;
    const guard = (types: string[], mine: (e: any) => boolean) => {
      for (const type of types) {
        const handler = q[`_on${type}`];
        q[`_on${type}`] = (e: Event) => {
          if (mine(e)) handler.call(q, e);
        };
      }
    };

    // A gesture is the sketch's when it *starts* on the canvas. `mouseIsPressed` carries the rest of
    // a drag that wanders off it (`orbitControl()`), so a canvas drag released over a panel still
    // gets its `pointerup` and p5 is never left with the mouse stuck down.
    guard(
      ['pointerdown', 'pointerup', 'pointercancel', 'pointermove', 'dragend', 'dragover', 'click', 'dblclick', 'wheel'],
      (e) => q.mouseIsPressed || e.target === q.canvas,
    );

    // Keys can't start on the canvas — it takes no focus, so they arrive on `<body>`. The rule is the
    // panel's instead: a key typed into a field or a control belongs to that widget (`TYPING`, the
    // same test the app's own shortcuts use). `_downKeys` lets the release of a key pressed *before*
    // the field took focus through, so p5 is not left holding it. `blur` stays unwrapped: p5 clears
    // its held keys with it.
    guard(['keydown', 'keyup', 'keypress'], (e) => !e.target?.closest?.(TYPING) || q._downKeys?.[e.key]);

    // p5 2.x awaits an async setup before the first draw.
    p.setup = async () => {
      const mode = isWebgl ? 'webgl' : 'p2d';
      p.createCanvas(width, height, mode as any);
      p.pixelDensity(1);
      p.noLoop();
      if (isWebgl) {
        hostCam = (p as any).createCamera();
        fitCamera(width, height);
        (p as any).setCamera(hostCam);
      }

      api.setBackend(p5Backend(p));
      api.randomSeed(api.seed);
      api.noiseSeed(api.seed);
      (p as any).api = api;

      canvas = (p as any).canvas as HTMLCanvasElement;
      if (canvas) styleCanvas(canvas, width, height);

      try {
        await load?.(p, api);
        setup?.(p, api);
        // p5 binds its mouse/key listeners on window with this signal (p5 2.3). The hidden export
        // instance must not hear the user's mouse mid-export, or frames would differ from the preview.
        if (api.exporting) (p as any)._removeAbortController?.abort();
        resolveReady();
      } catch (err) {
        rejectReady(err);
      }
    };

    p.draw = () => {
      // The tile can change between draws (tiled export); `setCamera` pushes the patched projection.
      // Only when something changed: refitting every frame would undo what orbitControl() just did.
      const { tile } = api;
      if (hostCamActive(p) && fitKey !== `${p.width}x${p.height}:${tile.x},${tile.y},${tile.width},${tile.height}`) {
        fitCamera(p.width, p.height);
        (p as any).setCamera(hostCam);
      }
      // p5 resets the matrix every draw, so a single scale() maps design units to pixels.
      if (config.scaleContext !== false) {
        if (api.scale !== 1) p.scale(api.scale);
        // In WebGL the origin is the centre and the camera above handles the tile.
        if (!isWebgl) p.translate(-api.tile.x, -api.tile.y);
      }
      lastResult = draw(p, frameT, api);
    };
  };

  pInstance = new p5(sketch, container);

  const renderer: Renderer = {
    get canvas() {
      return canvas as HTMLCanvasElement;
    },
    width,
    height,
    async setup() {
      await ready;
    },
    async draw(t) {
      frameT = t;
      lastResult = undefined;
      // p5 2.x redraw() is async: the sketch's draw runs after an awaited hook, not synchronously.
      await pInstance?.redraw();
      return lastResult;
    },
    resize(w, h) {
      (pInstance as any)?.resizeCanvas?.(w, h, true);
      // Mutates our camera in place: a sketch that switched to its own camera is left alone.
      if (hostCam) fitCamera(w, h);
      if (canvas) styleCanvas(canvas, w, h);
      renderer.width = w;
      renderer.height = h;
    },
    getView(): P5View | undefined {
      const p = pInstance as any;
      if (!p || !canvas) return;
      const h = p.height;
      const cam = isWebgl ? p._renderer?.states?.curCamera : undefined;
      return {
        camera: cam ? readCam(cam, h) : undefined,
        mouse: { x: p.mouseX / h, y: p.mouseY / h, px: p.pmouseX / h, py: p.pmouseY / h, pressed: p.mouseIsPressed, button: p.mouseButton },
        keys: { pressed: p.keyIsPressed, key: p.key, keyCode: p.keyCode, code: p.code },
        touches: (p.touches ?? []).map((t: any) => ({ x: t.x / h, y: t.y / h, id: t.id })),
      };
    },
    setView(view) {
      const p = pInstance as any;
      const v = view as P5View | undefined;
      if (!p || !v) return;
      const h = p.height;
      // Into whichever camera is active after setup: ours (kept through later refits via hostView) or the sketch's.
      const cam = isWebgl ? p._renderer?.states?.curCamera : undefined;
      if (cam && v.camera) {
        if (cam === hostCam) hostView = v.camera;
        applyCam(cam, v.camera, hostH || h);
      }
      Object.assign(p, {
        mouseX: v.mouse.x * h, mouseY: v.mouse.y * h, pmouseX: v.mouse.px * h, pmouseY: v.mouse.py * h,
        mouseIsPressed: v.mouse.pressed, mouseButton: v.mouse.button,
        keyIsPressed: v.keys.pressed, key: v.keys.key, keyCode: v.keys.keyCode, code: v.keys.code,
        touches: v.touches.map((t) => ({ x: t.x * h, y: t.y * h, id: t.id })),
      });
    },
    dispose() {
      if (pInstance) dispose?.(pInstance, api);
      pInstance?.remove();
      pInstance = null;
      canvas = null;
    },
  };

  return renderer;
};

export const renderers: Record<string, RendererFactory> = {
  canvas2d,
  p5: p5Factory,
  'p5-webgl': p5Factory,
};
