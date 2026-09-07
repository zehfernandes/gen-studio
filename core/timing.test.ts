import { describe, it, expect } from 'vitest';
import { frameAt, frameCount, loopT } from './timing';

describe('frameCount', () => {
  it('distinguishes stills from animations', () => {
    expect(frameCount({ config: {} })).toEqual({ fps: 30, frames: 1, animated: false });
    expect(frameCount({ config: { fps: 24, duration: 2.5 } })).toEqual({ fps: 24, frames: 60, animated: true });
  });

  it('rounds fractional frame counts', () => {
    expect(frameCount({ config: { fps: 24, duration: 1 / 10 } }).frames).toBe(2);
  });
});

describe('loopT', () => {
  it('never reaches 1, so the last frame is not a copy of frame 0', () => {
    expect(loopT(0, 120)).toBe(0);
    expect(loopT(60, 120)).toBe(0.5);
    expect(loopT(119, 120)).toBeLessThan(1);
    expect(loopT(119, 120)).toBeCloseTo(1 - 1 / 120);
  });

  it('is 0 for stills', () => {
    expect(loopT(0, 1)).toBe(0);
  });
});

describe('frameAt', () => {
  it('advances by fps, not by display refresh', () => {
    expect(frameAt(0, 30, 120)).toBe(0);
    expect(frameAt(0.5, 30, 120)).toBe(15);
    expect(frameAt(1, 30, 120)).toBe(30);
  });

  it('loops', () => {
    expect(frameAt(4, 30, 120)).toBe(0);
    expect(frameAt(4.1, 30, 120)).toBe(3);
  });

  it('is always 0 for stills', () => {
    expect(frameAt(123, 30, 1)).toBe(0);
  });

  it('resumes exactly on a frame boundary (Stage.play rewinds startTime by frame / fps)', () => {
    expect(frameAt(42 / 30, 30, 120)).toBe(42);
  });
});
