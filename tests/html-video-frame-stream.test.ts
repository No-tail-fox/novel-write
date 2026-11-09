import { mkdtemp, mkdir, readdir, readFile, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('node:fs/promises', async importOriginal => { const actual = await importOriginal<typeof import('node:fs/promises')>(); return { ...actual, lstat: vi.fn(actual.lstat) }; });
const mocks = vi.hoisted(() => ({ sidecar: vi.fn() }));
vi.mock('../src/shared/storybound-sidecar', () => ({ runStoryboundMediaSidecar: mocks.sidecar }));
import { encodeHtmlFrames } from '../electron/html-video-frame-stream';
import { withHtmlGraphicsRecovery } from '../electron/html-video-capture-recovery';
let dir = '';
beforeEach(async () => { vi.resetAllMocks(); dir = await mkdtemp(join(tmpdir(), 'storydream-stream-test-')); await mkdir(join(dir, 'frames')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
const input = (count: number) => ({ mode: 'encode_render_scene' as const, work_dir: dir, scene: { frames_dir: join(dir, 'frames'), audio_path: '', fps: 60, duration_s: count / 60, video_frame_count: count }, output_path: join(dir, 'segment.mp4') });
const path = (index: number) => join(dir, 'frames', `frame_${String(index + 1).padStart(4, '0')}.jpg`);
const produce = (count: number) => async (write: (index: number, data: Uint8Array) => Promise<void>) => { for (let i = 0; i < count; i++) await write(i, Buffer.from(String(i))); };
describe('bounded atomic HTML frame stream', () => {
  it('retains small-scene compatibility and invokes encoding only after capture', async () => {
    mocks.sidecar.mockImplementation(async payload => { expect(payload.scene.stream_frames).toBeUndefined(); expect(await readdir(join(dir, 'frames'))).toHaveLength(3); });
    await encodeHtmlFrames(input(3), produce(3));
    expect(mocks.sidecar).toHaveBeenCalledTimes(1);
  });
  it('gives the capture, streaming encoder, and outer process coordinated long-film budgets', async () => {
    mocks.sidecar.mockImplementation(async (_payload, { signal }) => new Promise(resolve => signal.addEventListener('abort', () => resolve({}), { once: true })));
    await expect(encodeHtmlFrames(input(12175), async () => { throw Error('capture stopped'); })).rejects.toThrow('capture stopped');
    expect(mocks.sidecar).toHaveBeenCalledWith(expect.objectContaining({ scene: expect.objectContaining({ stream_timeout_seconds: 3764 }) }), expect.objectContaining({ timeoutMs: 3793750 }));
  });
  it('bounds the queue to 32 complete frames and preserves order through GPU recovery', async () => {
    const consumed: number[] = []; let peak = 0, next = 0, recovered = false;
    mocks.sidecar.mockImplementation(async (payload, options) => {
      expect(payload.scene.stream_frames).toBe(true);
      for (let i = 0; i < 97; i++) {
        for (;;) {
          options.signal.throwIfAborted();
          const files = (await readdir(join(dir, 'frames'))).filter(name => name.endsWith('.jpg'));
          peak = Math.max(peak, files.length);
          if (files.includes(`frame_${String(i + 1).padStart(4, '0')}.jpg`)) break;
          await delay(2);
        }
        if (i === 0) await delay(80);
        consumed.push(Number(await readFile(path(i), 'utf8'))); await rm(path(i));
      }
    });
    await encodeHtmlFrames(input(97), write => withHtmlGraphicsRecovery(async () => {
      for (; next < 97; next++) {
        if (next === 40 && !recovered) { recovered = true; throw Error('UnknownVizError'); }
        await write(next, Buffer.from(String(next)));
      }
    }));
    expect(consumed).toEqual(Array.from({ length: 97 }, (_, i) => i));
    expect(peak).toBeLessThanOrEqual(32);
    expect(await readdir(join(dir, 'frames'))).toEqual([]);
    expect(mocks.sidecar).toHaveBeenCalledTimes(1);
  });
  it('propagates encoder failure while the producer waits on backpressure', async () => {
    const failure = Error('encoder failed');
    mocks.sidecar.mockImplementation(async () => { await delay(80); throw failure; });
    await expect(encodeHtmlFrames(input(97), produce(97))).rejects.toBe(failure);
    expect((await readdir(join(dir, 'frames'))).filter(n => n.endsWith('.jpg')).length).toBeLessThanOrEqual(32);
  });
  it('aborts and joins the encoder while preserving the capture error', async () => {
    let stopped = false;
    mocks.sidecar.mockImplementation(async (_payload, { signal }) => { try { await delay(10000, undefined, { signal }); } finally { stopped = true; } });
    const failure = Error('invalid authored content');
    await expect(encodeHtmlFrames(input(97), async write => { await write(0, Buffer.from('0')); throw failure; })).rejects.toBe(failure);
    expect(stopped).toBe(true);
  });
  it('cancels a blocked frame producer and its encoder', async () => {
    const controller = new AbortController(); let stopped = false;
    mocks.sidecar.mockImplementation(async (_payload, { signal }) => { try { await delay(10000, undefined, { signal }); } finally { stopped = true; } });
    const timer = setTimeout(() => controller.abort(Error('user cancelled')), 100);
    try { await expect(encodeHtmlFrames(input(97), produce(97), controller.signal)).rejects.toThrow(); expect(stopped).toBe(true); }
    finally { clearTimeout(timer); }
  });
  it('rejects a prematurely successful encoder', async () => {
    mocks.sidecar.mockResolvedValue({});
    await expect(encodeHtmlFrames(input(97), produce(97))).rejects.toThrow('before capture completed');
  });
  it('rejects junctions or symlinks before either producer or encoder touches external files', async () => {
    // Exercise reparse-point rejection without requiring OS symlink privileges.
    vi.mocked(lstat).mockResolvedValueOnce({ isDirectory: () => true, isSymbolicLink: () => true } as Awaited<ReturnType<typeof lstat>>);
    await expect(encodeHtmlFrames(input(97), produce(97))).rejects.toThrow('Unsafe');
    expect(await readdir(join(dir, 'frames'))).toEqual([]); expect(mocks.sidecar).not.toHaveBeenCalled();
  });
  it('rejects skipped frames, incomplete capture, and unsafe spool paths', async () => {
    await expect(encodeHtmlFrames(input(3), async write => { await write(1, Buffer.from('x')); })).rejects.toThrow('Non-sequential');
    await expect(encodeHtmlFrames(input(3), produce(2))).rejects.toThrow('Incomplete');
    const bad = input(3); bad.scene.frames_dir = dir;
    await expect(encodeHtmlFrames(bad, produce(3))).rejects.toThrow('Unsafe');
    expect(mocks.sidecar).not.toHaveBeenCalled();
  });
});
