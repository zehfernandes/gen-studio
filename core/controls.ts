import type { Control, SketchParams } from './types';

const isDescriptor = (v: any): v is Control & { value: any } =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && 'value' in v;

/**
 * `params` may declare a control inline: `count: { value: 18, min: 3, max: 48, step: 1 }`
 * or `mode: { value: 'top', options: ['top', 'bottom'] }`. This pulls the hints out and
 * flattens `params` IN PLACE (same object the sketch closes over), so `draw` reads
 * `params.count` as a plain value and versions/exports store flat values.
 */
export function splitParams(params: SketchParams): Record<string, Control> {
  const controls: Record<string, Control> = {};
  for (const key of Object.keys(params)) {
    const v = params[key];
    if (!isDescriptor(v)) continue;
    const { value, ...control } = v;
    params[key] = value;
    controls[key] = control;
  }
  return controls;
}

/**
 * `splitParams` flattens the module's *own* exported `params`, and a browser caches an ES module
 * for the life of the page: the second `loadSketch` of the same sketch — switch away in the sidebar
 * and back — hands it already-flat values, so it would find no descriptors and return no hints at
 * all. Every bounded number would fall back to a bare field, every dropdown to a text input, until
 * a reload. Memoizing per module also keeps `defaults` at the values the *code* declares, instead
 * of whatever the user had dragged the sliders to by the time they switched back.
 */
const perModule = new WeakMap<object, { controls: Record<string, Control>; defaults: SketchParams }>();

export function sketchControls(mod: object, params: SketchParams) {
  let hit = perModule.get(mod);
  if (!hit) {
    const controls = splitParams(params);
    hit = { controls, defaults: Object.freeze(structuredClone(params)) as SketchParams };
    perModule.set(mod, hit);
  }
  return hit;
}
