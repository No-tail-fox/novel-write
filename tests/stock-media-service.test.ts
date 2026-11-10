/**
 * S-1 stock media: download safety and IPC wiring, exercised against the local mock relay only
 * (127.0.0.1, ephemeral port). No real Pexels/Pixabay request is ever made.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StockMediaService, detectStockMediaContainer } from '../electron/stock-media-service';
import { startMockRelay, type MockRelay } from './helpers/mock-relay';
import { ipcInputSchemas } from '../src/shared/ipc-contract';
import { INVOKE_CHANNELS } from '../src/shared/storydream-api';
import { isSecretId, extractConfigSecrets, stripConfigSecrets, applyConfigSecrets } from '../src/shared/config-secrets';
import { ARTIFACT_STORAGE_DIRECTORIES } from '../src/shared/artifact-paths';
import { defaultConfig } from '../src/shared/config';
import { normalizeAppConfig } from '../src/shared/config-utils';
import type { AppConfig } from '../src/shared/types';
import { isStockMediaCancelled, type StockMediaCancelledResult } from '../src/shared/stock-media';

const MP4 = '\0\0\0\x18ftypisom\0\0\x02\0isomiso2mp41' + 'x'.repeat(200);
const MP4_OTHER = '\0\0\0\x18ftypisom\0\0\x02\0isomiso2mp41' + 'y'.repeat(200);
const HTML = '<!DOCTYPE html><html><head><title>Access denied</title></head><body>please log in</body></html>';
const KEY = 'pk-test-secret-123456';

let relay: MockRelay;
const directories: string[] = [];
beforeAll(async () => { relay = await startMockRelay(); });
afterAll(async () => { await relay.close(); });
afterEach(async () => {
  relay.reset();
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function managedDir() {
  const dir = await mkdtemp(join(tmpdir(), 'stock-media-')); directories.push(dir);
  return join(dir, 'stock-media');
}

function pexelsPayload(videos: Array<{ id: number; path: string; width?: number; height?: number }>) {
  return {
    page: 1, per_page: videos.length, total_results: videos.length,
    videos: videos.map(video => ({
      id: video.id, width: video.width ?? 1920, height: video.height ?? 1080,
      url: `${relay.origin}/page/${video.id}`, image: `${relay.origin}/thumb/${video.id}.jpg`, duration: 12,
      user: { id: 1, name: `Author ${video.id}`, url: `${relay.origin}/@author` },
      video_files: [{ id: video.id * 10, quality: 'hd', file_type: 'video/mp4', width: video.width ?? 1920, height: video.height ?? 1080, link: `${relay.origin}${video.path}` }],
    })),
  };
}

function service(dir: string, options: Partial<ConstructorParameters<typeof StockMediaService>[0]> = {}) {
  return new StockMediaService({
    resolveApiKey: async provider => (provider === 'pexels' ? KEY : ''),
    managedDirectory: () => dir,
    baseUrls: { pexels: relay.origin, pixabay: relay.origin },
    allowLoopbackHttp: true,
    ...options,
  });
}

async function searchOne(svc: StockMediaService, routes: Record<string, () => { status: number; body: string; headers?: Record<string, string> }>, videos = [{ id: 1, path: '/files/1.mp4' }]) {
  relay.setHandler((request) => {
    if (request.url.startsWith('/videos/search')) return { kind: 'json', body: pexelsPayload(videos) };
    const route = routes[request.url];
    return route ? { kind: 'text', ...route() } : undefined;
  });
  return svc.search({ provider: 'pexels', query: 'city', orientation: 'landscape', kind: 'video' });
}

async function listing(dir: string) {
  return (await readdir(dir).catch(() => [] as string[])).sort();
}

/** Narrow a search/download outcome to the success branch (these call sites never cancel). */
function done<T>(value: T | StockMediaCancelledResult): T {
  if (isStockMediaCancelled(value)) throw new Error(`unexpected cancel: ${value.requestId}`);
  return value;
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 3000) {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

/** Download body that sends one chunk and then stalls until the request signal aborts. */
function stallingFetch(chunk: Uint8Array, contentType: string, calls: string[] = []) {
  return async (url: string | URL, init?: RequestInit) => {
    calls.push(String(url));
    return new Response(new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(chunk);
        init?.signal?.addEventListener('abort', () => stream.error(init.signal?.reason));
      },
    }), { status: 200, headers: { 'content-type': contentType } });
  };
}

function shareItems(target: StockMediaService, source: StockMediaService) {
  (target as unknown as { items: Map<string, unknown> }).items = (source as unknown as { items: Map<string, unknown> }).items;
}

// ASCII-only WebP so the text relay sends it byte-exact.
const WEBP = 'RIFF\x24\0\0\0WEBPVP8 ' + 'w'.repeat(200);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, ...new Array(200).fill(0x20)]);

function pexelsPhotoPayload(photos: Array<{ id: number; width: number; height: number; src: Record<string, string> }>) {
  return {
    page: 1, per_page: photos.length, total_results: photos.length,
    photos: photos.map(photo => ({
      id: photo.id, width: photo.width, height: photo.height, url: `${relay.origin}/photo/${photo.id}`,
      photographer: `Photographer ${photo.id}`, photographer_url: `${relay.origin}/@p`,
      src: Object.fromEntries(Object.entries(photo.src).map(([name, path]) => [name, `${relay.origin}${path}`])),
    })),
  };
}

async function searchPhotos(svc: StockMediaService, routes: Record<string, () => { status: number; body: string; headers?: Record<string, string> }>) {
  relay.setHandler((request) => {
    if (request.url.startsWith('/v1/search')) {
      return { kind: 'json', body: pexelsPhotoPayload([{ id: 7, width: 3000, height: 4500, src: { original: '/img/7-original.webp', portrait: '/img/7-portrait.webp', landscape: '/img/7-landscape.webp' } }]) };
    }
    const route = routes[request.url];
    return route ? { kind: 'text', ...route() } : undefined;
  });
  return done(await svc.search({ provider: 'pexels', query: 'forest', orientation: 'portrait', kind: 'photo' }));
}

describe('stock media search (mock relay)', () => {
  it('sends the key only in the Authorization header and maps the documented query', async () => {
    const dir = await managedDir();
    const result = done(await searchOne(service(dir), {}));
    expect(result.items).toHaveLength(1);
    const request = relay.requests[0];
    expect(request.headers.authorization).toBe(KEY);
    const url = new URL(request.url, relay.origin);
    expect(url.pathname).toBe('/videos/search');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ query: 'city', orientation: 'landscape', page: '1', per_page: '20' });
    expect(request.url).not.toContain(KEY);
  });

  it('throws 未配置素材站密钥 without any network call when no key is configured', async () => {
    const svc = service(await managedDir(), { resolveApiKey: async () => '' });
    await expect(svc.search({ query: 'city', orientation: 'landscape', kind: 'video' })).rejects.toMatchObject({ code: 'STOCK_MEDIA_KEY_MISSING' });
    await expect(svc.search({ provider: 'pixabay', query: 'city', orientation: 'landscape', kind: 'video' })).rejects.toThrow('未配置素材站密钥');
    expect(relay.requests).toHaveLength(0);
  });

  it('classifies 401, 429 with Retry-After and empty results; never echoes the Pixabay key', async () => {
    const svc = service(await managedDir(), { resolveApiKey: async () => KEY });
    relay.enqueue({ kind: 'json', status: 401, body: { error: 'Unauthorized' } });
    await expect(svc.search({ provider: 'pexels', query: 'a', orientation: 'landscape', kind: 'video' })).rejects.toMatchObject({ code: 'STOCK_MEDIA_KEY_INVALID' });
    relay.enqueue({ kind: 'rate-limit', retryAfter: '7' });
    await expect(svc.search({ provider: 'pexels', query: 'a', orientation: 'landscape', kind: 'video' })).rejects.toMatchObject({ code: 'STOCK_MEDIA_RATE_LIMITED', retryAfterMs: 7000, retryable: true });
    relay.enqueue({ kind: 'json', body: { total: 0, totalHits: 0, hits: [] } });
    await expect(svc.search({ provider: 'pixabay', query: 'zzz', orientation: 'landscape', kind: 'video' })).rejects.toMatchObject({ code: 'STOCK_MEDIA_NO_RESULTS' });
    expect(relay.requests[2].url).toContain(`key=${KEY}`);
    relay.enqueue({ kind: 'text', status: 400, body: '[ERROR 400] "key" is invalid' });
    const failure = await svc.search({ provider: 'pixabay', query: 'a', orientation: 'landscape', kind: 'video' }).catch((error: Error) => error);
    expect(failure).toMatchObject({ code: 'STOCK_MEDIA_KEY_INVALID' });
    expect(String((failure as Error).message)).not.toContain(KEY);
  });

  it('honours a caller AbortSignal and the search timeout', async () => {
    const svc = service(await managedDir(), { searchTimeoutMs: 50 });
    relay.enqueue({ kind: 'slow-headers', delayMs: 500 });
    await expect(svc.search({ provider: 'pexels', query: 'a', orientation: 'landscape', kind: 'video' })).rejects.toMatchObject({ code: 'STOCK_MEDIA_TIMEOUT' });
    const controller = new AbortController(); controller.abort(new Error('user cancelled'));
    await expect(svc.search({ provider: 'pexels', query: 'a', orientation: 'landscape', kind: 'video' }, controller.signal)).rejects.toThrow('user cancelled');
  });
});

describe('stock media safe download (mock relay)', () => {
  it('downloads atomically, writes a source manifest and never re-downloads the same provider id', async () => {
    const dir = await managedDir();
    const svc = service(dir, { now: () => new Date('2026-10-31T00:00:00.000Z') });
    await searchOne(svc, { '/files/1.mp4': () => ({ status: 200, body: MP4, headers: { 'content-type': 'video/mp4' } }) });
    const first = done(await svc.download({ provider: 'pexels', kind: 'video', id: '1', ratio: '16:9' }));
    expect(first.reused).toBeNull();
    expect(first.path).toBe(join(dir, 'pexels-video-1.mp4'));
    expect(await readFile(first.path, 'latin1')).toBe(MP4);
    const manifest = JSON.parse(await readFile(first.manifestPath, 'utf8'));
    expect(manifest).toMatchObject({
      provider: 'pexels', id: '1', author: 'Author 1', sourceUrl: `${relay.origin}/page/1`,
      license: { name: 'Pexels License', attributionRequired: false }, downloadedAt: '2026-10-31T00:00:00.000Z',
      sha256: first.sha256, fileName: 'pexels-video-1.mp4',
    });
    expect(JSON.stringify(manifest)).not.toContain(KEY);
    expect(await listing(dir)).toEqual(['pexels-video-1.mp4', 'pexels-video-1.source.json']);

    const downloads = relay.requests.filter(request => request.url === '/files/1.mp4').length;
    const fresh = service(dir); // e.g. after restart / re-export: nothing cached in memory
    const again = await fresh.download({ provider: 'pexels', kind: 'video', id: '1' });
    expect(again).toMatchObject({ reused: 'provider-id', path: first.path, sha256: first.sha256 });
    expect(relay.requests.filter(request => request.url === '/files/1.mp4').length).toBe(downloads);
  });

  it('deduplicates identical content downloaded under another id', async () => {
    const dir = await managedDir();
    const svc = service(dir);
    await searchOne(svc, {
      '/files/1.mp4': () => ({ status: 200, body: MP4, headers: { 'content-type': 'video/mp4' } }),
      '/files/2.mp4': () => ({ status: 200, body: MP4, headers: { 'content-type': 'video/mp4' } }),
    }, [{ id: 1, path: '/files/1.mp4' }, { id: 2, path: '/files/2.mp4' }]);
    const first = done(await svc.download({ provider: 'pexels', kind: 'video', id: '1' }));
    const second = await svc.download({ provider: 'pexels', kind: 'video', id: '2' });
    expect(second).toMatchObject({ reused: 'content', path: first.path, sha256: first.sha256 });
    expect(await listing(dir)).toEqual(['pexels-video-1.mp4', 'pexels-video-1.source.json', 'pexels-video-2.source.json']);
  });

  it('re-downloads when the managed file was corrupted instead of trusting a stale manifest', async () => {
    const dir = await managedDir();
    const svc = service(dir);
    let body = MP4;
    await searchOne(svc, { '/files/1.mp4': () => ({ status: 200, body, headers: { 'content-type': 'video/mp4' } }) });
    const first = done(await svc.download({ provider: 'pexels', kind: 'video', id: '1' }));
    const { writeFile } = await import('node:fs/promises');
    await writeFile(first.path, MP4_OTHER);
    body = MP4;
    const repaired = done(await svc.download({ provider: 'pexels', kind: 'video', id: '1' }));
    expect(repaired.reused).toBeNull();
    expect(await readFile(repaired.path, 'latin1')).toBe(MP4);
  });

  it('refuses an HTML page pretending to be a video, by content type and by magic bytes', async () => {
    const dir = await managedDir();
    const svc = service(dir);
    await searchOne(svc, {
      '/files/1.mp4': () => ({ status: 200, body: HTML, headers: { 'content-type': 'text/html' } }),
      '/files/2.mp4': () => ({ status: 200, body: HTML, headers: { 'content-type': 'video/mp4' } }),
    }, [{ id: 1, path: '/files/1.mp4' }, { id: 2, path: '/files/2.mp4' }]);
    await expect(svc.download({ provider: 'pexels', kind: 'video', id: '1' })).rejects.toMatchObject({ code: 'STOCK_MEDIA_NOT_MEDIA' });
    await expect(svc.download({ provider: 'pexels', kind: 'video', id: '2' })).rejects.toThrow('网页');
    expect(await listing(dir)).toEqual([]);
  });

  it('refuses oversize files by Content-Length and while streaming', async () => {
    const dir = await managedDir();
    const svc = service(dir, { maxBytes: { video: 100 } });
    await searchOne(svc, { '/files/1.mp4': () => ({ status: 200, body: MP4, headers: { 'content-type': 'video/mp4' } }) });
    await expect(svc.download({ provider: 'pexels', kind: 'video', id: '1' })).rejects.toMatchObject({ code: 'STOCK_MEDIA_TOO_LARGE' });
    expect(await listing(dir)).toEqual([]);

    const streaming = service(dir, {
      maxBytes: { video: 100 },
      fetch: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(MP4)); controller.close(); } }), { status: 200, headers: { 'content-type': 'video/mp4' } }),
    });
    (streaming as unknown as { items: Map<string, unknown> }).items = (svc as unknown as { items: Map<string, unknown> }).items;
    await expect(streaming.download({ provider: 'pexels', kind: 'video', id: '1' })).rejects.toMatchObject({ code: 'STOCK_MEDIA_TOO_LARGE' });
    expect(await listing(dir)).toEqual([]);
  });

  it('follows same-host redirects but refuses redirects to http or unexpected hosts without fetching them', async () => {
    const dir = await managedDir();
    const svc = service(dir);
    await searchOne(svc, {
      '/files/1.mp4': () => ({ status: 302, body: '', headers: { location: '/cdn/1.mp4' } }),
      '/cdn/1.mp4': () => ({ status: 200, body: MP4, headers: { 'content-type': 'video/mp4' } }),
      '/files/2.mp4': () => ({ status: 302, body: '', headers: { location: 'http://videos.pexels.com/2.mp4' } }),
      '/files/3.mp4': () => ({ status: 307, body: '', headers: { location: 'https://evil.example.com/3.mp4' } }),
    }, [{ id: 1, path: '/files/1.mp4' }, { id: 2, path: '/files/2.mp4' }, { id: 3, path: '/files/3.mp4' }]);
    const ok = done(await svc.download({ provider: 'pexels', kind: 'video', id: '1' }));
    expect(ok.manifest.downloadUrl).toBe(`${relay.origin}/cdn/1.mp4`);
    await expect(svc.download({ provider: 'pexels', kind: 'video', id: '2' })).rejects.toMatchObject({ code: 'STOCK_MEDIA_REDIRECT_REJECTED' });
    await expect(svc.download({ provider: 'pexels', kind: 'video', id: '3' })).rejects.toMatchObject({ code: 'STOCK_MEDIA_REDIRECT_REJECTED' });
    expect(await listing(dir)).toEqual(['pexels-video-1.mp4', 'pexels-video-1.source.json']);
  });

  it('production policy refuses non-https and off-provider download links', async () => {
    const dir = await managedDir();
    const svc = service(dir, { allowLoopbackHttp: false });
    const items = (svc as unknown as { items: Map<string, unknown> }).items;
    const base = { provider: 'pexels', kind: 'video', author: 'a', authorUrl: '', sourceUrl: '', previewUrl: '', width: 1920, height: 1080, license: { name: 'Pexels License', url: '', attributionRequired: false } };
    items.set('pexels:video:9', { ...base, id: '9', downloadUrl: 'http://videos.pexels.com/9.mp4', renditions: [{ url: 'http://videos.pexels.com/9.mp4', width: 1920, height: 1080 }] });
    items.set('pexels:video:8', { ...base, id: '8', downloadUrl: `${relay.origin}/x.mp4`, renditions: [{ url: `${relay.origin}/x.mp4`, width: 1920, height: 1080 }] });
    await expect(svc.download({ provider: 'pexels', kind: 'video', id: '9' })).rejects.toMatchObject({ code: 'STOCK_MEDIA_URL_REJECTED' });
    await expect(svc.download({ provider: 'pexels', kind: 'video', id: '8' })).rejects.toMatchObject({ code: 'STOCK_MEDIA_URL_REJECTED' });
    expect(relay.requests).toHaveLength(0);
  });

  it('refuses ids that were not returned by a recent search', async () => {
    const svc = service(await managedDir());
    await expect(svc.download({ provider: 'pexels', kind: 'video', id: '424242' })).rejects.toMatchObject({ code: 'STOCK_MEDIA_ITEM_UNKNOWN' });
    expect(relay.requests).toHaveLength(0);
  });

  it('cancelling mid-download leaves no partial file and no manifest', async () => {
    const dir = await managedDir();
    const controller = new AbortController();
    const svc = service(dir, {
      fetch: async (_url, init) => new Response(new ReadableStream<Uint8Array>({
        start(stream) {
          stream.enqueue(new TextEncoder().encode(MP4));
          setTimeout(() => controller.abort(new Error('用户取消下载')), 20);
          init?.signal?.addEventListener('abort', () => stream.error(init.signal?.reason));
        },
      }), { status: 200, headers: { 'content-type': 'video/mp4' } }),
    });
    const helper = service(dir);
    await searchOne(helper, {});
    (svc as unknown as { items: Map<string, unknown> }).items = (helper as unknown as { items: Map<string, unknown> }).items;
    await expect(svc.download({ provider: 'pexels', kind: 'video', id: '1' }, controller.signal)).rejects.toThrow('用户取消下载');
    expect(await listing(dir)).toEqual([]);
  });

  it('download failures on the CDN map to an expired link, not a bad key', async () => {
    const dir = await managedDir();
    const svc = service(dir);
    await searchOne(svc, { '/files/1.mp4': () => ({ status: 403, body: 'Forbidden' }) });
    await expect(svc.download({ provider: 'pexels', kind: 'video', id: '1' })).rejects.toMatchObject({ code: 'STOCK_MEDIA_LINK_EXPIRED' });
    expect(await listing(dir)).toEqual([]);
  });
});

describe('stock media cancel (stock-media:cancel)', () => {
  it('cancel by requestId aborts the in-flight download: temp removed, no manifest, cancelled result instead of an error', async () => {
    const dir = await managedDir();
    const helper = service(dir);
    await searchOne(helper, {});
    const svc = service(dir, { fetch: stallingFetch(new TextEncoder().encode(MP4), 'video/mp4') });
    shareItems(svc, helper);
    const pending = svc.download({ requestId: 'download-req-0001', provider: 'pexels', kind: 'video', id: '1' });
    await waitFor(async () => (await listing(dir)).some(name => name.startsWith('.partial-')));
    expect(svc.cancel({ requestId: 'download-req-0001' })).toEqual({ cancelledCount: 1 });
    await expect(pending).resolves.toEqual({ cancelled: true, operation: 'download', requestId: 'download-req-0001', message: expect.stringContaining('已取消下载') });
    expect(await listing(dir)).toEqual([]);
    // Nothing left to cancel afterwards; the item can be downloaded normally later.
    expect(svc.cancel({ provider: 'pexels', kind: 'video', id: '1' })).toEqual({ cancelledCount: 0 });
  });

  it('cancel by provider+kind+id also aborts the downloading item and keeps the managed directory clean', async () => {
    const dir = await managedDir();
    const helper = service(dir);
    await searchOne(helper, {});
    const svc = service(dir, { fetch: stallingFetch(new TextEncoder().encode(MP4), 'video/mp4') });
    shareItems(svc, helper);
    const pending = svc.download({ provider: 'pexels', kind: 'video', id: '1' });
    await waitFor(async () => (await listing(dir)).some(name => name.startsWith('.partial-')));
    expect(svc.cancel({ provider: 'pexels', kind: 'video', id: '1' })).toEqual({ cancelledCount: 1 });
    const result = await pending;
    expect(isStockMediaCancelled(result)).toBe(true);
    expect(await listing(dir)).toEqual([]);
  });

  it('a cancel that arrives before its download starts is honoured without any network request', async () => {
    const dir = await managedDir();
    const helper = service(dir);
    await searchOne(helper, {});
    const calls: string[] = [];
    const svc = service(dir, { fetch: stallingFetch(new TextEncoder().encode(MP4), 'video/mp4', calls) });
    shareItems(svc, helper);
    expect(svc.cancel({ requestId: 'early-req-00001' })).toEqual({ cancelledCount: 0 });
    await expect(svc.download({ requestId: 'early-req-00001', provider: 'pexels', kind: 'video', id: '1' })).resolves.toMatchObject({ cancelled: true, operation: 'download' });
    expect(calls).toEqual([]);
    expect(await listing(dir)).toEqual([]);
  });

  it('a new search cancels the previous one in flight (it resolves as cancelled, not as an error)', async () => {
    const svc = service(await managedDir());
    relay.setHandler((request) => request.url.includes('query=slow')
      ? { kind: 'slow-headers', delayMs: 2000, then: { kind: 'json', body: pexelsPayload([{ id: 1, path: '/files/1.mp4' }]) } }
      : request.url.startsWith('/videos/search') ? { kind: 'json', body: pexelsPayload([{ id: 2, path: '/files/2.mp4' }]) } : undefined);
    const slow = svc.search({ requestId: 'search-slow-0001', provider: 'pexels', query: 'slow', orientation: 'landscape', kind: 'video' });
    await waitFor(() => relay.requests.length === 1);
    const fast = done(await svc.search({ requestId: 'search-fast-0001', provider: 'pexels', query: 'fast', orientation: 'landscape', kind: 'video' }));
    await expect(slow).resolves.toEqual({ cancelled: true, operation: 'search', requestId: 'search-slow-0001', message: '已取消检索。' });
    expect(fast.items.map(item => item.id)).toEqual(['2']);
    // Superseded results are not remembered for download.
    await expect(svc.download({ provider: 'pexels', kind: 'video', id: '1' })).rejects.toMatchObject({ code: 'STOCK_MEDIA_ITEM_UNKNOWN' });
  });
});

describe('stock media image download (mock relay)', () => {
  it('downloads a WebP photo by task ratio, writes the manifest and copies it into the local image library once', async () => {
    const dir = await managedDir();
    const libraryRoot = join(dir, '..', 'person-assets');
    const svc = service(dir, { imageLibraryRoot: () => libraryRoot });
    const routes = {
      '/img/7-portrait.webp': () => ({ status: 200, body: WEBP, headers: { 'content-type': 'image/webp' } }),
      '/img/7-landscape.webp': () => ({ status: 200, body: WEBP, headers: { 'content-type': 'image/webp' } }),
    };
    await searchPhotos(svc, routes);
    const first = done(await svc.download({ provider: 'pexels', kind: 'photo', id: '7', ratio: '9:16', imageLibrary: '素材站图片' }));
    expect(relay.requests.map(request => request.url)).toContain('/img/7-portrait.webp');
    expect(relay.requests.map(request => request.url)).not.toContain('/img/7-original.webp');
    expect(first.path).toBe(join(dir, 'pexels-photo-7.webp'));
    expect(first.manifest).toMatchObject({ kind: 'photo', contentType: 'image/webp', width: 800, height: 1200, author: 'Photographer 7' });
    expect(first.library).toEqual({ name: '素材站图片', path: join(await realpath(libraryRoot), '素材站图片', 'pexels-photo-7.webp'), reused: false });
    expect(await readFile(first.library!.path, 'latin1')).toBe(WEBP);
    expect(await listing(dir)).toEqual(['pexels-photo-7.source.json', 'pexels-photo-7.webp']);
    expect(await listing(join(libraryRoot, '素材站图片'))).toEqual(['pexels-photo-7.webp']);

    const again = done(await svc.download({ provider: 'pexels', kind: 'photo', id: '7', imageLibrary: '素材站图片' }));
    expect(again).toMatchObject({ reused: 'provider-id', library: { reused: true } });
    expect(await listing(join(libraryRoot, '素材站图片'))).toEqual(['pexels-photo-7.webp']);

    const landscapeDir = await managedDir();
    const landscape = service(landscapeDir);
    await searchPhotos(landscape, routes);
    relay.requests.length = 0;
    await landscape.download({ provider: 'pexels', kind: 'photo', id: '7', ratio: '16:9' });
    expect(relay.requests.map(request => request.url)).toEqual(['/img/7-landscape.webp']);
  });

  it('accepts JPEG bytes and refuses non-image content (GIF, HTML, video) and oversize images, leaving no files', async () => {
    const dir = await managedDir();
    const libraryRoot = join(dir, '..', 'person-assets');
    const helper = service(dir);
    await searchPhotos(helper, {
      '/img/7-portrait.webp': () => ({ status: 200, body: 'GIF89a' + 'g'.repeat(100), headers: { 'content-type': 'image/png' } }),
    });
    await expect(helper.download({ provider: 'pexels', kind: 'photo', id: '7', ratio: '9:16' })).rejects.toMatchObject({ code: 'STOCK_MEDIA_NOT_MEDIA' });

    const asVideo = service(dir, { fetch: async () => new Response(MP4, { status: 200, headers: { 'content-type': 'video/mp4' } }) });
    shareItems(asVideo, helper);
    await expect(asVideo.download({ provider: 'pexels', kind: 'photo', id: '7' })).rejects.toMatchObject({ code: 'STOCK_MEDIA_NOT_MEDIA' });

    const asHtml = service(dir, { fetch: async () => new Response(HTML, { status: 200, headers: { 'content-type': 'image/jpeg' } }) });
    shareItems(asHtml, helper);
    await expect(asHtml.download({ provider: 'pexels', kind: 'photo', id: '7' })).rejects.toThrow('网页');

    const tooLarge = service(dir, { maxBytes: { photo: 64 }, fetch: async () => new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } }) });
    shareItems(tooLarge, helper);
    await expect(tooLarge.download({ provider: 'pexels', kind: 'photo', id: '7', imageLibrary: '素材站图片' })).rejects.toMatchObject({ code: 'STOCK_MEDIA_TOO_LARGE' });
    expect(await listing(dir)).toEqual([]);
    expect(await listing(join(libraryRoot, '素材站图片'))).toEqual([]);

    const jpeg = service(dir, { imageLibraryRoot: () => libraryRoot, fetch: async () => new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } }) });
    shareItems(jpeg, helper);
    const ok = done(await jpeg.download({ provider: 'pexels', kind: 'photo', id: '7', imageLibrary: '人物甲' }));
    expect(ok.path).toBe(join(dir, 'pexels-photo-7.jpg'));
    expect(ok.library?.path).toBe(join(await realpath(libraryRoot), '人物甲', 'pexels-photo-7.jpg'));
  });

  it('cancelling an image download removes the temp file and never touches the image library', async () => {
    const dir = await managedDir();
    const libraryRoot = join(dir, '..', 'person-assets');
    const helper = service(dir);
    await searchPhotos(helper, {});
    const svc = service(dir, { imageLibraryRoot: () => libraryRoot, fetch: stallingFetch(JPEG, 'image/jpeg') });
    shareItems(svc, helper);
    const pending = svc.download({ requestId: 'photo-req-00001', provider: 'pexels', kind: 'photo', id: '7', imageLibrary: '素材站图片' });
    await waitFor(async () => (await listing(dir)).some(name => name.startsWith('.partial-')));
    expect(svc.cancel({ requestId: 'photo-req-00001' }).cancelledCount).toBe(1);
    expect(isStockMediaCancelled(await pending)).toBe(true);
    expect(await listing(dir)).toEqual([]);
    expect(await listing(libraryRoot)).toEqual([]);
  });
});

describe('stock media review hardening', () => {
  const jpegFetch = async () => new Response(JPEG, { status: 200, headers: { 'content-type': 'image/jpeg' } });

  async function photoService(dir: string, options: Partial<ConstructorParameters<typeof StockMediaService>[0]>) {
    const helper = service(dir);
    await searchPhotos(helper, {});
    const svc = service(dir, { fetch: jpegFetch, ...options });
    shareItems(svc, helper);
    return svc;
  }

  it('refuses an image library that is an existing junction/symlink and writes nothing outside person-assets', async () => {
    const dir = await managedDir();
    const libraryRoot = join(dir, '..', 'person-assets');
    const outside = join(dir, '..', 'outside');
    await mkdir(libraryRoot, { recursive: true });
    await mkdir(outside, { recursive: true });
    await symlink(outside, join(libraryRoot, '素材站图片'), 'junction');
    const svc = await photoService(dir, { imageLibraryRoot: () => libraryRoot });
    await expect(svc.download({ provider: 'pexels', kind: 'photo', id: '7', imageLibrary: '素材站图片' }))
      .rejects.toMatchObject({ code: 'STOCK_MEDIA_LIBRARY_REJECTED' });
    expect(await listing(outside)).toEqual([]);
    // The validated managed copy is kept and truthfully not reported as "cancelled / nothing saved".
    expect(await listing(dir)).toEqual(['pexels-photo-7.jpg', 'pexels-photo-7.source.json']);
  });

  it('accepts a junctioned person-assets root itself (realpath) but still writes only into a real child folder', async () => {
    const dir = await managedDir();
    const realRoot = join(dir, '..', 'real-person-assets');
    const linkedRoot = join(dir, '..', 'person-assets-link');
    await mkdir(realRoot, { recursive: true });
    await symlink(realRoot, linkedRoot, 'junction');
    const svc = await photoService(dir, { imageLibraryRoot: () => linkedRoot });
    const result = done(await svc.download({ provider: 'pexels', kind: 'photo', id: '7', imageLibrary: '人物甲' }));
    expect(result.library?.path.toLowerCase()).toContain(join('real-person-assets', '人物甲', 'pexels-photo-7.jpg').toLowerCase());
    expect(await listing(join(realRoot, '人物甲'))).toEqual(['pexels-photo-7.jpg']);
  });

  it('refuses to overwrite a non-regular file occupying the library target name', async () => {
    const dir = await managedDir();
    const libraryRoot = join(dir, '..', 'person-assets');
    await mkdir(join(libraryRoot, '素材站图片', 'pexels-photo-7.jpg'), { recursive: true });
    const svc = await photoService(dir, { imageLibraryRoot: () => libraryRoot });
    await expect(svc.download({ provider: 'pexels', kind: 'photo', id: '7', imageLibrary: '素材站图片' }))
      .rejects.toMatchObject({ code: 'STOCK_MEDIA_LIBRARY_REJECTED' });
    expect(await listing(join(libraryRoot, '素材站图片'))).toEqual(['pexels-photo-7.jpg']);
  });

  it('only accepts provider-style numeric ids and safe library names; a forged manifest id is never trusted', async () => {
    const download = ipcInputSchemas['stock-media:download'];
    for (const id of ['7', '1234567890']) expect(download.safeParse({ provider: 'pexels', kind: 'photo', id }).success, id).toBe(true);
    for (const id of ['abc', 'AbC', '0', '07', '1_2', '1-2', '1'.repeat(21), '..', '7.jpg']) {
      expect(download.safeParse({ provider: 'pexels', kind: 'photo', id }).success, id).toBe(false);
      expect(ipcInputSchemas['stock-media:cancel'].safeParse({ provider: 'pexels', kind: 'photo', id }).success, id).toBe(false);
    }
    for (const imageLibrary of ['CON', 'nul', 'Com1', 'lpt9.txt', 'aux.']) {
      expect(download.safeParse({ provider: 'pexels', kind: 'photo', id: '7', imageLibrary }).success, imageLibrary).toBe(false);
    }
    expect(download.safeParse({ provider: 'pexels', kind: 'photo', id: '7', imageLibrary: 'Connie' }).success).toBe(true);

    const dir = await managedDir();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'pexels-photo-7.jpg'), JPEG);
    await writeFile(join(dir, 'pexels-photo-7.source.json'), JSON.stringify({
      schemaVersion: 1, provider: 'pexels', kind: 'photo', id: '../../x', author: '', authorUrl: '', sourceUrl: '',
      license: { name: '', url: '', attributionRequired: false }, downloadUrl: '', width: 1, height: 1, downloadedAt: '',
      sha256: 'a'.repeat(64), sizeBytes: JPEG.byteLength, contentType: 'image/jpeg', fileName: 'pexels-photo-7.jpg',
    }));
    const calls: string[] = [];
    const svc = await photoService(dir, { fetch: async (url: string | URL) => { calls.push(String(url)); return jpegFetch(); } });
    const result = done(await svc.download({ provider: 'pexels', kind: 'photo', id: '7' }));
    expect(result.reused).toBeNull(); // forged manifest ignored; re-downloaded and re-recorded
    expect(calls).toHaveLength(1);
    expect(result.manifest.id).toBe('7');
  });

  it('keeps the early-cancel memory bounded and does not re-arm ids that already reached the service', async () => {
    const svc = service(await managedDir());
    const early = () => (svc as unknown as { earlyCancelled: Set<string> }).earlyCancelled;
    for (let index = 0; index < 1000; index += 1) svc.cancel({ requestId: `early-${String(index).padStart(6, '0')}` });
    expect(early().size).toBe(200);
    expect(early().has('early-000000')).toBe(false);
    expect(early().has('early-000999')).toBe(true);
    // A consumed id leaves the set.
    await expect(svc.download({ requestId: 'early-000999', provider: 'pexels', kind: 'video', id: '1' })).resolves.toMatchObject({ cancelled: true });
    expect(early().size).toBe(199);
  });

  it('a cancel after the commit point is ignored: success stays success, and a library copy failure is a real error, not "未保存"', async () => {
    const dir = await managedDir();
    let svc: StockMediaService | undefined;
    let lateCancel: unknown;
    svc = await photoService(dir, {
      imageLibraryRoot: () => { lateCancel = svc!.cancel({ requestId: 'late-cancel-0001' }); return join(dir, '..', 'person-assets'); },
    });
    const ok = done(await svc.download({ requestId: 'late-cancel-0001', provider: 'pexels', kind: 'photo', id: '7', imageLibrary: '素材站图片' }));
    expect(lateCancel).toEqual({ cancelledCount: 0 });
    expect(ok.library?.reused).toBe(false);
    expect((svc as unknown as { earlyCancelled: Set<string> }).earlyCancelled.size).toBe(0);

    const failingDir = await managedDir();
    const fileRoot = join(failingDir, '..', 'not-a-directory');
    await mkdir(join(failingDir, '..'), { recursive: true });
    await writeFile(fileRoot, 'x');
    let failing: StockMediaService | undefined;
    failing = await photoService(failingDir, {
      imageLibraryRoot: () => { lateCancel = failing!.cancel({ requestId: 'late-cancel-0002' }); return fileRoot; },
    });
    const outcome = failing.download({ requestId: 'late-cancel-0002', provider: 'pexels', kind: 'photo', id: '7', imageLibrary: '素材站图片' });
    await expect(outcome).rejects.toMatchObject({ code: 'STOCK_MEDIA_LIBRARY_COPY_FAILED' });
    await expect(outcome).rejects.toThrow('图片已保存到素材目录');
    expect(lateCancel).toEqual({ cancelledCount: 0 });
    expect(await listing(failingDir)).toEqual(['pexels-photo-7.jpg', 'pexels-photo-7.source.json']);
  });
});

describe('stock media magic bytes', () => {
  it('recognises supported containers and flags HTML/JSON', () => {
    const bytes = (text: string) => new Uint8Array(Buffer.from(text, 'latin1'));
    expect(detectStockMediaContainer(bytes(WEBP))).toBe('webp');
    expect(detectStockMediaContainer(bytes(MP4))).toBe('mp4');
    expect(detectStockMediaContainer(bytes('\0\0\0\x14ftypqt  \0\0\0\0qt  '))).toBe('mov');
    expect(detectStockMediaContainer(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('webm');
    expect(detectStockMediaContainer(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))).toBe('jpg');
    expect(detectStockMediaContainer(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBe('png');
    expect(detectStockMediaContainer(bytes(`  ${HTML}`))).toBe('html');
    expect(detectStockMediaContainer(bytes('{"error":"not found"}'))).toBe('html');
    expect(detectStockMediaContainer(bytes('GIF89a.........'))).toBeNull();
  });
});

describe('stock media IPC / config contract', () => {
  it('registers both channels with strict input schemas', () => {
    expect(INVOKE_CHANNELS).toContain('stock-media:search');
    expect(INVOKE_CHANNELS).toContain('stock-media:download');
    expect(ipcInputSchemas['stock-media:search'].safeParse({ query: 'city', orientation: 'portrait', kind: 'video' }).success).toBe(true);
    expect(ipcInputSchemas['stock-media:search'].safeParse({ query: '', orientation: 'portrait', kind: 'video' }).success).toBe(false);
    expect(ipcInputSchemas['stock-media:download'].safeParse({ provider: 'pexels', kind: 'video', id: '1', ratio: '9:16' }).success).toBe(true);
    // The renderer may never hand the main process a URL or a path.
    expect(ipcInputSchemas['stock-media:download'].safeParse({ provider: 'pexels', kind: 'video', id: '1', url: 'https://evil.example.com' }).success).toBe(false);
    expect(ipcInputSchemas['stock-media:download'].safeParse({ provider: 'pexels', kind: 'video', id: '../../etc' }).success).toBe(false);
  });

  it('registers stock-media:cancel with a strict requestId | provider+kind+id schema and image-library limits', () => {
    expect(INVOKE_CHANNELS.indexOf('stock-media:cancel')).toBe(INVOKE_CHANNELS.indexOf('stock-media:download') + 1);
    const cancel = ipcInputSchemas['stock-media:cancel'];
    expect(cancel.safeParse({ requestId: 'download-req-0001' }).success).toBe(true);
    expect(cancel.safeParse({ provider: 'pixabay', kind: 'photo', id: '42' }).success).toBe(true);
    expect(cancel.safeParse({}).success).toBe(false);
    expect(cancel.safeParse({ requestId: 'short' }).success).toBe(false);
    expect(cancel.safeParse({ requestId: 'download-req-0001', path: 'C:/x' }).success).toBe(false);
    expect(cancel.safeParse({ provider: 'pexels', kind: 'video', id: '../1' }).success).toBe(false);
    const download = ipcInputSchemas['stock-media:download'];
    expect(download.safeParse({ requestId: 'download-req-0001', provider: 'pexels', kind: 'photo', id: '7', imageLibrary: '素材站图片' }).success).toBe(true);
    expect(download.safeParse({ provider: 'pexels', kind: 'video', id: '7', imageLibrary: '素材站图片' }).success).toBe(false);
    for (const imageLibrary of ['../x', 'a/b', 'a\\b', '.trash', '', 'C:']) {
      expect(download.safeParse({ provider: 'pexels', kind: 'photo', id: '7', imageLibrary }).success, imageLibrary).toBe(false);
    }
    expect(ipcInputSchemas['stock-media:search'].safeParse({ requestId: 'search-req-0001', query: 'city', orientation: 'portrait', kind: 'photo' }).success).toBe(true);
  });

  it('wires preload, browser fallback and main handlers', async () => {
    const [preload, fallback, main] = await Promise.all([
      readFile(new URL('../electron/preload.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/app/browser-fallback.ts', import.meta.url), 'utf8'),
      readFile(new URL('../electron/main.ts', import.meta.url), 'utf8'),
    ]);
    expect(preload).toContain("invokeTrusted('stock-media:search', input)");
    expect(preload).toContain("invokeTrusted('stock-media:download', input)");
    expect(preload).toContain("invokeTrusted('stock-media:cancel', input)");
    expect(fallback).toContain('async searchStockMedia()');
    expect(fallback).toContain('async downloadStockMedia()');
    expect(fallback).toContain('async cancelStockMedia()');
    expect(main).toContain("trustedHandle('stock-media:search'");
    expect(main).toContain("trustedHandle('stock-media:download'");
    expect(main).toContain("trustedHandle('stock-media:cancel', (_event, input) => stockMediaService.cancel(input));");
    expect(ARTIFACT_STORAGE_DIRECTORIES).toContain('stock-media');
  });

  it('keeps stock-media keys in the vault only; old configs round-trip unchanged', () => {
    expect(isSecretId('stockMedia/pexels/apiKey')).toBe(true);
    expect(isSecretId('stockMedia/pixabay/apiKey')).toBe(true);
    expect(isSecretId('stockMedia/other/apiKey')).toBe(false);
    const withKeys = { ...structuredClone(defaultConfig), stockMedia: { pexelsApiKey: 'pexels-secret', pixabayApiKey: 'pixabay-secret' } } as AppConfig;
    const secrets = extractConfigSecrets(withKeys);
    expect(secrets).toMatchObject({ 'stockMedia/pexels/apiKey': 'pexels-secret', 'stockMedia/pixabay/apiKey': 'pixabay-secret' });
    const stripped = stripConfigSecrets(withKeys);
    expect(JSON.stringify(stripped)).not.toContain('pexels-secret');
    expect(JSON.stringify(stripped)).not.toContain('pixabay-secret');
    expect(applyConfigSecrets(stripped, secrets)).toEqual(withKeys);
    expect(normalizeAppConfig(stripped)).toHaveProperty('stockMedia');

    const old = structuredClone(defaultConfig);
    expect(extractConfigSecrets(old)['stockMedia/pexels/apiKey']).toBeUndefined();
    expect(stripConfigSecrets(old)).not.toHaveProperty('stockMedia');
    expect(applyConfigSecrets(stripConfigSecrets(old), extractConfigSecrets(old))).toEqual(old);
  });
});
