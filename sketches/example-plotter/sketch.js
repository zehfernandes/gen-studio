// Pen-plotter style sketch. The canvas is only a preview; the real artifact
// is an SVG, so `draw` returns it when exporting. Press E → .svg + .png + .json.

export const config = {
  size: { preset: 'A4 300dpi' },
};

export const params = {
  seed: 7,
  points: { value: 9, min: 4, max: 20, step: 1 },
  spread: { value: 88, min: 10, max: 100, step: 1 },
  loops: { value: 0.8, min: 0, max: 1, step: 0.05 },
  margin: 0,
  lineWidth: { value: 0.3, min: 0.1, max: 2, step: 0.1 },
  ink: '#1a1a1a',
};

// Sizes are pixels; the sketch decides what a millimetre is. A4 is 210mm wide,
// so one mm is w / 210 — the plotter gets real units, the host never needs them.
const A4_WIDTH_MM = 210;

function line(api) {
  const { width: w, height: h } = api;
  const mm = w / A4_WIDTH_MM;
  const m = params.margin * mm;
  const step = (h - 2 * m) / (params.points - 1);
  const radius = ((w - 2 * m) * params.spread) / 200;
  const points = [];

  for (let i = 0; i < params.points; i++) {
    const r = api.random(-1, 1);
    const x = w / 2 + Math.sign(r) * r * r * radius;
    const y =
      m +
      i * step +
      (i === 0 || i === params.points - 1 ? 0 : api.random(-step, step) * params.loops);
    points.push([x, y]);
  }

  return points;
}

function curves(points) {
  return points.slice(0, -1).map((point, i) => {
    const before = points[i - 1] || point;
    const next = points[i + 1];
    const after = points[i + 2] || next;
    return [
      [point[0] + (next[0] - before[0]) / 6, point[1] + (next[1] - before[1]) / 6],
      [next[0] - (after[0] - point[0]) / 6, next[1] - (after[1] - point[1]) / 6],
      next,
    ];
  });
}

function toSVG(points, api) {
  const { width: w, height: h } = api;
  const mm = w / A4_WIDTH_MM;
  const d = [
    `M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`,
    ...curves(points).map(
      ([a, b, end]) =>
        `C${a[0].toFixed(1)} ${a[1].toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)} ${end[0].toFixed(1)} ${end[1].toFixed(1)}`,
    ),
  ].join(' ');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${(w / mm).toFixed(1)}mm" height="${(h / mm).toFixed(1)}mm" viewBox="0 0 ${w} ${h}">\n` +
    `  <path d="${d}" fill="none" stroke="${params.ink}" stroke-width="${(params.lineWidth * mm).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>\n` +
    `</svg>\n`
  );
}

/** @param {GenStudio.Canvas2D} c  @param {number} t  @param {GenStudio.Api} api  @returns {GenStudio.DrawResult} */
export function draw(c, t, api) {
  const points = line(api);
  const mm = api.width / A4_WIDTH_MM;

  c.fillStyle = '#fff';
  c.fillRect(0, 0, api.width, api.height);
  c.strokeStyle = params.ink;
  c.lineWidth = params.lineWidth * mm;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(points[0][0], points[0][1]);
  for (const [a, b, end] of curves(points)) {
    c.bezierCurveTo(a[0], a[1], b[0], b[1], end[0], end[1]);
  }
  c.stroke();

  if (api.exporting) {
    return [c.canvas, { data: toSVG(points, api), extension: '.svg' }];
  }
}
