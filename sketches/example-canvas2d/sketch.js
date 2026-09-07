export const config = {
  size: { preset: 'A4 300dpi' },
  autoRender: false,
};

export const params = {
  seed: 1,
  count: { value: 18, min: 3, max: 48, step: 1 },
  amplitude: { value: 0.13, min: 0.01, max: 0.5, step: 0.01 },
  frequency: { value: 8, min: 1, max: 32, step: 1 },
  ink: '#1c1612',
  paper: '#f4f1e8',
};

// api.width / api.height are the design pixels (2480 x 3508 here). Sizing
// everything relative to them keeps the picture identical on A4, A2 or a
// 1080 post; `resolution` in the Size panel only adds pixels.
/** @param {GenStudio.Canvas2D} c  @param {number} t  @param {GenStudio.Api} api */
export function draw(c, t, api) {
  const { width: w, height: h } = api;

  c.fillStyle = params.paper;
  c.fillRect(0, 0, w, h);

  c.strokeStyle = params.ink;
  c.lineWidth = w * 0.0017;
  c.lineCap = 'round';

  const step = w / params.count;
  const dy = h / 1200;

  for (let i = 0; i <= params.count; i++) {
    const x = i * step;
    c.beginPath();
    for (let y = 0; y <= h; y += dy) {
      const nx = x / w;
      const ny = y / h;
      const wave = Math.sin(
        ny * params.frequency * Math.PI * 2 +
          nx * 4 +
          t * Math.PI * 2 +
          api.noise(nx * 4, ny * 4) * 4,
      );
      const px = x + wave * params.amplitude * w;
      c.lineTo(px, y);
    }
    c.stroke();
  }

  // Guides only on screen, never in the file.
  if (!api.exporting) {
    c.strokeStyle = 'rgba(255, 0, 0, 0.25)';
    c.lineWidth = w * 0.001;
    c.strokeRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9);
  }
}
