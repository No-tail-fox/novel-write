import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PixelleWorkerError } from './pixelle-worker';
import { fetchWithNetworkPolicy } from './network-policy';
import { PIXELLE_REVISION, type PixelleClipResult, type PixelleRenderClipRequest, type PixelleFrameResult, type PixelleRenderFrameRequest, type PixelleTemplateDescriptor } from './pixelle';

type Resource = NonNullable<PixelleRenderFrameRequest['resourceMap']>[string];
type CachedResource = Omit<Resource, 'path'> & { url: string };
type RenderRequest = PixelleRenderFrameRequest | PixelleRenderClipRequest;
type RenderResult = PixelleFrameResult | PixelleClipResult;
interface ResourceOptions<Q extends RenderRequest, R extends RenderResult> {
  cacheDir: string;
  template: PixelleTemplateDescriptor;
  signal?: AbortSignal;
  /** Production passes the isolated worker; injected in tests, never a model provider. */
  render: (request: Q) => Promise<R>;
  fetchResource?: (url: string, signal?: AbortSignal) => Promise<{ bytes: Buffer; contentType: string }>;
}
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const locks = new Map<string, Promise<unknown>>();
const maxResourceBytes = 16 * 1024 * 1024;
const maxRequestBytes = 64 * 1024 * 1024;

/** All downloads are public, credential-free, SSRF-checked and bounded by the host. */
async function fetchResource(url: string, signal?: AbortSignal) {
  const response = await fetchWithNetworkPolicy(url, {
    purpose: 'public-research', signal, timeoutMs: 45_000, maxBytes: maxResourceBytes,
    headers: { 'User-Agent': 'Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36' },
  });
  if (!response.ok) throw new Error(`Pixelle 模板资源 HTTP ${response.status}: ${url}`);
  return { bytes: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get('content-type')?.split(';')[0].trim() || 'application/octet-stream' };
}

function publicResourceUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Pixelle 模板资源必须使用无凭据的 HTTPS 地址');
  return url.href;
}
export function cssResourceUrls(css: string, base: string): string[] {
  return [...css.matchAll(/url\(\s*['"]?([^\s)'";]+)['"]?\s*\)/g)]
    .map(match => publicResourceUrl(new URL(match[1], base).href));
}

/** Render offline first, then fetch only resources actually requested by the original template.
 * Bytes are hash-locked on first use. A corrupt cache fails rather than changing the design.
 * No template, font-family or background is rewritten to conceal a missing dependency.
 */
export async function renderPixelleFrameWithResources<Q extends RenderRequest, R extends RenderResult>(request: Q, options: ResourceOptions<Q, R>): Promise<R> {
  const root = resolve(options.cacheDir, PIXELLE_REVISION);
  const previous = locks.get(root) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => renderWithCache(request, options, root));
  locks.set(root, current);
  try { return await current; } finally { if (locks.get(root) === current) locks.delete(root); }
}
async function renderWithCache<Q extends RenderRequest, R extends RenderResult>(request: Q, options: ResourceOptions<Q, R>, root: string): Promise<R> {
  options.signal?.throwIfAborted();
  if ((['provider', 'revision', 'path', 'sha256'] as const).some(key => request.templateRef[key] !== options.template.ref[key])) throw new Error('Pixelle 模板资源与模板引用不匹配');
  await mkdir(root, { recursive: true });
  const manifestPath = join(root, 'resources.json');
  let entries: CachedResource[] = [];
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { revision: string; entries: CachedResource[] };
    if (manifest.revision !== PIXELLE_REVISION || !Array.isArray(manifest.entries)) throw new Error('Pixelle 模板资源缓存版本无效');
    entries = manifest.entries;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const resources: NonNullable<PixelleRenderFrameRequest['resourceMap']> = { ...request.resourceMap };
  const allowed = new Set(options.template.remoteDependencies.filter(value => new URL(value).pathname !== '/').map(publicResourceUrl));
  const cachedBytes = new Map<string, Buffer>();
  for (const item of entries) {
    const url = publicResourceUrl(item.url);
    if (!/^[a-f0-9]{64}$/.test(item.sha256) || typeof item.contentType !== 'string') throw new Error('Pixelle 模板资源缓存清单无效');
    const path = join(root, digest(url));
    const bytes = await readFile(path);
    if (digest(bytes) !== item.sha256) throw new Error(`Pixelle 模板资源缓存校验失败: ${url}`);
    cachedBytes.set(url, bytes);
    resources[url] = { path, sha256: item.sha256, contentType: item.contentType };
  }
  function allowStylesheetChildren() {
    for (const url of [...allowed]) {
      if (resources[url]?.contentType === 'text/css' && cachedBytes.has(url)) {
        for (const child of cssResourceUrls(cachedBytes.get(url)!.toString('utf8'), url)) allowed.add(child);
      }
    }
  }
  allowStylesheetChildren();
  let downloaded = 0;
  let count = 0;
  for (let pass = 0; pass < 8; pass += 1) {
    options.signal?.throwIfAborted();
    try { return await options.render({ ...request, resourceMap: resources }); }
    catch (error) {
      if (!(error instanceof PixelleWorkerError) || error.code !== 'PIXELLE_RESOURCE_REQUIRED') throw error;
      const urls = [...new Set(error.missingResources)];
      if (!urls.length || urls.some(url => resources[url] || !allowed.has(url))) throw new Error(`Pixelle 模板资源不在原版依赖清单中: ${urls.join(', ')}`);
      for (const url of urls) {
        options.signal?.throwIfAborted();
        if (++count > 128) throw new Error('Pixelle 模板单次资源数量超限');
        const item = await (options.fetchResource ?? fetchResource)(url, options.signal);
        downloaded += item.bytes.length;
        if (!item.bytes.length || item.bytes.length > maxResourceBytes || downloaded > maxRequestBytes) throw new Error('Pixelle 模板资源大小超限');
        if (!/^(text\/css|image\/(png|jpeg|webp)|font\/[a-z0-9-]+|application\/(octet-stream|font-[a-z0-9-]+|x-font-[a-z0-9-]+))$/i.test(item.contentType)) throw new Error(`Pixelle 模板资源类型不可用: ${item.contentType}`);
        const path = join(root, digest(url));
        const partial = `${path}.${randomUUID()}.partial`;
        try { await writeFile(partial, item.bytes, { flag: 'wx' }); await rename(partial, path); }
        finally { await rm(partial, { force: true }); }
        const entry = { url, sha256: digest(item.bytes), contentType: item.contentType };
        entries = [...entries.filter(item => item.url !== url), entry];
        resources[url] = { path, sha256: entry.sha256, contentType: entry.contentType };
        cachedBytes.set(url, item.bytes);
      }
      const temporaryManifest = `${manifestPath}.${randomUUID()}.partial`;
      try { await writeFile(temporaryManifest, JSON.stringify({ revision: PIXELLE_REVISION, entries }, null, 2), { flag: 'wx' }); await rename(temporaryManifest, manifestPath); }
      finally { await rm(temporaryManifest, { force: true }); }
      allowStylesheetChildren();
    }
  }
  throw new Error('Pixelle 模板资源解析超过八轮，请检查嵌套依赖');
}