export const config = {
  size: { preset: 'Instagram post' },
  fps: 30,
  duration: 4,
};

export const params = {
  seed: 1,
  count: { value: 24, min: 3, max: 120, step: 1 },
  radius: { value: 0.32, min: 0.05, max: 0.48, step: 0.01 },
  size: { value: 18, min: 2, max: 60, step: 1 },
  color: '#ff5c33',
  bg: '#101010',
};

// `t` runs 0 → 1 across the loop and never reaches 1, so frame 0 follows the last frame seamlessly.
// api.random() would give the same numbers on every frame (the seed is stable); motion comes from `t`.
/** @param {GenStudio.Canvas2D} c  @param {number} t  @param {GenStudio.Api} api */
export function draw(c, t, api) {
  const { width: w, height: h } = api;

  c.fillStyle = params.bg;
  c.fillRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * params.radius;

  c.fillStyle = params.color;
  const phase = t * Math.PI * 2;
  for (let i = 0; i < params.count; i++) {
    const a = (i / params.count) * Math.PI * 2 + phase;
    const orbit = api.noise(i * 0.1, Math.cos(phase) + 2, Math.sin(phase) + 2) * 0.2;
    const x = cx + Math.cos(a) * r * (1 + orbit);
    const y = cy + Math.sin(a) * r * (1 + orbit);
    c.beginPath();
    c.arc(x, y, params.size, 0, Math.PI * 2);
    c.fill();
  }
}
