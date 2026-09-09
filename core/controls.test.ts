import { describe, it, expect } from 'vitest';
import { splitParams, sketchControls } from './controls';

describe('splitParams', () => {
  it('flattens descriptors in place and returns the hints', () => {
    const params: Record<string, any> = {
      seed: 1,
      count: { value: 18, min: 3, max: 48, step: 1 },
      mode: { value: 'top', options: ['top', 'bottom'] },
      ink: '#1c1612',
    };
    const controls = splitParams(params);
    expect(params).toEqual({ seed: 1, count: 18, mode: 'top', ink: '#1c1612' });
    expect(controls).toEqual({ count: { min: 3, max: 48, step: 1 }, mode: { options: ['top', 'bottom'] } });
  });

  it('leaves bare values and arrays alone', () => {
    const params: Record<string, any> = { a: 1, b: [1, 2], c: null, d: true };
    expect(splitParams(params)).toEqual({});
    expect(params).toEqual({ a: 1, b: [1, 2], c: null, d: true });
  });
});

describe('sketchControls', () => {
  const load = () => {
    // A module object and the `params` it exports — the same pair a cached import hands back twice.
    const params: Record<string, any> = { seed: 1, count: { value: 18, min: 3, max: 48 } };
    return { mod: { params }, params };
  };

  it('keeps the hints when the same module is loaded again', () => {
    const { mod, params } = load();
    expect(sketchControls(mod, params).controls).toEqual({ count: { min: 3, max: 48 } });
    // Second load: `params` is already flat, so splitting again would find nothing.
    expect(sketchControls(mod, params).controls).toEqual({ count: { min: 3, max: 48 } });
  });

  it('keeps defaults at the code values, not the edited ones', () => {
    const { mod, params } = load();
    expect(sketchControls(mod, params).defaults).toEqual({ seed: 1, count: 18 });
    params.count = 42; // the user dragged the slider
    expect(sketchControls(mod, params).defaults).toEqual({ seed: 1, count: 18 });
  });
});
