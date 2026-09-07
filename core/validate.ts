import type { SketchModule } from './types';

type Fail = (message: string) => never;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isPositive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0;

function validateLifecycle(mod: Partial<SketchModule>, fail: Fail) {
  if (typeof mod.draw !== 'function') fail('`export function draw(p, t, api)` is required');
  for (const name of ['load', 'setup', 'dispose'] as const) {
    if (mod[name] !== undefined && typeof mod[name] !== 'function') fail(`\`${name}\` must be a function`);
  }
}

function validateSize(size: unknown, presets: string[], fail: Fail) {
  if (size === undefined) return;
  if (!isObject(size)) fail('`size` must be an object');
  if (size.preset !== undefined && (typeof size.preset !== 'string' || !presets.includes(size.preset))) {
    fail(`unknown size preset "${size.preset}" — one of: ${presets.join(', ')}`);
  }
  for (const key of ['width', 'height', 'resolution']) {
    if (size[key] !== undefined && !isPositive(size[key])) fail(`\`size.${key}\` must be a positive finite number`);
  }
}

function validateAnimation(fps: unknown, duration: unknown, fail: Fail) {
  if ((fps === undefined) !== (duration === undefined)) fail('an animation needs both `fps` and `duration` in config');
  if (fps !== undefined && !isPositive(fps)) fail('`fps` must be a positive finite number');
  if (duration !== undefined && !isPositive(duration)) fail('`duration` must be a positive finite number');
}

/**
 * The sketch contract, checked once at load so a mistake reads as a sentence in the status bar
 * instead of a TypeError per frame or a silent fallback. `known` lists the registries' keys.
 */
export function validate(mod: Partial<SketchModule>, entry: string, known: { renderers: string[]; presets: string[] }) {
  const fail: Fail = (message) => {
    throw new Error(`${entry}: ${message}`);
  };
  validateLifecycle(mod, fail);
  if (mod.config !== undefined && !isObject(mod.config)) fail('`config` must be an object');
  if (mod.params !== undefined && !isObject(mod.params)) fail('`params` must be a plain object');

  const { renderer, size, fps, duration } = mod.config ?? {};
  if (renderer !== undefined && (typeof renderer !== 'string' || !known.renderers.includes(renderer))) {
    fail(`unknown renderer "${renderer}" — one of: ${known.renderers.join(', ')}`);
  }
  validateSize(size, known.presets, fail);
  validateAnimation(fps, duration, fail);
}
