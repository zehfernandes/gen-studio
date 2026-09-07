import type { DrawResult, FileLayer, Layer } from './types';

/** `2026.09.02-14.30.05.007` — sortable, readable, safe on every filesystem. */
export function timestamp(date = new Date()): string {
  // sv-SE is ISO-shaped (`2026-09-02 14:30:05`) and, unlike toISOString, local time.
  const local = date.toLocaleString('sv-SE').replace(/-/g, '.').replace(' ', '-').replace(/:/g, '.');
  return `${local}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

export function isCanvas(value: unknown): value is HTMLCanvasElement {
  return typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement;
}

/**
 * Normalize whatever `draw` returned into a list of files to write.
 * Nothing → the canvas. A canvas → itself. A descriptor → itself. An array → each item.
 */
export function toLayers(result: DrawResult, canvas: HTMLCanvasElement): FileLayer[] {
  if (result === undefined || result === null) return [{ data: canvas, extension: '.png' }];
  const items = (Array.isArray(result) ? result : [result]).filter((x): x is Layer => Boolean(x));
  return items.map((item) => {
    if (isCanvas(item)) return { data: item, extension: '.png' };
    const layer = item as FileLayer;
    if (!layer.extension) throw new Error('Layer needs an `extension`, e.g. { data, extension: ".svg" }');
    const extension = layer.extension.startsWith('.') ? layer.extension : `.${layer.extension}`;
    return { ...layer, extension };
  });
}

/** File name for layer `i` of `total`: suffix wins, otherwise `-i` when there are several layers. */
export function layerFileName(base: string, layer: FileLayer, index: number, total: number): string {
  const tag = layer.suffix ?? (total > 1 ? `-${index}` : '');
  return `${base}${tag}${layer.extension}`;
}
