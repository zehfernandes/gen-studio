// Pen-plotter style sketch. The canvas is only a preview; the real artifact
// is an SVG, so `draw` returns it when exporting. Press E → .svg + .png + .json.

export const config = {
  size: { preset: 'A4 300dpi' },
};

export const params = {
  seed: 7,
  rows: { value: 28, min: 4, max: 60, step: 1 },
  wobble: { value: 6, min: 0, max: 20, step: 0.5 },
  margin: 15,
  ink: '#1a1a1a',
};

// Sizes are pixels; the sketch decides what a millimetre is. A4 is 210mm wide,
// so one mm is w / 210 — the plotter gets real units, the host never needs them.
const A4_WIDTH_MM = 210;

function lines(api) {
  const { width: w, height: h } = api;
  const mm = w / A4_WIDTH_MM;
  const m = params.margin * mm;
  const out = [];
  for (let r = 0; r < params.rows; r++) {
    const y = m + ((h - 2 * m) * r) / (params.rows - 1);
    const pts = [];
    for (let x = m; x <= w - m; x += 2 * mm) {
      const n = api.noise((x / mm) * 0.02, r * 0.3) - 0.5;
      pts.push([x, y + n * params.wobble * 2 * mm]);
    }
    out.push(pts);
  }
  return out;
}

function toSVG(paths, api) {
  const { width: w, height: h } = api;
  const mm = w / A4_WIDTH_MM;
  const d = paths
    .map((pts) => 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L'))
    .join(' ');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${(w / mm).toFixed(1)}mm" height="${(h / mm).toFixed(1)}mm" viewBox="0 0 ${w} ${h}">\n` +
    `  <path d="${d}" fill="none" stroke="${params.ink}" stroke-width="${(0.3 * mm).toFixed(2)}"/>\n` +
    `</svg>\n`
  );
}

/** @param {GenStudio.Canvas2D} c  @param {number} t  @param {GenStudio.Api} api  @returns {GenStudio.DrawResult} */
export function draw(c, t, api) {
  const paths = lines(api);
  const mm = api.width / A4_WIDTH_MM;

  c.fillStyle = '#fff';
  c.fillRect(0, 0, api.width, api.height);
  c.strokeStyle = params.ink;
  c.lineWidth = 0.3 * mm;
  for (const pts of paths) {
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.stroke();
  }

  if (api.exporting) {
    return [c.canvas, { data: toSVG(paths, api), extension: '.svg' }];
  }
}
