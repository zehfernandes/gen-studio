import { describe, it, expect } from 'vitest';
import { validate } from './validate';

const known = { renderers: ['canvas2d', 'p5'], presets: ['A4 300dpi'] };
const draw = () => {};

describe('validate', () => {
  it('accepts a minimal sketch', () => {
    expect(() => validate({ draw }, 'sketch.js', known)).not.toThrow();
  });

  it('names the file and the missing export', () => {
    expect(() => validate({}, 'sketch.js', known)).toThrow('sketch.js: `export function draw(p, t, api)` is required');
  });

  it('lists the known renderers and presets', () => {
    expect(() => validate({ draw, config: { renderer: 'three' } }, 'sketch.js', known)).toThrow('unknown renderer "three" — one of: canvas2d, p5');
    expect(() => validate({ draw, config: { size: { preset: 'A4' } } }, 'sketch.js', known)).toThrow('unknown size preset "A4" — one of: A4 300dpi');
  });

  it('requires fps and duration together', () => {
    expect(() => validate({ draw, config: { fps: 30 } }, 'sketch.js', known)).toThrow('both `fps` and `duration`');
    expect(() => validate({ draw, config: { fps: 30, duration: 4 } }, 'sketch.js', known)).not.toThrow();
  });

  it('rejects the wrong shapes', () => {
    expect(() => validate({ draw, params: [1] as any }, 'sketch.js', known)).toThrow('`params` must be a plain object');
    expect(() => validate({ draw, setup: 3 as any }, 'sketch.js', known)).toThrow('`setup` must be a function');
  });

  it('requires positive finite animation values', () => {
    expect(() => validate({ draw, config: { fps: -30, duration: 4 } }, 'sketch.js', known)).toThrow('`fps` must be a positive finite number');
    expect(() => validate({ draw, config: { fps: 30, duration: Infinity } }, 'sketch.js', known)).toThrow('`duration` must be a positive finite number');
  });

  it('requires positive finite size values', () => {
    expect(() => validate({ draw, config: { size: { width: 0 } } }, 'sketch.js', known)).toThrow('`size.width` must be a positive finite number');
    expect(() => validate({ draw, config: { size: { resolution: -1 } } }, 'sketch.js', known)).toThrow('`size.resolution` must be a positive finite number');
  });
});
