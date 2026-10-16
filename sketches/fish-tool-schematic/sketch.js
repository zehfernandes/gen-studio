// A film of the grid tool at work: each step drags a handle the way a person would, and the
// schematic on the left shows what the fish reads off the grid — the warped lattice, how every
// cell is stretched or pinched, the probes where the fish measures itself — while the painted fish
// on the right re-grows from the same grid. The steps build on each other, the way a person keeps
// working a grid, and the last one eases back to the reference. Press E to render it as an MP4.
//
// It imports the painted fish (`fish-tool-painted`) and drives its exported `deform`, so the
// schematic can never drift from the real tool.

import * as fish from '../fish-tool-painted/sketch.js';

const SANS = "Inter, ui-sans-serif, system-ui, sans-serif";
const MONO = "CommitMono, 'Commit Mono', ui-monospace, Menlo, monospace";

export const config = {
  size: { width: 1920, height: 1080 },
  fps: 30,
  duration: 30,
};

export const params = {
  seed: 22, // a spotted fish: the spots crowd visibly where the grid is pinched
  paper: '#f6f4ee',
  ink: '#2a2a2a',
  tool: '#e0217f',
  wide: '#2a8a91', // cells pulled wider than tall
  tall: '#d9822b', // cells squeezed taller than wide
};

// The host flattens `{ value, … }` params only for the sketch it loads; this one drives the fish's.
for (const k in fish.params) {
  const v = fish.params[k];
  if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v) fish.params[k] = v.value;
}

// Handles: 0 3 15 12 are corners, 5 6 9 10 inner, the rest edges (row-major, 4 × 4).
const STEPS = [
  { title: 'The reference grid', note: 'A 4 × 4 lattice of handles bends the page with a smooth cubic warp. The fish is laid out in grid space, then re-grown from what the warp does to it.', moves: [] },
  { title: 'Stretch — drag an edge handle', note: 'Pulled long, the body reads log(width ÷ height) > 0: its profile breeds toward slender, the tail forks, and spines are counted along the longer back.', moves: [[7, [0.09, 0]]] },
  { title: 'Squeeze — the same edge, inward', note: 'Squeezed tall, the stretch goes negative: the body deepens toward a disc, fins grow taller, the tail rounds off and the eye grows.', moves: [[7, [-0.3, 0]]] },
  { title: 'Scale in proportion — ⇧ + corner', note: 'A uniform scale changes size, not proportion: the stretch readings hold, so the fish keeps its species and only gains pixels.', moves: [[15, [0.07, 0.05]]], mods: { shift: true } },
  { title: 'Taper the tail end — ⌘ + edge', note: 'The sheet spreads toward the tail (a flat bilinear taper, not a perspective): the tail end is wider than the head end, and the outer tail rays grow filaments.', moves: [[11, [0, 0.1]]], mods: { cmd: true } },
  { title: 'Taper the head end — ⌘ + edge', note: 'Now the head end spreads too: the taper evens out, and what is left is a taller sheet.', moves: [[8, [0, 0.09]]], mods: { cmd: true } },
  { title: 'Distort one corner — ⌘ + corner', note: 'Only one corner moves; the four corners carry every handle with them, so the bends underneath are kept.', moves: [[3, [0.04, -0.08]]], mods: { cmd: true } },
  { title: 'Bend — an inner handle up', note: 'The back line (v = 0.3) bows above its chord: the arch reading turns positive and a hump grows on the forehead (gibbosus).', moves: [[5, [0, -0.11]], [6, [0, -0.05]]] },
  { title: 'Bend — the same handles down', note: 'The back line sags below its chord: the arch goes negative and the belly swells (ventricosus).', moves: [[5, [0, 0.2]], [6, [0, 0.15]]] },
  { title: 'Pinch — two inner handles together', note: 'Cells squeezed below 75 % of the body\'s mean area crowd the skin pattern; spots shrink and stripes tighten where the grid is pinched.', moves: [[5, [0.05, 0]], [6, [-0.05, 0]], [9, [0.05, 0]], [10, [-0.05, 0]]] },
  { title: 'Pull the head long — ⌘⌥ bends the left column', note: 'Only the head region is stretched: the head probe reads > 0.2 and a barbel hangs from the chin; past 0.35 the jaw opens.', moves: [[0, [-0.08, 0]], [4, [-0.08, 0]], [8, [-0.08, 0]], [12, [-0.08, 0]]], mods: { cmd: true, alt: true } },
  { title: 'Back to the reference', note: 'Double-click resets the grid. Same seed + same grid ⇒ the same fish, on screen and in the export.', moves: [], reset: true },
];

const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const lerp = (a, b, t) => a + (b - a) * t;

const lerp2 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];

// Each step works on where the last one left the grid: hold, drag, hold. The last eases back.
const apply = (L, step, p) => {
  if (step.reset) return L.map((q, i) => lerp2(q, fish.identity()[i], p));
  for (const [idx, d] of step.moves) L = fish.deform(L, idx, [d[0] * p, d[1] * p], { shift: false, alt: false, cmd: false, ...step.mods });
  return L;
};
const STARTS = STEPS.reduce((acc, step) => [...acc, apply(acc.at(-1), step, 1)], [fish.identity()]); // grid at each step's start

// The lattice at time t, the step it belongs to, and where that step started.
function latticeAt(t) {
  const k = Math.min(STEPS.length - 1, Math.floor(t * STEPS.length)), local = t * STEPS.length - k;
  const step = STEPS[k], p = ease((local - 0.12) / 0.62);
  return { L: apply(STARTS[k], step, p), step, k, p, start: STARTS[k], base: fish.identity() };
}

/** @param {GenStudio.Canvas2D} c  @param {number} t  @param {GenStudio.Api} api */
export function draw(c, t, api) {
  const { width: W, height: H } = api, { L, step, k, p, start, base } = latticeAt(t);
  c.fillStyle = params.paper;
  c.fillRect(0, 0, W, H);

  // ---- the fish, from the same grid (right)
  const fx = 780, fy = 110, fk = 1100 / 2400;
  const saved = { lattice: fish.params.lattice, seed: fish.params.seed, showGrid: fish.params.showGrid };
  Object.assign(fish.params, { lattice: L, seed: params.seed });
  c.save();
  c.beginPath();
  c.rect(fx, fy, 2400 * fk, 1800 * fk);
  c.clip();
  c.translate(fx, fy);
  c.scale(fk, fk);
  fish.draw(c, 0, { ...api, width: 2400, height: 1800, scale: api.scale * fk, exporting: true });
  // The grid over it, in the tool's colour.
  const Pf = fish.makeWarp(L, 2400, 1800);
  gridLines(c, Pf, params.tool, 1.4 / fk, 0.55);
  c.restore();
  const info = fish.inspect();
  Object.assign(fish.params, saved);
  c.strokeStyle = 'rgba(0,0,0,0.15)';
  c.lineWidth = 1;
  c.strokeRect(fx, fy, 2400 * fk, 1800 * fk);

  // ---- the schematic (left)
  const bx = 40, by = 110, bw = 680, bh = 510;
  const Pn = fish.makeWarp(L, 1, 1), box = ([x, y]) => [bx + x * bw, by + y * bh];
  const P = (u, v) => box(Pn(u, v));
  c.fillStyle = '#fff';
  c.fillRect(bx, by, bw, bh);
  c.save();
  c.beginPath();
  c.rect(bx, by, bw, bh);
  c.clip(); // a grid scaled past the box stays inside it
  // Each cell coloured by its stretch: log(width ÷ height), teal = pulled wide, orange = squeezed
  // tall; dotted where its area is pinched below 75 % of the reference.
  const A0 = 0.8 / 9 * (0.72 / 6);
  for (let i = 0; i < 9; i++) for (let j = 0; j < 6; j++) {
    const q = [P(i / 9, j / 6), P((i + 1) / 9, j / 6), P((i + 1) / 9, (j + 1) / 6), P(i / 9, (j + 1) / 6)];
    const wdt = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2 / bw / (0.8 / 9), hgt = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2 / bh / (0.72 / 6);
    const e = Math.log((wdt || 1e-6) / (hgt || 1e-6)), a = shoelace(q) / (bw * bh) / A0;
    c.globalAlpha = Math.min(0.55, Math.abs(e) * 0.9);
    c.fillStyle = e > 0 ? params.wide : params.tall;
    poly(c, q);
    c.fill();
    if (a < 0.75) {
      c.globalAlpha = 0.6;
      c.fillStyle = params.ink;
      const m = q.reduce((s, v) => [s[0] + v[0] / 4, s[1] + v[1] / 4], [0, 0]);
      for (let d = -1; d <= 1; d++) dotAt(c, [m[0] + d * 6, m[1]], 1.6);
    }
  }
  c.globalAlpha = 1;
  // The reference grid, dashed, and the warped one.
  const Pb = fish.makeWarp(base, 1, 1);
  c.setLineDash([4, 4]);
  gridLines(c, (u, v) => box(Pb(u, v)), '#9a9a9a', 1, 0.7);
  c.setLineDash([]);
  gridLines(c, P, params.ink, 1.2, 0.85);
  // Probes: where the fish measures itself (head, body, tail stretch; the back line for the arch).
  const backLine = Array.from({ length: 41 }, (_, q) => P(lerp(0.12, 0.62, q / 40), 0.3));
  c.strokeStyle = params.tool;
  c.lineWidth = 2.2;
  c.globalAlpha = 0.85;
  poly(c, backLine, false);
  c.stroke();
  c.setLineDash([3, 3]);
  poly(c, [backLine[0], backLine.at(-1)], false);
  c.stroke();
  c.setLineDash([]);
  c.globalAlpha = 1;
  label(c, 'back line → arch', add(backLine[20], [0, -12]), params.tool, 13);
  for (const [u, name] of [[0.12, 'head'], [0.37, 'body'], [0.86, 'tail']]) {
    const pt = P(u, 0.5);
    c.fillStyle = params.tool;
    dotAt(c, pt, 5);
    label(c, name, add(pt, [8, 16]), params.tool, 13);
  }
  // Handles, the dragged ones filled, with an arrow from where they started.
  const moved = new Set(step.moves.map(([i]) => i));
  L.forEach((pt, i) => {
    const [x, y] = box(pt), corner = [0, 3, 12, 15].includes(i), inner = [5, 6, 9, 10].includes(i), r = corner ? 7 : 6;
    c.beginPath();
    inner ? c.arc(x, y, r, 0, Math.PI * 2) : c.rect(x - r, y - r, 2 * r, 2 * r);
    c.fillStyle = moved.has(i) ? params.tool : '#fff';
    c.fill();
    c.strokeStyle = params.tool;
    c.lineWidth = 1.6;
    c.stroke();
  });
  for (const [i] of step.moves) if (p > 0.02) arrow(c, box(start[i]), box(L[i]), params.tool);
  c.restore();
  c.strokeStyle = 'rgba(0,0,0,0.2)';
  c.lineWidth = 1;
  c.strokeRect(bx, by, bw, bh);
  label(c, 'grid space (u, v) — cells: teal = pulled wide, orange = squeezed tall, dots = pinched', [bx, by + bh + 22], '#666', 13);

  // ---- titles and readouts
  label(c, `${String(k + 1).padStart(2, '0')} / ${STEPS.length}`, [40, 52], params.tool, 22, '', MONO);
  label(c, step.title, [140, 52], params.ink, 28, '600', SANS);
  wrap(c, step.note, [40, 84], 1840, 17, '#555');
  readouts(c, info, [40, 680]);
  progress(c, t, W, H);
}

function readouts(c, info, [x, y]) {
  if (!info) return;
  const { E } = info, row = (name, v, yy, lo = -1.2, hi = 1.2) => {
    label(c, name.padEnd(7), [x, yy], params.ink, 15, '', MONO);
    const bx = x + 80, bw = 180, mid = bx + bw * ((0 - lo) / (hi - lo)), at = bx + bw * ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo));
    c.fillStyle = '#e6e3dc';
    c.fillRect(bx, yy - 9, bw, 10);
    c.fillStyle = v >= 0 ? params.wide : params.tall;
    c.fillRect(Math.min(mid, at), yy - 9, Math.abs(at - mid), 10);
    c.fillStyle = '#999';
    c.fillRect(mid - 0.5, yy - 12, 1, 16);
    label(c, (v >= 0 ? '+' : '') + v.toFixed(2), [bx + bw + 10, yy], params.ink, 15, '', MONO);
  };
  label(c, 'what the fish reads off the grid', [x, y], '#666', 13);
  row('head', E.head, y + 28);
  row('body', E.body, y + 52);
  row('tail', E.tail, y + 76);
  row('taper', E.taper, y + 100);
  row('arch', E.arch, y + 124, -0.4, 0.4);
  const x2 = x + 380;
  label(c, 'what it grows', [x2, y], '#666', 13);
  const facts = [
    `body plan   ${info.shape < -0.45 ? 'disc' : info.shape > 0.45 ? 'slender' : 'perch'} (${info.shape >= 0 ? '+' : ''}${info.shape.toFixed(2)})`,
    `spines      ${info.spines ?? '–'} along the back`,
    `tail        ${['truncate', 'rounded', 'forked'][info.tail] ?? '–'}`,
    `jaw         ${['closed', 'gaping', 'jutting'][info.mouth] ?? '–'}`,
    `skin        ${info.pattern ?? '–'}`,
  ];
  // Organs wrap two to a line so the list never runs into the fish.
  const organs = info.traits.length ? info.traits : ['none'];
  for (let i = 0; i < organs.length; i += 2) facts.push(`${i ? '' : 'organs'}`.padEnd(12) + organs.slice(i, i + 2).join(', '));
  facts.forEach((f, i) => label(c, f, [x2, y + 28 + i * 24], params.ink, 15, '', MONO));
}

// ---------------------------------------------------------------- drawing helpers

const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const shoelace = (q) => Math.abs(q.reduce((s, p, i) => { const n = q[(i + 1) % q.length]; return s + p[0] * n[1] - n[0] * p[1]; }, 0)) / 2;
function poly(c, pts, close = true) {
  c.beginPath();
  pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
  if (close) c.closePath();
}
function dotAt(c, [x, y], r) {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
}
function gridLines(c, P, color, w, a) {
  c.strokeStyle = color;
  c.lineWidth = w;
  c.globalAlpha = a;
  c.beginPath();
  for (let i = 0; i <= 9; i++) for (let q = 0; q <= 40; q++) { const p = P(i / 9, q / 40); q ? c.lineTo(...p) : c.moveTo(...p); }
  for (let j = 0; j <= 6; j++) for (let q = 0; q <= 40; q++) { const p = P(q / 40, j / 6); q ? c.lineTo(...p) : c.moveTo(...p); }
  c.stroke();
  c.globalAlpha = 1;
}
function arrow(c, a, b, color) {
  const d = dist(a, b);
  if (d < 3) return;
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  c.strokeStyle = c.fillStyle = color;
  c.lineWidth = 2;
  c.setLineDash([5, 4]);
  c.beginPath();
  c.moveTo(...a);
  c.lineTo(...b);
  c.stroke();
  c.setLineDash([]);
  c.beginPath();
  c.moveTo(b[0], b[1]);
  c.lineTo(b[0] - 12 * Math.cos(ang - 0.4), b[1] - 12 * Math.sin(ang - 0.4));
  c.lineTo(b[0] - 12 * Math.cos(ang + 0.4), b[1] - 12 * Math.sin(ang + 0.4));
  c.fill();
}
function label(c, text, [x, y], color, size, weight = '', family = SANS) {
  c.font = `${weight} ${size}px ${family}`;
  c.fillStyle = color;
  c.fillText(text, x, y);
}
function wrap(c, text, [x, y], maxW, size, color) {
  c.font = `${size}px ${SANS}`;
  c.fillStyle = color;
  let line = '';
  for (const word of text.split(' ')) {
    if (c.measureText(line + word).width > maxW) {
      c.fillText(line, x, y);
      y += size * 1.35;
      line = '';
    }
    line += word + ' ';
  }
  c.fillText(line, x, y);
}
function progress(c, t, W, H) {
  const n = STEPS.length, w = (W - 80) / n;
  for (let i = 0; i < n; i++) {
    c.fillStyle = i < Math.floor(t * n) ? params.tool : i === Math.floor(t * n) ? 'rgba(224,33,127,0.45)' : '#e2ded6';
    c.fillRect(40 + i * w + 2, H - 18, w - 4, 4);
  }
}
