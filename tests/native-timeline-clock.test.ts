import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { transform } from 'esbuild';
import { installNativeCanvasStateGuard } from '../src/shared/creative-animation/native-canvas-state';
import { installNativeCanvasTextTracker } from '../src/shared/creative-animation/native-canvas-text-tracker';

async function runtime(offsetMs = 0, sourceDurationMs = 202908, durationMs = sourceDurationMs) {
  const code = await transform(await readFile('src/features/vox-animation/lemo-native-runtime.ts', 'utf8'), { loader: 'ts', format: 'cjs' });
  const render = vi.fn();
  const window: any = { addEventListener() {}, render };
  runInNewContext(code.code, {
    window, exports: {}, module: { exports: {} },
    require: (id: string) => {
      if (id.endsWith('native-canvas-state')) return { installNativeCanvasStateGuard };
      if (id.endsWith('native-canvas-text-tracker')) return { installNativeCanvasTextTracker };
      if (id === 'three' || id.endsWith('lemo-native-core/lib.js')) return {};
      throw new Error('Unmapped VM import: ' + id);
    },
    document: { fonts: { ready: Promise.resolve() }, images: [] },
    parent: { postMessage() {} },
    CanvasRenderingContext2D: class { fillText() {} strokeText() {} save() {} restore() {} },
    requestAnimationFrame: (callback: (time: number) => void) => { queueMicrotask(() => callback(0)); return 1; },
  });
  window.LemoHost.install({animation:{native:{startMs:offsetMs,sourceDurationMs,durationMs}},durationMs,cues:[]});
  return { window, render };
}

describe('native runtime millisecond boundaries', () => {
  it('does not render the previous cue at the actual 129974ms transition', async () => {
    const { window, render } = await runtime(122245, 11256);
    await window.__tl.seek(7.729);
    const time = render.mock.lastCall![0] as number;
    expect(time * 1000).toBeGreaterThanOrEqual(129974);
    expect(time * 1000).toBeLessThan(129974.000001);
    const cues = [{id:'old',startMs:127924,endMs:129974},{id:'next',startMs:129974,endMs:131706}];
    expect(cues.filter(c=>c.startMs<=time*1000&&time*1000<c.endMs).map(c=>c.id)).toEqual(['next']);
  });
  it('retains sub-millisecond frames on both sides instead of rounding the visible window', async () => {
    const { window, render } = await runtime(122245, 11256);
    for (const local of [7728.999,7729,7729.001,7728.5,7729.5]) {
      await window.__tl.seek(local/1000);
      const ms = (render.mock.lastCall![0] as number)*1000;
      expect(Math.abs(ms-(122245+local))).toBeLessThan(.000001);
      expect(ms>=129974).toBe(local>=7729);
    }
  });
  it('preserves half-open windows across the film and long timelines', async () => {
    const { window, render } = await runtime(0, 86400001);
    const boundaries = [1, 129974, 3600000, 86400000];
    for (let ms = 997; ms < 202908; ms += 997) boundaries.push(ms);
    for (const boundary of boundaries) {
      for (const delta of [-0.001, 0, 0.001]) {
        await window.__tl.seek((boundary + delta) / 1000);
        const ms = (render.mock.lastCall![0] as number) * 1000;
        expect(Math.abs(ms - (boundary + delta))).toBeLessThan(0.000001);
        expect(ms >= boundary).toBe(delta >= 0);
        expect(window.__lemo.time).toBe(render.mock.lastCall![0]);
      }
    }
  });
  it('retains shot clamping before and after the retimed range', async () => {
    const { window, render } = await runtime(122245, 11256, 22512);
    await window.__tl.seek(-1);
    expect((render.mock.lastCall![0] as number) * 1000).toBeCloseTo(122245, 6);
    await window.__tl.seek(100);
    expect((render.mock.lastCall![0] as number) * 1000).toBeCloseTo(133501, 6);
  });
  it('keeps the same boundary under retiming and non-monotonic preview seeks', async () => {
    const { window, render } = await runtime(122245, 11256, 22512);
    for (const local of [15458,0,15457.998,15458,22512]) {
      await window.__tl.seek(local/1000);
      const ms=(render.mock.lastCall![0] as number)*1000;
      expect(Math.abs(ms-(122245+local/2))).toBeLessThan(.000001);
      if(local===15458) expect(ms).toBeGreaterThanOrEqual(129974);
    }
  });
});