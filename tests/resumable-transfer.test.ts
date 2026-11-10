import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  detectVideoContainer,
  isRetryableTransferError,
  resumableDownload,
  resumablePartPaths,
  transferUrlKey,
} from '../electron/resumable-transfer';

type Handler = (req: IncomingMessage, res: ServerResponse, index: number) => void | Promise<void>;

interface Recorded { method: string; url: string; range?: string; ifRange?: string }

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!().catch(() => undefined);
});

function fakeMp4(size = 256 * 1024): Buffer {
  const header = Buffer.from([0, 0, 0, 0x18, ...Buffer.from('ftypisom'), 0, 0, 2, 0, ...Buffer.from('isomiso2')]);
  return Buffer.concat([header, randomBytes(size - header.length)]);
}

async function startServer(handlers: Handler[] | Handler): Promise<{ base: string; requests: Recorded[] }> {
  const requests: Recorded[] = [];
  const server: Server = createServer((req, res) => {
    const index = requests.length;
    requests.push({
      method: req.method ?? 'GET',
      url: req.url ?? '',
      ...(req.headers.range ? { range: String(req.headers.range) } : {}),
      ...(req.headers['if-range'] ? { ifRange: String(req.headers['if-range']) } : {}),
    });
    const handler = Array.isArray(handlers) ? handlers[Math.min(index, handlers.length - 1)] : handlers;
    void Promise.resolve(handler(req, res, index)).catch(() => res.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'opc-resumable-transfer-'));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** RFC 7233-compliant handler: honours Range only when If-Range matches the current ETag. */
function serveRange(body: Buffer, etag: string, extra: Record<string, string> = {}): Handler {
  return (req, res) => {
    const range = /^bytes=(\d+)-$/u.exec(String(req.headers.range ?? ''));
    const ifRange = req.headers['if-range'];
    if (range && (!ifRange || ifRange === etag)) {
      const start = Number(range[1]);
      res.writeHead(206, { 'content-type': 'video/mp4', etag, 'content-length': body.length - start, 'content-range': `bytes ${start}-${body.length - 1}/${body.length}`, ...extra });
      res.end(body.subarray(start));
      return;
    }
    res.writeHead(200, { 'content-type': 'video/mp4', etag, 'content-length': body.length, 'accept-ranges': 'bytes', ...extra });
    res.end(body);
  };
}

/** Sends the first `cut` bytes of a full 200 response, then resets the socket mid-body. */
function resetAfter(body: Buffer, etag: string, cut: number): Handler {
  return (_req, res) => {
    res.writeHead(200, { 'content-type': 'video/mp4', etag, 'content-length': body.length, 'accept-ranges': 'bytes' });
    res.write(body.subarray(0, cut), () => setTimeout(() => res.socket?.destroy(), 80));
  };
}

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const exists = async (path: string) => Boolean(await stat(path).catch(() => null));
const fast = { retryDelayMs: 5, timeoutMs: 10_000 };

describe('resumable verified downloads', () => {
  it('downloads, verifies and atomically renames on the happy path', async () => {
    const body = fakeMp4();
    const { base, requests } = await startServer(serveRange(body, '"v1"'));
    const target = join(await tempDir(), 'out.mp4');
    const result = await resumableDownload({ url: `${base}/v.mp4`, targetPath: target, expectedSha256: sha(body), ...fast });
    expect(result).toMatchObject({ bytes: body.length, sha256: sha(body), container: 'mp4', resumedFrom: 0, attempts: 1, restarts: 0 });
    expect((await readFile(target)).equals(body)).toBe(true);
    expect(await exists(resumablePartPaths(target).part)).toBe(false);
    expect(await exists(resumablePartPaths(target).sidecar)).toBe(false);
    expect(requests).toHaveLength(1);
    expect(requests[0].range).toBeUndefined();
  });

  it('resumes with Range + If-Range after a mid-body reset and appends the 206 body', async () => {
    const body = fakeMp4();
    const { base, requests } = await startServer([resetAfter(body, '"v1"', 100_000), serveRange(body, '"v1"')]);
    const target = join(await tempDir(), 'out.mp4');
    const result = await resumableDownload({ url: `${base}/v.mp4`, targetPath: target, ...fast });
    expect((await readFile(target)).equals(body)).toBe(true);
    expect(result.attempts).toBe(2);
    expect(requests).toHaveLength(2);
    const offset = Number(/^bytes=(\d+)-$/u.exec(requests[1].range ?? '')?.[1]);
    expect(offset).toBeGreaterThan(0);
    expect(offset).toBeLessThanOrEqual(100_000);
    expect(requests[1].ifRange).toBe('"v1"');
  });

  it('restarts from zero when the server ignores Range and answers 200', async () => {
    const body = fakeMp4();
    const ignoreRange: Handler = (_req, res) => { res.writeHead(200, { etag: '"v1"', 'content-length': body.length }); res.end(body); };
    const { base, requests } = await startServer([resetAfter(body, '"v1"', 120_000), ignoreRange]);
    const target = join(await tempDir(), 'out.mp4');
    await resumableDownload({ url: `${base}/v.mp4`, targetPath: target, ...fast });
    expect(requests[1].range).toMatch(/^bytes=\d+-$/u);
    expect((await readFile(target)).equals(body)).toBe(true);
  });

  it('restarts when the ETag changed (compliant 200 and misbehaving 206)', async () => {
    const original = fakeMp4();
    const replaced = fakeMp4();
    const compliant = await startServer([resetAfter(original, '"v1"', 90_000), serveRange(replaced, '"v2"')]);
    const target = join(await tempDir(), 'a.mp4');
    await resumableDownload({ url: `${compliant.base}/v.mp4`, targetPath: target, ...fast });
    expect((await readFile(target)).equals(replaced)).toBe(true);

    // A broken server that answers 206 with a different ETag despite If-Range: the client must not splice.
    const broken: Handler = (req, res) => {
      const start = Number(/^bytes=(\d+)-$/u.exec(String(req.headers.range ?? ''))?.[1] ?? 0);
      res.writeHead(206, { etag: '"v2"', 'content-range': `bytes ${start}-${replaced.length - 1}/${replaced.length}`, 'content-length': replaced.length - start });
      res.end(replaced.subarray(start));
    };
    const misbehaving = await startServer([resetAfter(original, '"v1"', 90_000), broken, serveRange(replaced, '"v2"')]);
    const target2 = join(await tempDir(), 'b.mp4');
    const result = await resumableDownload({ url: `${misbehaving.base}/v.mp4`, targetPath: target2, ...fast });
    expect(result.restarts).toBe(1);
    expect(misbehaving.requests[2].range).toBeUndefined();
    expect((await readFile(target2)).equals(replaced)).toBe(true);
  });

  it('discards the partial file and restarts on 412', async () => {
    const body = fakeMp4();
    const precondition: Handler = (_req, res) => { res.writeHead(412); res.end(); };
    const { base, requests } = await startServer([resetAfter(body, '"v1"', 80_000), precondition, serveRange(body, '"v1"')]);
    const target = join(await tempDir(), 'out.mp4');
    const result = await resumableDownload({ url: `${base}/v.mp4`, targetPath: target, ...fast });
    expect(result.restarts).toBe(1);
    expect(requests[1].range).toMatch(/^bytes=/u);
    expect(requests[2].range).toBeUndefined();
    expect((await readFile(target)).equals(body)).toBe(true);
  });

  it('restarts on a 206 whose Content-Range does not start at the resume offset', async () => {
    const body = fakeMp4();
    const wrongRange: Handler = (_req, res) => {
      res.writeHead(206, { etag: '"v1"', 'content-range': `bytes 0-${body.length - 1}/${body.length}`, 'content-length': body.length });
      res.end(body);
    };
    const { base, requests } = await startServer([resetAfter(body, '"v1"', 70_000), wrongRange, serveRange(body, '"v1"')]);
    const target = join(await tempDir(), 'out.mp4');
    const result = await resumableDownload({ url: `${base}/v.mp4`, targetPath: target, ...fast });
    expect(result.restarts).toBe(1);
    expect(requests[2].range).toBeUndefined();
    expect((await readFile(target)).equals(body)).toBe(true);
  });

  it('never accepts a truncated final length; resumes the remainder and keeps .part when it cannot', async () => {
    const body = fakeMp4();
    // Clean chunked end (no transport error) but shorter than the Content-Range total.
    const shortRange: Handler = (req, res) => {
      const start = Number(/^bytes=(\d+)-$/u.exec(String(req.headers.range ?? ''))?.[1] ?? 0);
      res.writeHead(206, { etag: '"v1"', 'content-range': `bytes ${start}-${body.length - 1}/${body.length}` });
      res.end(body.subarray(start, Math.min(body.length, start + 50_000)));
    };
    const healing = await startServer([shortRange, shortRange, serveRange(body, '"v1"')]);
    const target = join(await tempDir(), 'out.mp4');
    const healed = await resumableDownload({ url: `${healing.base}/v.mp4`, targetPath: target, ...fast });
    expect((await readFile(target)).equals(body)).toBe(true);
    expect(healing.requests.map((request) => request.range)).toEqual([undefined, 'bytes=50000-', 'bytes=100000-']);
    expect(healed.attempts).toBe(3);

    const always = await startServer(shortRange);
    const target2 = join(await tempDir(), 'short.mp4');
    await expect(resumableDownload({ url: `${always.base}/v.mp4`, targetPath: target2, maxAttempts: 2, ...fast }))
      .rejects.toThrow(/VIDEO_PROVIDER_DOWNLOAD_FAILED/u);
    expect(await exists(target2)).toBe(false);
    expect((await stat(resumablePartPaths(target2).part)).size).toBe(100_000);
  });

  it('rejects HTML disguised as video/mp4 and leaves no file behind', async () => {
    const html = Buffer.from('<!DOCTYPE html><html><body>Signature expired</body></html>');
    const { base } = await startServer((_req, res) => { res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': html.length }); res.end(html); });
    const target = join(await tempDir(), 'out.mp4');
    await expect(resumableDownload({ url: `${base}/v.mp4`, targetPath: target, ...fast })).rejects.toThrow(/VIDEO_PROVIDER_DOWNLOAD_INVALID/u);
    expect(await exists(target)).toBe(false);
    expect(await exists(resumablePartPaths(target).part)).toBe(false);
    expect(await exists(resumablePartPaths(target).sidecar)).toBe(false);
  });

  it('rejects a SHA-256 mismatch', async () => {
    const body = fakeMp4();
    const { base } = await startServer(serveRange(body, '"v1"'));
    const target = join(await tempDir(), 'out.mp4');
    await expect(resumableDownload({ url: `${base}/v.mp4`, targetPath: target, expectedSha256: '0'.repeat(64), ...fast })).rejects.toThrow(/SHA-256/u);
    expect(await exists(target)).toBe(false);
  });

  it('does not retry an HTTP error status', async () => {
    const { base, requests } = await startServer((_req, res) => { res.writeHead(404, 'Not Found'); res.end('missing'); });
    const target = join(await tempDir(), 'out.mp4');
    await expect(resumableDownload({ url: `${base}/v.mp4`, targetPath: target, ...fast })).rejects.toThrow('VIDEO_PROVIDER_DOWNLOAD_FAILED: 404 Not Found');
    expect(requests).toHaveLength(1);
  });

  it('cancel leaves a resumable .part, and secrets in the query never reach the sidecar', async () => {
    const body = fakeMp4();
    let firstChunkSent!: () => void;
    const sent = new Promise<void>((resolve) => { firstChunkSent = resolve; });
    const hang: Handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'video/mp4', etag: '"v1"', 'content-length': body.length });
      res.write(body.subarray(0, 60_000), () => setTimeout(firstChunkSent, 80));
    };
    const { base, requests } = await startServer([hang, serveRange(body, '"v1"')]);
    const target = join(await tempDir(), 'out.mp4');
    const controller = new AbortController();
    const pending = resumableDownload({ url: `${base}/files/v.mp4?token=SECRET-TOKEN-123&X-Amz-Signature=deadbeef`, targetPath: target, signal: controller.signal, ...fast });
    await sent;
    controller.abort(new Error('user cancelled'));
    await expect(pending).rejects.toThrow('user cancelled');
    const { part, sidecar } = resumablePartPaths(target);
    const partSize = (await stat(part)).size;
    expect(partSize).toBeGreaterThan(0);
    const sidecarText = await readFile(sidecar, 'utf8');
    expect(sidecarText).not.toMatch(/SECRET|token|Signature|deadbeef|\?/u);
    expect(JSON.parse(sidecarText)).toMatchObject({ version: 1, urlKey: transferUrlKey(`${base}/files/v.mp4`), etag: '"v1"', expectedLength: body.length });

    // A freshly signed URL for the same object still resumes from the saved offset.
    const result = await resumableDownload({ url: `${base}/files/v.mp4?token=NEW-TOKEN&X-Amz-Signature=cafe`, targetPath: target, ...fast });
    expect(result.resumedFrom).toBe(partSize);
    expect(requests[1].range).toBe(`bytes=${partSize}-`);
    expect((await readFile(target)).equals(body)).toBe(true);
    expect(await exists(sidecar)).toBe(false);
  });

  it('ignores a stale or foreign sidecar and starts fresh', async () => {
    const body = fakeMp4();
    const { base, requests } = await startServer(serveRange(body, '"v1"'));
    const target = join(await tempDir(), 'out.mp4');
    const { part, sidecar } = resumablePartPaths(target);
    await writeFile(part, Buffer.from('garbage-prefix'));
    await writeFile(sidecar, JSON.stringify({ version: 1, urlKey: transferUrlKey('https://other.example/x.mp4'), etag: '"v1"', updatedAt: '' }));
    await resumableDownload({ url: `${base}/v.mp4`, targetPath: target, ...fast });
    expect(requests[0].range).toBeUndefined();
    expect((await readFile(target)).equals(body)).toBe(true);
  });

  it('detects MP4/MOV/WebM magic bytes and classifies retryable errors', () => {
    expect(detectVideoContainer(fakeMp4(64))).toBe('mp4');
    expect(detectVideoContainer(Buffer.from([0, 0, 0, 0x14, ...Buffer.from('ftypqt  ')]))).toBe('mov');
    expect(detectVideoContainer(Buffer.from([0, 0, 0, 8, ...Buffer.from('moov')]))).toBe('mov');
    expect(detectVideoContainer(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 0, 0, 0]))).toBe('webm');
    expect(detectVideoContainer(Buffer.from('<!DOCTYPE html>'))).toBeNull();
    expect(detectVideoContainer(Buffer.from('{"error":1}'))).toBeNull();
    expect(isRetryableTransferError(Object.assign(new Error('x'), { code: 'UND_ERR_SOCKET' }))).toBe(true);
    expect(isRetryableTransferError(new TypeError('fetch failed', { cause: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }) }))).toBe(true);
    expect(isRetryableTransferError(new Error('VIDEO_PROVIDER_DOWNLOAD_FAILED: 404'))).toBe(false);
  });
});
