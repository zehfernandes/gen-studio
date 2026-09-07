import { SketchApi } from './api';
import { renderers } from './renderers';
import { fitPixels } from './size';
import { frameAt, frameCount, loopT } from './timing';
import type { LoadedSketch, Renderer } from './types';

// Seconds the preview keeps redrawing after the last input event.
const INPUT_SETTLE = 0.5;

export class Stage {
  container: HTMLElement;
  api: SketchApi;
  renderer?: Renderer;
  sketch?: LoadedSketch;

  playing = false;
  frame = 0;
  totalFrames = 1;
  fps = 30;
  raf = 0;
  dirty = true;
  onRecover?: () => void;
  onError?: (err: unknown) => void;
  /** Once input has been quiet for `INPUT_SETTLE` seconds: a sketch may have written `params` during the gesture. */
  onInputEnd?: () => void;
  /** False while exporting: the preview shares `params` with the export renderer, so a drag would leak into frames. */
  acceptInput = true;

  // Wall-clock origin of the loop; frame = floor((now - startTime) * fps).
  private startTime = 0;
  private lastError = '';
  private drawing = false;
  // Wall-clock time until which input keeps the preview redrawing; 0 when idle.
  private inputUntil = 0;
  private loadId = 0;

  constructor(parent: HTMLElement, api: SketchApi) {
    this.container = document.createElement('div');
    this.container.id = 'stage';
    parent.appendChild(this.container);
    this.api = api;

    // Renderers track input themselves (p5 listens on window); the host only has to redraw while it
    // happens, since a still sketch is otherwise drawn once and left alone.
    const input = (e: Event) => this.onInput(e);
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'wheel']) this.container.addEventListener(type, input);
    for (const type of ['keydown', 'keyup']) window.addEventListener(type, input);
  }

  private onInput(e: Event) {
    if (!this.renderer || !this.sketch || !this.acceptInput) return;
    if ((e.target as HTMLElement | null)?.closest?.('input, textarea, .lil-gui')) return;
    // `autoRender: false` means "only on Render/Enter", for input as well as for slider edits.
    if (this.sketch.config.autoRender === false) return;
    // Keep drawing a little past the last event: p5's orbitControl eases out over frames, and a
    // frozen tail would resume on the next unrelated input.
    this.inputUntil = performance.now() / 1000 + INPUT_SETTLE;
  }

  /** Called from the RAF loop: redraw while input is live, then tell the app once it settles. */
  private tickInput(now: number) {
    if (!this.inputUntil) return;
    if (now < this.inputUntil) {
      this.dirty = true;
      return;
    }
    this.inputUntil = 0;
    this.onInputEnd?.();
  }

  async load(sketch: LoadedSketch): Promise<boolean> {
    const loadId = ++this.loadId;
    this.disposeRenderer();
    this.sketch = sketch;

    const canvas = this.fit();
    const factory = renderers[sketch.config.renderer || 'canvas2d'];
    if (!factory) throw new Error(`Unknown renderer: ${sketch.config.renderer}`);

    this.api.seed = sketch.params.seed ?? 0;
    this.api.frame = 0;
    this.api.scale = canvas.width / sketch.size.width;
    this.api.setSize(sketch.size.width, sketch.size.height);
    this.api.exporting = false;

    const renderer = factory({
      container: this.container,
      width: canvas.width,
      height: canvas.height,
      config: sketch.config,
      params: sketch.params,
      api: this.api,
      load: sketch.module.load,
      setup: sketch.module.setup,
      draw: sketch.module.draw,
      dispose: sketch.module.dispose,
    });
    this.renderer = renderer;

    try {
      await renderer.setup();
    } catch (err) {
      if (loadId !== this.loadId || this.renderer !== renderer) return false;
      this.disposeRenderer();
      throw err;
    }
    if (loadId !== this.loadId || this.renderer !== renderer) return false;

    const { fps, frames, animated } = frameCount(sketch);
    this.fps = fps;
    this.totalFrames = frames;
    this.playing = animated;
    this.api.fps = animated ? fps : 0;
    this.api.frames = frames;
    this.frame = 0;
    this.startTime = performance.now() / 1000;
    this.dirty = true;
    this.loop();
    return true;
  }

  renderOnce() {
    this.dirty = true;
    this.render();
  }

  /** Show one frame while paused (export progress, scrubbing). */
  seek(frame: number) {
    this.frame = Math.max(0, Math.min(this.totalFrames - 1, frame));
    if (this.playing) this.startTime = performance.now() / 1000 - this.frame / this.fps;
    this.renderOnce();
  }

  private render() {
    if (!this.renderer || !this.dirty || !this.sketch || this.drawing) return;

    const renderer = this.renderer;
    const loadId = this.loadId;
    const active = () => loadId === this.loadId && this.renderer === renderer;
    const { size } = this.sketch;
    this.api.frame = this.frame;
    this.api.setSize(size.width, size.height);
    // Preview draws the design at whatever pixel size fits the stage; export uses size.resolution.
    this.api.scale = renderer.width / size.width;
    this.api.randomSeed(this.sketch.params.seed ?? 0);
    this.api.noiseSeed(this.sketch.params.seed ?? 0);

    const t = loopT(this.frame, this.totalFrames);
    this.dirty = false;
    // Fires once when a draw succeeds after an error, so the status bar can clear the message.
    const done = () => {
      if (!active()) return;
      if (this.lastError) this.onRecover?.();
      this.lastError = '';
    };
    try {
      const result = renderer.draw(t);
      // canvas2d draws synchronously; p5 returns a promise. Hold further frames until it settles
      // so a slow frame can't stack redraws (the RAF keeps ticking, `dirty` remembers the request).
      if (result instanceof Promise) {
        this.drawing = true;
        result
          .then(done, (err) => active() && this.reportError(err))
          .finally(() => {
            if (active()) this.drawing = false;
          });
      } else done();
    } catch (err) {
      if (active()) this.reportError(err);
    }
  }

  private reportError(err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === this.lastError) return;
    this.lastError = message;
    console.error('[gen-studio] sketch error:', err);
    this.onError?.(err);
  }

  private loop() {
    if (this.raf) cancelAnimationFrame(this.raf);

    const step = () => {
      // Always re-arm first so a throwing draw() can never stop the loop.
      this.raf = requestAnimationFrame(step);
      const now = performance.now() / 1000;
      if (this.playing) {
        const next = frameAt(now - this.startTime, this.fps, this.totalFrames);
        if (next !== this.frame) {
          this.frame = next;
          this.dirty = true;
        }
      }
      this.tickInput(now);
      this.render();
    };

    this.raf = requestAnimationFrame(step);
  }

  play() {
    if (this.playing) return;
    this.startTime = performance.now() / 1000 - this.frame / this.fps;
    this.playing = true;
  }

  pause() {
    this.playing = false;
  }

  toggle() {
    if (this.totalFrames <= 1) return;
    if (this.playing) this.pause();
    else this.play();
  }

  /** Canvas pixels for the current stage box: sharp at devicePixelRatio, never above the export size. */
  private fit() {
    if (!this.sketch) return { width: 1, height: 1 };
    return fitPixels(this.sketch.size, this.container.clientWidth, this.container.clientHeight, window.devicePixelRatio || 1);
  }

  resize() {
    if (!this.renderer || !this.sketch) return;
    const size = this.fit();
    if (this.renderer.width !== size.width || this.renderer.height !== size.height) {
      this.renderer.resize(size.width, size.height);
      this.dirty = true;
    }
  }

  private disposeRenderer() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.renderer) {
      try {
        this.renderer.dispose();
      } catch (err) {
        this.reportError(err);
      }
      this.renderer = undefined;
    }
    this.drawing = false;
    this.container.innerHTML = '';
  }
}
