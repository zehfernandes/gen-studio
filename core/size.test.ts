import { describe, it, expect, vi } from 'vitest';
import { resolveSize, outputPixels, matchPreset, fitPixels, presets, DEFAULT_SIZE } from './size';

describe('resolveSize', () => {
  it('fills defaults', () => {
    expect(resolveSize()).toEqual(DEFAULT_SIZE);
    expect(resolveSize({ width: 800, height: 600 })).toEqual({ width: 800, height: 600, resolution: 1 });
  });

  it('resolves presets and lets fields override', () => {
    expect(resolveSize({ preset: 'A4 300dpi' })).toEqual({ width: 2480, height: 3508, resolution: 1 });
    expect(resolveSize({ preset: 'Instagram story', resolution: 2 })).toEqual({ width: 1080, height: 1920, resolution: 2 });
    expect(resolveSize({ preset: 'A4 300dpi', height: 4000 }).height).toBe(4000);
  });

  it('warns and falls back on an unknown preset', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveSize({ preset: 'nope' })).toEqual(DEFAULT_SIZE);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});

describe('outputPixels', () => {
  it('multiplies by resolution and rounds', () => {
    expect(outputPixels({ width: 1080, height: 1080, resolution: 1 })).toEqual({ width: 1080, height: 1080 });
    expect(outputPixels({ width: 1080, height: 1920, resolution: 2 })).toEqual({ width: 2160, height: 3840 });
    expect(outputPixels({ width: 2480, height: 3508, resolution: 0.5 })).toEqual({ width: 1240, height: 1754 });
    expect(outputPixels({ width: 1001, height: 1001, resolution: 0.5 })).toEqual({ width: 501, height: 501 });
  });
});

describe('matchPreset', () => {
  it('matches either orientation, ignores resolution', () => {
    expect(matchPreset({ width: 1080, height: 1350, resolution: 3 })).toBe('Instagram portrait');
    expect(matchPreset({ width: 3508, height: 2480, resolution: 1 })).toBe('A4 300dpi');
    expect(matchPreset({ width: 1000, height: 1000, resolution: 1 })).toBeUndefined();
  });

  it('sees presets added at runtime', () => {
    presets['Test wall'] = { width: 123, height: 456 };
    try {
      expect(matchPreset({ width: 123, height: 456, resolution: 1 })).toBe('Test wall');
    } finally {
      delete presets['Test wall'];
    }
  });
});

describe('fitPixels', () => {
  const a4 = { width: 2480, height: 3508, resolution: 1 };

  it('fits the aspect ratio inside the box at dpr', () => {
    const fit = fitPixels(a4, 1000, 800, 2);
    expect(fit.height).toBe(1600);
    expect(fit.width).toBe(Math.round((2480 * 1600) / 3508));
  });

  it('never exceeds the export size', () => {
    expect(fitPixels({ width: 300, height: 200, resolution: 1 }, 4000, 4000, 2)).toEqual({ width: 300, height: 200 });
    expect(fitPixels({ width: 300, height: 200, resolution: 2 }, 4000, 4000, 2)).toEqual({ width: 600, height: 400 });
  });

  it('is at least 1x1', () => {
    expect(fitPixels(a4, 0, 0, 1)).toEqual({ width: 1, height: 1 });
  });
});
