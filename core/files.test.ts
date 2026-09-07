import { describe, it, expect } from 'vitest';
import { timestamp, toLayers, layerFileName } from './files';

describe('timestamp', () => {
  it('is sortable and filesystem safe', () => {
    expect(timestamp(new Date(2026, 8, 2, 14, 30, 5, 7))).toBe('2026.09.02-14.30.05.007');
  });
});

describe('toLayers', () => {
  const canvas = {} as HTMLCanvasElement;

  it('falls back to the canvas when draw returns nothing', () => {
    expect(toLayers(undefined, canvas)).toEqual([{ data: canvas, extension: '.png' }]);
  });

  it('normalizes a single descriptor and adds the dot', () => {
    expect(toLayers({ data: '<svg/>', extension: 'svg' }, canvas)).toEqual([{ data: '<svg/>', extension: '.svg' }]);
  });

  it('keeps arrays in order', () => {
    const layers = toLayers([{ data: 'a', extension: '.svg' }, { data: 'b', extension: '.json', suffix: '.meta' }], canvas);
    expect(layers.map((l) => l.extension)).toEqual(['.svg', '.json']);
  });

  it('requires an extension', () => {
    expect(() => toLayers({ data: 'x' } as any, canvas)).toThrow(/extension/);
  });
});

describe('layerFileName', () => {
  it('uses the base name alone for a single layer', () => {
    expect(layerFileName('poster.S', { data: '', extension: '.png' }, 0, 1)).toBe('poster.S.png');
  });

  it('indexes multiple layers unless a suffix is given', () => {
    expect(layerFileName('poster.S', { data: '', extension: '.png' }, 0, 2)).toBe('poster.S-0.png');
    expect(layerFileName('poster.S', { data: '', extension: '.svg', suffix: '.plot' }, 1, 2)).toBe('poster.S.plot.svg');
  });
});
