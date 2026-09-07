import { describe, it, expect } from 'vitest';
import { createRandomBackend } from './random';

describe('createRandomBackend', () => {
  it('is deterministic for the same seed', () => {
    const a = createRandomBackend(42);
    const b = createRandomBackend(42);
    const seqA = [a.random(), a.random(), a.random()];
    const seqB = [b.random(), b.random(), b.random()];
    expect(seqA).toEqual(seqB);
  });

  it('produces different streams for different seeds', () => {
    const a = createRandomBackend(1);
    const b = createRandomBackend(2);
    expect(a.random()).not.toBe(b.random());
  });

  it('supports noise', () => {
    const r = createRandomBackend(7);
    const n = r.noise(1.5, 2.5);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThanOrEqual(1);
  });

  it('keeps noise seeds 0 and 12345 distinct', () => {
    const zero = createRandomBackend(0);
    const other = createRandomBackend(12345);
    expect(zero.noise(1.5, 2.5, 3.5)).not.toBe(other.noise(1.5, 2.5, 3.5));
  });
});
