import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultConfig } from '@shared/config';
import { normalizeAppConfig } from '@shared/config-utils';
import { resetGenerationAuthorization, setGenerationAuthorization } from '@shared/generation-authorization';
import { createConfiguredVideoProvider, requiredVideoCapabilities } from '@shared/video-provider';
import { downloadVerifiedVideoResult } from '../electron/resumable-transfer';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  resetGenerationAuthorization();
  while (cleanup.length) await cleanup.pop()!().catch(() => undefined);
});

function fakeMp4(size = 200_000): Buffer {
  const header = Buffer.from([0, 0, 0, 0x18, ...Buffer.from('ftypisom'), 0, 0, 2, 0, ...Buffer.from('isomiso2')]);
  return Buffer.concat([header, randomBytes(size - header.length)]);
}

type Download = 'reset' | 'ok';

/** Local provider: POST submit -> task id, GET status -> signed URL, GET file -> scripted download behaviour. */
async function startProvider(body: Buffer, downloads: Download[]) {
  const log: Array<{ method: string; path: string; range?: string }> = [];
  let downloadIndex = 0;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    log.push({ method: req.method ?? 'GET', path: url.pathname, ...(req.headers.range ? { range: String(req.headers.range) } : {}) });
    if (req.method === 'POST' && url.pathname === '/v1/videos') {
      req.resume();
      req.on('end', () => { res.writeHead(202, { 'content-type': 'application/json' }); res.end(JSON.stringify({ task_id: 'remote-1', status: 'queued' })); });
      return;
    }
    if (url.pathname.startsWith('/v1/videos/')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'succeeded', output: { url: `http://${req.headers.host}/files/remote-1.mp4?sig=SECRET-${log.length}` } }));
      return;
    }
    if (url.pathname === '/files/remote-1.mp4') {
      const behaviour = downloads[Math.min(downloadIndex, downloads.length - 1)];
      downloadIndex += 1;
      const range = /^bytes=(\d+)-$/u.exec(String(req.headers.range ?? ''));
      const start = range && req.headers['if-range'] === '"r1"' ? Number(range[1]) : 0;
      const headers = start
        ? { etag: '"r1"', 'content-length': body.length - start, 'content-range': `bytes ${start}-${body.length - 1}/${body.length}` }
        : { etag: '"r1"', 'content-length': body.length };
      res.writeHead(start ? 206 : 200, { 'content-type': 'video/mp4', ...headers });
      if (behaviour === 'reset') {
        const half = Math.floor((body.length - start) / 2);
        res.write(body.subarray(start, start + half), () => setTimeout(() => res.socket?.destroy(), 60));
      } else {
        res.end(body.subarray(start));
      }
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, log };
}

function providerConfig(base: string) {
  return normalizeAppConfig({ ...defaultConfig, video: { ...defaultConfig.video, providers: [{
    ...defaultConfig.video.providers[0], id: 'local-remote', enabled: true, baseUrl: `${base}/v1`, apiKey: 'test-only-key',
    model: 'local-model', submitPath: '/videos', statusPathTemplate: '/videos/{id}', pollIntervalMs: 1, timeoutMs: 10_000,
    pricePerSecond: 0, capabilities: ['t2v'],
  }], activeProviderId: 'local-remote', automation: { ...defaultConfig.video.automation, providerWhitelist: ['local-remote'], fallback: 'disabled' } } });
}

async function tempWorkDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'opc-motion-comic-resume-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

describe('motion-comic remote video result download wiring', () => {
  it('recovers a remote task, resumes an interrupted download across attempts and keeps the normal output name', async () => {
    const body = fakeMp4();
    // Each attempt allows 3 transfers: the first recovery attempt fails on all of them, the second finishes.
    const { base, log } = await startProvider(body, ['reset', 'reset', 'reset', 'ok']);
    const workDir = await tempWorkDir();
    const recovery = () => createConfiguredVideoProvider(providerConfig(base), workDir, undefined, {
      recoveryProviderId: 'local-remote',
      downloadResult: downloadVerifiedVideoResult,
    });

    await expect(recovery().resume!('remote-1', { estimatedCost: 1 })).rejects.toThrow(/VIDEO_PROVIDER_DOWNLOAD_FAILED/u);
    const outputDir = join(workDir, 'generated-videos');
    const partial = (await readdir(outputDir)).filter((name) => name.endsWith('.part'));
    expect(partial).toHaveLength(1);
    expect(partial[0]).toMatch(/^\.resume-[0-9a-f]{32}\.mp4\.part$/u);
    const sidecar = await readFile(join(outputDir, `${partial[0]}.json`), 'utf8');
    expect(sidecar).not.toContain('SECRET');
    const savedBytes = (await stat(join(outputDir, partial[0]))).size;
    expect(savedBytes).toBeGreaterThan(0);

    const resumed = await recovery().resume!('remote-1', { estimatedCost: 1 });
    expect(resumed.path).toMatch(/generated-videos[\\/]\d+-[0-9a-f-]{36}\.mp4$/u);
    expect((await readFile(resumed.path)).equals(body)).toBe(true);
    expect(await readdir(outputDir)).toEqual([resumed.path.split(/[\\/]/u).at(-1)]);
    expect(log.filter((entry) => entry.method === 'POST')).toHaveLength(0);
    expect(log.filter((entry) => entry.path === '/files/remote-1.mp4').at(-1)?.range).toBe(`bytes=${savedBytes}-`);
  });

  it('submits exactly once and resumes a mid-body reset within the same generate call', async () => {
    setGenerationAuthorization(async () => undefined);
    const body = fakeMp4();
    const { base, log } = await startProvider(body, ['reset', 'ok']);
    const workDir = await tempWorkDir();
    const request = { prompt: '雨夜里角色回头', durationSec: 4, ratio: '16:9' };
    const provider = createConfiguredVideoProvider(providerConfig(base), workDir, {
      durationSec: 4, requiredCapabilities: requiredVideoCapabilities(request), remainingBudget: Number.POSITIVE_INFINITY,
    }, { submitRetryCount: 0, providerId: 'local-remote', downloadResult: downloadVerifiedVideoResult });
    const submitted: string[] = [];
    const generated = await provider.generate({ ...request, onSubmitted: (id) => { submitted.push(id); } });
    expect(submitted).toEqual(['remote-1']);
    expect(log.filter((entry) => entry.method === 'POST')).toHaveLength(1);
    expect((await readFile(generated.path)).equals(body)).toBe(true);
    const downloads = log.filter((entry) => entry.path === '/files/remote-1.mp4');
    expect(downloads).toHaveLength(2);
    expect(downloads[1].range).toMatch(/^bytes=\d+-$/u);
  });

  it('marks an HTML result as an invalid download without consuming the remote task', async () => {
    const workDir = await tempWorkDir();
    const server = createServer((req, res) => {
      if (req.url?.startsWith('/v1/videos/')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'succeeded', url: `http://${req.headers.host}/files/x.mp4` }));
        return;
      }
      res.writeHead(200, { 'content-type': 'video/mp4' });
      res.end('<html>expired</html>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const provider = createConfiguredVideoProvider(providerConfig(base), workDir, undefined, { recoveryProviderId: 'local-remote', downloadResult: downloadVerifiedVideoResult });
    await expect(provider.resume!('remote-1', { estimatedCost: 1 })).rejects.toThrow(/^VIDEO_PROVIDER_DOWNLOAD_INVALID:/u);
    expect(await readdir(join(workDir, 'generated-videos'))).toEqual([]);
  });

  it('main process passes the verified downloader to both motion-comic provider constructions only', async () => {
    // O-5: the motion-comic generator moved from main.ts into electron/motion-comic-shot-video.ts.
    const main = await readFile(new URL('../electron/main.ts', import.meta.url), 'utf8');
    const shotVideo = await readFile(new URL('../electron/motion-comic-shot-video.ts', import.meta.url), 'utf8');
    const mainProcess = `${main}\n${shotVideo}`;
    expect(shotVideo).toContain("import { downloadVerifiedVideoResult } from './resumable-transfer';");
    const start = shotVideo.indexOf('async function generateMotionComicShotVideo');
    const end = shotVideo.indexOf('\n  return { generateMotionComicShotVideo };', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const generator = shotVideo.slice(start, end);
    expect(generator.match(/downloadResult: downloadVerifiedVideoResult/gu)).toHaveLength(2);
    expect(generator).toContain('recoveryProviderId: resumableJob.providerId,\n      downloadResult: downloadVerifiedVideoResult');
    expect(generator).toContain('{ submitRetryCount: 0, downloadResult: downloadVerifiedVideoResult }');
    expect(mainProcess.match(/downloadVerifiedVideoResult/gu)).toHaveLength(3);
  });
});
