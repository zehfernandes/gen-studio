import { SketchApi } from './api';
import { Sidebar } from './sidebar';
import { buildParamsGUI, updateParamsGUI } from './params';
import { Stage } from './stage';
import { listSketches, loadSketch, listVersions, saveVersion, deleteVersion } from './sketch';
import { exporters } from './export';
import { hooks, keys, TYPING } from './hooks';
import { resolveSize } from './size';
import type { Panel } from './params';
import type { LoadedSketch, Size } from './types';

const THUMB_WIDTH = 320;

export class App {
  root: HTMLElement;
  statusEl: HTMLElement;
  sidebar: Sidebar;
  stage: Stage;
  paramsContainer: HTMLElement;
  api: SketchApi;

  sketch?: LoadedSketch;
  sketches: { name: string; entry: string }[] = [];
  gui?: Panel;
  abortExport?: AbortController;

  private sketchLoadId = 0;
  private versionLoadId = 0;
  private statusTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'gen-studio';
    document.body.appendChild(this.root);

    this.statusEl = document.createElement('div');
    this.statusEl.id = 'status';
    this.statusEl.setAttribute('role', 'status');
    this.statusEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(this.statusEl);

    this.api = new SketchApi();

    this.sidebar = new Sidebar(this.root, {
      onSelect: (name) => this.loadSketch(name),
      onLoadVersion: (id) => this.loadVersion(id),
      onDeleteVersion: (id) => this.deleteVersion(id),
    });

    this.stage = new Stage(this.root, this.api);
    this.stage.onRecover = () => this.setStatus('');
    this.stage.onError = (err) => this.setStatus(`Sketch error: ${err instanceof Error ? err.message : err}`);
    this.stage.onInputEnd = () => updateParamsGUI(this.gui);

    this.paramsContainer = document.createElement('div');
    this.paramsContainer.id = 'params';
    this.root.appendChild(this.paramsContainer);

    this.bindKeyboard();
    this.init();
  }

  private async init() {
    try {
      this.sketches = await listSketches();
      const hash = new URLSearchParams(location.hash.slice(1));
      await this.loadSketch(hash.get('s') || (this.sketches[0]?.name ?? 'example-canvas2d'), hash.get('v'));
    } catch (err) {
      console.error('[gen-studio] failed to initialize:', err);
      this.setStatus(`Failed to load sketches: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** A sketch that fails to import (syntax error, missing `draw`) reports itself here; the app keeps running. */
  async loadSketch(name: string, versionId?: string | null) {
    const loadId = ++this.sketchLoadId;
    let sketch: LoadedSketch;
    try {
      sketch = await loadSketch(name);
    } catch (err) {
      if (loadId !== this.sketchLoadId) return;
      console.error('[gen-studio] failed to load sketch:', err);
      this.sidebar.setSketches(this.sketches, name);
      return this.setStatus(`${name}: ${err instanceof Error ? err.message : err}`);
    }
    if (loadId !== this.sketchLoadId) return;
    this.sketch = sketch;

    const version = versionId ? sketch.versions.find((x) => x.id === versionId) : undefined;
    if (version) {
      Object.assign(sketch.params, version.params);
      if (version.size) Object.assign(sketch.size, version.size);
    }

    this.sidebar.setSketches(this.sketches, name);
    this.sidebar.setVersions(sketch.versions, version?.id ?? null, name);

    this.buildParamsGUI();
    this.setStatus('');
    if (!(await this.loadStage()) || loadId !== this.sketchLoadId) return;
    this.updateHash(version?.id);
  }

  private async loadStage(): Promise<boolean> {
    const sketch = this.sketch;
    if (!sketch) return false;
    try {
      if (!(await this.stage.load(sketch)) || this.sketch !== sketch) return false;
    } catch (err) {
      if (this.sketch !== sketch) return false;
      console.error('[gen-studio] failed to start sketch:', err);
      this.setStatus(`${sketch.name}: ${err instanceof Error ? err.message : err}`);
      return false;
    }
    for (const fn of hooks.load) this.runHook(() => fn(sketch, this));
    return true;
  }

  /** `R`: a new random seed, the most common "show me another one". Redraws and refreshes the panel. */
  reseed() {
    if (!this.sketch) return;
    if (!('seed' in this.sketch.params)) return this.setStatus('No `seed` in params — add `seed: 1` to use R');
    // Not in the render path: the seed is a param like any other and goes into versions and sidecars.
    this.sketch.params.seed = Math.floor(Math.random() * 1e6);
    this.paramsChanged();
  }

  /** `←` / `→`: pause and show the frame `delta` away. Wraps around the loop. */
  step(delta: number) {
    const { totalFrames, frame } = this.stage;
    if (totalFrames <= 1) return;
    this.stage.pause();
    this.stage.seek((((frame + delta) % totalFrames) + totalFrames) % totalFrames);
  }

  /** A throwing plugin reports itself and the app keeps going, like a throwing sketch. */
  private runHook(fn: () => void) {
    try {
      fn();
    } catch (err) {
      console.error('[gen-studio] plugin hook failed:', err);
      this.setStatus(`Plugin error: ${err instanceof Error ? err.message : err}`);
    }
  }

  private buildParamsGUI() {
    const sketch = this.sketch;
    if (!sketch) return;
    // dialkit controls hold listeners; drop the old panel before its container is emptied.
    this.gui?.destroy();
    const hasAnim = !!(sketch.config.fps && sketch.config.duration);
    const auto = this.autoRender();
    const gui = buildParamsGUI(this.paramsContainer, sketch, auto ? () => this.stage.renderOnce() : () => {}, {
      save: () => this.saveVersion(),
      export: () => this.export(),
      size: () => this.setSize(),
      playPause: hasAnim ? () => this.stage.toggle() : undefined,
      render: auto ? undefined : () => this.stage.renderOnce(),
    });
    this.gui = gui;
    for (const fn of hooks.panel) this.runHook(() => fn(gui, sketch, this));
  }

  /** Params changed from outside the panel (a plugin, MIDI, a file): refresh the widgets and redraw. */
  paramsChanged() {
    updateParamsGUI(this.gui);
    if (this.autoRender()) this.stage.renderOnce();
  }

  /** `config.autoRender === false`: heavy sketches redraw only via the Render button / Enter. */
  private autoRender() {
    return this.sketch?.config.autoRender !== false;
  }

  /** `sketch.size` changed: rerun load/setup so anything cached from api.width/height is rebuilt. */
  async setSize(size?: Size) {
    if (!this.sketch) return false;
    if (size) Object.assign(this.sketch.size, size);
    updateParamsGUI(this.gui);
    return this.loadStage();
  }

  async saveVersion() {
    const sketch = this.sketch;
    const renderer = this.stage.renderer;
    if (!sketch || !renderer) return;
    this.setStatus('Saving...');
    try {
      const thumb = thumbnail(renderer.canvas);
      const id = await saveVersion(sketch.name, sketch.params, sketch.size, thumb);
      sketch.versions = await listVersions(sketch.name);
      if (this.sketch !== sketch) return;
      this.sidebar.setVersions(sketch.versions, id, sketch.name);
      this.updateHash(id);
      this.setStatus('Saved');
      this.clearStatusAfter(900);
    } catch (err) {
      console.error('[gen-studio] failed to save version:', err);
      this.setStatus(`Save failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async loadVersion(id: string) {
    const sketch = this.sketch;
    if (!sketch) return;
    const loadId = ++this.versionLoadId;
    const v = sketch.versions.find((x) => x.id === id);
    if (!v) return;
    Object.assign(sketch.params, v.params);
    const size = v.size ?? resolveSize(sketch.config.size);
    if (sameSize(size, sketch.size)) this.paramsChanged();
    else await this.setSize(size);
    if (loadId !== this.versionLoadId || this.sketch !== sketch) return;
    this.sidebar.setActiveVersion(id);
    this.updateHash(id);
  }

  private async deleteVersion(id: string) {
    const sketch = this.sketch;
    if (!sketch) return;
    try {
      await deleteVersion(sketch.name, id);
      sketch.versions = sketch.versions.filter((v) => v.id !== id);
      if (this.sketch !== sketch) return;
      this.sidebar.setVersions(sketch.versions, null, sketch.name);
      this.updateHash();
    } catch (err) {
      console.error('[gen-studio] failed to delete version:', err);
      this.setStatus(`Delete failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // One action: animated sketches become a video, everything else a still. Plugins pass any `exporters` key.
  async export(name?: string) {
    const sketch = this.sketch;
    if (!sketch || this.abortExport) return;
    const hasAnim = !!(sketch.config.fps && sketch.config.duration);
    const exporter = exporters[name ?? (hasAnim ? 'mp4' : 'still')];
    if (!exporter) return this.setStatus(`Unknown exporter: ${name}`);
    const wasPlaying = this.stage.playing;
    const frame = this.stage.frame;
    const controller = (this.abortExport = new AbortController());
    this.stage.pause();
    this.setInputEnabled(false);
    let failed = false;
    try {
      const files = await exporter({
        sketch,
        onStatus: (t) => this.setStatus(t),
        // The stage follows the export so the preview shows the frame being written.
        onProgress: (done, total) => {
          this.stage.seek(done - 1);
          this.setStatus(`Exporting ${done}/${total}`);
        },
        signal: controller.signal,
        // What the user did to the preview instance itself (orbit, mouse): the file should show it too.
        view: this.stage.renderer?.getView?.(),
      });
      this.notifyExported(files, sketch);
    } catch (err) {
      failed = true;
      console.error('[gen-studio] export failed:', err);
      this.setStatus(`Export failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.finishExport(controller, wasPlaying, frame, failed);
    }
  }

  private notifyExported(files: void | string[], sketch: LoadedSketch) {
    if (!Array.isArray(files) || !files.length) return;
    for (const fn of hooks.exported) this.runHook(() => fn(files, sketch, this));
  }

  private finishExport(controller: AbortController, wasPlaying: boolean, frame: number, failed: boolean) {
    this.stage.seek(frame);
    if (wasPlaying) this.stage.play();
    if (this.abortExport === controller) this.abortExport = undefined;
    this.setInputEnabled(true);
    this.clearStatusAfter(failed ? 8000 : 2000);
  }

  setStatus(text: string) {
    if (this.statusTimer) clearTimeout(this.statusTimer);
    this.statusTimer = undefined;
    this.statusEl.textContent = text;
    this.statusEl.style.opacity = text ? '1' : '0';
  }

  private clearStatusAfter(delay: number) {
    this.statusTimer = setTimeout(() => {
      this.statusTimer = undefined;
      this.setStatus('');
    }, delay);
  }

  private setInputEnabled(enabled: boolean) {
    this.stage.acceptInput = enabled;
    this.sidebar.el.inert = !enabled;
    this.paramsContainer.inert = !enabled;
    this.stage.container.inert = !enabled;
  }

  /** Owns `s` and `v`; any other key a plugin put in the hash is kept, so plugin state can ride along with the URL. */
  private updateHash(versionId?: string) {
    if (!this.sketch) return;
    const hash = new URLSearchParams(location.hash.slice(1));
    hash.set('s', this.sketch.name);
    if (versionId) hash.set('v', versionId);
    else hash.delete('v');
    location.hash = hash.toString();
  }

  private bindKeyboard() {
    const blockDuringExport = (e: Event) => {
      if (!this.abortExport) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e instanceof KeyboardEvent && e.type === 'keydown' && e.key === 'Escape') this.abortExport.abort();
    };
    for (const type of ['keydown', 'keyup', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'mousedown', 'mousemove', 'mouseup', 'touchstart', 'touchmove', 'touchend', 'wheel']) {
      window.addEventListener(type, blockDuringExport, { capture: true, passive: false });
    }

    window.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest(TYPING) || e.metaKey || e.ctrlKey || e.altKey) return;
      const action = keys[e.key.length === 1 ? e.key.toLowerCase() : e.key];
      if (!action) return;
      e.preventDefault();
      action(this);
      if (this.abortExport) e.stopImmediatePropagation();
    });

    window.addEventListener('resize', () => this.stage.resize());
  }
}

function sameSize(a: Size, b: Size) {
  return a.width === b.width && a.height === b.height && a.resolution === b.resolution;
}

// Preview canvases are retina-sized now; keep committed thumbs small.
function thumbnail(source: HTMLCanvasElement) {
  const scale = Math.min(1, THUMB_WIDTH / source.width);
  if (scale === 1) return source.toDataURL('image/png');
  const c = document.createElement('canvas');
  c.width = Math.round(source.width * scale);
  c.height = Math.round(source.height * scale);
  c.getContext('2d')!.drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}
