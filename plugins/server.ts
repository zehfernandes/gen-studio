import type { Plugin } from 'vite';

// Node side of your plugins: extra Vite plugins, loaded by vite.config.ts next to core's server.
// A route is a middleware; reuse `SKETCHES_DIR`, `safeJoin`, `readBody`, `json`, `text` from '../core/server'.
//
// import { json } from '../core/server';
// const hello: Plugin = {
//   name: 'hello',
//   configureServer(server) {
//     server.middlewares.use('/api/hello', (_req, res) => json(res, { ok: true }));
//   },
// };
// export default [hello];

export default [] as Plugin[];
