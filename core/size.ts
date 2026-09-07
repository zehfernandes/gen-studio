import type { Size, SizeInput } from './types';

/**
 * Named sizes in design pixels. Print presets are pre-computed at 300 dpi so
 * `resolution: 1` is print-ready. Extend from plugins: `presets['My wall'] = { width, height }`.
 */
export const presets: Record<string, { width: number; height: number }> = {
  'A4 300dpi': { width: 2480, height: 3508 },
  'A3 300dpi': { width: 3508, height: 4961 },
  'A2 300dpi': { width: 4961, height: 7016 },
  '18 × 24 in 300dpi': { width: 5400, height: 7200 },
  '24 × 36 in 300dpi': { width: 7200, height: 10800 },
  'Instagram post': { width: 1080, height: 1080 },
  'Instagram story': { width: 1080, height: 1920 },
  YouTube: { width: 1920, height: 1080 },
  'X post': { width: 1600, height: 900 },
  '4K': { width: 3840, height: 2160 },
};

export const DEFAULT_SIZE: Size = { width: 1080, height: 1080, resolution: 1 };

/** `config.size` → full Size. Explicit fields win over the preset; missing fields fall back to the default. */
export function resolveSize(input?: SizeInput): Size {
  const base = { ...DEFAULT_SIZE };
  if (!input) return base;
  if (input.preset) {
    const p = presets[input.preset];
    if (p) Object.assign(base, p);
    else console.warn(`[gen-studio] unknown size preset "${input.preset}", using ${base.width}x${base.height}`);
  }
  if (input.width) base.width = input.width;
  if (input.height) base.height = input.height;
  if (input.resolution) base.resolution = input.resolution;
  return base;
}

/** Export dimensions in device pixels. */
export function outputPixels(size: Size) {
  return { width: Math.round(size.width * size.resolution), height: Math.round(size.height * size.resolution) };
}

/** Preset whose W×H equals the design size (either orientation), if any. */
export function matchPreset(size: Size): string | undefined {
  return Object.keys(presets).find((k) => {
    const p = presets[k];
    return (p.width === size.width && p.height === size.height) || (p.width === size.height && p.height === size.width);
  });
}

/** Preview canvas: largest same-aspect box inside `boxW×boxH` CSS px at `dpr`, never above the export size. */
export function fitPixels(size: Size, boxW: number, boxH: number, dpr = 1) {
  const out = outputPixels(size);
  const ratio = Math.min((boxW * dpr) / size.width, (boxH * dpr) / size.height, out.width / size.width);
  const scale = Math.max(ratio, 1 / size.width);
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
}
