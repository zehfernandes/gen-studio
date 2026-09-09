import {
  mountButtonGroup,
  mountColorControl,
  mountFolder,
  mountSelectControl,
  mountSlider,
  mountTextControl,
  mountToggle,
} from 'dialkit/vanilla';
import { presets, matchPreset } from './size';
import { keyFor } from './hooks';
import type { Control, LoadedSketch, Size, SketchParams } from './types';

/**
 * A mounted widget. `update()` re-reads its value from `params` — dialkit's controls take their
 * full props again on every refresh, so a factory closes over the object and rebuilds them.
 */
export interface Mounted {
  update(): void;
  destroy(): void;
}

/**
 * Builds the widget for one param into `host` (a section body). Write the new value into
 * `params[key]` and call `onChange()`. dialkit's `mountSlider`/`mountToggle`/… are props-in,
 * `{ update, destroy }`-out: wrap one, or render your own DOM — a section is a plain element
 * inside `.dialkit-root`, so the theme's custom properties reach anything you put there.
 */
export type ControlFactory = (
  host: HTMLElement,
  params: SketchParams,
  key: string,
  control: Control,
  onChange: () => void,
) => Mounted;

const isInt = (n: unknown) => Number.isInteger(n);

/**
 * Whole-number bounds and value mean a whole-number slider: `{ value: 18, min: 3, max: 48 }`
 * without this hands the sketch 17.325. An explicit `step` always wins.
 */
const impliedStep = (value: unknown, c: Control) =>
  c.step ?? (isInt(value) && isInt(c.min) && isInt(c.max) ? 1 : (c.max! - c.min!) / 1000);

const slider: ControlFactory = (host, params, key, control, onChange) => {
  const step = impliedStep(params[key], control);
  const props = () => ({
    label: key,
    value: params[key] as number,
    min: control.min!,
    max: control.max!,
    step,
    onChange: (value: number) => {
      params[key] = value;
      onChange();
    },
  });
  const m = mountSlider(host, props());
  return { update: () => m.update(props()), destroy: () => m.destroy() };
};

const text: ControlFactory = (host, params, key, _control, onChange) => {
  const props = () => ({
    label: key,
    value: String(params[key]),
    onChange: (value: string) => {
      params[key] = value;
      onChange();
    },
  });
  const m = mountTextControl(host, props());
  return { update: () => m.update(props()), destroy: () => m.destroy() };
};

/**
 * A free numeric field, shaped like dialkit's editable slider value: mono, right-aligned, an
 * underline as the affordance. dialkit's only numeric widget is a slider and a bare `seed: 1` has
 * no bounds to give one, so this fills the gap — and unlike a text control it **commits on Enter
 * and on blur, not per keystroke**, so typing "1080" is one change and not four.
 *
 * `min`/`max`/`step` are honoured when the param declares them (a lone bound lands here, since the
 * slider needs both). Arrow keys step by `step`, or by the value's own precision, ×10 with Shift —
 * the same convention as dialkit's slider.
 */
const numberField: ControlFactory = (host, params, key, control, onChange) => {
  const row = document.createElement('div');
  row.className = 'gen-number';
  const label = document.createElement('span');
  label.className = 'gen-number-label';
  label.textContent = key;
  const input = document.createElement('input');
  input.className = 'gen-number-input';
  input.inputMode = 'decimal';
  input.spellcheck = false;
  input.setAttribute('aria-label', key);
  row.append(label, input);
  host.append(row);

  const show = () => (input.value = String(params[key]));

  const norm = (n: number) => {
    const step = control.step;
    const snapped = step && step > 0 ? Number((Math.round(n / step) * step).toPrecision(14)) : n;
    return Math.min(control.max ?? Infinity, Math.max(control.min ?? -Infinity, snapped));
  };

  const commit = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(n)) {
      const next = norm(n);
      if (next !== params[key]) {
        params[key] = next;
        onChange();
      }
    }
    // Always redraw the field: rejected input and "0080" both snap back to the real value.
    show();
  };

  // One step is the declared `step`, else 1 for a whole number and the value's own precision
  // otherwise (0.25 → 0.01), so arrows never introduce float noise.
  const stepFor = () => {
    if (control.step && control.step > 0) return control.step;
    const decimals = (String(params[key]).split('.')[1] ?? '').length;
    return decimals ? 10 ** -decimals : 1;
  };

  input.addEventListener('focus', () => input.select());
  input.addEventListener('blur', () => commit(input.value));
  input.addEventListener('keydown', (e) => {
    const dir = e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0;
    if (dir) {
      e.preventDefault();
      const base = Number(input.value);
      if (!Number.isFinite(base)) return;
      commit(String(Number((base + dir * stepFor() * (e.shiftKey ? 10 : 1)).toPrecision(14))));
      input.select();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(input.value);
      input.select();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      show();
      input.select();
    }
  });

  show();
  return {
    // Never write into the field being typed in — the caret would jump to the end.
    update: () => {
      if (document.activeElement !== input) show();
    },
    destroy: () => row.remove(),
  };
};

/** Bounded → slider; bare (or half-bounded) → the numeric field, because a slider needs both ends. */
const number: ControlFactory = (host, params, key, control, onChange) =>
  (control.min === undefined || control.max === undefined ? numberField : slider)(host, params, key, control, onChange);

/**
 * Widget per `control.type`. Without an explicit type the value picks one (`inferType`).
 * Plugins add types (`controlTypes.curve = ...`) or replace a default (`controlTypes.color = ...`).
 *
 * `controlled`: dialkit's select and toggle only redraw when the parent hands the new props back —
 * they call `onChange` and otherwise sit still — so those two re-apply their own props after a
 * change. The slider and the colour picker keep their own DOM in sync, and a text input already
 * holds what was typed, so refreshing those mid-edit would only fight the user.
 */
export const controlTypes: Record<string, ControlFactory> = {
  number,

  select: (host, params, key, control, onChange) => {
    let self: Mounted | undefined;
    const props = () => ({
      label: key,
      value: params[key] as string,
      options: control.options ?? [],
      onChange: (value: string) => {
        params[key] = value;
        self?.update(); // controlled widget: see `controlled` below
        onChange();
      },
    });
    const m = mountSelectControl(host, props());
    self = { update: () => m.update(props()), destroy: () => m.destroy() };
    return self;
  },

  color: (host, params, key, _control, onChange) => {
    const props = () => ({
      label: key,
      value: params[key] as string,
      onChange: (value: string) => {
        params[key] = value;
        onChange();
      },
    });
    const m = mountColorControl(host, props());
    return { update: () => m.update(props()), destroy: () => m.destroy() };
  },

  boolean: (host, params, key, _control, onChange) => {
    let self: Mounted | undefined;
    const props = () => ({
      label: key,
      checked: params[key] as boolean,
      onChange: (value: boolean) => {
        params[key] = value;
        self?.update(); // controlled widget: see `controlled` below
        onChange();
      },
    });
    const m = mountToggle(host, props());
    self = { update: () => m.update(props()), destroy: () => m.destroy() };
    return self;
  },

  string: text,
};

function inferType(value: unknown, control?: Control): string | undefined {
  if (control?.options) return 'select';
  if (typeof value === 'string' && /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) return 'color';
  const t = typeof value;
  return t === 'number' || t === 'boolean' || t === 'string' ? t : undefined;
}

/** The params panel. Plugins get this from `hooks.panel`. */
export interface Panel {
  /** The `.dialkit-root` element every control is mounted inside. */
  element: HTMLElement;
  /** Section bodies, to add a control to one core already built. */
  folders: { render: HTMLElement; params: HTMLElement; size: HTMLElement };
  /** A new section at the bottom of the panel; returns its body. */
  addFolder(title: string): HTMLElement;
  /** Re-read every widget from `params` and `size`. */
  update(): void;
  /** Called after any widget changed a value. Plugins may wrap it (see `add-hot-reload`). */
  onEdit?: () => void;
  destroy(): void;
}

export interface ParamsPanelActions {
  save: () => void;
  export: () => void;
  /** Called after the Size section changed `sketch.size`. */
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
): Panel {
  const { params, config, controls, defaults, size } = sketch;
  container.innerHTML = '';

  const element = document.createElement('div');
  element.className = 'dialkit-root';
  element.dataset.theme = 'dark';
  container.appendChild(element);

  const widgets: Mounted[] = [];
  const sections: { destroy(): void }[] = [];

  const addFolder = (title: string) => {
    const folder = mountFolder(element, { title, defaultOpen: true });
    sections.push(folder);
    return folder.body;
  };

  const panel: Panel = {
    element,
    folders: { render: addFolder('Render'), params: addFolder('Params'), size: addFolder('Size') },
    addFolder,
    update: () => widgets.forEach((w) => w.update()),
    destroy() {
      widgets.forEach((w) => w.destroy());
      sections.forEach((s) => s.destroy());
      container.innerHTML = '';
    },
  };

  const edited = () => {
    onChange();
    panel.onEdit?.();
  };

  // Labels carry the shortcut so the keys are discoverable without reading hooks.ts; plugins that rebind a key are reflected.
  const label = (text: string, action: string) => {
    const key = keyFor(action);
    return key ? `${text} (${key})` : text;
  };
  const buttons: { label: string; onClick: () => void }[] = [];
  if (actions.render) buttons.push({ label: label('Render', 'app.stage.renderOnce()'), onClick: actions.render });
  if (actions.playPause) buttons.push({ label: label('Play / Pause', 'app.stage.toggle()'), onClick: actions.playPause });
  buttons.push({
    label: label(config.fps && config.duration ? 'Export video' : 'Export print', 'app.export()'),
    onClick: actions.export,
  });
  buttons.push({ label: label('Save version', 'app.saveVersion()'), onClick: actions.save });
  sections.push(mountButtonGroup(panel.folders.render, { buttons }));

  for (const key of Object.keys(params)) {
    const control = controls[key] ?? {};
    // Infer from what the code declared, not the live value: a version may have stored a color as
    // `oklch(...)`, and that must still build a color picker.
    const type = control.type ?? inferType(defaults[key] ?? params[key], control);
    const factory = type && controlTypes[type];
    if (factory) widgets.push(factory(panel.folders.params, params, key, control, edited));
    else if (type) console.warn(`[gen-studio] param "${key}": unknown control type "${type}"`);
  }

  widgets.push(...sizeControls(panel.folders.size, size, actions.size));

  return panel;
}

/** Edits the live `size` in place, like params. Picking a preset fills width/height. */
function sizeControls(host: HTMLElement, size: Size, reload: () => void): Mounted[] {
  // Width and height commit once (Enter or blur), so they can rerun the lifecycle straight away.
  // The resolution slider commits on every step of a drag, so that one waits for the drag to settle.
  // ponytail: a debounce, because dialkit's controls report no drag-end. 300 ms, raise if it drags.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settle = () => {
    clearTimeout(timer);
    timer = setTimeout(reload, 300);
  };
  const now = () => {
    clearTimeout(timer);
    reload();
  };

  const presetProps = () => ({
    label: 'preset',
    value: matchPreset(size) ?? 'Custom',
    options: ['Custom', ...Object.keys(presets)],
    onChange: (name: string) => {
      if (!presets[name]) return;
      Object.assign(size, presets[name]);
      fields.forEach((f) => f.update());
      now();
    },
  });
  const presetControl = mountSelectControl(host, presetProps());
  const syncPreset = () => presetControl.update(presetProps());

  // `size` is a plain record like `params`, so the Size rows are the same widgets the params use —
  // `min`/`step` here are what keep width and height whole and positive. Bound to the local
  // factories, not the `controlTypes` registry, so a plugin replacing `number` can't reshape Size.
  const field = (key: keyof Size, control: Control, after: () => void) =>
    number(host, size, key, control, () => {
      syncPreset();
      after();
    });

  const fields = [
    field('width', { min: 1, step: 1 }, now),
    field('height', { min: 1, step: 1 }, now),
    field('resolution', { min: 0.25, max: 4, step: 0.25 }, settle),
  ];

  return [{ update: syncPreset, destroy: () => presetControl.destroy() }, ...fields];
}

/** Refresh every widget from `params`. Optional: a plugin may call it before the first panel exists. */
export function updateParamsGUI(panel?: Panel) {
  panel?.update();
}
