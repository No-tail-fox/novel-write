import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const state = vi.hoisted(() => ({ calls: 0, stalled: 3, events: [] as string[] }));
vi.mock('electron', () => ({
  BrowserWindow: class {
    dead = false;
    webContents = {
      setWindowOpenHandler() {}, on() {},
      executeJavaScript: async () => { state.calls++; if (state.calls === state.stalled) return new Promise(() => {}); return state.calls === 2 ? { duration: 1, fonts: [] } : true; },
      capturePage: async () => ({ getSize: () => ({ width: 1920, height: 1080 }), toPNG: () => Buffer.from('frame'), toJPEG: () => Buffer.from('frame') }),
    };
    loadURL = async () => {};
    isDestroyed = () => this.dead;
    destroy = () => { this.dead = true; state.events.push('destroy'); };
  },
  session: { fromPartition: () => ({ setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, on() {}, webRequest: { onBeforeRequest() {} } }) },
}));
vi.mock('../electron/lemo-upstream-source', () => ({ serveLemoUpstreamProject: async () => ({
  origin: 'http://127.0.0.1:1234', pageUrl: 'http://127.0.0.1:1234/@film/', manifest: { revision: 'test' }, failures: [],
  close: async () => { state.events.push('source-closed'); },
}) }));
vi.mock('../electron/html-video-frame-stream', () => ({ encodeHtmlFrames: async (_input: unknown, capture: (write: () => Promise<void>) => Promise<void>, signal: AbortSignal) => {
  signal.addEventListener('abort', () => state.events.push('encoder-aborted'), { once: true });
  try { await capture(async () => {}); }
  finally { await new Promise(r => setTimeout(r, 20)); state.events.push('encoder-cleaned'); }
} }));
import { exportLemoUpstreamProject, reviewLemoUpstreamProject } from '../electron/lemo-upstream-renderer';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); state.calls = 0; state.stalled = 3; state.events = []; });
async function options() { const outputDir = await mkdtemp(join(tmpdir(), 'lemo-abort-')); roots.push(outputDir); return { outputDir, upstreamRoot: '', threeRoot: '', filmDir: '', timeoutMs: 80 }; }
describe('native capture cancellation', () => {
  it('aborts and awaits the encoder before closing the source or reporting timeout', async () => {
    await expect(exportLemoUpstreamProject({ ...await options(), durationSeconds: 1, fps: 1 })).rejects.toThrow('LEMO_REVIEW_TIMEOUT');
    expect(state.events).toEqual(['destroy', 'encoder-aborted', 'encoder-cleaned', 'source-closed']);
  });
  it('settles a never-resolving readiness script when the caller aborts', async () => {
    state.stalled = 1; const controller = new AbortController();
    const pending = reviewLemoUpstreamProject({ ...await options(), times: [0], signal: controller.signal });
    setTimeout(() => controller.abort(new Error('user cancelled')), 20);
    await expect(pending).rejects.toThrow('user cancelled');
    expect(state.events).toEqual(['destroy', 'source-closed']);
  });
});
