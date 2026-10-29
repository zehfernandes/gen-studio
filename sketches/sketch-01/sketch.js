/*
  sketch-01 — Resend broadcast card
  ---------------------------------------------------------------
  Port of the dashboard's canvas stamp
  (resend-monorepo/apps/dashboard/src/components/canvas-stamp/canvas-stamp.tsx).
  Defaults reproduce production. Card data is at the top of the panel; the
  Pattern and Look folders expose the constants the production code hardcodes.

  The pattern: `lines` points on a circle, every pair joined, pairs farther than
  `maxDistance` skipped; closer pairs are brighter and thicker. `lines` grows
  with contacts (contacts / contactsPerLine, clamped to minLines..maxLines).
*/

/** @type {GenStudio.Config} */
export const config = {
  size: { width: 364, height: 504, resolution: 2 }, // 340 × 480 card + 12 px border each side; @2x export like the dashboard on retina
};

export const params = {
  // card data (what the dashboard passes in)
  title: 'Product launch',
  subtitle: 'Resend Broadcast',
  date: '2026-10-29',
  contacts: { value: 1200, min: 0, max: 10000, step: 1 },
  cardNumber: { value: 1, min: 0, max: 99, step: 1 },

  // broadcast fields not drawn yet, here for the next sketches:
  // id → seed / rarity roll; sentAt → weekday, send time, moon phase, holidays;
  // scheduledAt empty = sent now, set = scheduled; senderDomain → per-domain look.
  id: { value: 1, min: 1, max: 9999, step: 1 },
  sentAt: '2026-10-29T14:30:00Z',
  scheduledAt: '',
  senderDomain: 'resend.com',

  // pattern
  contactsPerLine: { value: 200, min: 10, max: 1000, step: 1, group: 'Pattern' },
  minLines: { value: 4, min: 2, max: 30, step: 1, group: 'Pattern' },
  maxLines: { value: 30, min: 2, max: 60, step: 1, group: 'Pattern' },
  avoidPentagram: { value: true, group: 'Pattern' },
  radius: { value: 125, min: 40, max: 170, step: 1, group: 'Pattern' },
  maxDistance: { value: 300, min: 50, max: 400, step: 1, group: 'Pattern' },
  maxDistanceDense: { value: 220, min: 50, max: 400, step: 1, group: 'Pattern' }, // used above 8 lines
  lineWidth: { value: 2, min: 0.2, max: 6, step: 0.1, group: 'Pattern' },
  glow: { value: 20, min: 0, max: 60, step: 1, group: 'Pattern' },
  centerY: { value: 170, min: 100, max: 300, step: 1, group: 'Pattern' },

  // look
  bgTop: { value: '#181818', group: 'Look' },
  bgBottom: { value: '#2b2b2b', group: 'Look' },
  lineColor: { value: '#ffffff', group: 'Look' },
  titleColor: { value: '#ffffff', group: 'Look' },
  subtitleColor: { value: '#808080', group: 'Look' },
  titleY: { value: 350, min: 250, max: 440, step: 1, group: 'Look' },
};

const W = 340; // card
const H = 480;
const BORDER = 12;
const RADIUS = 12;
const START_X = 20 + BORDER;
const FOOTER_Y = H - 12;
const SANS = 'Favorit, Inter, Helvetica, Arial';
const MONO = '"SF Mono", "Roboto Mono", "DejaVu Sans Mono", Menlo, Consolas, monospace';

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

function lineCount() {
  let n = Math.min(Math.max(params.minLines, params.contacts / params.contactsPerLine), params.maxLines);
  if (params.avoidPentagram && n > 4.9 && n < 5.9) n = 6;
  return n;
}

function drawCard(ctx) {
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, params.bgTop);
  bg.addColorStop(1, params.bgBottom);
  ctx.beginPath();
  ctx.roundRect(BORDER, BORDER, W, H, RADIUS);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(78, 78, 78, 0.70)';
  ctx.stroke();

  // Top-right highlight on the inner edge. Production strokes it twice, hence 0.36 ≈ 1 - 0.8².
  const hx = W * 1.0678;
  const hy = H * 0.0279;
  const hl = ctx.createRadialGradient(hx, hy, 0, hx, hy, W * 0.5689);
  hl.addColorStop(0, 'rgba(255, 255, 255, 0.36)');
  hl.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.strokeStyle = hl;
  ctx.stroke();

  ctx.beginPath();
  ctx.roundRect(0, 0, W + BORDER * 2, H + BORDER * 2, RADIUS + 4);
  ctx.strokeStyle = 'rgba(78, 78, 78, 0.70)';
  ctx.stroke();
}

function drawPattern(ctx, scale) {
  const n = lineCount();
  const maxDist = n > 8 ? params.maxDistanceDense : params.maxDistance;
  const cx = (W + BORDER * 2) / 2;
  const cy = params.centerY;
  const pts = Array.from({ length: Math.round(n) }, (_, i) => {
    const a = ((2 * Math.PI) / n) * i;
    return [cx + params.radius * Math.cos(a), cy + params.radius * Math.sin(a)];
  });

  // shadowBlur is in device pixels and ignores ctx.scale, so scale it by hand.
  ctx.shadowBlur = params.glow * scale;
  ctx.shadowColor = params.lineColor;
  for (const [x0, y0] of pts) {
    for (const [x1, y1] of pts) {
      const d = Math.hypot(x1 - x0, y1 - y0);
      if (d >= maxDist) continue;
      const k = 1 - d / maxDist;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.strokeStyle = rgba(params.lineColor, k);
      ctx.lineWidth = k * params.lineWidth;
      ctx.stroke();
    }
  }
  ctx.shadowBlur = 0;
}

// Word-wraps to the card width, max two lines with an ellipsis. Returns the last baseline.
function drawHeading(ctx, text, y, size, color) {
  ctx.fillStyle = color;
  ctx.font = `${size}px ${SANS}`;
  const maxWidth = W - START_X - BORDER;
  let lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const test = `${line}${word} `;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = `${word} `;
    } else line = test;
  }
  lines.push(line);
  if (lines.length > 2) lines = [lines[0], `${lines[1].trim()}...`];
  lines.forEach((l, i) => ctx.fillText(l, START_X, y + i * 30));
  return y + (lines.length - 1) * 30;
}

// Mono label in an outlined box; x is the left edge, or the right edge when right = true.
function drawTag(ctx, text, x, right = false) {
  const pad = 5;
  ctx.font = `13px ${MONO}`;
  ctx.lineWidth = 1;
  const w = ctx.measureText(text).width + pad * 2;
  const h = 13 + pad * 2;
  const left = right ? x - w : x + pad;
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.strokeRect(left, FOOTER_Y - h + pad, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillText(text, left + pad, FOOTER_Y - pad / 2);
  return w;
}

/** @param {CanvasRenderingContext2D} ctx @param {number} t @param {GenStudio.Api} api */
export function draw(ctx, t, api) {
  ctx.clearRect(0, 0, api.width, api.height);
  drawCard(ctx);
  drawPattern(ctx, api.scale);

  const lastY = drawHeading(ctx, params.title || 'Resend', params.titleY, 28, params.titleColor);
  drawHeading(ctx, params.subtitle, lastY + 28, 16, params.subtitleColor);

  const [y, m, d] = String(params.date).split('-');
  const dateW = drawTag(ctx, `${d}/${m}/${y}`, START_X + 14);
  drawTag(ctx, Math.round(params.contacts).toLocaleString('en-US'), START_X + dateW + 8 + 14);
  drawTag(ctx, `E#${String(params.cardNumber).padStart(2, '0')}`, W - BORDER, true);

  ctx.fillStyle = '#7f7f7f';
  ctx.fillRect(START_X, FOOTER_Y - 18.5, 20, 24);
}
