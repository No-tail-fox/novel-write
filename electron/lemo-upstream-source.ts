import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const LEMO_UPSTREAM_REVISION = 'f17136060781a0068a7951245a3aa7835a7230de';
export interface LemoUpstreamManifest {
  revision: string;
  repository: string;
  files: Array<{ path: string; sha256: string; bytes: number }>;
}
export async function readLemoUpstreamManifest(root: string): Promise<LemoUpstreamManifest> {
  const manifest = JSON.parse(await readFile(join(root, 'storydream-upstream.json'), 'utf8')) as LemoUpstreamManifest;
  if (manifest.revision !== LEMO_UPSTREAM_REVISION || !Array.isArray(manifest.files)) throw new Error('LEMO_UPSTREAM_VERSION: 上游工程版本不匹配。');
  return manifest;
}
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.hdr': 'application/octet-stream',
  '.wasm': 'application/wasm', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
};
function inside(root: string, file: string): boolean {
  const rel = relative(root, file);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}
export interface LemoSourceOptions { upstreamRoot: string; filmDir: string; threeRoot: string; resourceRoot?: string }

/** Native ES modules, with a private film mount per session. No source rewriting or factory compilation. */
export async function serveLemoUpstreamProject(options: LemoSourceOptions) {
  const [upstreamRoot, filmDir, threeRoot, manifest] = await Promise.all([
    realpath(options.upstreamRoot), realpath(options.filmDir), realpath(options.threeRoot), readLemoUpstreamManifest(options.upstreamRoot),
  ]);
  const resources = new Map<string, string>();
  if (options.resourceRoot) {
    const cache = await realpath(options.resourceRoot);
    const index = JSON.parse(await readFile(join(cache, 'resources.json'), 'utf8')) as { revision: string; files: Array<{ path: string; sha256: string; sourceUrl: string; license: string }> };
    if (index.revision !== LEMO_UPSTREAM_REVISION) throw new Error('LEMO_RESOURCE_VERSION');
    for (const item of index.files) {
      if (!/^(?:core\/|styles\/|@film\/)/.test(item.path) || !/\.(?:woff2?|ttf|otf|hdr|bin|glb|gltf|png|jpe?g|webp|wav|mp3|txt)$/i.test(item.path)
        || !item.sourceUrl || !item.license) throw new Error('LEMO_RESOURCE_MANIFEST');
      const file = await realpath(resolve(cache, item.path));
      if (!inside(cache, file) || createHash('sha256').update(await readFile(file)).digest('hex') !== item.sha256) throw new Error('LEMO_RESOURCE_INTEGRITY');
      resources.set(item.path, file);
    }
  }
  const tracked = new Set(manifest.files.map(file => file.path));
  const entry = await realpath(join(filmDir, 'index.html'));
  if (!inside(filmDir, entry)) throw new Error('LEMO_FILM_ENTRY: 影片入口越出项目目录。');
  let origin = '';
  let closing = false;
  let closePromise: Promise<void> | undefined;
  const streams = new Map<ReturnType<typeof createReadStream>, Promise<void>>();
  const failures: Array<{ path: string; status: number }> = [];
  const server = createServer(async (req, res) => {
    if (closing) { res.destroy(); return; }
    const fail = (code: number, text: string) => {
      if (res.destroyed) return;
      if (failures.length < 200) failures.push({ path: (req.url || '').slice(0, 1024), status: code });
      res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(text);
    };
    if (req.headers.host !== origin.slice('http://'.length) || (req.headers.origin && req.headers.origin !== origin)) return fail(403, 'bad origin');
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405, 'read only');
    let url: string;
    try { url = decodeURIComponent((req.url || '/').split('?')[0]); } catch { return fail(400, 'bad path'); }
    // Decode once and reject platform-specific separators, drive paths and traversal before resolving.
    if (!url.startsWith('/') || /[\\\0:]/.test(url) || url.split('/').some(part => part === '..' || part === '.')) return fail(403, 'outside root');
    const dependency = /(?:^|\/)node_modules\/three\/(.+)$/.exec(url);
    let base: string, subpath: string;
    if (dependency) { base = threeRoot; subpath = dependency[1]; }
    else if (url.startsWith('/@film/')) { base = filmDir; subpath = url.slice('/@film/'.length); }
    else { base = upstreamRoot; subpath = url.slice(1); if (!tracked.has(subpath) && !resources.has(subpath)) return fail(404, 'untracked library resource'); }
    if (!mime[extname(subpath).toLowerCase()]) return fail(403, 'unsupported resource');
    try {
      let file: string;
      try {
        file = await realpath(resolve(base, subpath));
        if (!inside(base, file)) return fail(403, 'outside root');
      } catch (error) {
        const cached = dependency ? undefined : resources.get(url.slice(1));
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !cached) throw error;
        file = cached;
      }
      const info = await stat(file);
      if (closing || res.destroyed) { res.destroy(); return; }
      if (!info.isFile()) return fail(404, 'not a file');
      res.writeHead(200, { 'Content-Type': mime[extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': info.size,
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = createReadStream(file);
      // Socket shutdown is earlier than Windows releasing the underlying file handle.
      streams.set(stream, new Promise<void>(done => stream.once('close', () => { streams.delete(stream); done(); })));
      stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
    } catch { fail(404, 'missing local resource'); }
  });
  await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); done(); }); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('LEMO_SERVER_ADDRESS');
  origin = `http://127.0.0.1:${address.port}`;
  const rel = relative(upstreamRoot, filmDir);
  const pageUrl = inside(upstreamRoot, filmDir)
    ? `${origin}/${rel.split(sep).map(encodeURIComponent).join('/')}/index.html`
    : `${origin}/@film/index.html`;
  const close = () => {
    if (closePromise) return closePromise;
    closing = true;
    closePromise = (async () => {
      const stopped = new Promise<void>((done, reject) => {
        server.close(error => error ? reject(error) : done());
        server.closeAllConnections();
      });
      const openStreams = [...streams];
      for (const [stream] of openStreams) stream.destroy();
      await Promise.all([stopped, ...openStreams.map(([, closed]) => closed)]);
    })();
    return closePromise;
  };
  return { origin, pageUrl, manifest, failures, close };
}
