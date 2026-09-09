import type { Panel } from './params';
import type { App } from './app';
import type { LoadedSketch } from './types';

/**
 * Where plugins meet the running app. Everything here is a plain object mutated at import time
 * (`plugins/index.ts` runs before `new App()`); the app reads it later.
 */

/**
 * Keyboard map: `e.key` (letters lowercased) → action. Core's defaults live here too, so a plugin
 * can add a key (`keys.b = (app) => app.export('batch')`) or rebind one (`keys.e = ...`).
 * Fired only without modifiers and outside inputs/the panel.
 */
export const keys: Record<string, (app: App) => void> = {
  s: (app) => app.saveVersion(),
  e: (app) => app.export(),
  r: (app) => app.reseed(),
  Escape: (app) => app.abortExport?.abort(),
  ' ': (app) => app.stage.toggle(),
  g: (app) => app.paramsContainer.classList.toggle('hidden'),
  Enter: (app) => app.stage.renderOnce(),
  ArrowLeft: (app) => app.step(-1),
  ArrowRight: (app) => app.step(1),
};

/**
 * A key event whose target matches this is the panel's, not the sketch's: the user is typing in a
 * field or working a control. Used by the app's shortcuts and by the p5 renderer, which would
 * otherwise hear every keystroke — p5 binds `keydown`/`keyup` to `window`.
 */
export const TYPING = 'input, textarea, select, button, [contenteditable], .dialkit-root';

/**
 * The key bound to an action, for button labels: `keyFor('app.export()')` → `'E'`. Matches the handler's
 * source text (whitespace ignored), so a plugin that rebinds `keys.e` and binds `keys.x` to export is reflected.
 */
export function keyFor(action: string): string | undefined {
  const source = (k: string) => keys[k].toString().replace(/\s/g, '');
  const key = Object.keys(keys).find((k) => source(k).includes(action.replace(/\s/g, '')));
  if (!key) return;
  return key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key;
}

export const hooks = {
  /** After a sketch (or a new size for it) is loaded into the stage. */
  load: [] as ((sketch: LoadedSketch, app: App) => void)[],
  /** After the params panel is built; add sections and controls here. Rebuilt on every sketch load. */
  panel: [] as ((panel: Panel, sketch: LoadedSketch, app: App) => void)[],
  /** After an exporter wrote its files. `files` are paths under `sketches/` (`<sketch>/exports/<file>`). */
  exported: [] as ((files: string[], sketch: LoadedSketch, app: App) => void)[],
};
