import { describe, it, expect } from 'vitest';
import { SketchApi } from './api';

describe('SketchApi', () => {
  it('random() is the same on every frame for one seed', () => {
    const api = new SketchApi();
    const draw = (frame: number) => {
      api.frame = frame;
      api.randomSeed(7);
      return [api.random(), api.random(), api.random()];
    };
    expect(draw(0)).toEqual(draw(1));
    expect(draw(0)).toEqual(draw(119));
  });

  it('a sketch can opt into a new draw per frame', () => {
    const api = new SketchApi();
    const draw = (frame: number) => {
      api.frame = frame;
      api.randomSeed(7 + api.frame);
      return api.random();
    };
    expect(draw(0)).not.toBe(draw(1));
  });

  it('time is frame / fps, 0 for stills', () => {
    const api = new SketchApi();
    expect(api.time).toBe(0);
    api.fps = 30;
    api.frame = 45;
    expect(api.time).toBe(1.5);
  });
});
