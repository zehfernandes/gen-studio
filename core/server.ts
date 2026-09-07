import type { Plugin, ViteDevServer } from 'vite';
import { promises as fs } from 'fs';
import { spawn, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import path from 'path';

export const SKETCHES_DIR = path.resolve('sketches');

const ENTRY_FILES = ['sketch.js', 'index.js', 'sketch.ts', 'index.ts'];

/** Resolve inside `base`; throws on `..` escapes. Use it for every path that comes from a request. */
export function safeJoin(base: string, ...parts: string[]): string {
  const target = path.resolve(base, ...parts);
  const resolvedBase = path.resolve(base);
  if (target !== resolvedBase && !target.startsWith(resolvedBase + path.sep)) {
    throw new Error('unsafe path');
  }
  return target;
}

async function findEntry(sketchPath: string): Promise<string | null> {
  for (const name of ENTRY_FILES) {
    try {
      await fs.access(path.join(sketchPath, name));
      return name;
    } catch {
      // try next
    }
  }
  return null;
}

export async function readBody(req: AsyncIterable<Uint8Array | string>, limit = 200 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += data.length;
    if (total > limit) throw new Error('body too large');
    chunks.push(data);
  }
  return Buffer.concat(chunks);
}

export function json(res: ServerResponse, data: unknown, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

export function text(res: ServerResponse, message: string, status = 500) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain');
  res.end(message);
}

async function listSketches() {
  await fs.mkdir(SKETCHES_DIR, { recursive: true });
  const entries = await fs.readdir(SKETCHES_DIR, { withFileTypes: true });
  const sketches = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sketchPath = path.join(SKETCHES_DIR, entry.name);
    const entryFile = await findEntry(sketchPath);
    if (entryFile) sketches.push({ name: entry.name, entry: entryFile });
  }
  sketches.sort((a, b) => a.name.localeCompare(b.name));
  return sketches;
}

async function createVersionDir(versionsDir: string): Promise<{ id: string; dir: string }> {
  await fs.mkdir(versionsDir, { recursive: true });
  const entries = await fs.readdir(versionsDir, { withFileTypes: true });
  const ids = entries
    .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
    .map((e) => Number(e.name));
  let next = ids.length ? Math.max(...ids) + 1 : 1;
  while (true) {
    const id = String(next++).padStart(3, '0');
    const dir = path.join(versionsDir, id);
    try {
      await fs.mkdir(dir);
      return { id, dir };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
}

async function listVersions(name: string) {
  const versionsDir = safeJoin(SKETCHES_DIR, name, 'versions');
  // Read only: a typo in the URL hash must not create `sketches/<typo>/versions/`.
  const entries = await fs.readdir(versionsDir, { withFileTypes: true }).catch(() => []);
  const versions = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    const paramsPath = path.join(versionsDir, entry.name, 'params.json');
    try {
      const raw = await fs.readFile(paramsPath, 'utf-8');
      const data = JSON.parse(raw);
      versions.push({
        id: entry.name,
        params: data.params || {},
        size: data.size,
        createdAt: data.createdAt || new Date().toISOString(),
      });
    } catch {
      // ignore malformed version folders
    }
  }
  versions.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  return versions;
}

// ---- ffmpeg streaming -------------------------------------------------------
// Frames are piped straight into ffmpeg's stdin, so no PNGs touch the disk and
// an abort just kills the process.

interface VideoJob {
  proc: ChildProcess;
  file: string;
  done: Promise<void>;
  error?: Error;
}

const videoJobs = new Map<string, VideoJob>();

function ffmpegNotFound(): Error {
  return new Error(
    'ffmpeg not found. Install it (e.g. `brew install ffmpeg`) or set FFMPEG_PATH to the binary.',
  );
}

function startVideo(file: string, fps: number) {
  return startFfmpeg(file, [
    '-framerate', String(fps),
    '-i', '-',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '18',
    // libx264 needs even dimensions.
    '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
  ]);
}

/**
 * Spawn ffmpeg reading PNGs from stdin (`-f image2pipe -vcodec png` is prepended, `file` appended) and
 * register it as a job: the browser then streams frames through `/api/video/:id/frame|end|abort`.
 * Plugins build other outputs on this (a stitched print, a GIF) without their own process handling.
 */
export function startFfmpeg(file: string, outputArgs: string[]): Promise<{ id: string; job: VideoJob }> {
  const cmd = process.env.FFMPEG_PATH || 'ffmpeg';
  const args = ['-y', '-f', 'image2pipe', '-vcodec', 'png', ...outputArgs, file];

  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 20000) stderr = stderr.slice(-10000);
    });

    const job: VideoJob = {
      proc,
      file,
      done: new Promise<void>((res, rej) => {
        proc.once('exit', (code) => {
          if (code === 0) res();
          else rej(new Error(`ffmpeg exited with code ${code}\n${stderr.trim().split('\n').slice(-5).join('\n')}`));
        });
      }),
    };
    job.done.catch((err) => {
      job.error = err;
    });

    proc.once('error', (err: NodeJS.ErrnoException) => {
      reject(err.code === 'ENOENT' ? ffmpegNotFound() : err);
    });
    proc.once('spawn', () => {
      proc.stdin?.on('error', () => {
        /* EPIPE after abort; surfaced via exit code */
      });
      const id = randomUUID();
      videoJobs.set(id, job);
      resolve({ id, job });
    });
  });
}

function writeFrame(job: VideoJob, frame: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (job.error) return reject(job.error);
    const stdin = job.proc.stdin;
    if (!stdin || !stdin.writable) return reject(new Error('ffmpeg is no longer accepting frames'));
    stdin.write(frame, (err) => (err ? reject(job.error ?? err) : resolve()));
  });
}

async function endVideo(id: string): Promise<void> {
  const job = videoJobs.get(id);
  if (!job) throw new Error('unknown video job');
  job.proc.stdin?.end();
  try {
    await job.done;
  } catch (err) {
    await fs.rm(job.file, { force: true });
    throw err;
  } finally {
    videoJobs.delete(id);
  }
}

async function abortVideo(id: string): Promise<void> {
  const job = videoJobs.get(id);
  if (!job) return;
  videoJobs.delete(id);
  job.proc.kill('SIGKILL');
  await job.done.catch(() => {});
  await fs.rm(job.file, { force: true });
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isPositive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const isName = (value: string) => value.length > 0 && value !== '.' && value !== '..' && !/[\\/]/.test(value);
const isRelativeFile = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && !path.isAbsolute(value) && value.split(/[\\/]/).every((part) => part !== '' && part !== '.' && part !== '..');

async function writeVersion(name: string, req: IncomingMessage, res: ServerResponse) {
  const body: unknown = JSON.parse((await readBody(req, 50 * 1024 * 1024)).toString());
  if (!isObject(body) || !isObject(body.params) || !isObject(body.size)) return text(res, 'params and size are required', 400);
  const { width, height, resolution } = body.size;
  if (![width, height, resolution].every(isPositive) || (body.thumb !== undefined && typeof body.thumb !== 'string')) {
    return text(res, 'invalid version data', 400);
  }
  const versionsDir = safeJoin(SKETCHES_DIR, name, 'versions');
  const { id, dir } = await createVersionDir(versionsDir);
  try {
    await fs.writeFile(
      path.join(dir, 'params.json'),
      JSON.stringify({ params: body.params, size: body.size, createdAt: new Date().toISOString() }, null, 2),
      'utf-8',
    );
    const thumb = body.thumb ?? '';
    if (thumb.startsWith('data:image/png;base64,')) {
      const base64 = thumb.slice('data:image/png;base64,'.length);
      await fs.writeFile(path.join(dir, 'thumb.png'), Buffer.from(base64, 'base64'));
    }
  } catch (err) {
    await fs.rm(dir, { recursive: true, force: true });
    throw err;
  }
  return json(res, { id });
}

async function removeVersion(name: string, id: string, res: ServerResponse) {
  if (!/^\d+$/.test(id)) return text(res, 'invalid version id', 400);
  const versionDir = safeJoin(SKETCHES_DIR, name, 'versions', id);
  await fs.rm(versionDir, { recursive: true, force: true });
  return json(res, { id });
}

async function handleVersions(segments: string[], method: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  // /api/sketches/:name/versions
  if (segments[0] !== 'sketches' || segments[2] !== 'versions') return false;
  const name = segments[1];
  if (!isName(name)) {
    text(res, 'invalid sketch name', 400);
    return true;
  }

  // GET /api/sketches/:name/versions
  if (segments.length === 3 && method === 'GET') {
    json(res, { versions: await listVersions(name) });
    return true;
  }

  // POST /api/sketches/:name/versions
  if (segments.length === 3 && method === 'POST') {
    await writeVersion(name, req, res);
    return true;
  }

  // DELETE /api/sketches/:name/versions/:id
  if (segments.length === 4 && method === 'DELETE') {
    await removeVersion(name, segments[3], res);
    return true;
  }
  return false;
}

async function handleSketchVideo(segments: string[], method: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  // POST /api/sketches/:name/video  { file, fps } → { id }   (file is relative to the sketch dir)
  if (segments[0] !== 'sketches' || segments[2] !== 'video' || segments.length !== 3 || method !== 'POST') return false;
  const name = segments[1];
  const body: unknown = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString());
  if (!isName(name) || !isObject(body) || !isRelativeFile(body.file) || !isPositive(body.fps)) {
    text(res, 'valid file and fps are required', 400);
    return true;
  }
  const sketchDir = safeJoin(SKETCHES_DIR, name);
  const target = safeJoin(sketchDir, ...body.file.split(/[\\/]/));
  await fs.mkdir(path.dirname(target), { recursive: true });
  const { id } = await startVideo(target, body.fps);
  json(res, { id });
  return true;
}

async function handleVideoJob(segments: string[], method: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  // /api/video/:id/(frame|end|abort)
  if (segments[0] !== 'video' || segments.length !== 3 || method !== 'POST') return false;
  const [, id, action] = segments;
  if (action === 'frame') {
    const job = videoJobs.get(id);
    if (!job) {
      text(res, 'unknown video job', 404);
      return true;
    }
    await writeFrame(job, await readBody(req));
  } else if (action === 'end') await endVideo(id);
  else if (action === 'abort') await abortVideo(id);
  else return false;
  json(res, { ok: true });
  return true;
}

async function handleFile(segments: string[], method: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  // POST /api/files/:path — writes under sketches/<sketch>/...
  if (segments[0] !== 'files' || method !== 'POST') return false;
  const rel = segments.slice(1).join('/');
  if (!rel) {
    text(res, 'path required', 400);
    return true;
  }
  const filePath = safeJoin(SKETCHES_DIR, ...rel.split('/'));
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const data = await readBody(req);
  await fs.writeFile(filePath, data);
  json(res, { path: rel });
  return true;
}

export function genStudioServer(): Plugin {
  return {
    name: 'gen-studio-server',
    configureServer(server: ViteDevServer) {
      server.httpServer?.once('close', () => {
        for (const id of [...videoJobs.keys()]) void abortVideo(id);
      });
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api')) return next();
        try {
          const url = new URL(req.url || '/', 'http://localhost');
          const method = (req.method || 'GET').toUpperCase();
          const pathname = url.pathname.replace(/^\/api/, '') || '/';
          const segments = pathname.split('/').filter(Boolean).map(decodeURIComponent);

          // GET /api/sketches
          if (segments.length === 1 && segments[0] === 'sketches' && method === 'GET') {
            const sketches = await listSketches();
            return json(res, { sketches });
          }
          if (await handleVersions(segments, method, req, res)) return;
          if (await handleSketchVideo(segments, method, req, res)) return;
          if (await handleVideoJob(segments, method, req, res)) return;
          if (await handleFile(segments, method, req, res)) return;
          return text(res, 'not found', 404);
        } catch (err) {
          console.error('[gen-studio-server]', err);
          return text(res, err instanceof Error ? err.message : 'server error', 500);
        }
      });
    },
  };
}
