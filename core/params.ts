import GUI, { Controller } from 'lil-gui';
import { presets, matchPreset } from './size';
import { keyFor } from './hooks';
import type { Control, LoadedSketch, Size, SketchParams } from './types';

/**
 * Builds the widget for one param. Attach to `folder` (lil-gui) so `updateParamsGUI` refreshes it:
 * either return a `folder.add(...)` controller or subclass lil-gui's `Controller` for custom DOM.
 * Write the new value into `params[key]` and call `onChange()`.
 */
export type ControlFactory = (folder: GUI, params: SketchParams, key: string, control: Control, onChange: () => void) => unknown;

/**
 * Widget per `control.type`. Without an explicit type the value picks one (`inferType`).
 * Plugins add types (`controlTypes.wheel = ...`) or replace a default (`controlTypes.color = ...`).
 */
const plain: ControlFactory = (f, p, k, _c, on) => f.add(p, k).onChange(on);

/**
 * lil-gui turns wheel events over a slider into value changes unless its own root scrolls; ours is
 * `#params`, so scrolling the panel would edit whatever slider the pointer crossed. Stop the event
 * before lil-gui's listener (capture runs first at the target); the panel still scrolls natively.
 */
function noWheel<T extends Controller>(controller: T): T {
  (controller as any).$slider?.addEventListener('wheel', (e: Event) => e.stopImmediatePropagation(), { capture: true });
  return controller;
}

// lil-gui's implicit step for a bounded slider is (max - min) / 1000, so `{ value: 18, min: 3, max: 48 }`
// would hand the sketch 17.325. Whole-number bounds and value mean a whole-number slider.
const isInt = (n: unknown) => Number.isInteger(n);
const impliedStep = (value: unknown, c: Control) => c.step ?? (isInt(value) && isInt(c.min) && isInt(c.max) ? 1 : undefined);

export const controlTypes: Record<string, ControlFactory> = {
  select: (f, p, k, c, on) => f.add(p, k, c.options).onChange(on),
  number: (f, p, k, c, on) => noWheel(f.add(p, k, c.min, c.max, impliedStep(p[k], c))).onChange(on),
  color: (f, p, k, _c, on) => f.addColor(p, k).onChange(on),
  boolean: plain,
  string: plain,
};

function inferType(value: unknown, control?: Control): string | undefined {
  if (control?.options) return 'select';
  if (typeof value === 'string' && /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) return 'color';
  const t = typeof value;
  return t === 'number' || t === 'boolean' || t === 'string' ? t : undefined;
}

// Edits the live `size` in place, like params. Picking a preset fills width/height.
function addSizeFolder(gui: GUI, size: Size, onChange: () => void) {
  const folder = gui.addFolder('Size');
  const view = {
    get preset() {
      return matchPreset(size) ?? 'Custom';
    },
    set preset(name: string) {
      if (presets[name]) Object.assign(size, presets[name]);
    },
  };
  const refresh = () => folder.controllers.forEach((c) => c.updateDisplay());
  const changed = () => {
    refresh();
    onChange();
  };

  folder.add(view, 'preset', ['Custom', ...Object.keys(presets)]).onChange((name: string) => {
    if (presets[name]) changed();
  });
  folder.add(size, 'width').min(1).step(1).onFinishChange(changed);
  folder.add(size, 'height').min(1).step(1).onFinishChange(changed);
  noWheel(folder.add(size, 'resolution', 0.25, 4, 0.25)).onFinishChange(changed);
  refresh();
}

/**
 * `group: 'Palette'` in a param's hints nests it in a subfolder. Folders appear in the order their
 * first member is declared; ungrouped params stay directly under Params, in declaration order.
 */
function addControllers(gui: GUI, params: SketchParams, controls: Record<string, Control>, onChange: () => void) {
  const groups = new Map<string, GUI>();
  const folderFor = (name?: string) => {
    if (!name) return gui;
    let folder = groups.get(name);
    if (!folder) groups.set(name, (folder = gui.addFolder(name)));
    return folder;
  };

  for (const key of Object.keys(params)) {
    const control = controls[key] ?? {};
    const type = control.type ?? inferType(params[key], control);
    const factory = type && controlTypes[type];
    if (factory) factory(folderFor(control.group), params, key, control, onChange);
    else if (type) console.warn(`[gen-studio] param "${key}": unknown control type "${type}"`);
  }
}

export interface ParamsPanelActions {
  save: () => void;
  export: () => void;
  /** Called after the Size folder changed `sketch.size`. */
  size: () => void;
  playPause?: () => void;
  /** Present when `config.autoRender === false`: draws the current params on demand. */
  render?: () => void;
}

export function buildParamsGUI(
  container: HTMLElement,
  sketch: LoadedSketch,
  onChange: () => void,
  actions: ParamsPanelActions,
): GUI {
  const { params, config, controls, size } = sketch;
  container.innerHTML = '';
  const gui = new GUI({ container, autoPlace: false });
  gui.domElement.classList.add('gen-studio');

  // Labels carry the shortcut so the keys are discoverable without reading hooks.ts; plugins that rebind a key are reflected.
  const label = (text: string, action: string) => {
    const key = keyFor(action);
    return key ? `${text} (${key})` : text;
  };
  const render = gui.addFolder('Render');
  if (actions.render) render.add(actions, 'render').name(label('Render', 'app.stage.renderOnce()'));
  if (actions.playPause) render.add(actions, 'playPause').name(label('Play / Pause', 'app.stage.toggle()'));
  render.add(actions, 'export').name(label(config.fps && config.duration ? 'Export video' : 'Export print', 'app.export()'));
  render.add(actions, 'save').name(label('Save version', 'app.saveVersion()'));

  const paramsFolder = gui.addFolder('Params');
  addControllers(paramsFolder, params, controls, onChange);

  addSizeFolder(gui, size, actions.size);

  return gui;
}

/** Refresh every widget from `params`. Optional: a plugin may call it before the first panel exists. */
export function updateParamsGUI(gui?: GUI) {
  gui?.controllersRecursive().forEach((c: any) => c.updateDisplay());
}
