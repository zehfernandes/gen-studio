// The plugin surface. Registries are plain objects: add a key, or overwrite one of core's.
export { renderers, styleCanvas } from './renderers';
export { exporters, makeExportRenderer, frameCount, postFile, layerToBlob, sidecar, exportName, EXPORTS_DIR } from './export';
export { controlTypes, updateParamsGUI } from './params';
export { hooks, keys, keyFor } from './hooks';
export { presets, resolveSize, outputPixels, matchPreset, fitPixels } from './size';
export { SketchApi } from './api';
export { createRandomBackend } from './random';
export { timestamp, toLayers, layerFileName, isCanvas } from './files';
export { frameAt, loopT } from './timing';
export { validate } from './validate';
export type { App } from './app';
export type { ControlFactory, Mounted, Panel } from './params';
export type {
  Api,
  ApiBackend,
  Size,
  SizeInput,
  Tile,
  Renderer,
  RendererFactory,
  RendererFactoryOptions,
  ExporterFactory,
  ExporterFactoryOptions,
  SketchConfig,
  SketchModule,
  SketchParams,
  Control,
  VersionInfo,
  LoadedSketch,
  Layer,
  FileLayer,
  DrawResult,
} from './types';
