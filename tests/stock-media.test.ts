import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { StockMediaService, normalizePexelsVideo } from '../electron/stock-media-service';
import { PEXELS_API_DOCUMENTATION_URL, PEXELS_LICENSE_URL, stockMediaImportSchema, stockMediaSearchSchema, type StockMediaImportInput, type StockMediaSearchInput } from '../src/shared/stock-media';
import { bindShortVideoMaterials, allocateShortVideoMaterials } from '../src/shared/short-video-material-runtime';
import { runStoryboundMediaSidecar } from '../src/shared/storybound-sidecar';
import { setDefaultPythonRuntimeAppRoot } from '../src/shared/python-runtime';
import { defaultConfig } from '../src/shared/config';
import { normalizeAppConfig } from '../src/shared/config-utils';
import { applyConfigSecrets, extractConfigSecrets, isSecretId, retainReferencedConfigSecrets, stripConfigSecrets } from '../src/shared/config-secrets';

const root = resolve('.artifacts/stock-media-tests-20261102');
const exec = promisify(execFile);
const servers: Server[] = [];
const directories: string[] = [];
let fixtureDirectory: string;
let videoBytes: Buffer;
beforeAll(async () => {
  await mkdir(root, { recursive: true });
  fixtureDirectory = await mkdtemp(join(root, 'media-'));
  const python = resolve('vendor/python/python.exe');
  const ffmpeg = (await exec(python, ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { windowsHide: true })).stdout.trim();
  const path = join(fixtureDirectory, 'fixture.mp4');
  await exec(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10', '-t', '2', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', path], { windowsHide: true, timeout: 20000 });
  videoBytes = await readFile(path);
  setDefaultPythonRuntimeAppRoot(resolve('.'));
}, 30000);
afterEach(async () => {
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
afterAll(async () => { if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true }); });
function source(mediaId = 42, variantId = 88) {
  return { id: mediaId, width: 320, height: 180, duration: 2, url: 'https://www.pexels.com/video/' + mediaId + '/', image: 'https://images.pexels.com/videos/' + mediaId + '/preview.jpeg', user: { name: '测试作者', url: 'https://www.pexels.com/@test-author/' }, video_files: [{ id: variantId, width: 320, height: 180, file_type: 'video/mp4', link: 'https://videos.pexels.com/video-files/' + mediaId + '/test.mp4' }] };
}
const searchInput = (extra: Partial<StockMediaSearchInput> = {}): StockMediaSearchInput => ({ operationId: crypto.randomUUID(), provider: 'pexels', type: 'video', query: '城市 夜景', ...extra });
const importInput = (extra: Partial<StockMediaImportInput> = {}): StockMediaImportInput => ({ operationId: crypto.randomUUID(), provider: 'pexels', mediaId: '42', variantId: '88', ...extra });
type ResponseHook = (request: IncomingMessage, response: ServerResponse) => boolean;
async function fixture(hook?: ResponseHook, options: { key?: string; maxDownloadBytes?: number; probe?: (path: string, signal?: AbortSignal) => Promise<{ width: number; height: number; durationMs: number }> } = {}) {
  const directory = await mkdtemp(join(root, 'case-')); directories.push(directory);
  const requests: Array<{ path: string; hasAuthorization: boolean }> = [];
  const server = createServer((request, response) => {
    requests.push({ path: request.url!, hasAuthorization: Boolean(request.headers.authorization) });
    if (hook?.(request, response)) return;
    if (request.url?.startsWith('/videos/search')) { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ videos: [source()], total_results: 1 })); }
    else if (request.url?.startsWith('/videos/videos/')) { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(source(Number(request.url.split('/').at(-1))))); }
    else { response.setHeader('content-type', 'video/mp4'); response.setHeader('content-length', videoBytes.length); response.end(videoBytes); }
  });
  servers.push(server); await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture HTTP port');
  const transport: typeof fetch = (url, init) => { const target = new URL(String(url)); return fetch('http://127.0.0.1:' + address.port + target.pathname + target.search, init); };
  const probe = options.probe ?? (async (path: string, signal?: AbortSignal) => {
    const result = await runStoryboundMediaSidecar({ mode: 'probe_media', work_dir: directory, media_path: path }, { signal });
    if (!result.has_video) throw new Error('No decoded video');
    return { width: result.width!, height: result.height!, durationMs: result.duration! * 1000 };
  });
  const create = (key = options.key ?? 'dedicated-pexels-fixture-key') => new StockMediaService({ directory, getApiKey: async () => key, fetch: transport, probe, maxDownloadBytes: options.maxDownloadBytes });
  return { service: create(), create, directory, requests, probe };
}
async function expectClean(directory: string) {
  expect(await readdir(join(directory, 'temporary'))).toEqual([]);
  expect(await readdir(join(directory, 'receipts'))).toEqual([]);
  expect(await readdir(join(directory, 'objects'))).toEqual([]);
}

describe('Pexels stock media — real local HTTP and decoded MP4, no real provider credential', () => {
  it('validates bounded queries and import identities; renderer cannot submit a download URL or path', () => {
    expect(() => stockMediaSearchSchema.parse(searchInput({ query: '' }))).toThrow();
    expect(() => stockMediaSearchSchema.parse(searchInput({ minDurationSec: 20, maxDurationSec: 5 }))).toThrow();
    expect(() => stockMediaImportSchema.parse({ ...importInput(), downloadUrl: 'https://evil.test/a', path: '../../a' })).toThrow();
    expect(() => stockMediaImportSchema.parse(importInput({ mediaId: '../1' }))).toThrow();
  });
  it('normalizes official source, author, license and safe MP4 variants', () => {
    const item = normalizePexelsVideo(source()); expect(item.author).toBe('测试作者'); expect(item.license.url).toBe(PEXELS_LICENSE_URL);
    expect(item.durationMs).toBe(2000); expect(item.variants[0].mimeType).toBe('video/mp4');
    expect(() => normalizePexelsVideo({ ...source(), user: { name: '', url: 'https://www.pexels.com/@test/' } })).toThrow();
    expect(() => normalizePexelsVideo({ ...source(), video_files: [{ ...source().video_files[0], link: 'http://127.0.0.1/a.mp4' }] })).toThrow();
  });
  it('reports no key without making a request and never falls back to another provider key', async () => {
    const f = await fixture(undefined, { key: '' }); expect(await f.service.status()).toEqual({ provider: 'pexels', configured: false });
    await expect(f.service.search(searchInput())).rejects.toThrow('STOCK_MEDIA_NOT_CONFIGURED'); expect(f.requests).toHaveLength(0);
  });
  it('sends Chinese search, orientation and pagination to official API and filters duration per page', async () => {
    const f = await fixture(); const result = await f.service.search(searchInput({ orientation: 'portrait', page: 2, perPage: 4, minDurationSec: 3 }));
    expect(result.items).toEqual([]); expect(result.durationFiltered).toBe(true); expect(result.page).toBe(2);
    const requested = new URL(f.requests[0].path, 'https://api.pexels.com'); expect(requested.searchParams.get('query')).toBe('城市 夜景'); expect(requested.searchParams.get('orientation')).toBe('portrait'); expect(requested.searchParams.get('page')).toBe('2'); expect(f.requests[0].hasAuthorization).toBe(true);
  });
  it('keeps empty result and pagination explicit', async () => {
    const f = await fixture((req, res) => { if (!req.url?.startsWith('/videos/search')) return false; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ videos: [], total_results: 25 })); return true; });
    const result = await f.service.search(searchInput()); expect(result.items).toEqual([]); expect(result.hasMore).toBe(true);
  });
  it.each([[401, 'CREDENTIAL'], [403, 'CREDENTIAL'], [429, 'RATE_LIMIT'], [500, 'HTTP']] as const)('reports API %s without response or credential leakage', async (status, code) => {
    const f = await fixture((_req, res) => { res.writeHead(status, { 'retry-after': '15' }); res.end('private-response'); return true; });
    await expect(f.service.search(searchInput())).rejects.toThrow('STOCK_MEDIA_' + code);
  });
  it('sanitizes malformed provider payload errors', async () => {
    const f = await fixture((_req, res) => { res.setHeader('content-type', 'application/json'); res.end('dedicated-pexels-fixture-key'); return true; });
    await expect(f.service.search(searchInput())).rejects.toThrow('STOCK_MEDIA_RESPONSE');
  });
  it('downloads and probes real media, deduplicates concurrent imports and reopens without network/key', async () => {
    const f = await fixture(); const [first, second] = await Promise.all([f.service.import(importInput()), f.service.import(importInput())]);
    expect(first.path).toBe(second.path); expect(second.reused).toBe(true); expect(first.durationMs).toBeCloseTo(2000, 0);
    expect(first.provenance).toMatchObject({ author: '测试作者', mediaId: '42', licenseUrl: PEXELS_LICENSE_URL, apiDocumentationUrl: PEXELS_API_DOCUMENTATION_URL });
    expect(f.requests.filter(r => r.path.startsWith('/video-files/'))).toHaveLength(1);
    expect(f.requests.filter(r => r.path.startsWith('/video-files/')).every(r => !r.hasAuthorization)).toBe(true);
    const before = f.requests.length; const reopened = await f.create('').import(importInput()); expect(reopened.reused).toBe(true); expect(f.requests).toHaveLength(before);
    expect(await readdir(join(f.directory, 'temporary'))).toEqual([]);
  }, 20000);
  it('deduplicates identical media bytes across provider IDs while preserving both source records', async () => {
    const f = await fixture(); const one = await f.service.import(importInput()); const two = await f.service.import(importInput({ mediaId: '43' }));
    expect(one.path).toBe(two.path); expect((await readdir(join(f.directory, 'objects'))).filter(name => name.endsWith('.mp4'))).toHaveLength(1);
    const sidecar = JSON.parse(await readFile(one.path + '.stock.json', 'utf8')); expect(sidecar.sources.map((p: { mediaId: string }) => p.mediaId)).toEqual(['42', '43']);
  }, 20000);
  it('refreshes an expired URL once, then downloads successfully', async () => {
    let mediaCalls = 0;
    const f = await fixture((req, res) => { if (!req.url?.startsWith('/video-files/') || ++mediaCalls > 1) return false; res.writeHead(403); res.end(); return true; });
    await f.service.import(importInput()); expect(mediaCalls).toBe(2); expect(f.requests.filter(r => r.path.startsWith('/videos/videos/'))).toHaveLength(2);
  }, 20000);
  it('bounds an expired link retry and leaves no partial files', async () => {
    const f = await fixture((req, res) => { if (!req.url?.startsWith('/video-files/')) return false; res.writeHead(410); res.end(); return true; });
    await expect(f.service.import(importInput())).rejects.toThrow('STOCK_MEDIA_DOWNLOAD'); expect(f.requests.filter(r => r.path.startsWith('/video-files/'))).toHaveLength(2); await expectClean(f.directory);
  });
  it('rejects redirects outside the official media host without following them or forwarding credentials', async () => {
    const f = await fixture((req, res) => { if (!req.url?.startsWith('/video-files/')) return false; res.writeHead(302, { location: 'http://127.0.0.1/private' }); res.end(); return true; });
    await expect(f.service.import(importInput())).rejects.toThrow('STOCK_MEDIA_URL'); expect(f.requests.some(r => r.path === '/private')).toBe(false); await expectClean(f.directory);
  });
  it('allows bounded redirects on the official media host and never sends API auth to media', async () => {
    const f = await fixture((req, res) => { if (!req.url?.endsWith('/test.mp4')) return false; res.writeHead(302, { location: 'https://videos.pexels.com/video-files/42/redirect.mp4' }); res.end(); return true; });
    await f.service.import(importInput()); expect(f.requests.some(r => r.path.endsWith('/redirect.mp4'))).toBe(true); expect(f.requests.filter(r => r.path.startsWith('/video-files')).every(r => !r.hasAuthorization)).toBe(true);
  }, 20000);
  it.each(['mime', 'signature', 'length', 'stream-size'] as const)('rejects invalid %s and cleans temporary files', async mode => {
    const f = await fixture((req, res) => { if (!req.url?.startsWith('/video-files/')) return false;
      res.setHeader('content-type', mode === 'mime' ? 'text/html' : 'video/mp4');
      if (mode === 'length') res.setHeader('content-length', 1024 * 1024 * 1024);
      if (mode === 'stream-size') { res.setHeader('transfer-encoding', 'chunked'); res.end(videoBytes); }
      else res.end('<html>not a real video</html>');
      return true;
    }, mode === 'stream-size' ? { maxDownloadBytes: 64 } : {});
    await expect(f.service.import(importInput())).rejects.toThrow(/STOCK_MEDIA_(MEDIA|SIZE)/); await expectClean(f.directory);
  });
  it('rejects a decoded-duration or dimension mismatch before commit', async () => {
    const f = await fixture(undefined, { probe: async () => ({ width: 320, height: 180, durationMs: 12000 }) });
    await expect(f.service.import(importInput())).rejects.toThrow('时长'); await expectClean(f.directory);
  });
  it('cancels an in-progress HTTP body and removes its temporary file', async () => {
    let started!: () => void; const pendingBody = new Promise<void>(done => { started = done; });
    const f = await fixture((req, res) => { if (!req.url?.startsWith('/video-files/')) return false; res.setHeader('content-type', 'video/mp4'); res.write(videoBytes.subarray(0, 24)); started(); return true; });
    const input = importInput(); const download = f.service.import(input); const rejection = expect(download).rejects.toThrow('STOCK_MEDIA_CANCELLED');
    await pendingBody; f.service.cancel({ operationId: input.operationId }); await rejection; await expectClean(f.directory);
  });
  it('cancels a duplicate waiter without aborting the owning download', async () => {
    let release!: () => void; let started!: () => void; const pendingProbe = new Promise<void>(done => { started = done; }); const gate = new Promise<void>(done => { release = done; });
    const f = await fixture(undefined, { probe: async () => { started(); await gate; return { width: 320, height: 180, durationMs: 2000 }; } });
    const owner = f.service.import(importInput()); await pendingProbe;
    const input = importInput(); const waiter = f.service.import(input); const rejected = expect(waiter).rejects.toThrow('STOCK_MEDIA_CANCELLED'); f.service.cancel({ operationId: input.operationId }); await rejected; release();
    expect((await owner).path).toMatch(/mp4$/); expect(f.requests.filter(r => r.path.startsWith('/video-files/'))).toHaveLength(1);
  });
  it('copies provider provenance through the task pool, scene allocation and project reopen', async () => {
    const f = await fixture(); const imported = await f.service.import(importInput());
    const work = join(f.directory, 'task'); const normalize = async (source: string, target: string) => { await copyFile(source, target); return { width: 320, height: 180, durationMs: 2000 }; };
    const pool = await bindShortVideoMaterials({ files: [imported.path], fit: 'cover' }, work, { normalize });
    const reopened = await bindShortVideoMaterials(pool.settings, work, { normalize }); expect(reopened.assets[0].stockMedia).toEqual(pool.assets[0].stockMedia);
    const scenes = [{ id: 1, cap: '素材测试', descPrompt: '', durationMs: 1000 }];
    const allocated = allocateShortVideoMaterials(scenes, reopened.assets, 'cover'); expect(allocated[0].license).toContain('测试作者 / Pexels'); expect(allocated[0].stockMedia?.[0].contentHash).toBe(imported.provenance.contentHash); expect(allocated[0].muted).toBe(true);
    await writeFile(imported.path + '.stock.json', JSON.stringify({ version: 1, contentHash: 'wrong', sources: [] }), 'utf8');
    await expect(bindShortVideoMaterials({ files: [imported.path], fit: 'cover' }, join(f.directory, 'task2'), { normalize })).rejects.toThrow('来源回执');
  }, 20000);
  it('isolates the dedicated key in the existing secret vault and strips it from public config', () => {
    const config = normalizeAppConfig({ ...defaultConfig, stockMedia: { pexelsApiKey: ' dedicated-stock-key ' } });
    expect(isSecretId('stockMedia/pexels/apiKey')).toBe(true); expect(config.stockMedia.pexelsApiKey).toBe('dedicated-stock-key');
    const secrets = extractConfigSecrets(config); expect(secrets['stockMedia/pexels/apiKey']).toBe('dedicated-stock-key');
    const stripped = stripConfigSecrets(config); expect(stripped.stockMedia.pexelsApiKey).toBe(''); expect(config.stockMedia.pexelsApiKey).toBe('dedicated-stock-key');
    expect(applyConfigSecrets(stripped, secrets).stockMedia.pexelsApiKey).toBe('dedicated-stock-key');
    expect(retainReferencedConfigSecrets(stripped, secrets)['stockMedia/pexels/apiKey']).toBe('dedicated-stock-key');
    expect(normalizeAppConfig({}).stockMedia).toEqual({ pexelsApiKey: '' });
  });
});
