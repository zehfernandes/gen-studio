import { defineConfig } from 'vite';
import { genStudioServer } from './core/server.ts';
import serverPlugins from './plugins/server.ts';

export default defineConfig({
  // Your plugins first: core's server answers every /api route it knows and 404s the rest,
  // so anything registered after it would never see a request.
  plugins: [...serverPlugins, genStudioServer()],
});
