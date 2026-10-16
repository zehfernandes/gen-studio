// Jellyfish in the one-colour teal lithograph of `fish-tool-cyan` (after the medusae plates in
// Haeckel's Kunstformen der Natur), on the same D'Arcy grid tool: drag the grid and the medusa is
// re-grown, not distorted. The bell is a surface of revolution laid in grid space: radial canals,
// contour rings, a rim with lappets; below it oral arms and tentacles. Canals and tentacles are
// counted from the rim's length on the page, so stretching the bell grows more of them; squeezing
// it tall turns a saucer into a mitre. The far side shows through the glassy bell.
//
// One free-transform tool on the grid (keys and handles: see `deform` below). Click the paper for
// a new seed; double-click resets the grid; H shows / hides the grid. The lattice is a param (an
// array, so the panel skips it): versions and exports keep the deformation.

export const config = {
  size: { width: 1800, height: 2400 },
};

const identity = () => {
  const L = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) L.push([0.1 + (0.8 * i) / 3, 0.14 + (0.72 * j) / 3]);
  return L;
};

export const params = {
  seed: 7,
  bell: { value: 0.26, min: 0.12, max: 0.42, step: 0.01, group: 'Medusa' }, // bell height, grid units
  canals: { value: 1, min: 0.4, max: 2.5, step: 0.05, group: 'Medusa' }, // radial canal density
  tentacles: { value: 1, min: 0.3, max: 3, step: 0.05, group: 'Medusa' }, // tentacle density
  pressure: { value: 1, min: 0.3, max: 2.5, step: 0.05, group: 'Pen' },
  wobble: { value: 0.4, min: 0, max: 4, step: 0.05, group: 'Pen' },
  hatch: { value: 1, min: 0, max: 2.5, step: 0.05, group: 'Pen' }, // contour-ring density
  tint: { value: 0.45, min: 0, max: 1, step: 0.01, group: 'Pen' },
  grain: { value: 0.18, min: 0, max: 1, step: 0.01, group: 'Pen' },
  showGrid: true,
  gridColor: '#e0217f', // the tool's colour: preview only, never in the drawing
  ink: '#24868d', // lithographer's teal
  paper: '#f4eee6',
  tintColor: '#a9dcd8',
  lattice: identity(),
};

// ---------------------------------------------------------------- math

const TAU = Math.PI * 2;
const FOLD = 0.05; // relative area below which the grid counts as folded: parts there are dropped
const lerp = (a, b, t) => a + (b - a) * t;
const lerp2 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const norm = (a) => mul(a, 1 / (len(a) || 1));
const perp = (a) => [-a[1], a[0]];

// Per-part streams: dragging a handle or changing one part never reshuffles another.
function hash(a, b = 0, c = 0) {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x632be5ab, 0x85ebca77) ^ Math.imul((c | 0) + 0x1b873593, 0xc2b2ae3d);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function rng(a, b) {
  let s = (hash(a, b) * 4294967296) | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tensor-product cubic through all 16 handles: an untouched lattice is exactly linear,
// a dragged one bends every grid line smoothly (fig 153).
const NODES = [0, 1 / 3, 2 / 3, 1];
const weights = (s) => NODES.map((tk, k) => NODES.reduce((w, tm, m) => (m === k ? w : (w * (s - tm)) / (tk - tm)), 1));
function makeWarp(L, W, H) {
  return (u, v) => {
    const wu = weights(u), wv = weights(v);
    let x = 0, y = 0;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const w = wu[i] * wv[j], p = L[j * 4 + i];
      x += w * p[0];
      y += w * p[1];
    }
    return [x * W, y * H];
  };
}

// Uniform Catmull-Rom through a list of values, s in [0, 1].
function curve1(vals, s) {
  const n = vals.length - 1, x = Math.min(Math.max(s, 0), 1) * n, i = Math.min(Math.floor(x), n - 1), f = x - i;
  const p0 = vals[Math.max(i - 1, 0)], p1 = vals[i], p2 = vals[i + 1], p3 = vals[Math.min(i + 2, n)];
  return 0.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (3 * p1 - p0 - 3 * p2 + p3) * f * f * f);
}

const arcPts = (c, r, a0, a1, n = 36) =>
  Array.from({ length: n + 1 }, (_, i) => { const a = lerp(a0, a1, i / n); return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]; });
const qb = (a, b, c, n = 16) =>
  Array.from({ length: n + 1 }, (_, i) => { const t = i / n, m = 1 - t; return [m * m * a[0] + 2 * m * t * b[0] + t * t * c[0], m * m * a[1] + 2 * m * t * b[1] + t * t * c[1]]; });
const bend = (a, b, k, n = 8) => {
  const d = sub(b, a), p = perp(d);
  return Array.from({ length: n + 1 }, (_, i) => { const t = i / n, s = Math.sin(Math.PI * t) * k; return [a[0] + d[0] * t + p[0] * s, a[1] + d[1] * t + p[1] * s]; });
};
function chaikin(pts, it = 2) {
  for (let k = 0; k < it; k++) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) out.push(lerp2(pts[i], pts[i + 1], 0.25), lerp2(pts[i], pts[i + 1], 0.75));
    out.push(pts.at(-1));
    pts = out;
  }
  return pts;
}
function inside([x, y], poly) {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
  }
  return ins;
}
function distToPoly(p, poly) {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], ab = sub(poly[(i + 1) % poly.length], a);
    const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
    d = Math.min(d, len(sub(p, add(a, mul(ab, t)))));
  }
  return d;
}


// ---------------------------------------------------------------- the medusa, in (u, v) of the grid

let S;

const area = (u, v) => {
  const e = 1e-3, ju = sub(S.P(u + e, v), S.P(u - e, v)), jv = sub(S.P(u, v + e), S.P(u, v - e));
  return (ju[0] * jv[1] - ju[1] * jv[0]) / (4 * e * e) / S.A0;
};

// log(horizontal ÷ vertical scale) of the grid at (u, v): 0 untouched, > 0 pulled wide, < 0 tall.
function stretchAt(u, v) {
  const e = 0.01, { P, W, H } = S;
  const sx = len(sub(P(u + e, v), P(u - e, v))) / (2 * e * 0.8 * W), sy = len(sub(P(u, v + e), P(u, v - e))) / (2 * e * 0.72 * H);
  return Math.max(-1.2, Math.min(1.2, Math.log((sx || 1e-6) / (sy || 1e-6))));
}

function genome(seed) {
  const r = rng(seed, 77), range = (a, b) => lerp(a, b, r());
  const pick = (names, ws) => { let x = r() * ws.reduce((a, b) => a + b); return names[ws.findIndex((w) => (x -= w) < 0)]; };
  return {
    q: range(0.3, 1.05), // bell profile: low = saucer, high = mitre
    p: range(1.5, 2.8), // how square the shoulders are
    width: range(0.26, 0.38), // half-width of the bell, grid units
    tilt: range(0.03, 0.06), // how much of the rim's ellipse we see
    canalK: range(0.7, 1.4),
    tentacle: pick(['coiled', 'wavy', 'straight', 'curtain'], [35, 30, 15, 20]),
    tentacleLen: range(0.32, 0.55),
    tentacleK: range(0.7, 1.5),
    arms: pick(['frilled', 'ribbon', 'short', 'none'], [35, 30, 20, 15]), // oral arms
    armLen: range(0.22, 0.5),
    gonads: pick(['horseshoe', 'folded', 'none'], [35, 40, 25]),
    stripes: r() < 0.18, // dark radial bands on the bell (Chrysaora)
    warts: r() < 0.25, // nematocyst warts (Pelagia)
    sway: range(-1, 1), // the current the tentacles drift in
  };
}

// The bell as a surface of revolution: rho 0 (apex) … 1 (rim), phi the azimuth (0 = facing us).
// The profile morphs with the grid: a bell squeezed tall grows taller, one pulled wide flattens.
function buildJelly() {
  const { G } = S, e = stretchAt(0.5, 0.24);
  const q = Math.max(0.2, Math.min(1.4, G.q * Math.exp(-0.8 * e)));
  const J = { cx: 0.5, hw: G.width, H: params.bell, vm: 0.1 + params.bell, tilt: G.tilt, q, p: G.p };
  J.prof = (rho) => (1 - Math.min(1, Math.abs(rho)) ** J.p) ** J.q;
  J.uv = (rho, phi, k = 1) => [J.cx + J.hw * rho * Math.sin(phi), J.vm - J.H * J.prof(rho) * k + J.tilt * rho * Math.cos(phi)];
  J.at = (rho, phi, k = 1) => S.P(...J.uv(rho, phi, k));
  J.ok = (rho, phi) => area(...J.uv(rho, phi)) >= FOLD;
  J.shape = q > 1 ? 'mitre' : q > 0.7 ? 'bell' : q > 0.42 ? 'dome' : 'saucer';
  // Silhouette: down the left shoulder, across the front rim, up the right shoulder.
  const sil = [];
  for (let k = 40; k >= 0; k--) sil.push(J.at(k / 40, -Math.PI / 2));
  for (let k = 0; k <= 40; k++) sil.push(J.at(k / 40, Math.PI / 2));
  for (let k = 0; k <= 40; k++) sil.push(J.at(1, Math.PI / 2 - (Math.PI * k) / 40));
  J.sil = sil;
  // Rim length on the page decides how many canals and tentacles there are.
  let rim = 0;
  for (let k = 0; k < 80; k++) rim += len(sub(J.at(1, (TAU * (k + 1)) / 80), J.at(1, (TAU * k) / 80)));
  J.rim = rim;
  J.canals = Math.max(4, 4 * Math.round(rim / (S.U * 520 * G.canalK / params.canals) / 4) || 4);
  J.nTent = Math.max(8, Math.round((rim / (S.U * 46 * G.tentacleK)) * params.tentacles));
  S.J = J;
  if (J.canals >= 24) S.traits.add('multiradiata');
}

// A band of the bell's front surface between two rings, as a page polygon.
const ringBand = (a, b, n = 40) => {
  const { J } = S, outer = [], inner = [];
  for (let k = 0; k <= n; k++) {
    const phi = -Math.PI / 2 + (Math.PI * k) / n;
    outer.push(J.at(b, phi));
    inner.push(J.at(a, phi));
  }
  return [...outer, ...inner.reverse()];
};

// Page polyline from uv samples, split where the grid folds over itself.
function uvLine(c, pts, opts) {
  let run = [];
  const flush = () => { if (run.length > 1) pen(c, run, { ...opts, id: (opts.id ?? 0) + run.length }); run = []; };
  for (const q of pts) {
    if (area(q[0], q[1]) < FOLD) { flush(); continue; }
    run.push(S.P(q[0], q[1]));
  }
  flush();
}

// ---------------------------------------------------------------- parts

function bellTint(c) {
  const { J } = S;
  tint(c, J.sil, 0.35);
  for (let i = 0; i < 5; i++) tint(c, ringBand(0.6 + 0.08 * i, 1), 0.1); // deeper toward the rim
  tint(c, ringBand(0, 0.25), 0.15); // the apex's thick jelly
}

// Contour rings of latitude: drawn only where the tone beats each ring's own threshold (golden-
// ratio dither), dark at the shoulders and the rim, faint in the middle; the full rings are strong,
// the half-tones faint, as on the stone.
function rings(c) {
  const { J, G, U } = S, N = Math.round(26 * params.hatch);
  const tone = (rho, phi) => {
    let v = 0.1 + 0.75 * Math.abs(Math.sin(phi)) ** 3 + 0.5 * rho ** 5;
    if (G.stripes) v += 0.9 * (Math.cos(J.canals * 0.5 * phi) > 0.55);
    return Math.min(1, v);
  };
  const strong = new Path2D(), faint = new Path2D();
  for (let j = 1; j < N; j++) {
    const rho = j / N, th = (j * 0.6180339) % 1;
    let onS = false, onF = false;
    for (let k = 0; k <= 90; k++) {
      const phi = -Math.PI / 2 + (Math.PI * k) / 90, t = tone(rho, phi), p = J.at(rho, phi), ok = J.ok(rho, phi);
      const s = ok && t > Math.max(th, 0.55), f = ok && t > th && !s;
      s ? (onS ? strong.lineTo(...p) : strong.moveTo(...p)) : 0;
      f ? (onF ? faint.lineTo(...p) : faint.moveTo(...p)) : 0;
      onS = s;
      onF = f;
    }
  }
  c.lineWidth = 1.2 * S.K.lw;
  c.globalAlpha = 0.9 * (S.fade ?? 1);
  c.stroke(strong);
  c.lineWidth = 0.85 * S.K.lw;
  c.globalAlpha = 0.4;
  c.stroke(faint);
  c.globalAlpha = 1;
}

// Radial canals from the apex to the rim; the ones on the far side show faintly through the bell.
// Between them, fine ribs (three per canal) model the bell's curve: strong at the shoulders where
// the surface turns away, gone in the middle where it faces us.
function canals(c, back) {
  const { J } = S, off = hash(S.seed, 31) * TAU;
  if (!back) {
    const n = J.canals * 3;
    for (let k = 0; k < n; k++) {
      const phi = off + (TAU * (k + 0.5)) / n;
      if (Math.cos(phi) <= 0 || Math.abs(Math.sin(phi)) < 0.35) continue;
      S.fade = Math.abs(Math.sin(phi)) ** 2;
      uvLine(c, Array.from({ length: 25 }, (_, i) => J.uv(0.1 + (0.88 * i) / 24, phi)), { w: 0.9, a: 0.55, id: 20500 + k * 30, passes: 1 });
    }
    S.fade = 1;
  }
  for (let k = 0; k < J.canals; k++) {
    const phi = off + (TAU * k) / J.canals, front = Math.cos(phi) > 0;
    if (front === back) continue;
    S.fade = back ? 0.35 : 1;
    uvLine(c, Array.from({ length: 31 }, (_, i) => J.uv(0.04 + (0.96 * i) / 30, phi)), { w: 1.7, a: 0.9, id: 20000 + k * 40, passes: 1 });
    S.fade = 1;
  }
}

function gonads(c) {
  const { J, G } = S;
  if (G.gonads === 'none') return;
  for (let k = 0; k < 4; k++) {
    const phi0 = Math.PI / 4 + (k * Math.PI) / 2, front = Math.cos(phi0) > 0;
    S.fade = front ? 1 : 0.4;
    if (G.gonads === 'horseshoe') {
      // A horseshoe (Aurelia's "ears"): a U of tissue around the canal, tinted and outlined.
      const arc = (dr) => Array.from({ length: 25 }, (_, i) => { const s = i / 24; return J.uv(0.28 + dr + 0.3 * Math.sin(Math.PI * s), phi0 + (s - 0.5) * 1.1); });
      const outer = arc(0.05), inner = arc(-0.03);
      tint(c, [...outer, ...inner.reverse()].map((q) => S.P(...q)), 0.9);
      uvLine(c, arc(0.05), { w: 1.6, a: 0.85, id: 21000 + k * 50, passes: 1 });
      uvLine(c, arc(-0.03), { w: 1.1, a: 0.7, id: 21100 + k * 50, passes: 1 });
    } else {
      // Folded: a frilled ribbon hanging along the canal under the bell.
      const pts = Array.from({ length: 60 }, (_, i) => { const r0 = 0.32 + (0.5 * i) / 59; return J.uv(r0, phi0 + 0.07 * Math.sin(i * 1.3), 0.86); });
      uvLine(c, pts, { w: 1.4, a: 0.85, id: 21200 + k * 70, passes: 1 });
      tint(c, pts.map((q) => S.P(...q)).concat(pts.slice().reverse().map((q) => S.P(q[0] + 0.012, q[1]))), 0.7);
    }
    S.fade = 1;
  }
  S.traits.add(G.gonads === 'horseshoe' ? 'aurita' : 'plicata');
}

function warts(c) {
  const { J, G, U } = S;
  if (!G.warts) return;
  const r = rng(S.seed, 33);
  for (let i = 0; i < 70; i++) {
    const rho = 0.15 + r() * 0.8, phi = (r() - 0.5) * Math.PI * 0.95, rad = (3 + r() * 4) * U;
    if (!J.ok(rho, phi)) continue;
    const p = J.at(rho, phi);
    pen(c, arcPts(p, rad, 0, TAU, 12), { w: 1, a: 0.7, id: 22000 + i, passes: 1 });
  }
  S.traits.add('noctiluca');
}

// The bell's own lines: outer outline, the subumbrella seen through it, the far rim faint, the
// near rim strong with a fringe of lappets.
function bellLines(c) {
  const { J, U } = S;
  uvLine(c, Array.from({ length: 61 }, (_, k) => { const rho = Math.abs(1 - (2 * k) / 60), phi = k < 30 ? -Math.PI / 2 : Math.PI / 2; return J.uv(rho, phi); }), { w: 3, id: 23000 });
  S.fade = 0.45;
  uvLine(c, Array.from({ length: 61 }, (_, k) => { const rho = Math.abs(1 - (2 * k) / 60) * 0.9, phi = k < 30 ? -Math.PI / 2 : Math.PI / 2; return J.uv(rho, phi, 0.72); }), { w: 1.6, id: 23100 });
  uvLine(c, Array.from({ length: 41 }, (_, k) => J.uv(1, Math.PI / 2 + (Math.PI * k) / 40)), { w: 1.8, id: 23200 });
  S.fade = 1;
  uvLine(c, Array.from({ length: 81 }, (_, k) => J.uv(1, Math.PI / 2 - (Math.PI * k) / 80)), { w: 2.6, id: 23300 });
  // Lappets: small scallops hanging from the front rim, two per canal.
  const n = J.canals * 2;
  for (let k = 0; k < n; k++) {
    const a = -Math.PI / 2 + (Math.PI * k) / n, b = a + Math.PI / n;
    if (!J.ok(1, a)) continue;
    const pa = J.at(1, a), pb = J.at(1, b), mid = J.at(1.0, (a + b) / 2), down = norm(sub(S.P(J.uv(1, (a + b) / 2)[0], J.uv(1, (a + b) / 2)[1] + 0.01), mid));
    pen(c, qb(pa, add(mid, mul(down, len(sub(pb, pa)) * 0.7)), pb, 8), { w: 1.2, a: 0.8, id: 23400 + k, passes: 1 });
  }
}

// Tentacles hang from the rim, counted from its length on the page. They are laid in grid space,
// so the grid bends them; the ones behind the bell show faintly through it.
function tentacles(c, back) {
  const { J, G, U } = S, n = G.tentacle === 'curtain' ? J.nTent * 2 : J.nTent, off = hash(S.seed, 34) * TAU;
  for (let i = 0; i < n; i++) {
    const phi = off + (TAU * i) / n, front = Math.cos(phi) > 0;
    if (front === back) continue;
    const [u0, v0] = J.uv(1, phi), h = hash(S.seed, 35, i), L = G.tentacleLen * (0.75 + 0.5 * h) * (G.tentacle === 'curtain' ? 0.7 : 1);
    const pts = [];
    for (let k = 0; k <= 160; k++) {
      const f = k / 160, sway = G.sway * 0.06 * f * f;
      let x = u0 + sway + 0.006 * Math.sin(f * 5 + i), y = v0 + L * f;
      if (G.tentacle === 'coiled') {
        // Corkscrew loops, tighter and smaller toward the tip.
        const th = f * (22 + 10 * h) * TAU, rad = 0.011 * (1 - 0.6 * f);
        x += rad * Math.sin(th);
        y += rad * 0.7 * Math.cos(th);
      } else if (G.tentacle === 'wavy') x += 0.011 * Math.sin(f * 7 * TAU + i);
      pts.push([x, y]);
    }
    S.fade = back ? 0.35 : 1;
    uvLine(c, pts, { w: G.tentacle === 'curtain' ? 0.9 : 1.3, a: 0.85, id: 24000 + i * 200, passes: 1 });
    if (G.tentacle !== 'curtain') {
      // A small bulb where the tentacle leaves the rim.
      const p = S.P(u0, v0 + 0.004);
      tint(c, arcPts(p, 5 * U, 0, TAU, 12), 1.2);
      pen(c, arcPts(p, 5 * U, 0, TAU, 12), { w: 1, a: 0.8, id: 24500 + i, passes: 1 });
    }
    S.fade = 1;
  }
  S.traits.add({ coiled: 'spiralis', wavy: 'undulata', straight: 'filifera', curtain: 'cirrata' }[G.tentacle]);
}

// The manubrium (a stalk under the bell) and the oral arms hanging from it.
function oralArms(c) {
  const { J, G } = S;
  if (G.arms === 'none') return;
  const top = J.vm - J.H * 0.5, root = J.vm + 0.02, L = G.armLen * (G.arms === 'short' ? 0.4 : 1);
  // Stalk, seen through the bell.
  S.fade = 0.6;
  for (const dx of [-0.025, 0.025]) uvLine(c, [[J.cx + dx * 0.6, top], [J.cx + dx, root]], { w: 1.6, id: 25000 + (dx > 0) });
  tint(c, [[J.cx - 0.015, top], [J.cx + 0.015, top], [J.cx + 0.025, root], [J.cx - 0.025, root]].map((q) => S.P(...q)), 0.8);
  S.fade = 1;
  const spread = [-1, -0.35, 0.35, 1];
  spread.forEach((sp, a) => {
    const back = Math.abs(sp) < 0.5; // the middle two hang behind
    S.fade = back ? 0.5 : 1;
    const centre = (f) => [J.cx + sp * 0.05 * f + G.sway * 0.04 * f * f + 0.01 * Math.sin(f * 3 + a), root + L * f];
    const width = (f) => 0.028 * (1 - 0.55 * f) * (G.arms === 'ribbon' ? Math.abs(Math.cos(f * 7 + a)) * 0.8 + 0.2 : 1);
    const frill = (f, side) => (G.arms === 'frilled' ? 1 + 0.45 * Math.sin(f * 60 + side * 1.7 + a) : 1);
    const left = [], right = [];
    for (let k = 0; k <= 80; k++) {
      const f = k / 80, [x, y] = centre(f), w = width(f);
      left.push([x - w * frill(f, -1), y]);
      right.push([x + w * frill(f, 1), y]);
    }
    tint(c, [...left, ...right.slice().reverse()].map((q) => S.P(...q)), 0.8);
    uvLine(c, left, { w: 1.5, a: 0.9, id: 26000 + a * 300, passes: 1 });
    uvLine(c, right, { w: 1.5, a: 0.9, id: 26100 + a * 300, passes: 1 });
    for (const q of [0.33, 0.66]) uvLine(c, left.map((p, k) => lerp2(p, right[k], q)), { w: 0.8, a: 0.5, id: 26200 + a * 300 + q * 10, passes: 1 });
    S.fade = 1;
  });
  if (G.arms === 'frilled' && G.armLen > 0.4) S.traits.add('crispata');
  if (G.arms === 'ribbon') S.traits.add('taeniata');
}

// A highlight lifted off the glassy bell: a feathered patch erased from the ink layer.
function highlight(c) {
  const { J } = S;
  c.save();
  c.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 4; i++) {
    const poly = [];
    const a0 = -1.15 + i * 0.08, a1 = -0.35 - i * 0.08, r0 = 0.42 + i * 0.03, r1 = 0.78 - i * 0.04;
    for (let k = 0; k <= 20; k++) poly.push(J.at(r1, lerp(a0, a1, k / 20)));
    for (let k = 20; k >= 0; k--) poly.push(J.at(r0, lerp(a0, a1, k / 20)));
    c.globalAlpha = 0.28;
    c.beginPath();
    poly.forEach((p, j) => (j ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
    c.fill();
  }
  c.restore();
}

// ---------------------------------------------------------------- the plate's caption

const GENERA = { saucer: ['Aurelia', 'plana'], dome: ['Aequorea', 'pellucida'], bell: ['Olindias', 'campanulata'], mitre: ['Leuckartiara', 'mitra'] };
function speciesName() {
  const { J, G, traits } = S;
  const genus = G.stripes ? 'Chrysaora' : G.warts ? 'Pelagia' : J.nTent > 90 ? 'Cyanea' : GENERA[J.shape][0];
  const epithet = ['multiradiata', 'crispata', 'spiralis', 'aurita', 'taeniata', 'cirrata', 'noctiluca', 'undulata', 'plicata', 'filifera'].find((t) => traits.has(t)) ?? GENERA[J.shape][1];
  const name = `${genus} ${epithet}`;
  const fig = 1 + ([...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 9);
  return { fig, name };
}

function caption(c) {
  const { W, H, U } = S, { fig, name } = speciesName(), size = 46 * U;
  const roman = `${size}px Georgia, 'Times New Roman', serif`, italic = `italic ${roman}`;
  const a = `Fig. ${fig}.  `, b = `${name}.`;
  c.font = roman;
  const wa = c.measureText(a).width;
  c.font = italic;
  const x = (W - wa - c.measureText(b).width) / 2, y = H - 70 * U;
  c.fillStyle = params.ink;
  c.font = roman;
  c.fillText(a, x, y);
  c.font = italic;
  c.fillText(b, x + wa, y);
}

// ---------------------------------------------------------------- the pencil

// A smooth low-frequency wobble (three summed sines of arc length, never per-point noise),
// stroked in two passes at slightly different width and opacity.
// Pressure: each stroke starts thin, presses through the middle and flicks off, with a slow
// pressure swell along the way; strokes overshoot their ends a little, as a hand does. `ruled`
// lines (the grid) are drawn against a straightedge: even width, no overshoot.
const taper = (f) => Math.max(0.2, Math.min(1, f / 0.1) ** 0.6 * Math.min(1, (1 - f) / 0.22) ** 0.8);
function pen(c, pts, { w = 2, a = 0.95, id = 0, passes = 2, ruled = false } = {}) {
  if (pts.length < 2) return;
  const { K, U } = S;
  if (!ruled && pts.length > 2) {
    const over = (1 + hash(K.seed, id, 7) * 3) * U, d0 = norm(sub(pts[0], pts[1])), d1 = norm(sub(pts.at(-1), pts.at(-2)));
    pts = [add(pts[0], mul(d0, over * 0.4)), ...pts, add(pts.at(-1), mul(d1, over))];
  }
  const n = pts.length, s = [0];
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + len(sub(pts[i], pts[i - 1]));
  const L = s[n - 1] || 1, ph = [1, 2, 3, 4].map((k) => hash(K.seed, id, k) * TAU);
  for (let p = 0; p < passes; p++) {
    const q = pts.map((pt, i) => {
      const t = norm(sub(pts[Math.min(i + 1, n - 1)], pts[Math.max(i - 1, 0)]));
      const o = K.wob * (Math.sin(s[i] / K.f1 + ph[0] + p * 1.7) + 0.5 * Math.sin(s[i] / K.f2 + ph[1] + p * 2.3) + 0.25 * Math.sin(s[i] / K.f3 + ph[2] + p));
      return [pt[0] - t[1] * o, pt[1] + t[0] * o];
    });
    const w0 = w * K.lw * (p ? 0.55 : 1);
    c.globalAlpha = a * (p ? 0.5 : 1) * (S.fade ?? 1); // S.fade: parts seen through the body
    if (ruled) {
      c.beginPath();
      q.forEach((pt, i) => (i ? c.lineTo(pt[0], pt[1]) : c.moveTo(pt[0], pt[1])));
      c.lineWidth = w0;
      c.stroke();
      continue;
    }
    for (let i = 0; i < n - 1; i++) {
      const m = (s[i] + s[i + 1]) / 2;
      c.beginPath();
      c.moveTo(q[i][0], q[i][1]);
      c.lineTo(q[i + 1][0], q[i + 1][1]);
      c.lineWidth = w0 * taper(m / L) * (0.78 + 0.22 * Math.sin(m / (K.f1 * 1.6) + ph[3]));
      c.stroke();
    }
  }
  c.globalAlpha = 1;
}


function paper(c) {
  const { W, H, U } = S, r = rng(1, 99);
  c.fillStyle = params.paper;
  c.fillRect(0, 0, W, H);
  c.fillStyle = params.ink;
  c.globalAlpha = 0.035;
  c.beginPath();
  for (let i = 0; i < 6000; i++) {
    const x = r() * W, y = r() * H, rad = (0.5 + r() * 1.2) * U;
    c.moveTo(x + rad, y);
    c.arc(x, y, rad, 0, TAU);
  }
  c.fill();
  c.globalAlpha = 1;
  c.strokeStyle = c.fillStyle = params.ink;
}

// A translucent aqua wash under the lines (multiply, like a second litho stone in a pale ink).
function tint(c, poly, k = 1) {
  if (poly.length < 3 || params.tint <= 0) return;
  c.save();
  c.fillStyle = params.tintColor;
  c.globalAlpha = Math.min(1, params.tint * k * (S.fade ?? 1));
  c.beginPath();
  poly.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
  c.closePath();
  c.fill();
  c.restore();
}

// ---------------------------------------------------------------- graphite

// One ink layer per target context (the preview and the export never share one), sized in device
// pixels and drawn with the target's transform, so tiles and scale behave exactly as on `c`.
const layers = new WeakMap(), tiles = new Map();
function inkLayer(c) {
  let L = layers.get(c);
  if (!L || L.canvas.width !== c.canvas.width || L.canvas.height !== c.canvas.height) {
    const cv = document.createElement('canvas');
    cv.width = c.canvas.width;
    cv.height = c.canvas.height;
    L = cv.getContext('2d');
    layers.set(c, L);
    L.target = c;
  }
  L.setTransform(1, 0, 0, 1, 0, 0);
  L.globalCompositeOperation = 'source-over';
  L.clearRect(0, 0, L.canvas.width, L.canvas.height);
  L.setTransform(c.getTransform());
  L.globalCompositeOperation = 'multiply';
  L.lineCap = L.lineJoin = 'round';
  L.strokeStyle = L.fillStyle = params.ink;
  return L;
}

// The paper's tooth as a seeded tile in device pixels: specks and short fibres where graphite
// skips. Built once per device scale; the same scale gives the same tile, so exports reproduce.
function toothTile(px) {
  const size = Math.max(32, Math.round(512 * px));
  if (tiles.has(size)) return tiles.get(size);
  const cv = document.createElement('canvas'), t = cv.getContext('2d'), r = rng(1, 98);
  cv.width = cv.height = size;
  t.fillStyle = t.strokeStyle = '#000';
  for (let i = 0; i < 11000; i++) {
    const x = r() * size, y = r() * size, rad = (0.7 + r() * 1.6) * px; // no floor: coverage stays the same at every scale
    t.globalAlpha = 0.3 + r() * 0.7;
    t.beginPath();
    t.arc(x, y, rad, 0, TAU);
    t.fill();
  }
  t.lineWidth = px;
  for (let i = 0; i < 1800; i++) {
    const x = r() * size, y = r() * size, l = (4 + r() * 16) * px;
    t.globalAlpha = 0.25 + r() * 0.5;
    t.beginPath();
    t.moveTo(x, y);
    t.lineTo(x + l, y + (r() - 0.5) * 2 * px);
    t.stroke();
  }
  tiles.set(size, cv);
  return cv;
}

function finishInk(L, api) {
  const c = L.target, px = Math.hypot(L.getTransform().a, L.getTransform().b) * (api.width / 1800);
  L.setTransform(1, 0, 0, 1, 0, 0);
  if (params.grain > 0) {
    L.globalCompositeOperation = 'destination-out';
    L.globalAlpha = Math.min(1, params.grain * 1.5);
    L.fillStyle = L.createPattern(toothTile(px), 'repeat');
    L.fillRect(0, 0, L.canvas.width, L.canvas.height);
    L.globalAlpha = 1;
  }
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'multiply';
  c.drawImage(L.canvas, 0, 0);
  c.restore();
  c.fillStyle = c.strokeStyle = params.ink;
  return c;
}


// ---------------------------------------------------------------- draw

/** @param {GenStudio.Canvas2D} c  @param {number} _t  @param {GenStudio.Api} api */
export function draw(c, _t, api) {
  const { width: W, height: H } = api, U = W / 1800, seed = params.seed | 0;
  S = {
    W, H, U, seed,
    P: makeWarp(params.lattice, W, H),
    A0: W * H * 0.8 * 0.72,
    G: genome(seed),
    traits: new Set(), // features this draw grew; the caption reads them
    post: [],
    fade: 1, // parts seen through the glass are drawn faint
    K: { seed, wob: params.wobble * 2.5 * U, f1: 140 * U, f2: 47 * U, f3: 19 * U, lw: params.pressure * U },
  };
  buildJelly();
  c.lineCap = c.lineJoin = 'round';

  paper(c);
  const ink = inkLayer(c);
  c = ink;
  // Back to front: what lies behind the glassy bell first, faint; the bell's tint then lies over it.
  tentacles(c, true);
  canals(c, true);
  oralArms(c);
  bellTint(c);
  rings(c);
  gonads(c);
  canals(c, false);
  warts(c);
  highlight(c);
  bellLines(c);
  tentacles(c, false);
  c = finishInk(ink, api);
  S.post.forEach((f) => f(c));
  caption(c);

  if (!api.exporting && params.showGrid) handles(c); // the grid is the tool, never the drawing
}

// ---------------------------------------------------------------- the tools (preview only)

// Corners → handles, *flat*: bilinear, not projective. A projective map foreshortens the far side
// and reads as a plane receding in 3D; D'Arcy's tapered grids (figs 151, 152) keep even spacing, so
// the fish is re-proportioned on the page, never seen at an angle.
const bilinear = ([p0, p1, p2, p3], [s, t]) => lerp2(lerp2(p0, p1, s), lerp2(p3, p2, s), t); // TL, TR, BR, BL
function unbilinear(quad, p) {
  // Newton's method from the centre; a few steps are exact to well under a pixel.
  let st = [0.5, 0.5];
  for (let k = 0; k < 12; k++) {
    const e = 1e-4, f = sub(bilinear(quad, st), p);
    const ds = mul(sub(bilinear(quad, [st[0] + e, st[1]]), bilinear(quad, st)), 1 / e);
    const dt = mul(sub(bilinear(quad, [st[0], st[1] + e]), bilinear(quad, st)), 1 / e);
    const det = ds[0] * dt[1] - ds[1] * dt[0] || 1e-9;
    st = [st[0] - (f[0] * dt[1] - f[1] * dt[0]) / det, st[1] - (ds[0] * f[1] - ds[1] * f[0]) / det];
  }
  return st;
}
const CORNERS = [0, 3, 15, 12]; // TL, TR, BR, BL — the order `bilinear` expects
const round4 = (p) => [+p[0].toFixed(4), +p[1].toFixed(4)];

// One free-transform tool, like Photoshop's: what a drag does depends on the handle and the keys.
//   corner          scale from the opposite corner      ⇧ keep proportions
//   edge            stretch one axis from the opposite side
//   ⌥ (corner/edge) scale from the centre instead
//   ⌘ corner        distort: move that corner alone
//   ⌘ edge          taper or skew that side (figs 151, 152)
//   inner handle    bend (fig 153)   ·   ⌘⌥ any handle: bend it   ·   drag the paper: move
// Every action re-maps the *existing* lattice, so a scale or a perspective keeps the bends under it.
const kindOf = (i) => (i < 0 ? 'move' : CORNERS.includes(i) ? 'corner' : [5, 6, 9, 10].includes(i) ? 'inner' : 'edge');
function actionOf(idx, { shift, alt, cmd }) {
  const kind = kindOf(idx);
  if (kind === 'move') return 'move';
  if (kind === 'inner' || (cmd && alt)) return 'bend';
  if (cmd) return kind === 'corner' ? 'distort' : 'taper';
  return kind === 'corner' ? (shift ? 'scale-uniform' : 'scale') : 'stretch';
}

function deform(orig, idx, d, mods) {
  const action = actionOf(idx, mods);
  if (action === 'move') return orig.map((p) => round4(add(p, d)));
  const col = idx % 4, row = Math.floor(idx / 4), o = orig[idx];
  if (action === 'bend') return orig.map((p, i) => (i === idx ? round4(add(p, d)) : p));
  if (action.startsWith('scale') || action === 'stretch') {
    // Anchor: the mirrored handle (opposite corner / side), or the centre with ⌥.
    const a = mods.alt ? lerp2(orig[0], orig[15], 0.5) : orig[(3 - row) * 4 + (3 - col)];
    const k = (i) => (Math.abs(o[i] - a[i]) < 1e-3 ? 1 : (o[i] + d[i] - a[i]) / (o[i] - a[i]));
    let sx = k(0), sy = k(1);
    if (action === 'stretch') (col === 0 || col === 3) ? (sy = 1) : (sx = 1);
    if (action === 'scale-uniform') sx = sy = Math.abs(sx - 1) > Math.abs(sy - 1) ? sx : sy;
    const safe = (v) => (Math.abs(v) < 0.05 ? Math.sign(v || 1) * 0.05 : v);
    sx = safe(sx); sy = safe(sy);
    return orig.map((p) => round4([a[0] + (p[0] - a[0]) * sx, a[1] + (p[1] - a[1]) * sy]));
  }
  // distort / taper: move the four corners, carry every handle with them (flat, see `bilinear`).
  const quad = CORNERS.map((i) => orig[i]), next = quad.map((p) => [...p]);
  if (action === 'distort') next[CORNERS.indexOf(idx)] = add(next[CORNERS.indexOf(idx)], d);
  else {
    // Along the side it spreads or pinches the two corners; across it, it slides the side.
    const side = col === 0 ? [0, 3] : col === 3 ? [1, 2] : row === 0 ? [0, 1] : [3, 2];
    const [i0, i1] = side, mid = lerp2(quad[i0], quad[i1], 0.5), along = norm(sub(quad[i1], quad[i0]));
    // Normalised by the half side, so the corners travel about as far as the pointer.
    const off = sub(o, mid), half = len(sub(quad[i1], quad[i0])) / 2 || 1e-3;
    const k = Math.max(0.05, 1 + dot(d, norm(off)) / half), across = sub(d, mul(along, dot(d, along)));
    for (const i of side) next[i] = add(add(mid, mul(sub(quad[i], mid), k)), across);
  }
  return orig.map((p) => round4(bilinear(next, unbilinear(quad, p))));
}

const CURSORS = { move: 'move', bend: 'grab', distort: 'crosshair', taper: 'crosshair', scale: 'nwse-resize', 'scale-uniform': 'nwse-resize', stretch: 'ew-resize' };
const EYES = ['ringed', 'plain', 'double', 'lidded', 'tiny'];
let hover = -1, eyeHit = null; // eyeHit: [x, y, radius] of the preview's eye, canvas units

// The grid is a tool, not part of the drawing: crisp guides in `gridColor` on top of the preview (like
// non-photo blue on a drawing board), untouched by pressure, wobble or grain, and never exported.
// 9 × 6 cells, so every handle (at thirds) sits on a grid crossing. Sizes are screen pixels.
function handles(c) {
  const { W, H, P } = S, L = params.lattice, px = (p) => [p[0] * W, p[1] * H];
  // One *screen* pixel in design px: the canvas is often shown smaller than its pixel size.
  const shown = c.canvas.getBoundingClientRect().width || c.canvas.width;
  const d = c.canvas.width / shown / Math.hypot(c.getTransform().a, c.getTransform().b);
  c.save();
  c.globalCompositeOperation = 'source-over';
  c.strokeStyle = params.gridColor;
  c.lineWidth = d;
  c.globalAlpha = 0.75;
  c.beginPath();
  for (let i = 0; i <= 9; i++) for (let k = 0; k <= 60; k++) { const q = P(i / 9, k / 60); k ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }
  for (let j = 0; j <= 6; j++) for (let k = 0; k <= 60; k++) { const q = P(k / 60, j / 6); k ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); }
  c.stroke();
  c.setLineDash([6 * d, 4 * d]);
  c.lineWidth = 1.5 * d;
  c.beginPath();
  CORNERS.forEach((i, k) => (k ? c.lineTo(...px(L[i])) : c.moveTo(...px(L[i]))));
  c.closePath();
  c.stroke();
  c.setLineDash([]);
  c.globalAlpha = 1;
  L.forEach((p, i) => {
    const [x, y] = px(p), kind = kindOf(i), r = (kind === 'corner' ? 5 : 4) * d;
    c.beginPath();
    if (kind === 'inner') c.arc(x, y, r, 0, TAU);
    else c.rect(x - r, y - r, 2 * r, 2 * r);
    c.fillStyle = i === hover ? params.gridColor : '#fff';
    c.fill();
    c.lineWidth = 1.5 * d;
    c.stroke();
  });
  c.restore();
}

const off = new WeakMap();

/** @param {GenStudio.Canvas2D} c  @param {GenStudio.Api} api */
export function setup(c, api) {
  if (api.exporting) return; // the hidden export canvas has no hands
  const cv = c.canvas;
  let drag = null, press = null, reseedTimer = 0;
  const at = (e) => {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, aspect: r.width / r.height };
  };
  const nearest = ({ x, y, aspect }) => {
    let best = -1, bd = 0.03;
    params.lattice.forEach(([px, py], i) => {
      const d = Math.hypot((px - x) * aspect, py - y);
      if (d < bd) (bd = d), (best = i);
    });
    return best;
  };
  const onEye = ({ x, y, aspect }) => eyeHit && Math.hypot((x - eyeHit[0]) * aspect, y - eyeHit[1]) < eyeHit[2] * 1.3;
  const down = (e) => {
    // Handles win; then a click on the eye loops its type; anything else grabs the whole sheet.
    // With the grid hidden there is nothing to grab: only the eye still answers.
    const p = at(e), idx = params.showGrid ? nearest(p) : -1;
    press = { p, idx, moved: false, eye: idx < 0 && onEye(p) };
    if (press.eye) {
      params.eye = EYES[(EYES.indexOf(params.eye) + 1) % EYES.length];
      return;
    }
    if (!params.showGrid) return;
    drag = { p, idx, orig: params.lattice.map((q) => [...q]) };
    cv.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const move = (e) => {
    const p = at(e);
    if (press && Math.hypot((p.x - press.p.x) * p.aspect, p.y - press.p.y) > 0.004) press.moved = true;
    const mods = { shift: e.shiftKey, alt: e.altKey, cmd: e.metaKey || e.ctrlKey };
    if (!drag) {
      hover = params.showGrid ? nearest(p) : -1;
      cv.style.cursor = hover < 0 && onEye(p) ? 'pointer' : params.showGrid ? CURSORS[actionOf(hover, mods)] : '';
      return;
    }
    // Keys are read on every move, so ⇧ or ⌘ can be pressed mid-drag, as in Photoshop.
    params.lattice = deform(drag.orig, drag.idx, [p.x - drag.p.x, p.y - drag.p.y], mods);
  };
  const up = () => (drag = null);
  // A click on bare paper (no handle, no eye, no drag) breeds a new fish: a new seed. It waits a
  // beat so a double-click can cancel it and reset the grid instead. Math.random is fine here: the
  // seed is a param, chosen outside the render path, like the app's own R key.
  const click = () => {
    const was = press;
    press = null;
    if (!was || was.moved || was.eye || was.idx >= 0) return;
    clearTimeout(reseedTimer);
    reseedTimer = setTimeout(() => (params.seed = Math.floor(Math.random() * 100000)), 260);
  };
  // Fast clicks on the eye are cycling it, not asking for a reset.
  const reset = (e) => {
    clearTimeout(reseedTimer);
    if (params.showGrid && !onEye(at(e))) params.lattice = identity();
  };
  const events = { pointerdown: down, pointermove: move, pointerup: up, pointercancel: up, click, dblclick: reset };
  for (const [k, f] of Object.entries(events)) cv.addEventListener(k, f);
  // H shows / hides the grid tool (G is taken: it hides the panel). Same guard as the app's own
  // keys: not while typing in an input or the panel, not with modifiers.
  const key = (e) => {
    if (e.key.toLowerCase() !== 'h' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select, button, [contenteditable], .dialkit-root')) return;
    params.showGrid = !params.showGrid;
  };
  window.addEventListener('keydown', key);
  off.set(c, () => {
    clearTimeout(reseedTimer);
    for (const [k, f] of Object.entries(events)) cv.removeEventListener(k, f);
    window.removeEventListener('keydown', key);
  });
}

/** @param {GenStudio.Canvas2D} c */
export function dispose(c) {
  off.get(c)?.();
  off.delete(c);
}
