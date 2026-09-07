import { createRandomBackend } from './random';
import type { Api, ApiBackend, Tile } from './types';

export class SketchApi implements Api {
  seed = 0;
  frame = 0;
  fps = 0;
  frames = 1;
  scale = 1;
  width = 0;
  height = 0;
  tile: Tile = { x: 0, y: 0, width: 0, height: 0 };
  exporting = false;

  /** Seconds into the loop at the current frame; 0 for stills. */
  get time() {
    return this.fps ? this.frame / this.fps : 0;
  }

  /** Design size; resets `tile` to the whole artwork. Exporters that tile set `tile` after this. */
  setSize(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.tile = { x: 0, y: 0, width, height };
  }
  // Seeded from the start: an unseeded Math.random() here would break reproducibility.
  private backend: ApiBackend = createRandomBackend(0);

  setBackend(backend: ApiBackend) {
    this.backend = backend;
  }

  random(min?: number, max?: number): number {
    return this.backend.random(min, max);
  }

  noise(x: number, y?: number, z?: number): number {
    return this.backend.noise(x, y, z);
  }

  // The seed alone, not seed + frame: a layout placed with random() must hold still while `t`
  // animates it. A sketch that wants a new draw per frame calls randomSeed(api.seed + api.frame).
  randomSeed(seed: number): void {
    this.seed = seed;
    this.backend.randomSeed(seed);
  }

  noiseSeed(seed: number): void {
    this.backend.noiseSeed(seed);
  }
}
