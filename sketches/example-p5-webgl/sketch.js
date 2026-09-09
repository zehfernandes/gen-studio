export const config = {
  renderer: 'p5-webgl',
  size: { preset: 'A3 300dpi' },
};

// The camera is three params, so a version or an export carries the view you found with the
// mouse. `distance` is in api.width units: the same numbers frame the preview and the A3 file.
export const params = {
  seed: 1,
  // `group` puts a param in its own folder in the panel; ungrouped ones stay in Params.
  yaw: { value: 0.6, min: -3.14, max: 3.14, step: 0.01, group: 'Camera' },
  pitch: { value: -0.4, min: -1.5, max: 1.5, step: 0.01, group: 'Camera' },
  distance: { value: 1.2, min: 0.2, max: 4, step: 0.01, group: 'Camera' },
  boxSize: { value: 0.16, min: 0.05, max: 0.5, step: 0.01 },
  color: '#2c62c8',
  bg: '#141628',
};

// One camera per p5 instance: the preview and the hidden export instance run this same module,
// so a plain module variable would hand one instance's camera to the other.
const cams = new WeakMap();

/** @param {GenStudio.P5} p */
export function setup(p) {
  // Our own camera object: orbitControl() mutates the current camera, and we want to read it back.
  cams.set(p, p.createCamera());
}

// A camera of our own has to honour api.tile itself (the host only does it for its default camera):
// scale and shift the projection so the tile's window fills the canvas — three's setViewOffset. A
// no-op when the tile is the whole artwork. Call it after perspective(), before setCamera().
function tileProjection(cam, api) {
  const { tile, width, height } = api;
  const m = cam.projMatrix.mat4;
  const sx = width / tile.width, sy = height / tile.height;
  m[0] *= sx; m[8] = (m[8] + (2 * tile.x + tile.width) / width - 1) * sx;
  m[5] *= sy; m[9] = (m[9] + 1 - (2 * tile.y + tile.height) / height) * sy;
}

/** @param {GenStudio.P5} p  @param {number} t  @param {GenStudio.Api} api */
export function draw(p, t, api) {
  const cam = cams.get(p);
  // params → camera. p5's camera lives in canvas pixels (the host only scales what we draw), hence
  // api.scale. A fixed FOV keeps the perspective the same at every canvas size (p5's default widens it);
  // the aspect is the artwork's, not the canvas's, so a tiled export sees the same frame.
  const r = params.distance * api.width * api.scale;
  const cp = Math.cos(params.pitch);
  cam.perspective(Math.PI / 3, api.width / api.height, r / 100, r * 10);
  cam.camera(r * cp * Math.sin(params.yaw), r * Math.sin(params.pitch), r * cp * Math.cos(params.yaw), 0, 0, 0, 0, 1, 0);
  tileProjection(cam, api);
  p.setCamera(cam);

  if (!api.exporting) {
    // Mouse → camera → params: drag to orbit, wheel to zoom; the sliders catch up on release.
    p.orbitControl();
    const dx = cam.eyeX - cam.centerX, dy = cam.eyeY - cam.centerY, dz = cam.eyeZ - cam.centerZ;
    const d = Math.hypot(dx, dy, dz);
    params.yaw = +Math.atan2(dx, dz).toFixed(3);
    params.pitch = +Math.asin(dy / d).toFixed(3);
    params.distance = +(d / (api.width * api.scale)).toFixed(3);
  }

  p.background(params.bg);
  p.noStroke();
  p.fill(params.color);

  // Sizes relative to api.width: the host scales the scene to the canvas, on screen and in the export.
  const w = api.width;
  for (let i = 0; i < 12; i++) {
    p.push();
    p.translate(api.random(-w, w) * 0.3, api.random(-w, w) * 0.3, api.random(-w, w) * 0.3);
    p.rotateY(api.random(Math.PI));
    p.box(w * params.boxSize * api.random(0.4, 1));
    p.pop();
  }
}
