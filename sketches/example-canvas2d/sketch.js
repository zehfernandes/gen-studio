export const config = {
  size: { preset: 'A4 300dpi' },
};

export const params = {
  seed: 3,
  count: { value: 8, min: 3, max: 48, step: 1 },
  spread: { value: 0.24, min: 0.01, max: 0.5, step: 0.01 },
  grain: { value: 24, min: 1, max: 32, step: 1 },
  paper: '#efeee8',
};

// api.width / api.height are the design pixels (2480 x 3508 here). Sizing
// everything relative to them keeps the picture identical on A4, A2 or a
// 1080 post; `resolution` in the Size panel only adds pixels.
/** @param {GenStudio.Canvas2D} c  @param {number} t  @param {GenStudio.Api} api */
export function draw(c, _t, api) {
  const { width: w, height: h } = api;

  c.fillStyle = params.paper;
  c.fillRect(0, 0, w, h);

  c.save();
  for (let i = 0; i < params.count; i++) {
    const size = api.random(w * 0.16, w * 0.36);
    const x = w / 2 + (api.random() + api.random() - 1) * w * params.spread - size / 2;
    const y = h / 2 + (api.random() + api.random() - 1) * w * params.spread - size / 2;
    const jitter = w * 0.0008;

    const hue = i % 2 ? api.random(342, 372) : api.random(198, 228);
    c.fillStyle = `hsl(${hue} ${api.random(66, 88)}% ${api.random(38, 55)}%)`;
    // A few offset impressions soften the otherwise digital edges without blending colours.
    for (let pass = 0; pass < 3; pass++) {
      c.fillRect(
        x + api.random(-jitter, jitter),
        y + api.random(-jitter, jitter),
        size + api.random(-jitter, jitter),
        size + api.random(-jitter, jitter),
      );
    }
    c.fillRect(x, y, size, size);
  }
  c.restore();

  // Fine dark grain and pale fibres run through both paper and solid ink.
  api.randomSeed(params.seed + 7919);
  const unit = w / 2480;
  const specks = Math.round(params.grain * 1000);

  c.save();
  c.fillStyle = 'rgba(52, 43, 34, 0.11)';
  c.beginPath();
  for (let i = 0; i < specks; i++) {
    const x = api.random(w);
    const y = api.random(h);
    const r = api.random(0.55, 3) * unit;
    c.moveTo(x + r, y);
    c.arc(x, y, r, 0, Math.PI * 2);
  }
  c.fill();

  c.fillStyle = 'rgba(255, 255, 255, 0.24)';
  c.beginPath();
  for (let i = 0; i < specks / 2; i++) {
    const x = api.random(w);
    const y = api.random(h);
    const r = api.random(0.5, 2.8) * unit;
    c.moveTo(x + r, y);
    c.arc(x, y, r, 0, Math.PI * 2);
  }
  c.fill();

  c.strokeStyle = 'rgba(255, 255, 255, 0.22)';
  c.lineWidth = unit;
  c.beginPath();
  for (let i = 0; i < specks / 6; i++) {
    const x = api.random(w);
    const y = api.random(h);
    c.moveTo(x, y);
    c.lineTo(x + api.random(5, 34) * unit, y + api.random(-0.8, 0.8) * unit);
  }
  c.stroke();
  c.restore();
  api.randomSeed(params.seed);

  // Guides only on screen, never in the file.
  if (!api.exporting) {
    c.strokeStyle = 'rgba(28, 22, 18, 0.12)';
    c.lineWidth = w * 0.0005;
    c.strokeRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9);
  }
}
