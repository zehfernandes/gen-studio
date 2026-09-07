import type { SketchConfig } from './types';

/** Frames to render: `round(fps × duration)` when `config` has both, else one (a still). `animated` tells which. */
export function frameCount({ config }: { config: SketchConfig }) {
  const { fps = 30, duration } = config;
  const animated = !!(config.fps && duration);
  return { fps, frames: animated ? Math.max(1, Math.round(fps * duration)) : 1, animated };
}

/** Frame index for a loop at `elapsed` seconds. Wall-clock based, so playback speed is independent of display refresh rate. */
export function frameAt(elapsed: number, fps: number, totalFrames: number): number {
  if (totalFrames <= 1) return 0;
  // Epsilon absorbs float drift (4.1 * 30 = 122.999…) so frame boundaries land where expected.
  return Math.floor(Math.max(0, elapsed) * fps + 1e-6) % totalFrames;
}

/**
 * Loop position for a frame: 0 ≤ t < 1. The last frame stops short of 1 so it never repeats frame 0
 * (a sketch driven by `sin(t * 2π)` would otherwise stutter on wrap). Stills are always 0.
 */
export function loopT(frame: number, totalFrames: number): number {
  return totalFrames > 1 ? frame / totalFrames : 0;
}
