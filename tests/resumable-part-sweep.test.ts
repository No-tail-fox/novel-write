import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { claimResumablePartForCleanup, resumableDownload, resumablePartPaths, isResumablePartActive, transferUrlKey } from '../electron/resumable-transfer';
import {
  DEFAULT_STALE_RESUMABLE_PART_MAX_AGE_MS,
  sweepStaleResumableParts,
  sweepStaleResumablePartsForAppData,
} from '../electron/resumable-part-sweep';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!().catch(() => undefined); });

const DAY = 24 * 60 * 60 * 1000;
const exists = async (path: string) => Boolean(await stat(path).catch(() => null));
const fast = { retryDelayMs: 5, timeoutMs: 10_000 };
const hex = (seed: string) => seed.repeat(32).slice(0, 32);

function fakeMp4(size = 128 * 1024): Buffer {
  const header = Buffer.from([0, 0, 0, 0x18, ...Buffer.from('ftypisom'), 0, 0, 2, 0, ...Buffer.from('isomiso2')]);
  return Buffer.concat([header, randomBytes(size - header.length)]);
}

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function startServer(handlers: Handler[]): Promise<string> {
  let index = 0;
  const server = createServer((req, res) => handlers[Math.min(index++, handlers.length - 1)](req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function resetAfter(body: Buffer, cut: number): Handler {
  return (_req, res) => {
    res.writeHead(200, { 'content-type': 'video/mp4', etag: '"v1"', 'content-length': body.length, 'accept-ranges': 'bytes' });
    res.write(body.subarray(0, cut), () => setTimeout(() => res.socket?.destroy(), 60));
  };
}

const status = (code: number, text: string): Handler => (_req, res) => { res.writeHead(code, text); res.end('x'); };

async function writeAged(path: string, ageMs: number, now: number, content = 'partial'): Promise<string> {
  await writeFile(path, content);
  const when = new Date(now - ageMs);
  await utimes(path, when, when);
  return path;
}

describe('resumable download leftovers are cleaned up when they can never resume', () => {
  async function interruptedPart(handlers: Handler[]) {
    const body = fakeMp4();
    const base = await startServer([resetAfter(body, 40_000), ...handlers]);
    const target = join(await tempDir('opc-part-cleanup-'), 'out.mp4');
    await expect(resumableDownload({ url: `${base}/v.mp4`, targetPath: target, maxAttempts: 1, ...fast })).rejects.toThrow(/VIDEO_PROVIDER_DOWNLOAD_FAILED/u);
    expect(await exists(resumablePartPaths(target).part)).toBe(true);
    expect(await exists(resumablePartPaths(target).sidecar)).toBe(true);
    return { base, target };
  }

  it('removes part + side record after a permanent 404/410', async () => {
    for (const [code, text] of [[404, 'Not Found'], [410, 'Gone']] as const) {
      const { base, target } = await interruptedPart([status(code, text)]);
      await expect(resumableDownload({ url: `${base}/v.mp4`, targetPath: target, ...fast })).rejects.toThrow(`VIDEO_PROVIDER_DOWNLOAD_FAILED: ${code} ${text}`);
      expect(await exists(resumablePartPaths(target).part)).toBe(false);
      expect(await exists(resumablePartPaths(target).sidecar)).toBe(false);
      expect(await exists(target)).toBe(false);
    }
  });

  it('keeps the part after 403 (expired signature) and 503 so a later recovery can still resume', async () => {
    for (const [code, text] of [[403, 'Forbidden'], [503, 'Service Unavailable']] as const) {
      const { base, target } = await interruptedPart([status(code, text)]);
      await expect(resumableDownload({ url: `${base}/v.mp4`, targetPath: target, ...fast })).rejects.toThrow(`${code}`);
      expect((await stat(resumablePartPaths(target).part)).size).toBeGreaterThan(0);
      expect(await exists(resumablePartPaths(target).sidecar)).toBe(true);
    }
  });

  it('removes the part when the payload is rejected as oversize (fatal)', async () => {
    const body = fakeMp4();
    const base = await startServer([(_req, res) => { res.writeHead(200, { 'content-type': 'video/mp4' }); res.end(body); }]);
    const target = join(await tempDir('opc-part-cleanup-'), 'out.mp4');
    await expect(resumableDownload({ url: `${base}/v.mp4`, targetPath: target, maxBytes: 10_000, ...fast })).rejects.toThrow();
    expect(await exists(resumablePartPaths(target).part)).toBe(false);
    expect(await exists(resumablePartPaths(target).sidecar)).toBe(false);
  });
});

describe('stale resumable part sweep', () => {
  const now = Date.UTC(2026, 10, 10, 12);
  const old = DEFAULT_STALE_RESUMABLE_PART_MAX_AGE_MS + DAY;

  async function layout() {
    const appData = await tempDir('opc-part-sweep-');
    const tasksRoot = join(appData, 'tasks');
    const live = join(tasksRoot, 'liveTask01', 'generated-videos');
    const orphan = join(tasksRoot, 'orphanTask02', 'generated-videos');
    await mkdir(live, { recursive: true });
    await mkdir(orphan, { recursive: true });
    const files = {
      oldPart: await writeAged(join(live, `.resume-${hex('a')}.mp4.part`), old, now),
      oldRecord: await writeAged(join(live, `.resume-${hex('a')}.mp4.part.json`), old, now, '{}'),
      freshPart: await writeAged(join(live, `.resume-${hex('b')}.mp4.part`), DAY, now),
      oldFinished: await writeAged(join(live, `.resume-${hex('c')}.mp4`), old, now, 'finished'),
      oldOutput: await writeAged(join(live, '1700000000000-x.mp4'), old, now, 'finished'),
      oldUnrelatedPart: await writeAged(join(live, 'other.mp4.part'), old, now),
      orphanRecentPart: await writeAged(join(orphan, `.resume-${hex('d')}.mp4.part`), 2 * 60 * 60 * 1000, now),
      orphanBrandNewPart: await writeAged(join(orphan, `.resume-${hex('e')}.mp4.part`), 60 * 1000, now),
    };
    // Outside managed task output folders: never swept.
    const elsewhere = join(tasksRoot, 'liveTask01', 'director-videos');
    await mkdir(elsewhere, { recursive: true });
    const elsewherePart = await writeAged(join(elsewhere, `.resume-${hex('f')}.mp4.part`), old, now);
    const quarantine = join(tasksRoot, '.history.deadbeef.quarantine', 'generated-videos');
    await mkdir(quarantine, { recursive: true });
    const quarantinePart = await writeAged(join(quarantine, `.resume-${hex('a')}.mp4.part`), old, now);
    return { appData, tasksRoot, files, elsewherePart, quarantinePart };
  }

  it('deletes old parts/records only, keeps finished files, fresh parts and other folders', async () => {
    const { tasksRoot, files, elsewherePart, quarantinePart } = await layout();
    const result = await sweepStaleResumableParts({ tasksRoot, now });
    expect(result.removed.sort()).toEqual([files.oldPart, files.oldRecord].sort());
    for (const keep of [files.freshPart, files.oldFinished, files.oldOutput, files.oldUnrelatedPart, files.orphanRecentPart, files.orphanBrandNewPart, elsewherePart, quarantinePart]) {
      expect(await exists(keep)).toBe(true);
    }
  });

  it('treats task folders without a task row as orphaned (after a grace period)', async () => {
    const { appData, files } = await layout();
    const result = await sweepStaleResumablePartsForAppData(appData, async () => ['liveTask01'], { now });
    expect(result?.removed.sort()).toEqual([files.oldPart, files.oldRecord, files.orphanRecentPart].sort());
    expect(await exists(files.orphanBrandNewPart)).toBe(true);
    expect(await exists(files.freshPart)).toBe(true);
    expect(await sweepStaleResumablePartsForAppData(appData, async () => { throw new Error('db closed'); })).toBeNull();
  });

  it('can be limited to one task and honours a custom age', async () => {
    const { tasksRoot, files } = await layout();
    const result = await sweepStaleResumableParts({ tasksRoot, now, storageKeys: ['orphanTask02', '../escape'], maxAgeMs: 30 * 60 * 1000 });
    expect(result.removed.sort()).toEqual([files.orphanRecentPart].sort());
    expect(await exists(files.oldPart)).toBe(true);
  });

  it('never follows a linked output folder or a linked tasks root', async () => {
    const { tasksRoot } = await layout();
    const outside = await tempDir('opc-part-sweep-outside-');
    const victim = await writeAged(join(outside, `.resume-${hex('9')}.mp4.part`), old, now);
    const linkedTask = join(tasksRoot, 'linkedTask03');
    await mkdir(linkedTask, { recursive: true });
    await symlink(outside, join(linkedTask, 'generated-videos'), 'junction');
    await symlink(outside, join(tasksRoot, 'linkedTask04'), 'junction');
    await sweepStaleResumableParts({ tasksRoot, now });
    expect(await exists(victim)).toBe(true);
    const linkedRoot = join(await tempDir('opc-part-sweep-root-'), 'tasks');
    await symlink(tasksRoot, linkedRoot, 'junction');
    expect((await sweepStaleResumableParts({ tasksRoot: linkedRoot, now })).removed).toEqual([]);
    expect(await sweepStaleResumableParts({ tasksRoot: join(tasksRoot, 'missing'), now })).toEqual({ removed: [], kept: 0, failed: 0 });
  });

  it('never deletes a part that is downloading right now', async () => {
    const appData = await tempDir('opc-part-sweep-active-');
    const outputDir = join(appData, 'tasks', 'activeTask05', 'generated-videos');
    await mkdir(outputDir, { recursive: true });
    const target = join(outputDir, `.resume-${hex('7')}.mp4`);
    const body = fakeMp4();
    let firstChunk!: () => void;
    const sent = new Promise<void>((resolve) => { firstChunk = resolve; });
    const base = await startServer([(_req, res) => {
      res.writeHead(200, { 'content-type': 'video/mp4', etag: '"v1"', 'content-length': body.length });
      res.write(body.subarray(0, 30_000), () => setTimeout(firstChunk, 80));
    }]);
    const controller = new AbortController();
    const pending = resumableDownload({ url: `${base}/v.mp4`, targetPath: target, signal: controller.signal, ...fast }).catch(() => undefined);
    await sent;
    const { part } = resumablePartPaths(target);
    expect(isResumablePartActive(part)).toBe(true);
    const result = await sweepStaleResumableParts({ tasksRoot: join(appData, 'tasks'), now: Date.now() + 30 * DAY });
    expect(result.removed).toEqual([]);
    expect(await exists(part)).toBe(true);
    controller.abort(new Error('test done'));
    await pending;
    expect(isResumablePartActive(part)).toBe(false);
  });
});

describe('sweep vs download start race', () => {
  function serveRange(body: Buffer, etag = '"v1"'): Handler {
    return (req, res) => {
      const range = /^bytes=(\d+)-$/u.exec(String(req.headers.range ?? ''));
      if (range && req.headers['if-range'] === etag) {
        const start = Number(range[1]);
        res.writeHead(206, { 'content-type': 'video/mp4', etag, 'content-length': body.length - start, 'content-range': `bytes ${start}-${body.length - 1}/${body.length}` });
        res.end(body.subarray(start));
        return;
      }
      res.writeHead(200, { 'content-type': 'video/mp4', etag, 'content-length': body.length, 'accept-ranges': 'bytes' });
      res.end(body);
    };
  }

  /** Spreads the download start over 0–4.8 ms + a few ticks so both orders (sweep first / download first) occur. */
  async function spread(round: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, (round % 25) / 5));
    for (let tick = 0; tick < round % 13; tick += 1) await new Promise((resolve) => setImmediate(resolve));
  }

  /** A 30-day-old but otherwise perfectly resumable part + side record. */
  async function staleResumablePart(target: string, url: string, body: Buffer, bytes = 50_000): Promise<void> {
    const { part, sidecar } = resumablePartPaths(target);
    const when = new Date(Date.now() - 30 * DAY);
    await writeFile(part, body.subarray(0, bytes));
    await writeFile(sidecar, JSON.stringify({ version: 1, urlKey: transferUrlKey(url), etag: '"v1"', expectedLength: body.length, updatedAt: when.toISOString() }));
    await utimes(part, when, when);
    await utimes(sidecar, when, when);
  }

  async function taskTarget(seed: string): Promise<{ tasksRoot: string; target: string }> {
    const tasksRoot = join(await tempDir('opc-part-race-'), 'tasks');
    const outputDir = join(tasksRoot, 'raceTask01', 'generated-videos');
    await mkdir(outputDir, { recursive: true });
    return { tasksRoot, target: join(outputDir, `.resume-${hex(seed)}.mp4`) };
  }

  it('claims are exclusive with downloads and with each other', async () => {
    const { target } = await taskTarget('1');
    const { part } = resumablePartPaths(target);
    const release = claimResumablePartForCleanup(part);
    expect(release).toBeTypeOf('function');
    expect(claimResumablePartForCleanup(part)).toBeNull();
    release!();
    release!(); // idempotent
    const again = claimResumablePartForCleanup(part);
    expect(again).toBeTypeOf('function');
    again!();

    const body = fakeMp4();
    let firstChunk!: () => void;
    const sent = new Promise<void>((resolve) => { firstChunk = resolve; });
    const base = await startServer([(_req, res) => {
      res.writeHead(200, { 'content-type': 'video/mp4', etag: '"v1"', 'content-length': body.length });
      res.write(body.subarray(0, 20_000), () => setTimeout(firstChunk, 50));
    }]);
    const controller = new AbortController();
    const pending = resumableDownload({ url: `${base}/v.mp4`, targetPath: target, signal: controller.signal, ...fast }).catch(() => undefined);
    // Marked active synchronously on call: a claim in the same tick already loses.
    expect(claimResumablePartForCleanup(part)).toBeNull();
    await sent;
    expect(claimResumablePartForCleanup(part)).toBeNull();
    controller.abort(new Error('done'));
    await pending;
    const after = claimResumablePartForCleanup(part);
    expect(after).toBeTypeOf('function');
    after!();
  });

  it('a download that starts while a sweep holds the claim waits, then restarts cleanly from zero', async () => {
    const body = fakeMp4();
    const requests: Array<string | undefined> = [];
    const handler = serveRange(body);
    const base = await startServer([(req, res) => { requests.push(req.headers.range); handler(req, res); }]);
    const url = `${base}/v.mp4`;
    const { target } = await taskTarget('2');
    await staleResumablePart(target, url, body);
    const { part, sidecar } = resumablePartPaths(target);

    const release = claimResumablePartForCleanup(part)!;
    let settled = false;
    const download = resumableDownload({ url, targetPath: target, ...fast }).finally(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(settled).toBe(false);
    expect(requests).toEqual([]); // it has neither read the stale part nor contacted the server
    await rm(part); // what the sweep does while holding the claim
    await rm(sidecar);
    release();
    const result = await download;
    expect(result.resumedFrom).toBe(0);
    expect(requests).toEqual([undefined]);
    expect((await readFile(target)).equals(body)).toBe(true);
  });

  it('concurrent sweep + resume never corrupts or fails the download (interleaving stress)', async () => {
    const body = fakeMp4();
    const base = await startServer([serveRange(body)]);
    const url = `${base}/v.mp4`;
    const outcomes = { resumed: 0, restarted: 0 };
    for (let round = 0; round < 36; round += 1) {
      const { tasksRoot, target } = await taskTarget((round % 16).toString(16));
      await staleResumablePart(target, url, body);
      const sweep = sweepStaleResumableParts({ tasksRoot });
      await spread(round);
      const result = await resumableDownload({ url, targetPath: target, ...fast });
      await sweep;
      expect((await readFile(target)).equals(body), `round ${round}`).toBe(true);
      expect(await exists(resumablePartPaths(target).part)).toBe(false);
      outcomes[result.resumedFrom ? 'resumed' : 'restarted'] += 1;
    }
    expect(outcomes.resumed + outcomes.restarted).toBe(36);
  }, 60_000);

  it('judges age per part+record pair, so a freshly rewritten half keeps the pair together', async () => {
    const appData = await tempDir('opc-part-pair-');
    const dir = join(appData, 'tasks', 'pairTask01', 'generated-videos');
    await mkdir(dir, { recursive: true });
    const now = Date.now();
    const old = DEFAULT_STALE_RESUMABLE_PART_MAX_AGE_MS + DAY;
    const name = (seed: string) => join(dir, `.resume-${hex(seed)}.mp4.part`);
    const staleBoth = [await writeAged(name('1'), old, now), await writeAged(`${name('1')}.json`, old, now, '{}')];
    const freshRecord = [await writeAged(name('2'), old, now), await writeAged(`${name('2')}.json`, 60_000, now, '{}')];
    const freshPart = [await writeAged(name('3'), 60_000, now), await writeAged(`${name('3')}.json`, old, now, '{}')];
    const result = await sweepStaleResumableParts({ tasksRoot: join(appData, 'tasks'), now });
    expect(result.removed.sort()).toEqual([...staleBoth].sort());
    for (const file of [...freshRecord, ...freshPart]) expect(await exists(file)).toBe(true);
  });

  it('a download that fails mid-way while a sweep runs leaves a complete, resumable pair (stress)', async () => {
    const body = fakeMp4();
    const etag = '"v1"';
    const cutting: Handler = (req, res) => {
      const start = Number(/^bytes=(\d+)-$/u.exec(String(req.headers.range ?? ''))?.[1] ?? 0);
      const ranged = Boolean(req.headers.range) && req.headers['if-range'] === etag;
      const from = ranged ? start : 0;
      res.writeHead(ranged ? 206 : 200, {
        'content-type': 'video/mp4', etag, 'content-length': body.length - from,
        ...(ranged ? { 'content-range': `bytes ${from}-${body.length - 1}/${body.length}` } : { 'accept-ranges': 'bytes' }),
      });
      res.write(body.subarray(from, from + 20_000), () => setTimeout(() => res.socket?.destroy(), 20));
    };
    const base = await startServer([cutting]);
    const url = `${base}/v.mp4`;
    for (let round = 0; round < 24; round += 1) {
      const { tasksRoot, target } = await taskTarget((round % 16).toString(16));
      await staleResumablePart(target, url, body);
      const sweep = sweepStaleResumableParts({ tasksRoot });
      await spread(round);
      await expect(resumableDownload({ url, targetPath: target, maxAttempts: 1, ...fast })).rejects.toThrow(/下载多次中断/u);
      await sweep;
      const { part, sidecar } = resumablePartPaths(target);
      // The fresh pair the failed download wrote must survive intact: never split, never removed.
      expect(await exists(part), `round ${round} part`).toBe(true);
      expect(await exists(sidecar), `round ${round} record`).toBe(true);
      expect((await stat(part)).size).toBeGreaterThan(0);
    }
  }, 60_000);
});
