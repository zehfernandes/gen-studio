// Browser side of your plugins. This file runs once before the app starts. Every registry is a
// plain object you mutate — add a key, or overwrite one of core's. Examples:
//
// import { renderers, exporters, presets, controlTypes, keys, hooks } from '../core';
//
// import threeRenderer from './three-renderer';
// renderers.three = threeRenderer;
//
// import gifExporter from './gif-export';
// exporters.gif = gifExporter;
// keys.q = (app) => app.export('gif');
//
// import { mountButtonGroup } from 'dialkit/vanilla';
// hooks.panel.push((panel, sketch, app) =>
//   mountButtonGroup(panel.addFolder('Batch'), { buttons: [{ label: 'Run', onClick: () => app.export('batch') }] }));
//
// controlTypes.wheel = (host, params, key, control, onChange) => { /* mount your own widget; return { update, destroy } */ };
//
// Sizes are pixels. A physical size is just a preset you compute once:
// const mm = (w: number, h: number, dpi = 300) => ({ width: Math.round((w / 25.4) * dpi), height: Math.round((h / 25.4) * dpi) });
// presets['Gallery 50x70cm'] = mm(500, 700);
//
// Server routes go in ./server.ts. Skills in .agents/skills/add-* append to these two files.
