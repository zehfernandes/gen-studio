// The pencil fish of `fish-tool-drawing`, moved into a one-colour teal lithograph (after the
// plates in Haeckel's Kunstformen der Natur): teal ink on warm white paper, a translucent aqua
// tint, and shading as fine contour lines that follow the body instead of stipple.
// D'Arcy Thompson's transformation grids (On Growth and Form, figs 150–153), as a tool.
// Drag the grid's handles: the fish is not distorted, it is re-grown from the warped grid.
// Landmarks ride the warp; spines, rays, the eye and the shading are generated again in
// output space, so a stretched back grows more spines and a deeper body grows taller fins.
//
// One free-transform tool on the grid (keys and handles: see `deform` below). Click the eye for
// the next eye. Click the paper for a new seed; double-click resets the grid; H shows / hides the grid. The caption names the species the fish has become. The lattice is a param (an array, so the panel skips it): versions and
// exports keep the deformation.

export const config = {
  size: { width: 2400, height: 1800 },
};

const identity = () => {
  const L = [];
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) L.push([0.1 + (0.8 * i) / 3, 0.14 + (0.72 * j) / 3]);
  return L;
};

export const params = {
  seed: 7,
  eye: { value: 'ringed', options: ['ringed', 'plain', 'double', 'lidded', 'tiny'], group: 'Fish' }, // or click the eye
  depth: { value: 0.3, min: 0.15, max: 0.48, step: 0.01, group: 'Fish' },
  spineSpacing: { value: 34, min: 18, max: 90, step: 1, group: 'Fish' },
  pressure: { value: 1, min: 0.3, max: 2.5, step: 0.05, group: 'Pen' },
  wobble: { value: 0.5, min: 0, max: 4, step: 0.05, group: 'Pen' },
  hatch: { value: 1, min: 0, max: 2.5, step: 0.05, group: 'Pen' }, // contour-line density
  stipple: { value: 0.08, min: 0, max: 3, step: 0.05, group: 'Pen' },
  tint: { value: 0.45, min: 0, max: 1, step: 0.01, group: 'Pen' }, // the translucent aqua wash
  grain: { value: 0.18, min: 0, max: 1, step: 0.01, group: 'Pen' }, // the litho stone's tooth
  showGrid: true,
  gridColor: '#e0217f', // the tool's colour: preview only, never in the drawing
  ink: '#24868d', // lithographer's teal
  paper: '#f4eee6', // warm white
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

// ---------------------------------------------------------------- the fish, in (u, v) of the grid

// Half-depth profiles from snout (s = 0) to caudal peduncle (s = 1).
const BODIES = [
  { top: [0, 0.5, 0.86, 1, 0.8, 0.42, 0.3], bot: [0, 0.42, 0.8, 0.92, 0.74, 0.36, 0.28], end: 0.76 }, // perch
  { top: [0, 0.7, 1, 0.95, 0.62, 0.32, 0.26], bot: [0, 0.55, 0.95, 1, 0.7, 0.3, 0.24], end: 0.74 }, // deep
  { top: [0, 0.38, 0.62, 0.72, 0.7, 0.48, 0.32], bot: [0, 0.32, 0.55, 0.64, 0.6, 0.42, 0.3], end: 0.8 }, // slender
];

// How the grid stretches the fish at u: log(horizontal ÷ vertical scale), 0 for an untouched grid,
// > 0 where it is pulled long, < 0 where it is squeezed tall. This is what makes the fish re-grow
// instead of merely stretching: a long grid breeds a slender, fork-tailed fish with a long jaw;
// a tall one an Antigonia-like disc with high fins, a round tail and a big eye (fig 153).
function makeStretch(P, W, H) {
  const e = 0.01;
  return (u) => {
    const sx = len(sub(P(u + e, 0.5), P(u - e, 0.5))) / (2 * e * 0.8 * W);
    const sy = len(sub(P(u, 0.5 + e), P(u, 0.5 - e))) / (2 * e * 0.72 * H);
    return Math.max(-1.2, Math.min(1.2, Math.log((sx || 1e-6) / (sy || 1e-6))));
  };
}

// The seed's genome: proportions and markings a species carries before any grid acts on it.
// One stream of its own, so adding a gene never reshuffles the parts' streams.
function genome(seed) {
  const r = rng(seed, 77), range = (a, b) => lerp(a, b, r());
  const G = {
    depthK: range(0.82, 1.2), // body depth
    peak: range(-0.07, 0.07), // where the body is deepest: forward (−) or back (+)
    snout: range(0.55, 0.85), // head fill exponent: low = blunt, high = pointed
    dStart: range(0.24, 0.36), dEnd: range(0.5, 0.62), dHeight: range(0.75, 1.35), dSpacing: range(0.75, 1.35),
    soft: range(0.75, 1.3), anal: range(0.7, 1.3), tail: range(0.85, 1.25),
    eyeK: range(0.8, 1.3), eyeU: range(0.08, 0.15), pect: range(0.8, 1.25),
    marks: Math.floor(r() * 4), // 0 plain · 1 bars · 2 spots · 3 dark saddle
    nBars: 3 + Math.floor(r() * 4),
    spots: Array.from({ length: 5 + Math.floor(r() * 9) }, () => [range(0.25, 0.9), range(0.1, 0.7), range(0.025, 0.05)]),
  };
  // The spiny dorsal. Weighted so the striking forms (the ones that name a species) stay uncommon.
  const pick = (names, ws) => { let x = r() * ws.reduce((a, b) => a + b); return names[ws.findIndex((w) => (x -= w) < 0)]; };
  G.dProfile = pick(['peaked', 'rising', 'even', 'falling', 'sail'], [35, 15, 15, 20, 15]); // spine heights along the fin
  G.dSpine = pick(['plain', 'curved', 'barbed', 'thick'], [50, 20, 15, 15]);
  G.dMembrane = pick(['notched', 'full', 'incised', 'none'], [45, 20, 20, 15]);
  G.dJoin = pick(['joined', 'split', 'continuous'], [60, 16, 24]); // spiny → soft dorsal
  return G;
}

function buildFish(seed, depth, E, G) {
  const r = rng(seed, 1);
  const base = Math.floor(r() * BODIES.length), b = BODIES[base];
  // The seed picks a body; the grid's stretch breeds it toward deep (squeezed) or slender (pulled).
  const t = Math.max(-1, Math.min(1, E.body / 0.6)), to = BODIES[t < 0 ? 1 : 2], k = Math.abs(t);
  // Naive and asymmetric: every profile value nudged a little, back and belly independently.
  const top = b.top.map((v, i) => lerp(v, to.top[i], k) * (1 + (r() - 0.5) * 0.14));
  const bot = b.bot.map((v, i) => lerp(v, to.bot[i], k) * (1 + (r() - 0.5) * 0.14));
  depth = Math.min(0.46, depth * G.depthK * Math.exp(-0.3 * E.body));
  // s^snout fills the head quickly (a blunt snout instead of a beak); `peak` slides the deepest
  // point fore or aft while keeping both ends in place.
  const U0 = 0.04, U1 = lerp(b.end, to.end, k);
  const s = (u) => { const x = Math.min(1, Math.max(0, (u - U0) / (U1 - U0))); return (x + G.peak * Math.sin(Math.PI * x)) ** G.snout; };
  return {
    U0, U1, base,
    at: (s) => U0 + (U1 - U0) * s,
    vTop: (u) => 0.52 - (curve1(top, s(u)) + E.hump * Math.exp(-(((s(u) - 0.22) / 0.1) ** 2))) * depth,
    vBot: (u) => 0.52 + (curve1(bot, s(u)) + E.paunch * Math.exp(-(((s(u) - 0.5) / 0.16) ** 2))) * depth * 0.92,
  };
}

// Everything a part needs for the current draw. Set at the top of draw(); canvas2d draws are
// synchronous, so the preview and the export instance never interleave inside one.
let S;

const area = (u, v) => {
  const e = 1e-3, ju = sub(S.P(u + e, v), S.P(u - e, v)), jv = sub(S.P(u, v + e), S.P(u, v - e));
  return (ju[0] * jv[1] - ju[1] * jv[0]) / (4 * e * e) / S.A0;
};

// The armature: the body's midline. Parts take orientation (T, N) and scale (D, the local body
// depth) from it, never from the raw local Jacobian, which flips or collapses on hard warps.
function frame(u) {
  const { P, F } = S, e = 0.004;
  const mid = (u) => P(u, (F.vTop(u) + F.vBot(u)) / 2);
  const T = norm(sub(mid(u + e), mid(u - e)));
  const axis = sub(P(u, F.vTop(u)), P(u, F.vBot(u)));
  let N = perp(T);
  if (dot(N, axis) < 0) N = mul(N, -1);
  return { T, N, D: len(axis), mid: mid(u) };
}

// A body edge sampled by output arc length, so counts follow what the eye sees on the page.
function edge(ua, ub, side) {
  const { P, F } = S, us = [], cum = [0];
  let prev;
  for (let k = 0; k <= 60; k++) {
    const u = lerp(ua, ub, k / 60), p = P(u, side > 0 ? F.vTop(u) : F.vBot(u));
    if (prev) cum.push(cum.at(-1) + len(sub(p, prev)));
    us.push(u);
    prev = p;
  }
  const uAt = (d) => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    return lerp(us[i - 1], us[i], (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1));
  };
  return { L: cum.at(-1), uAt };
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

// ---------------------------------------------------------------- parts

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


// A strip of the body (s along it, t from back to belly) as a page polygon, for graded tints.
function tintBand(s0, s1, t0, t1, n = 40) {
  const { P, F } = S, at = (s, t) => { const u = F.at(s); return P(u, lerp(F.vTop(u), F.vBot(u), t)); };
  const top = [], bot = [];
  for (let k = 0; k <= n; k++) { const s = lerp(s0, s1, k / n); top.push(at(s, t0)); bot.push(at(s, t1)); }
  return [...top, ...bot.reverse()];
}

// The body is glass: the skeleton shows through it, faint. A backbone along the body, vertebrae,
// spines up into the back and ribs curving round the belly cavity, all in grid space so they
// bend with the warp; drawn light so they read as *behind* the skin.
function ghost(c) {
  const { F } = S, at = (s, t) => { const u = F.at(s); return S.P(u, lerp(F.vTop(u), F.vBot(u), t)); };
  const ok = (s, t) => { const u = F.at(s); return area(u, lerp(F.vTop(u), F.vBot(u), t)) >= FOLD; };
  const spineT = (s) => 0.42 + 0.06 * s;
  pen(c, Array.from({ length: 41 }, (_, k) => { const s = lerp(0.28, 1, k / 40); return at(s, spineT(s)); }), { w: 3, a: 0.7, id: 17000, passes: 1 });
  for (let s = 0.3, i = 0; s < 0.99; s += 0.028, i++) {
    if (!ok(s, spineT(s))) continue;
    pen(c, [at(s, spineT(s) - 0.035), at(s, spineT(s) + 0.035)], { w: 2.2, a: 0.6, id: 17100 + i, passes: 1 }); // vertebra
    pen(c, [at(s, spineT(s)), at(s + 0.03, 0.12 + 0.05 * s)], { w: 1.2, a: 0.45, id: 17200 + i, passes: 1 }); // neural spine
    if (s < 0.62) {
      // A rib: down and back round the belly.
      pen(c, Array.from({ length: 9 }, (_, q) => { const f = q / 8; return at(s + 0.05 * f * f, lerp(spineT(s), 0.88, f)); }), { w: 1.2, a: 0.45, id: 17300 + i, passes: 1 });
    } else {
      pen(c, [at(s, spineT(s)), at(s + 0.03, 0.9 - 0.04 * s)], { w: 1.2, a: 0.45, id: 17400 + i, passes: 1 }); // haemal spine
    }
  }
}

// Where light catches the glassy body the colour lifts off: a feathered band along the upper flank
// erased from the ink layer (tint and lines alike), so the paper shows through.
function highlight(c) {
  const { F } = S, at = (s, t) => { const u = F.at(s); return S.P(u, lerp(F.vTop(u), F.vBot(u), t)); };
  c.save();
  c.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 4; i++) {
    const half = 0.095 * (1 - i / 4), mid = 0.24;
    const top = [], bot = [];
    for (let k = 0; k <= 40; k++) {
      const s = lerp(0.12 + i * 0.03, 0.78 - i * 0.04, k / 40), w = Math.sin(Math.PI * (k / 40)) * half;
      top.push(at(s, mid - w));
      bot.push(at(s, mid + w));
    }
    c.globalAlpha = 0.3;
    c.beginPath();
    [...top, ...bot.reverse()].forEach((p, j) => (j ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
    c.fill();
  }
  c.restore();
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

function body(c) {
  const { P, F } = S, top = [], bot = [];
  for (let k = 0; k <= 90; k++) {
    const u = lerp(F.U0, F.U1, k / 90);
    top.push(P(u, F.vTop(u)));
    bot.push(P(u, F.vBot(u)));
  }
  S.sil = [...top, ...bot.slice().reverse()];
  return () => {
    pen(c, top, { w: 4.2, a: 1, id: 1000 });
    pen(c, bot, { w: 4.2, a: 1, id: 1001 });
  };
}

// Engraver's stipple, with a few short ticks. Accepted with probability ∝ local area so the
// density is even on the page however the grid stretches the body; darker along the back and
// hugging the outline, lighter on the belly.
function shading(c) {
  const { P, F, U, G } = S, r = rng(S.seed, 2);
  let maxA = 0;
  for (let i = 0; i <= 12; i++) for (let j = 0; j <= 6; j++) {
    const u = lerp(F.U0, F.U1, i / 12);
    maxA = Math.max(maxA, area(u, lerp(F.vTop(u), F.vBot(u), j / 6)));
  }
  if (maxA <= 0) return;
  const gill = 0.26 + rng(S.seed, 5)() * 0.05; // the gill cover's first draw (see `head`)
  // Tone at (s along the body, t from back to belly), roughly 0..1: the engraver's modelling —
  // dark back, a light flank, dark rims, a shadow behind the gill cover, the peduncle darker —
  // plus the genome's markings, so they bend with the grid like everything else.
  const tone = (s, t) => {
    let v = 0.08 + 0.85 * (1 - t) ** 2 + 0.7 * Math.max(0, 1 - Math.min(t, 1 - t) / 0.07);
    v += 0.45 * Math.exp(-(((s - gill - 0.035) / 0.035) ** 2)) * (t > 0.08 && t < 0.92);
    v += 0.25 * Math.max(0, (s - 0.82) / 0.18);
    v *= 1 - 0.35 * Math.max(0, (t - 0.55) / 0.45); // belly catches the light
    if (G.marks === 1) for (let k = 0; k < G.nBars; k++) v += 1.1 * Math.exp(-(((s - lerp(0.3, 0.88, k / (G.nBars - 1))) / 0.032) ** 2)) * (1 - 0.4 * t);
    if (G.marks === 2) for (const [ss, tt, rr] of G.spots) v += 1.2 * (Math.hypot(s - ss, (t - tt) * 0.35) < rr);
    if (G.marks === 3) v += 1.2 * Math.exp(-(((s - 0.52) / 0.11) ** 2)) * Math.max(0, 1 - t / 0.6);
    return Math.min(1, v) ** 1.5; // push the lights lighter, keep the darks
  };
  // The lithographer's shading: fine contour lines along the body (iso-t), each line drawn only
  // where the tone is darker than its own threshold, so dark areas get every line and light ones
  // a few. A second family across the body (iso-s) cross-hatches the darkest parts. Spacing lives
  // in grid space, so the lines crowd where the grid is pinched and bend wherever it bends.
  const along = new Path2D(), across = new Path2D();
  const trace = (path, n, at, gate) => {
    let on = false;
    for (let k = 0; k <= n; k++) {
      const [sx, t] = at(k / n), u = F.at(sx), v = lerp(F.vTop(u), F.vBot(u), t);
      if (area(u, v) < FOLD || !gate(sx, t)) { on = false; continue; }
      const p = P(u, v);
      on ? path.lineTo(p[0], p[1]) : path.moveTo(p[0], p[1]);
      on = true;
    }
  };
  const rows = Math.round(90 * params.hatch), cols = Math.round(110 * params.hatch);
  // Two strengths: lines in the darks are full-strength, lines in the half-tones are faint, so the
  // shading reads as layers of transparent cyan rather than one flat weight.
  const faint = new Path2D();
  for (let j = 1; j < rows; j++) {
    const t = j / rows, th = (j * 0.6180339) % 1; // golden-ratio dither: thresholds spread evenly
    trace(along, 180, (q) => [0.02 + 0.98 * q, t], (sx) => tone(sx, t) > Math.max(th, 0.55));
    trace(faint, 180, (q) => [0.02 + 0.98 * q, t], (sx) => tone(sx, t) > th && tone(sx, t) <= 0.55);
  }
  for (let i = 1; i < cols; i++) {
    const sx = 0.02 + (0.98 * i) / cols, th = 0.55 + 0.45 * ((i * 0.6180339) % 1);
    trace(across, 60, (q) => [sx, q], (_, t) => tone(sx, t) > th);
  }
  c.lineWidth = 1.25 * S.K.lw;
  c.globalAlpha = 0.95;
  c.stroke(along);
  c.lineWidth = 0.9 * S.K.lw;
  c.globalAlpha = 0.45;
  c.stroke(faint);
  c.lineWidth = 1.25 * S.K.lw;
  c.globalAlpha = 0.6;
  c.stroke(across);
  c.globalAlpha = 1;
  const tries = Math.round(params.stipple * 42000 * Math.min(maxA, 4));
  const lines = new Path2D(), dots = new Path2D();
  for (let i = 0; i < tries; i++) {
    // Draw every random number up front, so a rejected sample never shifts the next one.
    const sx = 0.02 + 0.98 * r(), t = r(), roll = r(), kind = r(), ang = -0.4 + r() * 0.3, l = (4 + r() * 6) * U, rad = (0.8 + r() * 1) * U;
    const u = F.at(sx), v = lerp(F.vTop(u), F.vBot(u), t), a = area(u, v);
    if (a < FOLD || roll > (a / maxA) * tone(sx, t)) continue;
    const p = P(u, v);
    if (kind < 0.86) {
      dots.moveTo(p[0] + rad, p[1]);
      dots.arc(p[0], p[1], rad, 0, TAU);
      continue;
    }
    const { T, N } = frame(u), d = add(mul(T, Math.cos(ang)), mul(N, Math.sin(ang)));
    lines.moveTo(p[0], p[1]);
    lines.lineTo(p[0] + d[0] * l, p[1] + d[1] * l);
  }
  c.lineWidth = 1.2 * S.K.lw;
  c.globalAlpha = 0.85;
  c.stroke(lines);
  c.fill(dots);
  c.globalAlpha = 1;
}

function head(c) {
  const { P, F } = S, r = rng(S.seed, 5);
  const curve = (ug, bulge, f0, f1, id, w) => {
    if (area(ug, 0.5) < FOLD) return;
    const pts = [];
    for (let k = 0; k <= 24; k++) {
      const t = k / 24, u = ug + bulge * Math.sin(Math.PI * t) * (1 + 0.4 * t);
      pts.push(P(u, lerp(F.vTop(u), F.vBot(u), lerp(f0, f1, t))));
    }
    pen(c, pts, { w, id });
  };
  const ug = F.at(0.26 + r() * 0.05);
  curve(ug, 0.035, 0.1, 0.93, 5000, 2.6); // gill cover
  if (r() < 0.75) curve(ug - 0.05, 0.02, 0.35 + r() * 0.1, 0.88, 5001, 1.6); // preopercle
  if (r() < 0.5) curve(F.at(0.1), 0.012, 0.58, 0.8, 5002, 1.2); // cheek
}

function lateralLine(c) {
  const { P, F, U } = S, r = rng(S.seed, 12), style = Math.floor(r() * 3), f = 0.3 + r() * 0.06;
  const pts = [];
  for (let k = 0; k <= 80; k++) {
    const u = lerp(F.at(0.3), F.U1, k / 80);
    pts.push(area(u, 0.5) < FOLD ? null : P(u, lerp(F.vTop(u), F.vBot(u), f + 0.04 * Math.sin(k / 9))));
  }
  for (let k = 0; k < pts.length - 4; k += 4) {
    const seg = pts.slice(k, k + 5);
    if (seg.includes(null)) continue;
    if (style === 0) pen(c, seg, { w: 1.4, a: 0.7, id: 12000 + k, passes: 1 });
    else if (style === 1 && (k / 4) % 2 === 0) pen(c, seg, { w: 1.8, a: 0.8, id: 12000 + k, passes: 1 });
    else if (style === 2) {
      c.beginPath();
      c.arc(seg[0][0], seg[0][1], 1.8 * U, 0, TAU);
      c.fill();
    }
  }
}

function mouth(c) {
  const { P, F, E } = S, r = rng(S.seed, 4), U0 = F.U0, m = (0.055 + r() * 0.015) * Math.exp(0.5 * E.head);
  S.mouth = E.head > 0.35 ? 1 : Math.floor(r() * 3); // a long head opens a long jaw (fig 152)
  if (area(U0 + m / 2, 0.52) < FOLD) return;
  // Everything starts at the snout tip, where back and belly meet, so nothing pokes out of the head.
  const W = (pts) => pts.map(([u, v]) => P(u, v)), tip = [U0 + 0.001, 0.52], corner = [U0 + m, 0.536];
  if (S.mouth === 0) {
    // Closed: the gape, and the lower jaw's edge just under it.
    pen(c, W(qb(tip, [U0 + m * 0.5, 0.532], corner)), { w: 2.8, id: 4000 });
    pen(c, W(qb([U0 + 0.006, 0.528], [U0 + m * 0.45, 0.548], [U0 + m * 0.8, 0.547])), { w: 1.6, id: 4001 });
  } else if (S.mouth === 1) {
    // Gaping (fig 152): the lower jaw dropped, the inside of the mouth filled dark.
    const low = [U0 + 0.012, 0.556], up = qb(tip, [U0 + m * 0.5, 0.524], corner), lo = qb(low, [U0 + m * 0.5, 0.556], corner);
    c.globalAlpha = 0.55;
    c.beginPath();
    [...W(up), ...W(lo).reverse()].forEach((q, i) => (i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])));
    c.fill();
    c.globalAlpha = 1;
    pen(c, W(up), { w: 2.8, id: 4000 });
    pen(c, W([tip, ...qb([U0 + 0.004, 0.54], [U0 - 0.004, 0.556], low, 6)]), { w: 2.4, id: 4002 });
    pen(c, W(lo), { w: 2.4, id: 4001 });
  } else {
    // Jutting jaw (fig 150): the lower lip sits ahead of the snout.
    const low = [U0 - 0.016, 0.53];
    pen(c, W(qb(tip, [U0 + m * 0.5, 0.531], corner)), { w: 2.8, id: 4000 });
    pen(c, W(qb([U0 + 0.003, 0.525], [U0 - 0.012, 0.522], low, 8)), { w: 2.2, id: 4002 });
    pen(c, W(qb(low, [U0 + m * 0.3, 0.556], [U0 + m * 0.85, 0.549])), { w: 2.2, id: 4001 });
  }
}

const PUPIL = '#15565c'; // the darkest teal, not black

function eye(c) {
  const { P, F, U } = S, r = rng(S.seed, 3);
  const ue = F.at(S.G.eyeU + r() * 0.02), ve = lerp(F.vTop(ue), F.vBot(ue), 0.36 + r() * 0.08);
  if (area(ue, ve) < FOLD) return;
  const fr = frame(ue);
  // Rules: the eye stays inside the head and never crosses the outline. It is always a true
  // circle (eyes don't shear), sized by the head's depth: a big-head warp → a big eye (fig 151).
  let p = P(ue, ve);
  if (!inside(p, S.sil)) p = fr.mid;
  const rad = Math.min(fr.D * (0.13 + r() * 0.04) * S.G.eyeK * Math.exp(-0.35 * S.E.head), distToPoly(p, S.sil) * 0.85);
  if (rad < 3 * U) return;
  S.eyeAt = [p[0] / S.W, p[1] / S.H, rad / S.H];
  const a0 = r() * TAU, type = params.eye;
  // The pupil is the one truly black mass on the plate, and its glint is bare paper: both go on
  // after the graphite layer (S.post), where neither multiply nor the paper's tooth can grey them.
  const dot = (q, k, color = PUPIL) =>
    S.post.push((t) => { t.fillStyle = color; t.beginPath(); t.arc(q[0], q[1], rad * k, 0, TAU); t.fill(); t.fillStyle = params.ink; });
  const rim = (k, w, id) => {
    // Two mismatched arcs, never one perfect circle.
    pen(c, arcPts(p, rad * k, a0, a0 + 3.7), { w, id });
    pen(c, arcPts(add(p, [rad * 0.05, -rad * 0.03]), rad * k * 1.05, a0 + 3.4, a0 + 6.7), { w: w * 0.9, id: id + 1 });
  };
  const pupil = add(p, [rad * 0.06, rad * 0.02]), glint = add(p, [-rad * 0.08, -rad * 0.12]);
  if (type === 'tiny') {
    // Naive: a small ring and a dot, no glint.
    pen(c, arcPts(p, rad * 0.55, a0, a0 + TAU * 1.05), { w: 2.6, id: 3000 });
    dot(pupil, 0.28);
    return;
  }
  rim(type === 'double' ? 1.15 : 1, 3.4, 3000);
  if (type === 'double') rim(0.8, 2.2, 3010); // fig 151: a big eye inside a second ring
  if (type === 'ringed') pen(c, arcPts(p, rad * 0.66, a0, a0 + TAU * 0.92), { w: 1.2, a: 0.6, id: 3002, passes: 1 });
  dot(pupil, type === 'plain' ? 0.52 : 0.42);
  dot(glint, 0.12, params.paper);
  if (type === 'lidded') {
    // A heavy lid: paper over the top of the eye, a chord for the lid's edge, a thick brow above.
    const t0 = Math.PI + 0.45, t1 = TAU - 0.45, cap = arcPts(p, rad * 0.97, t0, t1, 24);
    S.post.push((t) => {
      t.fillStyle = params.paper;
      t.beginPath();
      cap.forEach((q, i) => (i ? t.lineTo(q[0], q[1]) : t.moveTo(q[0], q[1])));
      t.fill();
      t.fillStyle = t.strokeStyle = params.ink;
      pen(t, [cap[0], lerp2(cap[0], cap.at(-1), 0.5), cap.at(-1)], { w: 2.6, id: 3020 });
      pen(t, arcPts(add(p, [0, -rad * 0.05]), rad * 1.3, Math.PI + 0.25, TAU - 0.25, 24), { w: 4.5, id: 3021 });
    });
  }
}

// Spines walk the warped back: count = arc length / spacing, so stretching the back adds spines;
// height ∝ local depth, so a deeper body grows a taller fin (fig 153).
function spinyDorsal(c) {
  const { P, F, U } = S, r = rng(S.seed, 6);
  const G = S.G, j1 = r(), j2 = r(), split = G.dJoin === 'split';
  const s0 = G.dStart + j1 * 0.02, s1 = G.dEnd + j2 * 0.02 - (split ? 0.04 : 0);
  S.spinyEnd = s1;
  const es = edge(F.at(s0), F.at(s1), 1);
  const n = Math.max(3, Math.round(es.L / (params.spineSpacing * G.dSpacing * U)));
  const hF = (0.3 + r() * 0.18) * G.dHeight * Math.exp(-0.6 * S.E.body), peak = 0.2 + r() * 0.15;
  // Heights along the fin, f = 0 (front) … 1 (back).
  const profile = {
    peaked: (f) => 0.4 + 0.6 * Math.exp(-(((f - peak) / 0.4) ** 2)),
    rising: (f) => 0.45 + 0.55 * f,
    even: (f) => 0.85 + 0.15 * Math.sin(Math.PI * f),
    falling: (f) => (f < 0.08 ? 0.65 : 1 - 0.6 * f ** 0.8), // a short first spine, then the tallest, then down
    sail: (f) => 0.7 + 0.9 * Math.sin(Math.PI * (0.1 + 0.8 * f)),
  }[G.dProfile];
  const ends = (f) => (split ? Math.min(1, (1 - f) / 0.25 + 0.35) : 1); // a split fin dips to its last spine
  const sp = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1), u = es.uAt(f * es.L);
    if (area(u, F.vTop(u)) < FOLD) { sp.push(null); continue; }
    const fr = frame(u), dir = norm(add(fr.N, mul(fr.T, 0.25 + f * 0.35)));
    const cap = G.dProfile === 'sail' ? 0.42 : 0.26;
    const l = finCap(fr.D * hF * profile(f) * ends(f), cap) * (0.92 + hash(S.seed, 6, i) * 0.16);
    const base = P(u, F.vTop(u));
    sp.push({ base, dir, l, T: fr.T, tip: add(base, mul(dir, l)) });
  }
  const live = sp.filter((x) => x);
  if (live.length > 1 && G.dMembrane !== 'none') {
    const notchAt = { notched: 0.62, full: 0.94, incised: 0.3 }[G.dMembrane], edgePts = [];
    live.forEach((x, i) => { if (i) edgePts.push(add(x.base, mul(x.dir, x.l * notchAt))); edgePts.push(x.tip); });
    tint(c, [live[0].base, ...edgePts, ...live.map((x) => x.base).reverse()], 0.65);
  }
  // Spine style.
  sp.forEach((s, i) => {
    if (!s) return;
    if (G.dSpine === 'thick') {
      // A heavy tapering spine: a narrow wedge, filled, then outlined.
      const half = mul(s.T, s.l * 0.035);
      c.globalAlpha = 0.75;
      c.beginPath();
      c.moveTo(...add(s.base, half));
      c.lineTo(...s.tip);
      c.lineTo(...sub(s.base, half));
      c.fill();
      c.globalAlpha = 1;
    }
    pen(c, bend(s.base, s.tip, G.dSpine === 'curved' ? -0.13 : 0.04), { w: G.dSpine === 'thick' ? 2 : 2.8, id: 6000 + i });
    if (G.dSpine === 'barbed') for (const q of [0.4, 0.62, 0.84]) {
      // Small forward-pointing barbs along the front edge.
      const at = lerp2(s.base, s.tip, q), d = norm(add(mul(s.dir, 0.55), mul(s.T, -1)));
      pen(c, [at, add(at, mul(d, s.l * 0.09))], { w: 1.3, id: 6300 + i * 3 + Math.round(q * 10), passes: 1 });
    }
  });
  // Membrane between spines.
  const notchAt = { notched: 0.62, full: 0.94, incised: 0.3, none: 0 }[G.dMembrane];
  const hatch = { notched: [0.25, 0.5, 0.75], full: [0.17, 0.34, 0.5, 0.67, 0.84], incised: [0.35, 0.7], none: [] }[G.dMembrane];
  for (let i = 0; i < n - 1; i++) {
    const a = sp[i], b = sp[i + 1];
    if (!a || !b || !notchAt) continue;
    // From one tip to partway up the next spine, sagging toward the body.
    const notch = add(b.base, mul(b.dir, b.l * notchAt)), mid = add(lerp2(a.tip, notch, 0.5), mul(sub(a.base, a.tip), G.dMembrane === 'full' ? 0.04 : 0.12));
    pen(c, qb(a.tip, mid, notch, 10), { w: 1.8, a: 0.95, id: 6500 + i, passes: 1 });
    hatch.forEach((q, k) => {
      const s0 = add(lerp2(a.base, b.base, q), mul(a.dir, a.l * 0.04)), reach = Math.min(notchAt, 0.5 - 0.15 * q + (G.dMembrane === 'full' ? 0.3 : 0));
      pen(c, [s0, add(s0, mul(lerp2(a.dir, b.dir, q), lerp(a.l, b.l, q) * reach))], { w: 1.1, a: 0.85, id: 6800 + i * 5 + k, passes: 1 });
    });
  }
  const last = sp.findLast((x) => x);
  S.dorsalLast = last; // a continuous fin carries its membrane on into the soft dorsal
}

// A fin of soft rays along a body edge (side 1 = back, -1 = belly). Ray count from the base's
// output length; rays grow outward from the outline, never across the body.
function edgeFin(c, part, side, sa, sb, hF, lean, shape, frayed = false) {
  const { P, F, U } = S, es = edge(F.at(sa), F.at(sb), side);
  const n = Math.max(4, Math.round(es.L / (params.spineSpacing * U * 0.5)));
  const bases = [], tips = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1), u = es.uAt(f * es.L), v = side > 0 ? F.vTop(u) : F.vBot(u);
    if (area(u, v) < FOLD) continue;
    const fr = frame(u), out = side > 0 ? fr.N : mul(fr.N, -1);
    const dir = norm(add(out, mul(fr.T, lean + f * 0.5)));
    const l = finCap(fr.D * hF * S.grow * shape(f), 0.22) * (1 + (hash(S.seed, part, i) - 0.5) * (frayed ? 0.4 : 0.08));
    const b = P(u, v);
    bases.push(b);
    tips.push(add(b, mul(dir, l)));
  }
  if (tips.length < 2) return;
  tint(c, [...chaikin(tips), ...bases.slice().reverse()], 0.65);
  tips.forEach((t, i) => pen(c, bend(bases[i], t, 0.025), { w: 1.4, a: 0.95, id: part * 1000 + i, passes: 1 }));
  pen(c, chaikin([bases[0], ...tips, bases.at(-1)]), { w: 2.8, id: part * 1000 + 999 });
  for (let i = 0; i < tips.length - 1; i++) {
    const s0 = lerp2(bases[i], bases[i + 1], 0.5), d = sub(lerp2(tips[i], tips[i + 1], 0.5), s0);
    pen(c, bend(s0, add(s0, mul(d, 0.88)), 0.02), { w: 1.1, a: 0.8, id: part * 1000 + 500 + i, passes: 1 });
  }
  baseShade(c, bases, tips, part * 1000 + 600);
  if (part === 7 && S.G.dJoin === 'continuous' && S.dorsalLast && S.G.dMembrane !== 'none') {
    const a = S.dorsalLast.tip, b = tips[0];
    pen(c, qb(a, add(lerp2(a, b, 0.5), mul(sub(bases[0], b), 0.25)), b, 10), { w: 1.8, id: part * 1000 + 990 });
  }
}

// The plates darken every fin where it meets the body: short strokes up from the base.
function baseShade(c, bases, tips, id) {
  for (let i = 0; i < tips.length - 1; i++) for (let k = 1; k <= 3; k++) {
    const b = lerp2(bases[i], bases[i + 1], k / 4), t = lerp2(tips[i], tips[i + 1], k / 4);
    pen(c, [b, lerp2(b, t, 0.18 + 0.12 * hash(S.seed, id, i * 3 + k))], { w: 1, a: 0.85, id: id + i * 3 + k, passes: 1 });
  }
}

// A fan of rays from a short base (pelvic, pectoral). `angle` is measured from T toward N.
function fan(c, part, base, fr, angle, spread, l, n, { frayed = false, dark = false } = {}) {
  // The base runs the same way the rays turn (d/dangle of the ray), so rays never cross.
  const across = add(mul(fr.T, -Math.sin(angle)), mul(fr.N, Math.cos(angle)));
  const bases = [], tips = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1), a = angle + (f - 0.5) * spread;
    const d = add(mul(fr.T, Math.cos(a)), mul(fr.N, Math.sin(a))), b = add(base, mul(across, (f - 0.5) * l * 0.16));
    // A paddle: rounded, longest a little to one side of the middle.
    const k = (0.6 + 0.4 * Math.sin(Math.PI * (0.15 + 0.75 * f))) * (1 + (hash(S.seed, part, i) - 0.5) * (frayed ? 0.35 : 0.06));
    bases.push(b);
    tips.push(add(b, mul(d, l * k)));
  }
  tint(c, [...chaikin(tips), ...bases.slice().reverse()], 0.65);
  tips.forEach((t, i) => pen(c, bend(bases[i], t, 0.03), { w: 1.4, a: 0.95, id: part * 1000 + i, passes: 1 }));
  for (let i = 0; i < n - 1; i++) {
    const b = lerp2(bases[i], bases[i + 1], 0.5), t = lerp2(tips[i], tips[i + 1], 0.5);
    pen(c, bend(b, lerp2(b, t, 0.9), 0.03), { w: 1, a: 0.8, id: part * 1000 + 200 + i, passes: 1 });
    // A dark fin (fig 153's pectoral) is cross-hatched across its rays.
    if (dark) for (let q = 0.12; q < 0.85; q += 0.07) {
      pen(c, [lerp2(bases[i], tips[i], q), lerp2(bases[i + 1], tips[i + 1], q + 0.05)], { w: 1, a: 0.9, id: part * 1000 + 400 + i * 20 + Math.round(q * 14), passes: 1 });
    }
  }
  baseShade(c, bases, tips, part * 1000 + 600);
  pen(c, [bases[0], ...chaikin(tips), bases.at(-1)], { w: 2.8, id: part * 1000 + 999 });
  pen(c, bases, { w: 1.6, id: part * 1000 + 998, passes: 1 });
}

// Fins scale with body depth, but a disc-deep body would grow fins longer than the fish: cap them
// at a share of the body's length, snout to tail base.
const finCap = (l, k = 0.3) => Math.min(l, k * len(sub(S.P(S.F.U0, 0.52), S.P(S.F.U1, 0.52))));

function pelvic(c) {
  const { P, F } = S, r = rng(S.seed, 8), u = F.at(0.3 + r() * 0.06);
  if (area(u, F.vBot(u)) < FOLD) return;
  const fr = frame(u);
  const base = P(u, F.vBot(u)), angle = -(0.7 + r() * 0.4), l = finCap(fr.D * (0.36 + r() * 0.14) * S.grow);
  fan(c, 8, base, fr, angle, 0.55, l, 7 + Math.floor(r() * 3), { frayed: r() < 0.5 });
  if (S.shape < DEEP) {
    // Threads: the two leading rays run on, three times the fin's length, with a lazy S.
    [0, 0.08].forEach((da, j) => {
      const a = angle - 0.275 + da, d = add(mul(fr.T, Math.cos(a)), mul(fr.N, Math.sin(a)));
      const tip = add(base, mul(d, l * (0.9 + j * 0.05))), end = add(tip, mul(d, l * (2 - j * 0.4)));
      pen(c, qb(tip, add(lerp2(tip, end, 0.5), mul(perp(d), l * 0.25)), end, 16), { w: 1.4, id: 8900 + j });
    });
  }
}

function pectoral(c, far = false) {
  const { P, F, U } = S, r = rng(S.seed, 10), u = F.at(0.3 + r() * 0.04), v = lerp(F.vTop(u), F.vBot(u), 0.52 + r() * 0.08);
  if (area(u, v) < FOLD) return;
  const fr = frame(u);
  let base = P(u, v);
  if (!inside(base, S.sil)) base = fr.mid; // rule: the pectoral sits on the side of the body
  const n = Math.max(6, Math.round((fr.D * 0.2) / (params.spineSpacing * U * 0.35)));
  const angle = 0.08 + r() * 0.2, l = finCap(fr.D * (0.3 + r() * 0.12) * S.grow * S.G.pect), dark = r() < 0.4;
  if (far) {
    // The fin on the far side, seen through the glass body: a little higher and further back,
    // a little shorter, faint. Drawn before the shading, so the near side lies over it.
    S.fade = 0.4;
    fan(c, 19, add(base, add(mul(fr.N, fr.D * 0.05), mul(fr.T, fr.D * 0.06))), fr, angle + 0.12, 0.7, l * 0.9, n, { dark });
    S.fade = 1;
    return;
  }
  fan(c, 10, base, fr, angle, 0.75, l, n, { dark });
}

// The tail's tips are landmarks in grid space (pull the grid's right edge and the tail follows,
// fig 152); its rays are regenerated as straight strokes from the warped base to the tips.
function tail(c) {
  const { P, F, U, E } = S, r = rng(S.seed, 11), seeded = Math.floor(r() * 3);
  // A pulled tail forks, a squeezed one rounds; in between the seed decides.
  const style = (S.tail = E.tail > 0.25 ? 2 : E.tail < -0.25 ? 1 : seeded);
  const u = F.U1, vt = F.vTop(u), vb = F.vBot(u), vm = (vt + vb) / 2;
  const tl = Math.min(0.24, (0.15 + r() * 0.05) * S.G.tail * Math.exp(0.3 * E.tail)), hv = (vb - vt) * [1.5, 1.2, 1.7][style];
  const shape = [
    (f) => 1 - 0.08 * Math.sin(Math.PI * f), // truncate
    (f) => 0.7 + 0.3 * Math.sin(Math.PI * f), // rounded
    (f) => 0.55 + 0.45 * Math.abs(2 * f - 1) ** 1.3, // forked
  ][style];
  const Pt = P(u, vt), Pb = P(u, vb);
  const n = Math.max(8, Math.round(len(sub(Pt, Pb)) / (params.spineSpacing * U * 0.3)));
  const tips = [], bases = [];
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1), tu = u + tl * shape(f), tv = vm + (2 * f - 1) * hv * (0.9 + 0.1 * Math.sin(Math.PI * f));
    if (area(tu, tv) < FOLD) continue;
    tips.push(P(tu, tv));
    bases.push(lerp2(Pt, Pb, f));
  }
  if (tips.length < 2) return;
  tint(c, [Pt, ...chaikin(tips, 2), Pb], 0.65);
  tips.forEach((t, i) => {
    pen(c, bend(bases[i], t, 0.015), { w: 1.4, a: 0.95, id: 11000 + i, passes: 1 });
    if (i < tips.length - 1) {
      const s0 = lerp2(bases[i], bases[i + 1], 0.5), d = sub(lerp2(t, tips[i + 1], 0.5), s0);
      pen(c, [add(s0, mul(d, 0.04)), add(s0, mul(d, 0.85 + hash(S.seed, 11, i) * 0.1))], { w: 1.1, a: 0.8, id: 11500 + i, passes: 1 });
    }
  });
  baseShade(c, bases, tips, 11600);
  pen(c, chaikin([Pt, ...tips, Pb], 2), { w: 3.2, id: 11999 });

  // Spread the tail end of the sheet (a taper) and the outer rays trail long filaments.
  if (E.taper < -0.25) {
    const k = Math.min(1, (-E.taper - 0.25) / 0.4);
    [[bases[0], tips[0], 1], [bases.at(-1), tips.at(-1), -1]].forEach(([b, t, side], j) => {
      const d = sub(t, b), l = len(d) * (0.4 + 0.8 * k), dir = norm(d), n = mul(perp(dir), side * l * 0.12);
      const end = add(t, mul(dir, l));
      pen(c, qb(t, add(lerp2(t, end, 0.5), n), end, 14), { w: 1.6, id: 11900 + j });
    });
    S.traits.add('filamentosus');
  }
}

// Pull the tail long and the peduncle grows finlets, small flags along the back and belly (tuna).
function finlets(c) {
  const { P, F, E } = S;
  if (E.tail <= 0.28) return;
  const n = Math.min(6, 3 + Math.round((E.tail - 0.28) * 8));
  for (const side of [1, -1]) for (let i = 0; i < n; i++) {
    const u = lerp(F.at(side > 0 ? 0.8 : 0.78), F.U1 - 0.008, i / Math.max(1, n - 1)), v = side > 0 ? F.vTop(u) : F.vBot(u);
    if (area(u, v) < FOLD) continue;
    const fr = frame(u), out = mul(fr.N, side), b = P(u, v), s = fr.D * 0.35;
    const tip = add(b, add(mul(out, s * 0.6), mul(fr.T, s * 0.45))), back = add(b, mul(fr.T, s * 0.35));
    pen(c, [b, tip, back], { w: 1.8, id: 13000 + i + (side > 0 ? 0 : 50) });
    pen(c, [lerp2(b, back, 0.5), lerp2(b, tip, 0.85)], { w: 1, a: 0.8, id: 13100 + i + (side > 0 ? 0 : 50), passes: 1 });
  }
  S.traits.add('pinnulatus');
}

// Stretch the head long and a barbel hangs from the chin.
function barbel(c) {
  const { P, F, E } = S;
  if (E.head <= 0.2) return;
  const k = Math.min(1, (E.head - 0.2) / 0.5), u = F.at(0.07);
  if (area(u, F.vBot(u)) < FOLD) return;
  const fr = frame(u), l = frame(F.at(0.15)).D * (0.25 + 0.45 * k), b = P(u, F.vBot(u) - 0.004);
  [0.25, 0.6].forEach((a, j) => {
    const dir = add(mul(fr.N, -Math.cos(a)), mul(fr.T, Math.sin(a))), end = add(b, mul(dir, l * (1 - j * 0.2)));
    pen(c, qb(b, add(lerp2(b, end, 0.5), mul(fr.T, -l * 0.15)), end, 12), { w: 2, id: 14000 + j });
    c.beginPath();
    c.arc(end[0], end[1], 2.2 * S.U * params.pressure, 0, TAU);
    c.fill();
  });
  S.traits.add('barbatus');
}

// Where the grid is pinched, the skin shows its scales: rows of arcs, crowded as the pinch.
// "Pinched" is relative to the body's own mean area, so scaling the whole sheet grows none.
const PINCH = 0.75;
function scales(c) {
  const { P, F, U } = S, path = new Path2D();
  let count = 0, mean = 0;
  for (let i = 0; i < 40; i++) {
    const u = F.at(0.1 + (0.85 * (i % 8)) / 7), v = lerp(F.vTop(u), F.vBot(u), 0.15 + 0.7 * (Math.floor(i / 8) / 4));
    mean += area(u, v) / 40;
  }
  if (mean <= 0) return;
  for (let row = 0, t = 0.16; t < 0.86; row++, t += 0.075) {
    for (let s = 0.12 + (row % 2) * 0.012; s < 0.98; s += 0.024) {
      const u = F.at(s), v = lerp(F.vTop(u), F.vBot(u), t), a = area(u, v);
      if (a >= PINCH * mean || a < FOLD) continue;
      const p = P(u, v), { T } = frame(u), r = Math.max(4 * U, len(sub(P(F.at(s + 0.024), v), p)) * 0.75);
      const ang = Math.atan2(T[1], T[0]);
      path.moveTo(p[0] + Math.cos(ang - 1.25) * r, p[1] + Math.sin(ang - 1.25) * r);
      path.arc(p[0], p[1], r, ang - 1.25, ang + 1.25);
      count++;
    }
  }
  c.lineWidth = 1.5 * S.K.lw;
  c.globalAlpha = 0.9;
  c.stroke(path);
  c.globalAlpha = 1;
  if (count > 12) S.traits.add('squamosus');
}

const DEEP = -0.45; // below this the body counts as a disc

// A very deep body: the pelvic fins trail threads and the belly keel grows small spines (fig 153).
function keel(c) {
  const { P, F, U } = S;
  if (S.shape >= DEEP) return;
  const es = edge(F.at(0.4), F.at(0.6), -1), n = Math.max(3, Math.round(es.L / (params.spineSpacing * U * 0.9)));
  for (let i = 0; i < n; i++) {
    const u = es.uAt((i / (n - 1)) * es.L);
    if (area(u, F.vBot(u)) < FOLD) continue;
    const fr = frame(u), b = P(u, F.vBot(u)), dir = norm(add(mul(fr.N, -0.55), fr.T));
    pen(c, [b, add(b, mul(dir, fr.D * 0.07))], { w: 2, id: 15000 + i, passes: 1 });
  }
  S.traits.add('nematophorus');
}

// ---------------------------------------------------------------- the plate's caption

// The name is read off the fish, not rolled: the genus from how deep or long the body grew (the
// seed's body plus the grid's stretch), the epithet from its most distinctive trait. Change the
// fish and it is a different species: squeeze it into a disc and it becomes Antigonia.
const GENERA = [ // deep → long, each with the epithet it wears when nothing else stands out
  ['Antigonia', 'capros'],
  ['Pseudopriacanthus', 'altus'],
  ['Polyprion', 'americanus'],
  ['Scorpaena', 'scrofa'],
  ['Sphyraena', 'barracuda'],
];
function speciesName() {
  const { E, shape, traits } = S;
  const g = shape < -0.6 ? 0 : shape < -0.2 ? 1 : shape < 0.2 ? 2 : shape < 0.6 ? 3 : 4;
  // The most striking organ names it: grown organs first, then shape, eye, jaw, tail.
  const grown = ['barbatus', 'gibbosus', 'ventricosus', 'filamentosus', 'pinnulatus', 'nematophorus', 'squamosus'].find((t) => traits.has(t));
  const G = S.G;
  const epithet =
    grown ? grown
    : G.dProfile === 'sail' ? 'velifer' // sail-finned
    : G.dSpine === 'barbed' ? 'serratus'
    : G.dMembrane === 'none' ? 'pectinatus' // free spines like a comb
    : G.dJoin === 'split' ? 'dipterygius' // two dorsal fins
    : G.dSpine === 'curved' ? 'uncinatus' // hooked spines
    : E.taper > 0.25 ? 'cuneatus' // wedge-shaped, big head
    : S.G.marks === 1 ? 'fasciatus' // barred
    : S.G.marks === 2 ? 'maculatus' // spotted
    : S.G.marks === 3 ? 'ephippium' // saddled
    : params.eye === 'double' ? 'macrophthalmus'
    : params.eye === 'lidded' ? 'velatus'
    : params.eye === 'tiny' ? 'microps'
    : S.mouth === 1 ? 'hians' // gaping
    : S.mouth === 2 ? 'prognathus' // jutting jaw
    : S.tail === 2 && g >= 2 ? 'furcatus'
    : S.tail === 1 && g <= 2 ? 'rotundicauda'
    : GENERA[g][1];
  const name = `${GENERA[g][0]} ${epithet}`;
  // A stable plate number per species, in D'Arcy's range.
  const fig = 140 + ([...name].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 30);
  return { fig, name };
}

// Fixed at the bottom centre of the page: roman "Fig. 150." then the italic name.
function caption(c) {
  const { W, H, U } = S, { fig, name } = speciesName(), size = 46 * U;
  const y = H - 70 * U;
  const roman = `${size}px Georgia, 'Times New Roman', serif`, italic = `italic ${roman}`;
  const a = `Fig. ${fig}.  `, b = `${name}.`;
  c.font = roman;
  const wa = c.measureText(a).width;
  c.font = italic;
  const x = (W - wa - c.measureText(b).width) / 2;
  c.fillStyle = params.ink;
  c.font = roman;
  c.fillText(a, x, y);
  c.font = italic;
  c.fillText(b, x + wa, y);
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
  const c = L.target, px = Math.hypot(L.getTransform().a, L.getTransform().b) * (api.width / 2400);
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
  const { width: W, height: H } = api, U = W / 2400, seed = params.seed | 0;
  const P = makeWarp(params.lattice, W, H), st = makeStretch(P, W, H);
  const E = { body: (st(0.15) + st(0.3) + st(0.45) + st(0.6)) / 4, head: st(0.12), tail: st(0.86) };
  // More readings off the grid, each one grows (or removes) an organ:
  // taper = head side ÷ tail side of the sheet; arch = how far the back line (v = 0.3) bows off its
  // chord, in body depths — up grows a forehead hump, down a pot belly.
  const L = params.lattice, depthAt = len(sub(P(0.37, 0.3), P(0.37, 0.7))) || 1;
  E.taper = Math.log(len(sub(L[0], L[12])) / (len(sub(L[3], L[15])) || 1e-6));
  E.arch = dot(sub(P(0.37, 0.3), lerp2(P(0.12, 0.3), P(0.62, 0.3), 0.5)), norm(sub(P(0.37, 0.2), P(0.37, 0.3)))) / depthAt;
  E.hump = Math.min(0.7, Math.max(0, (E.arch - 0.06) * 5));
  E.paunch = Math.min(0.5, Math.max(0, (-E.arch - 0.06) * 4));
  S = {
    W, H, U, seed, P, E,
    grow: Math.exp(-0.5 * E.body), // fins: taller on a squeezed body, shorter on a pulled one
    G: genome(seed),
    F: null,
    traits: new Set(), // organs this draw grew; the caption reads them
    post: [], // marks that go on after the graphite layer, untouched by its grain
    A0: W * H * 0.8 * 0.72,
    K: { seed, wob: params.wobble * 2.5 * U, f1: 140 * U, f2: 47 * U, f3: 19 * U, lw: params.pressure * U },
  };
  c.lineCap = c.lineJoin = 'round';
  S.F = buildFish(seed, params.depth, E, S.G);
  // How deep (< 0) or long (> 0) the fish is overall: the seed's body, the stretch, the depth slider.
  S.shape = E.body + [0, -0.35, 0.35][S.F.base] - (params.depth - 0.3) * 2;
  if (E.hump) S.traits.add('gibbosus');
  if (E.paunch) S.traits.add('ventricosus');

  paper(c);
  // Everything graphite goes on its own layer: strokes multiply onto each other (overlaps build up
  // like layered pencil), then the paper's tooth is knocked out of the layer, then it lands on paper.
  const ink = inkLayer(c);
  c = ink;
  const outline = body(c);
  // Graded tint: a light veil over the whole body, deeper along the back and toward the tail,
  // leaving the flank and belly mostly paper, as the plates do.
  tint(c, S.sil, 0.45);
  for (let i = 0; i < 5; i++) {
    // Feathered in five steps each, so neither tint ends in a visible edge.
    tint(c, tintBand(0, 1, 0, 0.32 * (1 - i / 5)), 0.14);
    tint(c, tintBand(0.6 + 0.4 * (i / 5), 1, 0, 1), 0.08);
  }
  ghost(c);
  pectoral(c, true);
  shading(c);
  scales(c);
  highlight(c);
  outline();
  head(c);
  lateralLine(c);
  tail(c);
  spinyDorsal(c);
  const softStart = Math.min(0.7, S.spinyEnd + { joined: 0.015, split: 0.07, continuous: 0.005 }[S.G.dJoin]);
  edgeFin(c, 7, 1, softStart, 0.74, (0.32 + hash(seed, 7, 1) * 0.18) * S.G.soft, 0.4, (f) => 0.35 + 0.65 * Math.sin(Math.PI * (0.15 + 0.8 * f)));
  edgeFin(c, 9, -1, 0.56 + hash(seed, 9) * 0.04, 0.72, (0.3 + hash(seed, 9, 1) * 0.15) * S.G.anal, 0.5, (f) => 0.5 + 0.5 * Math.sin(Math.PI * (0.2 + 0.75 * f)), hash(seed, 9, 2) < 0.4);
  pelvic(c);
  keel(c);
  finlets(c);
  pectoral(c);
  barbel(c);
  mouth(c);
  eye(c);
  c = finishInk(ink, api);
  S.post.forEach((f) => f(c));
  caption(c);

  if (!api.exporting) {
    eyeHit = S.eyeAt;
    if (params.showGrid) handles(c); // the grid is the tool, never the drawing: preview only
  }
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
