import { Controller } from 'lil-gui';
import type GUI from 'lil-gui';
import type { Control, ControlFactory, SketchParams } from '../core';

/** `[x, y]` pairs in 0..1, sorted by x. This is the plain value stored in `params` and in versions. */
export type Point = [number, number];

/**
 * Monotone cubic (Fritsch–Carlson) through `pts`: smooth, no overshoot, passes through every point.
 * Sketches don't import from the host — copy this function into the sketch that uses the curve.
 */
export function curveAt(pts: Point[], x: number): number {
  const n = pts.length;
  if (n === 0) return x;
  if (n === 1) return pts[0][1];
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[n - 1][0]) return pts[n - 1][1];

  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    d.push(dx > 0 ? (pts[i + 1][1] - pts[i][1]) / dx : 0);
  }
  const m: number[] = [d[0]];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  m[n - 1] = d[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * a * d[i];
      m[i + 1] = tau * b * d[i];
    }
  }

  let i = 0;
  while (x > pts[i + 1][0]) i++;
  const h = pts[i + 1][0] - pts[i][0];
  const s = (x - pts[i][0]) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  return (
    (2 * s3 - 3 * s2 + 1) * pts[i][1] +
    (s3 - 2 * s2 + s) * h * m[i] +
    (-2 * s3 + 3 * s2) * pts[i + 1][1] +
    (s3 - s2) * h * m[i + 1]
  );
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const clone = (pts: Point[]): Point[] => pts.map(([x, y]) => [x, y]);
const DEFAULT: Point[] = [
  [0, 0],
  [1, 1],
];

/**
 * A lil-gui controller so `updateParamsGUI` (versions, plugins) refreshes it like any other widget.
 * Drag a point; click the curve to add one; double-click a point to remove it; ↺ resets to the code's default.
 * Endpoints slide vertically only, inner points stay between their neighbours, so the curve is always a function of x.
 */
class CurveController extends Controller {
  private $canvas: HTMLCanvasElement;
  private defaults: Point[];
  private drag = -1;

  constructor(parent: GUI, object: SketchParams, property: string, control: Control) {
    super(parent, object, property, 'lil-curve');
    this.defaults = clone((control.default as Point[]) ?? (this.getValue() as Point[]) ?? DEFAULT);
    this.initialValue = clone(this.defaults);

    Object.assign(this.domElement.style, { flexDirection: 'column', alignItems: 'stretch' });
    Object.assign(this.$name.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center' });

    const reset = document.createElement('button');
    reset.textContent = '↺';
    reset.title = 'Reset curve';
    Object.assign(reset.style, { background: 'none', border: '0', color: 'inherit', cursor: 'pointer', opacity: '0.6', font: 'inherit', padding: '0 2px' });
    reset.addEventListener('click', () => this.reset());
    this.$name.appendChild(reset);

    this.$canvas = document.createElement('canvas');
    Object.assign(this.$canvas.style, { width: '100%', aspectRatio: '1', display: 'block', cursor: 'crosshair', touchAction: 'none' });
    this.$widget.appendChild(this.$canvas);
    this.bind();
    // The panel is still laying out; measure on the next frame.
    requestAnimationFrame(() => this.updateDisplay());
  }

  reset() {
    this.setValue(clone(this.defaults));
    this._callOnFinishChange();
    return this;
  }

  private points(): Point[] {
    const v = this.getValue();
    if (!Array.isArray(v) || v.length < 2) this.setValue(clone(this.defaults));
    return this.getValue() as Point[];
  }

  private pos(e: MouseEvent): Point {
    const r = this.$canvas.getBoundingClientRect();
    return [clamp01((e.clientX - r.left) / r.width), clamp01(1 - (e.clientY - r.top) / r.height)];
  }

  private nearest(p: Point): number {
    const tol = 10 / this.$canvas.getBoundingClientRect().width;
    let best = -1;
    let bestD = tol * tol;
    this.points().forEach(([x, y], i) => {
      const d = (x - p[0]) ** 2 + (y - p[1]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  private bind() {
    const c = this.$canvas;
    c.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const p = this.pos(e);
      const pts = this.points();
      let i = this.nearest(p);
      if (i < 0) {
        i = pts.findIndex(([x]) => x > p[0]);
        if (i < 0) i = pts.length;
        pts.splice(i, 0, p);
        this._callOnChange();
      }
      this.drag = i;
      c.setPointerCapture(e.pointerId);
      this.updateDisplay();
    });
    c.addEventListener('pointermove', (e) => {
      if (this.drag < 0) return;
      const pts = this.points();
      const i = this.drag;
      const [x, y] = this.pos(e);
      const px = i === 0 ? 0 : i === pts.length - 1 ? 1 : Math.min(pts[i + 1][0] - 1e-3, Math.max(pts[i - 1][0] + 1e-3, x));
      pts[i] = [px, y];
      this._callOnChange();
      this.updateDisplay();
    });
    const up = () => {
      if (this.drag < 0) return;
      this.drag = -1;
      this._callOnFinishChange();
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('dblclick', (e) => {
      const pts = this.points();
      const i = this.nearest(this.pos(e));
      if (i <= 0 || i >= pts.length - 1) return;
      pts.splice(i, 1);
      this._callOnChange();
      this._callOnFinishChange();
      this.updateDisplay();
    });
  }

  updateDisplay() {
    const c = this.$canvas;
    const dpr = window.devicePixelRatio || 1;
    const px = Math.round((c.clientWidth || 200) * dpr);
    if (c.width !== px) c.width = c.height = px;

    const g = c.getContext('2d')!;
    const pad = 6 * dpr;
    const inner = px - pad * 2;
    const X = (x: number) => pad + x * inner;
    const Y = (y: number) => pad + (1 - y) * inner;
    g.clearRect(0, 0, px, px);

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = dpr;
    for (let i = 0; i <= 4; i++) {
      const v = i / 4;
      g.beginPath();
      g.moveTo(X(v), Y(0));
      g.lineTo(X(v), Y(1));
      g.moveTo(X(0), Y(v));
      g.lineTo(X(1), Y(v));
      g.stroke();
    }

    const pts = this.points();
    g.strokeStyle = '#fff';
    g.lineWidth = 2 * dpr;
    g.beginPath();
    for (let i = 0; i <= 100; i++) {
      const x = i / 100;
      const y = clamp01(curveAt(pts, x));
      if (i === 0) g.moveTo(X(x), Y(y));
      else g.lineTo(X(x), Y(y));
    }
    g.stroke();

    g.fillStyle = '#fff';
    g.strokeStyle = '#111';
    for (const [x, y] of pts) {
      g.beginPath();
      g.arc(X(x), Y(y), 5 * dpr, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    return this;
  }
}

/** `controlTypes.curve = curve` — then `params.tone = { value: [[0, 0], [1, 1]], type: 'curve' }`. */
export const curve: ControlFactory = (folder, params, key, control, onChange) =>
  new CurveController(folder, params, key, control).onChange(onChange);
