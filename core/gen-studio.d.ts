// Types for sketches. Nothing to import: `sketches/jsconfig.json` loads this file, so a JSDoc tag is
// enough for autocomplete in a plain .js sketch:
//
//   /** @param {CanvasRenderingContext2D} c  @param {number} t  @param {GenStudio.Api} api */
//   export function draw(c, t, api) { … }
//
// A p5 sketch takes `{GenStudio.P5} p` instead. A .ts sketch can also `import type { Api } from '../../core'`
// (erased at build time, so the sketch still has no runtime dependency on the host).
//
// These are aliases of core's own types, so they never drift from what the host actually passes.
//
// `params` stays untyped on purpose: the host flattens `count: { value: 18, min: 3, max: 48 }` to
// `count: 18` at load, which a type checker cannot see. That is why jsconfig.json has `checkJs: false`
// — you get autocomplete on `api`, `c`/`p` and the config, and no false errors on `params.count * 2`.

declare namespace GenStudio {
  /** Third argument of `draw`, `setup`, `load`, `dispose`. */
  type Api = import('./types').Api;
  /** `export const config = { … }`. */
  type Config = import('./types').SketchConfig;
  /** `export const params = { … }`: bare values or `{ value, min, max, step }` / `{ value, options }` descriptors. */
  type Params = import('./types').SketchParams;
  /** What `draw` may return: nothing, a canvas, a `{ data, extension }` file, or an array of those. */
  type DrawResult = import('./types').DrawResult;
  type Layer = import('./types').Layer;
  /** The `p` a p5 / p5-webgl sketch receives. */
  type P5 = import('p5');
  /** The `p` a canvas2d sketch receives. */
  type Canvas2D = CanvasRenderingContext2D;
}
