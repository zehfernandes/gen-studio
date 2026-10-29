/*
  sketch-02 — Resend broadcast card, social (1200 × 630), Bauhaus tiles
  ---------------------------------------------------------------
  Geometric tile grid. Each cell rolls a shape (quarter circle, half circle,
  triangle, circle, stripes, square, dot) and a colour from the palette.

  - id          → seed. Same id, same card.
  - contacts    → grid density (more contacts, more cells), unless `cols` is set.
  - sentAt      → weekday rotates the palette; a 2×2 "moon" tile shows the moon phase;
                  holiday tag on the footer.
  - scheduledAt → set = some tiles become outlines + SCHEDULED tag.
  - senderDomain → footer tag.

  Derived values live in `facts()`; add a shape to SHAPES to grow the vocabulary.
*/

/** @type {GenStudio.Config} */
export const config = {
  size: { width: 1200, height: 630, resolution: 2 },
};

const PALETTES = {
  bauhaus: ['#e63946', '#f4c430', '#1d4ed8', '#f5f0e6'],
  resend: ['#ffffff', '#a1a1a1', '#3f3f3f', '#e5e5e5'],
  acid: ['#c6ff00', '#00ffa3', '#ff3cac', '#ffffff'],
  dusk: ['#ff7eb6', '#a78bfa', '#fde68a', '#38bdf8'],
  print: ['#ff4f00', '#0047ff', '#111111', '#f2efe6'],
};

export const params = {
  // broadcast
  title: 'Product launch',
  subtitle: 'Resend Broadcast',
  contacts: { value: 1200, min: 0, max: 10000, step: 1 },
  cardNumber: { value: 1, min: 0, max: 99, step: 1 },
  id: { value: 1, min: 1, max: 9999, step: 1 },
  sentAt: '2026-10-29T14:30:00Z',
  scheduledAt: '',
  senderDomain: 'resend.com',

  // grid
  cols: { value: 0, min: 0, max: 24, step: 1, group: 'Grid' }, // 0 = from contacts
  artWidth: { value: 0.5, min: 0.2, max: 1, group: 'Grid' },
  margin: { value: 40, min: 0, max: 120, step: 1, group: 'Grid' },
  gap: { value: 0, min: 0, max: 0.3, group: 'Grid' },
  empty: { value: 0.08, min: 0, max: 0.9, group: 'Grid' },
  outline: { value: 0, min: 0, max: 1, group: 'Grid' }, // share of outlined tiles (rises when scheduled)
  strokeWidth: { value: 3, min: 0.5, max: 12, group: 'Grid' },
  stripes: { value: 6, min: 2, max: 20, step: 1, group: 'Grid' },
  moonTile: { value: true, group: 'Grid' },

  // shapes (relative weights, 0 = off)
  quarter: { value: 3, min: 0, max: 5, step: 1, group: 'Shapes' },
  half: { value: 2, min: 0, max: 5, step: 1, group: 'Shapes' },
  triangle: { value: 2, min: 0, max: 5, step: 1, group: 'Shapes' },
  circle: { value: 1, min: 0, max: 5, step: 1, group: 'Shapes' },
  stripe: { value: 1, min: 0, max: 5, step: 1, group: 'Shapes' },
  square: { value: 1, min: 0, max: 5, step: 1, group: 'Shapes' },
  dot: { value: 1, min: 0, max: 5, step: 1, group: 'Shapes' },

  // colour
  palette: { value: 'bauhaus', options: Object.keys(PALETTES), group: 'Colour' },
  c0: { value: PALETTES.bauhaus[0], group: 'Colour' },
  c1: { value: PALETTES.bauhaus[1], group: 'Colour' },
  c2: { value: PALETTES.bauhaus[2], group: 'Colour' },
  c3: { value: PALETTES.bauhaus[3], group: 'Colour' },
  weekdayShift: { value: true, group: 'Colour' },
  bg: { value: '#111111', group: 'Colour' },
  text: { value: '#ffffff', group: 'Colour' },

  // type
  titleSize: { value: 88, min: 32, max: 160, step: 1, group: 'Type' },
  tagSize: { value: 22, min: 12, max: 40, step: 1, group: 'Type' },
  showFooter: { value: true, group: 'Type' },
};

const SANS = 'Favorit, Inter, Helvetica, Arial';
const MONO = '"SF Mono", "Roboto Mono", "DejaVu Sans Mono", Menlo, Consolas, monospace';
const HOLIDAYS = { '01-01': 'New Year', '02-14': "Valentine's", '10-31': 'Halloween', '12-24': 'Christmas Eve', '12-25': 'Christmas', '12-31': "New Year's Eve" };
const SHAPES = ['quarter', 'half', 'triangle', 'circle', 'stripe', 'square', 'dot'];

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

// Everything the broadcast fields imply. All derived from params, so deterministic.
export function facts() {
  const sent = new Date(params.scheduledAt || params.sentAt);
  const d = Number.isNaN(sent.getTime()) ? new Date(0) : sent;
  // Days since a known new moon (2000-01-06 18:14 UTC) over the synodic month.
  const moon = ((((d.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 864e5 / 29.530588853) % 1) + 1) % 1;
  return {
    date: d,
    weekday: d.getUTCDay(), // 0 = Sunday
    hour: d.getUTCHours() + d.getUTCMinutes() / 60,
    moon, // 0 new, 0.5 full
    moonLit: (1 - Math.cos(2 * Math.PI * moon)) / 2, // lit fraction 0..1
    holiday: HOLIDAYS[d.toISOString().slice(5, 10)] || null,
    scheduled: Boolean(params.scheduledAt),
    cols: params.cols || Math.round(Math.min(Math.max(3, Math.sqrt(params.contacts / 30)), 16)),
  };
}

let lastPalette = params.palette;

/** @param {CanvasRenderingContext2D} ctx @param {number} t @param {GenStudio.Api} api */
export function draw(ctx, t, api) {
  if (params.palette !== lastPalette) {
    lastPalette = params.palette;
    [params.c0, params.c1, params.c2, params.c3] = PALETTES[params.palette];
  }
  api.randomSeed(params.id);
  const W = api.width;
  const H = api.height;
  const f = facts();
  const shift = params.weekdayShift ? f.weekday : 0;
  const colors = [params.c0, params.c1, params.c2, params.c3].map((_, i, a) => a[(i + shift) % 4]);
  const pick = () => colors[Math.floor(api.random(4))];

  ctx.fillStyle = params.bg;
  ctx.fillRect(0, 0, W, H);

  // grid
  const m = params.margin;
  const areaW = W * params.artWidth - m * 1.5;
  const areaH = H - m * 2;
  const cols = f.cols;
  const cell = areaW / cols;
  const rows = Math.max(1, Math.floor(areaH / cell));
  const oy = m + (areaH - rows * cell) / 2;
  const weights = SHAPES.map((s) => params[s]);
  const total = weights.reduce((a, b) => a + b, 0);
  const outline = f.scheduled ? Math.max(params.outline, 0.4) : params.outline;

  const moonAt = params.moonTile && cols >= 2 && rows >= 2
    ? [Math.floor(api.random(cols - 1)), Math.floor(api.random(rows - 1))]
    : null;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // always roll, so turning a shape off doesn't reshuffle every other tile
      const roll = api.random() * total;
      const rot = Math.floor(api.random(4));
      const fg = pick();
      let back = pick();
      if (back === fg) back = params.bg;
      const hollow = api.random() < outline;
      const isEmpty = api.random() < params.empty;
      if (moonAt && c >= moonAt[0] && c <= moonAt[0] + 1 && r >= moonAt[1] && r <= moonAt[1] + 1) continue;
      if (isEmpty || total === 0) continue;

      let acc = 0;
      const shape = SHAPES.find((_, i) => roll < (acc += weights[i]));
      const g = cell * params.gap * 0.5;
      tile(ctx, shape, m + c * cell + g, oy + r * cell + g, cell - g * 2, rot, fg, back, hollow);
    }
  }

  if (moonAt) {
    const x = m + moonAt[0] * cell;
    const y = oy + moonAt[1] * cell;
    moonTile(ctx, x, y, cell * 2, f, colors[0], colors[3]);
  }

  // type
  const tx = W * params.artWidth + m;
  const maxW = W - tx - m;
  ctx.fillStyle = params.text;
  ctx.font = `${params.titleSize}px ${SANS}`;
  ctx.textBaseline = 'top';
  const lines = wrap(ctx, params.title || 'Resend', maxW).slice(0, 3);
  lines.forEach((l, i) => ctx.fillText(l, tx, m + i * params.titleSize * 1.05));
  ctx.fillStyle = rgba(params.text, 0.55);
  ctx.font = `${Math.round(params.titleSize * 0.36)}px ${SANS}`;
  ctx.fillText(params.subtitle, tx, m + lines.length * params.titleSize * 1.05 + 12);

  if (params.showFooter) {
    const tags = [
      f.date.toISOString().slice(0, 10).split('-').reverse().join('/'),
      Math.round(params.contacts).toLocaleString('en-US'),
      params.senderDomain,
      `E#${String(params.cardNumber).padStart(2, '0')}`,
      f.scheduled && 'SCHEDULED',
      f.holiday,
    ].filter(Boolean);
    // flow tags left to right, wrapping upward from the bottom margin
    const h = params.tagSize * 1.8;
    const rowsOfTags = [[]];
    let x = 0;
    ctx.font = `${params.tagSize}px ${MONO}`;
    for (const tag of tags) {
      const w = ctx.measureText(tag).width + params.tagSize;
      if (x + w > maxW && x > 0) {
        rowsOfTags.push([]);
        x = 0;
      }
      rowsOfTags.at(-1).push(tag);
      x += w + 8;
    }
    rowsOfTags.forEach((row, i) => {
      let x = tx;
      const y = H - m - (rowsOfTags.length - i) * (h + 8) + 8;
      for (const tag of row) x += tagBox(ctx, tag, x, y, h) + 8;
    });
  }
  ctx.textBaseline = 'alphabetic';
}

// One cell. (x, y) top-left, s side, rot quarter turns.
function tile(ctx, shape, x, y, s, rot, fg, back, hollow) {
  ctx.save();
  ctx.translate(x + s / 2, y + s / 2);
  ctx.rotate((rot * Math.PI) / 2);
  ctx.translate(-s / 2, -s / 2);
  ctx.beginPath();
  ctx.rect(0, 0, s, s);
  ctx.clip();
  if (!hollow && shape !== 'stripe') {
    ctx.fillStyle = back;
    ctx.fillRect(0, 0, s, s);
  }

  ctx.beginPath();
  if (shape === 'quarter') { ctx.moveTo(0, 0); ctx.arc(0, 0, s, 0, Math.PI / 2); }
  if (shape === 'half') ctx.arc(s / 2, 0, s / 2, 0, Math.PI);
  if (shape === 'triangle') { ctx.moveTo(0, 0); ctx.lineTo(s, 0); ctx.lineTo(0, s); }
  if (shape === 'circle') ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
  if (shape === 'square') ctx.rect(s * 0.2, s * 0.2, s * 0.6, s * 0.6);
  if (shape === 'dot') ctx.arc(s / 2, s / 2, s * 0.16, 0, Math.PI * 2);
  ctx.closePath();

  if (shape === 'stripe') {
    const n = params.stripes;
    ctx.fillStyle = fg;
    for (let i = 0; i < n; i += 2) ctx.fillRect(0, (i * s) / n, s, s / n);
  } else if (hollow) {
    ctx.strokeStyle = fg;
    ctx.lineWidth = params.strokeWidth;
    ctx.stroke();
  } else {
    ctx.fillStyle = fg;
    ctx.fill();
  }
  ctx.restore();
}

// 2×2 tile: lit disc with a shadow disc sliding across by phase; waxing lights the right side.
function moonTile(ctx, x, y, s, f, lit, dark) {
  const r = s * 0.42;
  const cx = x + s / 2;
  const cy = y + s / 2;
  ctx.save();
  ctx.fillStyle = dark;
  ctx.fillRect(x, y, s, s);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = lit;
  ctx.fillRect(x, y, s, s);
  ctx.fillStyle = params.bg;
  ctx.beginPath();
  ctx.arc(cx + 2 * r * f.moonLit * (f.moon < 0.5 ? -1 : 1), cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function wrap(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  return [...lines, line];
}

function tagBox(ctx, text, x, y, h) {
  const pad = params.tagSize / 2;
  ctx.font = `${params.tagSize}px ${MONO}`;
  ctx.textBaseline = 'middle';
  const w = ctx.measureText(text).width + pad * 2;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = rgba(params.text, 0.5);
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = rgba(params.text, 0.9);
  ctx.fillText(text, x + pad, y + h / 2);
  return w;
}
