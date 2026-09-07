import { describe, it, expect } from 'vitest';
import { splitParams } from './controls';

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
