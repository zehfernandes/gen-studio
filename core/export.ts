import { SketchApi } from './api';
import { renderers } from './renderers';
import { outputPixels, matchPreset } from './size';
import { timestamp, toLayers, layerFileName, isCanvas } from './files';
import { loopT, frameCount } from './timing';

export { frameCount };
import type { ExporterFactory, FileLayer, LoadedSketch, Renderer } from './types';

// Everything an export writes lands in sketches/<name>/exports/ (gitignored).
export const EXPORTS_DIR = 'exports';

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas.toBlob failed'));
    }, 'image/png');
  });
}

export async function layerToBlob(layer: FileLayer): Promise<Blob> {
  const { data } = layer;
  if (isCanvas(data)) return canvasToBlob(data);
  if (data instanceof Blob) return data;
  if (typeof data === 'string') return new Blob([data], { type: 'text/plain' });
  return new Blob([data]);
}

/** Writes a file under `sketches/`; `relPath` is `<sketch>/exports/<file>`. */
export async function postFile(relPath: string, blob: Blob, signal?: AbortSignal): Promise<void> {
  const res = await fetch('/api/files/' + encodeURIComponent(relPath), {
    method: 'POST',
    body: blob,
    signal,
  });
  if (!res.ok) throw new Error(`Failed to write ${relPath}: ${res.status}`);
}

async function postJson(url: string, body?: unknown, signal?: AbortSignal): Promise<any> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error((await res.text()) || `${url}: ${res.status}`);
  return res.json();
}

/** Reproducibility record written next to every export. */
export function sidecar(sketch: LoadedSketch, extra: Record<string, unknown> = {}) {
  const body = {
    sketch: sketch.name,
    createdAt: new Date().toISOString(),
    seed: sketch.params.seed ?? null,
    size: sketch.size,
    pixels: outputPixels(sketch.size),
    preset: matchPreset(sketch.size) ?? null,
    fps: sketch.config.fps ?? null,
    duration: sketch.config.duration ?? null,
    params: sketch.params,
    ...extra,
  };
  return new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' });
}

/** `<sketch>.<stamp>` — short on purpose; params live in the sidecar `.json` next to it. */
export function exportName(sketch: LoadedSketch) {
  return `${sketch.name}.${timestamp()}`;
}

/**
 * A canvas the browser gave up on looks exactly like a finished one: the GPU drops it (out of memory at
 * print sizes, ~33 MP for WebGL in Chrome), the context comes back blank a moment later, and `toBlob`
 * happily encodes transparent pixels. Catch that here so a blank export is an error, not a file.
 */
function checkCanvas(canvas: HTMLCanvasElement, lost: boolean) {
  const mp = ((canvas.width * canvas.height) / 1e6).toFixed(0);
  const hint = `${canvas.width}×${canvas.height} (${mp} MP) is over this GPU's limit. Lower size.resolution, or add the add-tiled-export skill.`;
  const ctx2d = canvas.getContext('2d') as (CanvasRenderingContext2D & { isContextLost?: () => boolean }) | null;
  if (lost || ctx2d?.isContextLost?.()) throw new Error(`Canvas lost: ${hint}`);
  const gl = ctx2d ? null : ((canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext | null);
  if (gl?.isContextLost()) throw new Error(`WebGL context lost: ${hint}`);
  if (gl && (gl.drawingBufferWidth < canvas.width || gl.drawingBufferHeight < canvas.height)) {
    throw new Error(`WebGL buffer clamped to ${gl.drawingBufferWidth}×${gl.drawingBufferHeight}: ${hint}`);
  }
}

/**
 * Hidden renderer at `size.resolution`: the file is exactly `outputPixels(size)`. The building block for
 * every exporter, core or plugin: `drawFrame(frame, t)` returns the layers to write; call `dispose()` when done.
 * `pixels` overrides the canvas size for exporters that render the artwork in pieces (set `api.tile` per draw).
 * `view` is the preview renderer's `getView()` (passed to exporters as `opts.view`): applied after `setup`, it
 * makes the hidden instance see the camera/mouse state the user left on screen.
 */
export async function makeExportRenderer(sketch: LoadedSketch, pixels = outputPixels(sketch.size), view?: unknown) {
  const factory = renderers[sketch.config.renderer || 'canvas2d'];
  if (!factory) throw new Error(`Unknown renderer: ${sketch.config.renderer}`);

  const { width, height } = pixels;
  const api = new SketchApi();
  api.seed = sketch.params.seed ?? 0;
  api.frame = 0;
  const { fps, frames, animated } = frameCount(sketch);
  api.fps = animated ? fps : 0;
  api.frames = frames;
  api.scale = sketch.size.resolution;
  api.setSize(sketch.size.width, sketch.size.height);
  api.exporting = true;

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  document.body.appendChild(container);

  let renderer: Renderer;
  try {
    renderer = factory({
      container,
      width,
      height,
      config: sketch.config,
      params: sketch.params,
      api,
      load: sketch.module.load,
      setup: sketch.module.setup,
      draw: sketch.module.draw,
      dispose: sketch.module.dispose,
    });
  } catch (err) {
    container.remove();
    throw err;
  }

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    try {
      renderer.dispose();
    } catch (err) {
      console.error('[gen-studio] renderer cleanup failed:', err);
    } finally {
      container.remove();
    }
  };

  try {
    await renderer.setup();
    if (view !== undefined) renderer.setView?.(view);
  } catch (err) {
    try {
      dispose();
    } catch {}
    throw err;
  }

  // Chrome restores a lost 2D context within milliseconds, so remember that it happened at all.
  let lost = false;
  for (const type of ['contextlost', 'webglcontextlost']) renderer.canvas.addEventListener(type, () => (lost = true));

  const drawFrame = async (frame: number, t: number) => {
    api.frame = frame;
    api.randomSeed(api.seed);
    api.noiseSeed(api.seed);
    const result = await renderer.draw(t);
    checkCanvas(renderer.canvas, lost);
    return toLayers(result, renderer.canvas);
  };

  return { renderer, api, drawFrame, dispose };
}

const still: ExporterFactory = async ({ sketch, onStatus, signal, view }) => {
  onStatus('Preparing still export...');
  if (signal?.aborted) return onStatus('Still export cancelled');
  const { drawFrame, dispose } = await makeExportRenderer(sketch, undefined, view);

  try {
    const base = exportName(sketch);
    const layers = await drawFrame(0, 0);
    const dir = `${sketch.name}/${EXPORTS_DIR}`;
    const files: string[] = [];

    for (let i = 0; i < layers.length; i++) {
      if (signal?.aborted) return onStatus('Still export cancelled');
      const file = `${dir}/${layerFileName(base, layers[i], i, layers.length)}`;
      await postFile(file, await layerToBlob(layers[i]), signal);
      files.push(file);
    }
    if (signal?.aborted) return onStatus('Still export cancelled');
    await postFile(`${dir}/${base}.json`, sidecar(sketch, { view }), signal);

    onStatus(files.length === 1 ? `Saved ${files[0]}` : `Saved ${files.length} files to ${dir}/${base}.*`);
    return [...files, `${dir}/${base}.json`];
  } catch (err) {
    if (signal?.aborted) return onStatus('Still export cancelled');
    throw err;
  } finally {
    dispose();
  }
};

const mp4: ExporterFactory = async ({ sketch, onStatus, onProgress, signal, view }) => {
  const { fps, frames } = frameCount(sketch);
  onStatus(`Preparing ${frames}-frame video...`);
  if (signal?.aborted) return onStatus('Video export cancelled');
  const { drawFrame, dispose } = await makeExportRenderer(sketch, undefined, view);

  let jobId: string | null = null;
  try {
    const base = exportName(sketch);
    const dir = `${sketch.name}/${EXPORTS_DIR}`;
    const file = `${EXPORTS_DIR}/${base}.mp4`;

    ({ id: jobId } = await postJson(`/api/sketches/${encodeURIComponent(sketch.name)}/video`, { file, fps }));

    for (let i = 0; i < frames; i++) {
      if (signal?.aborted) break;

      const layers = await drawFrame(i, loopT(i, frames));
      const png = layers.find((l) => isCanvas(l.data));
      if (!png) throw new Error('Video export needs a canvas layer');

      const res = await fetch(`/api/video/${jobId}/frame`, { method: 'POST', body: await layerToBlob(png), signal });
      if (!res.ok) throw new Error(await res.text());

      onProgress?.(i + 1, frames);
    }

    if (signal?.aborted) {
      await postJson(`/api/video/${jobId}/abort`);
      jobId = null;
      onStatus('Video export cancelled');
      return;
    }

    onStatus('Encoding...');
    await postJson(`/api/video/${jobId}/end`, undefined, signal);
    jobId = null;
    await postFile(`${dir}/${base}.json`, sidecar(sketch, { frames, fps, view }), signal);
    onStatus(`Saved sketches/${dir}/${base}.mp4`);
    return [`${dir}/${base}.mp4`, `${dir}/${base}.json`];
  } catch (err) {
    if (jobId) await postJson(`/api/video/${jobId}/abort`).catch(() => {});
    if (signal?.aborted) return onStatus('Video export cancelled');
    throw err;
  } finally {
    dispose();
  }
};

export const exporters: Record<string, ExporterFactory> = { still, mp4 };
