---
name: add-shader
description: Add a full-screen fragment-shader renderer (raw WebGL2, no dependencies) so a sketch is a GLSL string plus params. Writes to plugins/ only.
---

# Add a shader renderer

Adds `renderers.shader`. A shader sketch compiles one fragment shader in `setup`; the host draws a full-screen triangle every frame with `u_resolution`, `u_time`, `u_frame`, `u_seed` and **every param forwarded as a uniform of the same name**. Numbers become `float`, hex colors `vec3`/`vec4`, booleans `float` 0/1, arrays `vecN`. No dependency.

## Rules

- Write to `plugins/` only. Never edit `core/`.
- Deterministic by construction: a shader is a pure function of its uniforms, and every uniform comes from `t`, `api.frame`, `api.seed` or `params`. Do not add a wall-clock uniform.
- The sketch stays plain: a GLSL string and the usual exports. No host imports inside the sketch.

## Steps

1. Write `plugins/shader-renderer.ts` from the reference below.
2. Register it in `plugins/index.ts`, once:
   ```ts
   import shader from './shader-renderer';
   renderers.shader = shader;
   ```
3. If the user has no shader sketch, create `sketches/example-shader/sketch.js` from the example below.
4. Verify: `pnpm check`; `pnpm dev`, open the sketch, change a color param and see the uniform update; press `E`, compare export and preview. Introduce a GLSL typo and confirm the compile error lands in the status bar instead of a blank canvas.

## What the sketch sees

```js
export function setup(p, api) { p.compile(frag); }   // once; recompile any time
export function draw(p, t, api) { p.uniforms.u_extra = ...; } // optional; params are automatic
```

`p = { gl, canvas, compile(frag), uniforms }`. `frag` is a GLSL ES 3.00 **body**: the host prepends

```glsl
#version 300 es
precision highp float;
in vec2 v_uv;            // 0..1, origin bottom-left
out vec4 fragColor;
uniform vec2 u_resolution;   // canvas pixels: use it for aspect only
uniform float u_time;        // t, 0..1 over the loop
uniform float u_frame;
uniform float u_seed;
```

so the sketch must **not** redeclare those. It declares its own uniforms for the params it uses (`uniform float count; uniform vec3 color;`). Unused params are skipped silently (their location is null).

## Pitfalls

- `preserveDrawingBuffer: true` on the context, same reason as three: the exporter reads the canvas after `draw` returns.
- Work in `v_uv` and `u_resolution.x / u_resolution.y`, never in absolute pixels: the export canvas is `size × resolution`, the preview whatever fits the stage. `gl_FragCoord`-based patterns change scale between the two.
- Hex colors are normalized to 0..1; 8-digit hex gives a `vec4`. Params named like a GLSL keyword or starting with `gl_` cannot be uniforms — rename the param.
- Compile errors: throw with the shader info log so `Stage.onError` shows it in the status bar. Keep the previous program if a recompile fails, so a live-edited shader does not go black.
- `await` the sketch's `draw` before rendering: it may be async, and uniforms set after the draw call would miss the frame.
- `resize` only needs `canvas.width/height` and `gl.viewport`; there is nothing cached at pixel size.
- `dispose`: delete program and buffer, then `gl.getExtension('WEBGL_lose_context')?.loseContext()` — browsers cap live WebGL contexts (~16), and every size change or export creates a new one.

## Reference implementation

```ts
// plugins/shader-renderer.ts
import { styleCanvas } from '../core';
import type { Renderer, RendererFactory } from '../core';

type UniformValue = number | boolean | string | number[];

export interface ShaderContext {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  /** Compile a fragment shader body (GLSL ES 3.00). Built-in uniforms and `v_uv`/`fragColor` are declared for you. */
  compile(frag: string): void;
  /** Extra uniforms set before every render, on top of the automatic ones (params, u_time, ...). */
  uniforms: Record<string, UniformValue>;
}

const VERT = `#version 300 es
in vec2 a_pos; out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const HEADER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_frame;
uniform float u_seed;
`;

function compileShader(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader compile error:\n${log}`);
  }
  return sh;
}

// Hex → 0..1 components. '#rgb', '#rrggbb', '#rrggbbaa'.
function hexToVec(hex: string): number[] {
  let h = hex.slice(1);
  if (h.length <= 4) h = [...h].map((c) => c + c).join('');
  const out = [];
  for (let i = 0; i < h.length; i += 2) out.push(parseInt(h.slice(i, i + 2), 16) / 255);
  return out;
}

const shader: RendererFactory = ({ container, width, height, params, api, load, setup, draw, dispose }) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  styleCanvas(canvas, width, height);
  container.appendChild(canvas);

  const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
  if (!gl) throw new Error('WebGL2 not supported');

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  let program: WebGLProgram | null = null;
  let locations = new Map<string, WebGLUniformLocation | null>();

  const location = (name: string) => {
    if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program!, name));
    return locations.get(name);
  };

  const setUniform = (name: string, value: UniformValue) => {
    const loc = location(name);
    if (loc === null || loc === undefined) return;
    if (typeof value === 'number') gl.uniform1f(loc, value);
    else if (typeof value === 'boolean') gl.uniform1f(loc, value ? 1 : 0);
    else if (typeof value === 'string') {
      if (!value.startsWith('#')) return;
      const v = hexToVec(value);
      v.length === 4 ? gl.uniform4fv(loc, v) : gl.uniform3fv(loc, v);
    } else if (Array.isArray(value)) {
      const fn = { 1: 'uniform1fv', 2: 'uniform2fv', 3: 'uniform3fv', 4: 'uniform4fv' }[value.length];
      if (fn) (gl as any)[fn](loc, value);
    }
  };

  const p: ShaderContext = {
    gl,
    canvas,
    uniforms: {},
    compile(frag) {
      const vs = compileShader(gl, gl.VERTEX_SHADER, VERT);
      const fs = compileShader(gl, gl.FRAGMENT_SHADER, HEADER + frag);
      const next = gl.createProgram()!;
      gl.attachShader(next, vs);
      gl.attachShader(next, fs);
      gl.linkProgram(next);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(next, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(next);
        gl.deleteProgram(next);
        throw new Error(`Shader link error:\n${log}`);
      }
      if (program) gl.deleteProgram(program);
      program = next;
      locations = new Map();
    },
  };

  const render = (t: number) => {
    if (!program) throw new Error('Shader sketch must call p.compile(frag) in setup()');
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const aPos = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    setUniform('u_resolution', [canvas.width, canvas.height]);
    setUniform('u_time', t);
    setUniform('u_frame', api.frame);
    setUniform('u_seed', api.seed);
    for (const key of Object.keys(params)) setUniform(key, params[key]);
    for (const key of Object.keys(p.uniforms)) setUniform(key, p.uniforms[key]);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const r: Renderer = {
    canvas,
    width,
    height,
    async setup() {
      await load?.(p, api);
      setup?.(p, api);
    },
    // Await the sketch's draw: it may be async, and uniforms must be set before we render.
    async draw(t) {
      const result = await draw(p, t, api);
      render(t);
      return result;
    },
    resize(w, h) {
      canvas.width = w;
      canvas.height = h;
      styleCanvas(canvas, w, h);
      r.width = w;
      r.height = h;
    },
    dispose() {
      dispose?.(p, api);
      if (program) gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();
    },
  };
  return r;
};

export default shader;
```

## Example sketch

```js
// sketches/example-shader/sketch.js
export const config = { renderer: 'shader', size: { preset: 'Instagram post' }, fps: 30, duration: 4 };

export const params = {
  seed: 3,
  bands: { value: 6, min: 1, max: 24, step: 1 },
  warp: { value: 0.4, min: 0, max: 2, step: 0.01 },
  ink: '#ff5c33',
  paper: '#101010',
};

// A GLSL ES 3.00 body. v_uv, fragColor, u_resolution, u_time, u_frame, u_seed are declared by the host.
const frag = /* glsl */ `
uniform float bands;
uniform float warp;
uniform vec3 ink;
uniform vec3 paper;

void main() {
  vec2 uv = v_uv;
  uv.x *= u_resolution.x / u_resolution.y;          // aspect only, never absolute pixels
  float phase = u_time * 6.2831853;                  // one cycle per loop
  float w = sin(uv.y * 6.0 + phase + u_seed) * warp;
  float s = 0.5 + 0.5 * sin((uv.x + w) * bands * 6.2831853);
  fragColor = vec4(mix(paper, ink, smoothstep(0.45, 0.55, s)), 1.0);
}`;

export function setup(p) {
  p.compile(frag);
}

export function draw() {}
```
