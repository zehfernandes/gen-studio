import { resolveSize, presets } from './size';
import { renderers } from './renderers';
import { sketchControls } from './controls';
import { validate } from './validate';
import type { LoadedSketch, Size, SketchConfig, SketchModule, SketchParams, VersionInfo } from './types';

export async function listSketches(): Promise<{ name: string; entry: string }[]> {
  const res = await fetch('/api/sketches');
  if (!res.ok) throw new Error('Failed to list sketches');
  return (await res.json()).sketches;
}

export async function listVersions(name: string): Promise<VersionInfo[]> {
  const res = await fetch(`/api/sketches/${encodeURIComponent(name)}/versions`);
  if (!res.ok) throw new Error('Failed to list versions');
  return (await res.json()).versions;
}

export async function loadSketch(name: string): Promise<LoadedSketch> {
  const [sketches, versions] = await Promise.all([
    listSketches(),
    listVersions(name).catch(() => []),
  ]);

  const meta = sketches.find((s) => s.name === name);
  if (!meta) throw new Error(`Sketch not found: ${name}`);

  const mod: SketchModule = await import(/* @vite-ignore */ `/sketches/${encodeURIComponent(name)}/${encodeURIComponent(meta.entry)}`);
  validate(mod, meta.entry, { renderers: Object.keys(renderers), presets: Object.keys(presets) });

  const config: SketchConfig = mod.config || {};
  const params: SketchParams = mod.params || {};
  const { controls, defaults } = sketchControls(mod, params);

  return {
    name,
    entry: meta.entry,
    module: mod,
    config,
    params,
    defaults,
    controls,
    // Code is the source: config.size, else the default. Panel changes last for the session (versions remember theirs).
    size: resolveSize(config.size),
    versions,
  };
}

export async function saveVersion(name: string, params: SketchParams, size: Size, thumb: string): Promise<string> {
  const res = await fetch(`/api/sketches/${encodeURIComponent(name)}/versions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ params, size, thumb }),
  });
  if (!res.ok) throw new Error('Failed to save version');
  return (await res.json()).id;
}

export async function deleteVersion(name: string, id: string): Promise<void> {
  const res = await fetch(`/api/sketches/${encodeURIComponent(name)}/versions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete version');
}
