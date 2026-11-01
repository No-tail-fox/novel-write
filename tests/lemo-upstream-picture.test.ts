import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createEditorialCollageDraft } from '../src/shared/editorial-collage';
import { voxProductionSettings } from '../src/shared/vox-production';
const mock = vi.hoisted(() => ({ assertCurrent: vi.fn(), export: vi.fn() }));
vi.mock('../electron/lemo-upstream-agent', () => ({ assertLemoUpstreamFilmCurrent: mock.assertCurrent }));
vi.mock('../electron/lemo-upstream-renderer', () => ({ exportLemoUpstreamProject: mock.export }));
vi.mock('../electron/lemo-upstream-source', () => ({ readLemoUpstreamManifest: async () => ({ revision: 'test-upstream' }) }));
import { prepareLemoUpstreamPicture } from '../electron/lemo-upstream-picture';
const roots: string[] = [];
const library = { upstreamRoot: 'test', threeRoot: 'test' };
beforeEach(() => {
  mock.assertCurrent.mockReset().mockResolvedValue(undefined);
  mock.export.mockReset().mockImplementation(async (options) => {
    await mkdir(options.outputDir, { recursive: true });
    const outputPath = join(options.outputDir, 'native-picture.mp4');
    await writeFile(outputPath, 'mock-video-not-a-real-film');
    return { outputPath, receipt: { technicalPassed: true } };
  });
});
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'lemo-picture-')); roots.push(root);
  const doc = createEditorialCollageDraft({ id: 'picture-test', title: 'offline', ratio: '16:9' });
  doc.productionRun = { version: 1, id: 'run-1', engine: 'lemo-native-v1', authoringVersion: 3, status: 'completed',
    settings: voxProductionSettings('paper-explainer'), nodes: [], sourceHash: 'test', runtimeIdentity: 'test', createdAt: doc.createdAt, updatedAt: doc.updatedAt };
  doc.upstreamFilm = { version: 1, runId: 'run-1', directory: 'source', styleId: 'brick-toy', turn: 3, sourceHash: 'abc', status: 'ready', lastTool: 'finish', message: 'test' };
  return { root, doc, prepare: (signal?: AbortSignal) => prepareLemoUpstreamPicture(library, root, doc, signal) };
}
describe('one verified native picture for all production entrypoints', () => {
  it('reuses only a fully written hash-verified capture', async () => {
    const h = await fixture(); const first = await h.prepare();
    expect(await h.prepare()).toBe(first); expect(mock.export).toHaveBeenCalledTimes(1);
    expect(mock.assertCurrent).toHaveBeenCalledTimes(4);
  });
  it.each([1, 2])('does not reuse a hash-valid legacy color-profile v%i capture', async version => {
    const h = await fixture();
    const key = createHash('sha256').update(JSON.stringify({ version, runId: 'run-1',
      sourceHash: 'abc', revision: 'test-upstream', durationSeconds: (h.doc.timeline?.durationMs ?? 0) / 1000,
      width: 1920, height: 1080, fps: 30 })).digest('hex');
    const directory = join(h.root, 'vox-production', 'lemo-exports', key);
    const captureId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    await mkdir(join(directory, captureId), { recursive: true });
    const legacy = join(directory, captureId, 'native-picture.mp4'), bytes = Buffer.from('old-full-range-capture');
    await writeFile(legacy, bytes);
    await writeFile(join(directory, 'picture.json'), JSON.stringify({ version: 1, key, captureId,
      bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }));
    expect(await h.prepare()).not.toBe(legacy);
    expect(mock.export).toHaveBeenCalledTimes(1);
  });
  it('does not reuse truncated or same-length corrupted video', async () => {
    const h = await fixture(); const first = await h.prepare();
    await writeFile(first!, 'X'.repeat('mock-video-not-a-real-film'.length));
    const next = await h.prepare(); expect(next).not.toBe(first);
    await writeFile(next!, ''); expect(await h.prepare()).not.toBe(next);
    expect(mock.export).toHaveBeenCalledTimes(3);
  });
  it('invalidates by source version and canvas, not by subtitle-only edits', async () => {
    const h = await fixture(); const first = await h.prepare(); h.doc.title = 'subtitle metadata change';
    expect(await h.prepare()).toBe(first);
    h.doc.upstreamFilm!.sourceHash = 'new'; const revised = await h.prepare(); expect(revised).not.toBe(first);
    h.doc.ratio = '9:16'; expect(await h.prepare()).not.toBe(revised); expect(mock.export).toHaveBeenCalledTimes(3);
  });
  it('fails closed on a stale source even when a cache exists', async () => {
    const h = await fixture(); await h.prepare(); mock.assertCurrent.mockRejectedValueOnce(new Error('LEMO_AGENT_NOT_READY'));
    await expect(h.prepare()).rejects.toThrow('LEMO_AGENT_NOT_READY'); expect(mock.export).toHaveBeenCalledTimes(1);
  });
  it('never commits a capture if the source changes during rendering', async () => {
    const h = await fixture(); mock.assertCurrent.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('LEMO_AGENT_NOT_READY'));
    await expect(h.prepare()).rejects.toThrow('LEMO_AGENT_NOT_READY');
    await h.prepare(); expect(mock.export).toHaveBeenCalledTimes(2);
  });
  it('does not reuse a failed capture and does not start after cancellation', async () => {
    const h = await fixture(); mock.export.mockRejectedValueOnce(new Error('LEMO_EXPORT_FAILED'));
    await expect(h.prepare()).rejects.toThrow('LEMO_EXPORT_FAILED'); await h.prepare(); expect(mock.export).toHaveBeenCalledTimes(2);
    const controller = new AbortController(); controller.abort(new Error('cancelled'));
    await expect(h.prepare(controller.signal)).rejects.toThrow('cancelled'); expect(mock.export).toHaveBeenCalledTimes(2);
  });
  it('leaves legacy documents alone and rejects a mismatched run', async () => {
    const h = await fixture(); h.doc.productionRun!.authoringVersion = 2; expect(await h.prepare()).toBeUndefined();
    h.doc.productionRun!.authoringVersion = 3; h.doc.upstreamFilm!.runId = 'old-run';
    await expect(h.prepare()).rejects.toThrow('LEMO_AGENT_NOT_READY'); expect(mock.export).not.toHaveBeenCalled();
  });
});
