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
