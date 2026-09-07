import type { ApiBackend } from './types';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildPerm(seed: number) {
  const p = new Uint8Array(512);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed >>> 0;
  for (let i = 255; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  for (let i = 0; i < 256; i++) p[i + 256] = p[i];
  return p;
}

function fade(t: number) {
  return t * t * (3 - 2 * t);
}

export function createRandomBackend(seed = 0): ApiBackend {
  let rand = mulberry32(seed);
  let perm = buildPerm(seed);

  function random(min?: number, max?: number): number {
    const r = rand();
    if (min === undefined) return r;
    if (max === undefined) return r * min;
    return min + r * (max - min);
  }

  function noise(x: number, y?: number, z?: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y ?? 0) & 255;
    const Z = Math.floor(z ?? 0) & 255;
    const fx = x - Math.floor(x);
    const fy = (y ?? 0) - Math.floor(y ?? 0);
    const fz = (z ?? 0) - Math.floor(z ?? 0);
    const u = fade(fx);
    const v = fade(fy);
    const w = fade(fz);

    const A = perm[X] + Y;
    const AA = perm[A] + Z;
    const AB = perm[A + 1] + Z;
    const B = perm[X + 1] + Y;
    const BA = perm[B] + Z;
    const BB = perm[B + 1] + Z;

    const corner = (hash: number) => perm[hash] / 255;

    return lerp(
      lerp(
        lerp(corner(perm[AA]), corner(perm[BA]), u),
        lerp(corner(perm[AB]), corner(perm[BB]), u),
        v,
      ),
      lerp(
        lerp(corner(perm[AA + 1]), corner(perm[BA + 1]), u),
        lerp(corner(perm[AB + 1]), corner(perm[BB + 1]), u),
        v,
      ),
      w,
    );
  }

  function lerp(a: number, b: number, t: number) {
    return a + (b - a) * t;
  }

  function randomSeed(s: number) {
    rand = mulberry32(s);
  }

  function noiseSeed(s: number) {
    perm = buildPerm(s);
  }

  return { random, noise, randomSeed, noiseSeed };
}
