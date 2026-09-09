/** Design pixels the sketch draws in, and an output multiplier applied only on export. */
export interface Size {
  width: number;
  height: number;
  /** Export = round(width × resolution) × round(height × resolution). 1 by default. */
  resolution: number;
}

/** What `config.size` accepts: explicit fields, a preset name, or a preset with overrides. */
export type SizeInput = Partial<Size> & { preset?: string };

export interface SketchConfig {
  renderer?: 'canvas2d' | 'p5' | 'p5-webgl' | string;
  size?: SizeInput;
  fps?: number;
  duration?: number;
  /** Default true: the host scales the context so the sketch draws in design units. */
  scaleContext?: boolean;
  /** Default true: a param edit redraws the preview. False for heavy sketches: edits wait for the Render button / Enter. */
  autoRender?: boolean;
}

export type SketchParams = Record<string, any>;

/**
 * UI hints declared inline in `params` (`{ value, min, max, step }` or `{ value, options }`).
 * `type` picks a widget from `controlTypes` (core/params.ts) instead of inferring one from the
 * value; plugins register new types and may read their own hints from the descriptor.
 */
export interface Control {
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  type?: string;
  /** Folder this param sits in; ungrouped params share the panel's `Params` folder. */
  group?: string;
  /** Plugin control types may read their own hints from the descriptor. */
  [hint: string]: unknown;
}

/**
 * What `draw` may return. Nothing → the canvas is the artifact.
 * A file descriptor → that file is the artifact. An array → several files ("layers").
 */
export interface FileLayer {
  data: string | Blob | ArrayBuffer | HTMLCanvasElement;
  extension: string;
  suffix?: string;
}
export type Layer = HTMLCanvasElement | FileLayer;
export type DrawResult = void | Layer | Layer[];

/**
 * A sketch's exports. `P` is the renderer object `draw` receives: `CanvasRenderingContext2D` for
 * canvas2d, `p5` for p5/p5-webgl; a plugin renderer names its own (`SketchModule<THREE.Scene>`).
 */
export interface SketchModule<P = any> {
  config?: SketchConfig;
  params?: SketchParams;
  load?: (p: P, api: Api) => Promise<void> | void;
  setup?: (p: P, api: Api) => void;
  /** May be async; the host awaits it before reading the canvas, so an export never catches a half-drawn frame. */
  draw: (p: P, t: number, api: Api) => DrawResult | Promise<DrawResult>;
  dispose?: (p: P, api: Api) => void;
}

export interface ApiBackend {
  random(min?: number, max?: number): number;
  noise(x: number, y?: number, z?: number): number;
  randomSeed(seed: number): void;
  noiseSeed(seed: number): void;
}

/** The window of the design the current canvas shows, in design pixels. The whole artwork unless an exporter tiles it. */
export interface Tile {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Api {
  /** `params.seed` (0 when the sketch has none). Constant across frames: `random()` gives the same layout on every frame. */
  seed: number;
  /** 0 … frames-1. Stills are always frame 0. */
  frame: number;
  /** `config.fps` for animations, 0 for stills. */
  fps: number;
  /** `round(fps × duration)` for animations, 1 for stills. */
  frames: number;
  /** Seconds into the loop: `frame / fps`. 0 for stills. */
  readonly time: number;
  /** Device pixels per design pixel: `size.resolution` on export, the fit ratio on screen. The host applies it. */
  scale: number;
  /** Design size (`size.width/height`), not canvas pixels. Never changes with resolution. */
  width: number;
  height: number;
  /**
   * What this canvas covers, in design pixels: `{ 0, 0, width, height }` on screen and in a normal export.
   * A tiled exporter sets a sub-rectangle per tile; 2D renderers translate by it, cameras read it.
   */
  tile: Tile;
  /** True while rendering for a file, false on screen. Use it to hide guides. */
  exporting: boolean;
  random(min?: number, max?: number): number;
  noise(x: number, y?: number, z?: number): number;
  randomSeed(seed: number): void;
  noiseSeed(seed: number): void;
  setBackend(backend: ApiBackend): void;
}

export interface Renderer {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  setup(): Promise<void> | void;
  /** May be async (p5 2.x `redraw` is); callers await it before reading the canvas. */
  draw(t: number): DrawResult | Promise<DrawResult>;
  resize(width: number, height: number): void;
  dispose(): void;
  /**
   * State the library keeps inside its own instance and the user changed on screen (a camera after
   * `orbitControl()`, the mouse position). JSON-able and size-independent, so the export renderer can
   * `setView` it after `setup` and the file shows what the preview showed. Renderers without such state omit both.
   */
  getView?(): unknown;
  setView?(view: unknown): void;
}

export interface RendererFactoryOptions {
  container: HTMLElement;
  width: number;
  height: number;
  config: SketchConfig;
  params: SketchParams;
  api: Api;
  load?: SketchModule['load'];
  setup?: SketchModule['setup'];
  draw: SketchModule['draw'];
  dispose?: SketchModule['dispose'];
}

export type RendererFactory = (opts: RendererFactoryOptions) => Renderer;

export interface ExporterFactoryOptions {
  sketch: LoadedSketch;
  onStatus: (text: string) => void;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  /** The preview renderer's `getView()` at the moment of export; hand it to `makeExportRenderer` so the file matches the screen. */
  view?: unknown;
}

/** Resolves to the files it wrote (paths under `sketches/`) so `hooks.exported` can see them; `void` is fine too. */
export type ExporterFactory = (opts: ExporterFactoryOptions) => Promise<void | string[]>;

export interface VersionInfo {
  id: string;
  params: SketchParams;
  size?: Size;
  createdAt: string;
}

export interface LoadedSketch {
  name: string;
  entry: string;
  module: SketchModule;
  config: SketchConfig;
  /** Flat values; the descriptors declared in code are split into `controls` on load. */
  params: SketchParams;
  /** The flat values as the code declared them, frozen at load — before any version or plugin wrote into `params`. */
  defaults: Readonly<SketchParams>;
  controls: Record<string, Control>;
  /** Live size; starts as `resolveSize(config.size)`, the Size panel writes into it. */
  size: Size;
  versions: VersionInfo[];
}
