import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  SCENE_RUNTIME_ADAPTERS,
  SCENE_RUNTIME_DEFAULT_EPOCH_MS,
  SCENE_SCOPE_SHADOWED_GLOBALS,
  buildSceneDeterminismShim,
  buildSceneRuntimeBootstrap,
  injectSceneRuntimeIntoHtml,
  sceneCaptureStrategy,
  sceneDurationFrames,
  sceneFrameSeconds,
  sceneRuntimeScripts,
  sceneRuntimeSeed,
  validateSceneRuntimeDescriptor,
  wrapSceneCode,
  type SceneRuntimeDescriptor,
} from '../src/shared/scene-runtime';
import { createFakePage, fakeAnimation } from './helpers/fake-scene-page';

const validDescriptor: SceneRuntimeDescriptor = {
  version: 1,
  adapter: 'lemo',
  fps: 30,
  width: 320,
  height: 180,
  durationFrames: 60,
  durationSeconds: 2,
  pageDurationSeconds: 2,
  lastFrame: null,
  errorCount: 0,
  fonts: { ready: true, failed: [] },
};

describe('SceneRuntime bootstrap generation', () => {
  it('produces a syntactically valid, self-contained program for every adapter', () => {
    for (const adapter of SCENE_RUNTIME_ADAPTERS) {
      const source = buildSceneRuntimeBootstrap(adapter, { fps: 24, durationFrames: 48, sceneId: 'scene-1' });
      expect(() => new vm.Script(source)).not.toThrow();
      expect(source).toContain(`"adapter":"${adapter}"`);
      expect(source).toContain(`"seed":${sceneRuntimeSeed('scene-1')}`);
      expect(source).not.toMatch(/\bimport\b|\brequire\(/u);
    }
    expect(() => new vm.Script(buildSceneDeterminismShim({ fps: 30 }))).not.toThrow();
  });

  it('rejects invalid adapters and options before generating code', () => {
    expect(() => buildSceneRuntimeBootstrap('remotion' as never)).toThrow(/适配器/u);
    expect(() => buildSceneRuntimeBootstrap('lemo', { fps: 0 })).toThrow(/fps/u);
    expect(() => buildSceneRuntimeBootstrap('lemo', { durationFrames: 1.5 })).toThrow(/durationFrames/u);
    expect(() => buildSceneRuntimeBootstrap('lemo', { width: -1 })).toThrow(/width/u);
    expect(() => buildSceneRuntimeBootstrap('lemo', { paintFrames: 9 })).toThrow(/paintFrames/u);
  });

  it('keeps time helpers on integer frames', () => {
    expect(sceneFrameSeconds(15, 30)).toBe(0.5);
    expect(sceneDurationFrames(2, 30)).toBe(60);
    expect(sceneDurationFrames(1.01, 24)).toBe(24);
    expect(() => sceneFrameSeconds(1.5, 30)).toThrow();
    expect(() => sceneDurationFrames(0, 30)).toThrow();
    expect(sceneRuntimeSeed('a')).not.toBe(sceneRuntimeSeed('b'));
    expect(sceneRuntimeSeed('scene-1')).toBe(sceneRuntimeSeed('scene-1'));
  });

  it('inlines the bootstrap at the start of <head> with an optional CSP nonce', () => {
    const html = '<!doctype html><html><head><title>x</title></head><body><script>window.go()</script></body></html>';
    const out = injectSceneRuntimeIntoHtml(html, 'generic-css', { nonce: 'abcDEF123456', fps: 30 });
    expect(out.indexOf('data-sd-runtime')).toBeLessThan(out.indexOf('<title>'));
    expect(out).toContain('nonce="abcDEF123456"');
    expect(out.indexOf('data-sd-runtime')).toBeGreaterThan(out.indexOf('<head>'));
    expect(injectSceneRuntimeIntoHtml('<html><body></body></html>', 'lemo')).toMatch(/^<html><head><script data-sd-runtime="1">/u);
    expect(injectSceneRuntimeIntoHtml('<p>x</p>', 'lemo')).toMatch(/^<script data-sd-runtime/u);
    expect(() => injectSceneRuntimeIntoHtml(html, 'lemo', { nonce: '"><x' })).toThrow();
    // A scene id cannot close the inline script early.
    const tricky = injectSceneRuntimeIntoHtml(html, 'lemo', { sceneId: '</script><script>alert(1)' });
    expect(tricky.match(/<\/script>/giu)?.length).toBe(html.match(/<\/script>/giu)!.length + 1);
  });

  it('host-side scripts only accept integer frames', () => {
    expect(sceneRuntimeScripts.seek(3)).toContain('seekFrame(3)');
    expect(() => sceneRuntimeScripts.seek(1.5)).toThrow();
    expect(() => sceneRuntimeScripts.errors(-1)).toThrow();
  });
});

describe('SceneRuntime protocol validation', () => {
  it('accepts a well-formed descriptor and checks expectations', () => {
    expect(validateSceneRuntimeDescriptor(validDescriptor, { adapter: 'lemo', fps: 30, durationFrames: 60, width: 320, height: 180 }).ok).toBe(true);
    const mismatch = validateSceneRuntimeDescriptor(validDescriptor, { adapter: 'hyperframes', fps: 24, durationFrames: 61, width: 640 });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.issues.join('\n')).toMatch(/适配器[\s\S]*fps[\s\S]*总帧数[\s\S]*宽度/u);
  });

  it('rejects missing or malformed protocol snapshots', () => {
    expect(validateSceneRuntimeDescriptor(undefined).ok).toBe(false);
    const cases: Array<Partial<Record<keyof SceneRuntimeDescriptor, unknown>>> = [
      { version: 2 },
      { adapter: 'remotion' },
      { fps: 0 },
      { durationFrames: 2.5 },
      { durationFrames: 0 },
      { durationSeconds: 3 },
      { pageDurationSeconds: -1 },
      { lastFrame: -1 },
      { errorCount: -1 },
      { fonts: { ready: 'yes', failed: [] } },
      { width: 0 },
    ];
    for (const patch of cases) {
      const result = validateSceneRuntimeDescriptor({ ...validDescriptor, ...patch });
      expect(result.ok, JSON.stringify(patch)).toBe(false);
    }
  });
});

describe('SceneRuntime adapters (evaluated in a vm page)', () => {
  it('generic-css pauses every animation and seeks currentTime to the frame time', async () => {
    const animations = [fakeAnimation(2000), fakeAnimation(1500)];
    const page = createFakePage({ animations });
    expect(page.run(buildSceneRuntimeBootstrap('generic-css', { fps: 30 }))).toBe(true);
    await page.run<Promise<void>>('window.__sd.ready()');
    expect(page.__sd.durationFrames).toBe(60); // derived from the latest animation end (2 s × 30)
    expect(page.__sd.duration).toBe(2);
    await expect(page.run<Promise<{ frame: number }>>('window.__sd.seekFrame(15)')).resolves.toEqual({ frame: 15 });
    for (const animation of animations) {
      expect(animation.playState).toBe('paused');
      expect(animation.currentTime).toBe(500);
    }
    expect(page.__sd.lastFrame).toBe(15);
    const descriptor = page.run('window.__sd.describe()');
    expect(validateSceneRuntimeDescriptor(descriptor, { adapter: 'generic-css', fps: 30 }).ok).toBe(true);
  });

  it('rejects out-of-range or fractional frames; adapter failures are recorded as seek errors', async () => {
    const failing = createFakePage({ globals: { READY: true, DUR: 1, render: () => { throw new Error('render exploded'); } } });
    failing.run(buildSceneRuntimeBootstrap('lemo', { fps: 30 }));
    await failing.run('window.__sd.ready()');
    await expect(failing.run('window.__sd.seek(2)')).rejects.toThrow(/render exploded/u);
    expect(failing.__sd.errors).toEqual([{ message: 'render exploded', source: 'seek', frame: 2 }]);
    const page = createFakePage({ animations: [fakeAnimation(1000)] });
    page.run(buildSceneRuntimeBootstrap('generic-css', { fps: 30, durationFrames: 30 }));
    await page.run('window.__sd.ready()');
    await expect(page.run('window.__sd.seek(30)')).rejects.toThrow(/SCENE_RUNTIME_FRAME_OUT_OF_RANGE/u);
    await expect(page.run('window.__sd.seek(1.5)')).rejects.toThrow(/SCENE_RUNTIME_FRAME_OUT_OF_RANGE/u);
    // Caller mistakes are rejected but are not page errors.
    expect(page.__sd.errors).toEqual([]);
    // A failed seek does not poison the queue.
    await expect(page.run('window.__sd.seek(29)')).resolves.toBeUndefined();
  });

  it('lemo waits for READY, uses DUR seconds and calls render(t) in seconds', async () => {
    const renders: number[] = [];
    const page = createFakePage({ globals: { READY: false, DUR: 2, render: (t: number) => { renders.push(t); } } });
    page.run(buildSceneRuntimeBootstrap('lemo', { fps: 30 }));
    let ready = false;
    const pending = page.run<Promise<void>>('window.__sd.ready()').then(() => { ready = true; });
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(ready).toBe(false);
    page.READY = true;
    await pending;
    expect(page.__sd.durationFrames).toBe(60);
    await page.run('window.__sd.seek(15)');
    await page.run('window.__sd.seek(59)');
    expect(renders[0]).toBe(0.5);
    expect(renders[1]).toBeCloseTo(59 / 30, 9);
    // The shell supplies an engine-compatible __hf when the page has none.
    expect(page.__hf.duration).toBe(2);
    await page.run('window.__hf.seek(1)');
    expect(renders[2]).toBe(1);
  });

  it('lemo honours an authoritative VideoSpec frame count over DUR', async () => {
    const page = createFakePage({ globals: { READY: true, DUR: 2, render: () => undefined } });
    page.run(buildSceneRuntimeBootstrap('lemo', { fps: 24, durationFrames: 50 }));
    await page.run('window.__sd.ready()');
    const descriptor = page.run<SceneRuntimeDescriptor>('window.__sd.describe()');
    expect(descriptor).toMatchObject({ durationFrames: 50, pageDurationSeconds: 2, fps: 24 });
  });

  it('hyperframes wraps __player.renderSeek + __hfWaitForSeekCompletion without awaiting the GSAP thenable', async () => {
    const calls: string[] = [];
    // A paused GSAP timeline is a thenable that never settles; awaiting it would hang.
    const timeline = { then: () => undefined, seek: () => calls.push('tl.seek'), duration: () => 3 };
    const page = createFakePage({
      globals: {
        __ready: true,
        __tl: timeline,
        __player: { renderSeek: (time: number, options: unknown) => { calls.push(`renderSeek:${time}:${JSON.stringify(options)}`); return timeline; } },
        __hfWaitForSeekCompletion: async () => { calls.push('wait'); },
      },
    });
    page.run(buildSceneRuntimeBootstrap('hyperframes', { fps: 30 }));
    await page.run('window.__sd.ready()');
    expect(page.__sd.durationFrames).toBe(90);
    await page.run('window.__sd.seek(45)');
    expect(calls).toEqual(['renderSeek:1.5:{"suppressEvents":false}', 'wait']);
  });

  it('hyperframes prefers a page-provided window.__hf.seek and never replaces it', async () => {
    const seeks: number[] = [];
    const hf = { duration: 4, seek: (time: number) => { seeks.push(time); } };
    const page = createFakePage({ globals: { __hf: hf, __player: { renderSeek: () => { throw new Error('should not be used'); } } } });
    page.run(buildSceneRuntimeBootstrap('hyperframes', { fps: 24 }));
    await page.run('window.__sd.ready()');
    expect(page.__hf).toBe(hf);
    expect(page.__sd.durationFrames).toBe(96);
    await page.run('window.__sd.seek(12)');
    expect(seeks).toEqual([0.5]);
  });

  it('hyperframes falls back to __tl.seek(time, false)', async () => {
    const seeks: unknown[][] = [];
    const page = createFakePage({ globals: { __ready: true, __tl: { seek: (...args: unknown[]) => seeks.push(args), duration: () => 1 } } });
    page.run(buildSceneRuntimeBootstrap('hyperframes', { fps: 30 }));
    await page.run('window.__sd.ready()');
    await page.run('window.__sd.seek(3)');
    expect(seeks).toEqual([[0.1, false]]);
  });

  it('ready() rejects on failed fonts and a missing duration', async () => {
    const fonts = createFakePage({ fonts: [{ family: 'Brand Sans', status: 'error' }], animations: [fakeAnimation()] });
    fonts.run(buildSceneRuntimeBootstrap('generic-css'));
    await expect(fonts.run('window.__sd.ready()')).rejects.toThrow(/SCENE_RUNTIME_FONT_FAILED: Brand Sans/u);
    expect(fonts.run('window.__sd.fonts()')).toEqual({ ready: true, failed: ['Brand Sans'] });

    const noDuration = createFakePage();
    noDuration.run(buildSceneRuntimeBootstrap('generic-css'));
    await expect(noDuration.run('window.__sd.ready()')).rejects.toThrow(/SCENE_RUNTIME_DURATION_UNKNOWN/u);
  });

  it('collects window errors and unhandled rejections into __sd.errors', () => {
    const page = createFakePage({ animations: [fakeAnimation()] });
    page.run(buildSceneRuntimeBootstrap('generic-css'));
    page.dispatch('error', { message: 'ReferenceError: x is not defined' });
    page.dispatch('unhandledrejection', { reason: new Error('boom') });
    expect(page.__sd.errors).toEqual([
      { message: 'ReferenceError: x is not defined', source: 'error', frame: null },
      { message: 'boom', source: 'unhandledrejection', frame: null },
    ]);
    expect(page.run<SceneRuntimeDescriptor>('window.__sd.describe()').errorCount).toBe(2);
  });

  it('is idempotent for the same adapter and refuses a conflicting one', () => {
    const page = createFakePage({ globals: { READY: true, DUR: 1, render: () => undefined } });
    page.run(buildSceneRuntimeBootstrap('lemo'));
    const first = page.__sd;
    expect(page.run(buildSceneRuntimeBootstrap('lemo'))).toBe(true);
    expect(page.__sd).toBe(first);
    expect(() => page.run(buildSceneRuntimeBootstrap('hyperframes'))).toThrow(/SCENE_RUNTIME_ADAPTER_CONFLICT/u);
  });
});

describe('scoped determinism shim (ADR-08)', () => {
  const sceneCode = `
    window.__log = [];
    window.__init = { now: performance.now(), date: Date.now(), newDate: new Date().getTime(), r: Math.random(), max: Math.max(1, 5) };
    function tick(t) {
      window.__log.push({ t: t, now: performance.now(), date: Date.now(), r: Math.random(), r2: Math.random() });
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    setTimeout(function () { window.__timerFiredAt = performance.now(); }, 100);
  `;

  it('leaves the page globals untouched while scene code sees virtual time and seeded random', async () => {
    const page = createFakePage({ animations: [fakeAnimation(2000)] });
    const before = page.run<unknown[]>('[Date, Date.now, performance, performance.now, Math, Math.random, requestAnimationFrame, setTimeout]');
    page.run(buildSceneRuntimeBootstrap('generic-css', { fps: 30, sceneId: 'scene-a' }));
    page.run(wrapSceneCode(sceneCode));
    await page.run('window.__sd.ready()');
    await page.run('window.__sd.seek(15)');

    const after = page.run<unknown[]>('[Date, Date.now, performance, performance.now, Math, Math.random, requestAnimationFrame, setTimeout]');
    expect(after).toHaveLength(before.length);
    after.forEach((value, index) => expect(value).toBe(before[index]));
    // Outside the scene scope the clocks are still real.
    expect(Math.abs(page.run<number>('Date.now()') - Date.now())).toBeLessThan(5_000);
    expect(page.run<number>('performance.now()')).toBeGreaterThan(500);

    expect(page.__init).toMatchObject({ now: 0, date: SCENE_RUNTIME_DEFAULT_EPOCH_MS, newDate: SCENE_RUNTIME_DEFAULT_EPOCH_MS, max: 5 });
    expect(page.__log).toHaveLength(1);
    expect(page.__log[0]).toMatchObject({ t: 500, now: 500, date: SCENE_RUNTIME_DEFAULT_EPOCH_MS + 500 });
    expect(page.__timerFiredAt).toBe(500); // virtual 100 ms timer fires once virtual time passes it
  });

  it('seeded random depends only on (scene, frame): any seek order gives the same values', async () => {
    const page = createFakePage({ animations: [fakeAnimation(2000)] });
    page.run(buildSceneRuntimeBootstrap('generic-css', { fps: 30, sceneId: 'scene-a' }));
    page.run(wrapSceneCode(sceneCode));
    await page.run('window.__sd.ready()');
    for (const frame of [7, 3, 7, 3]) await page.run(`window.__sd.seek(${frame})`);
    const log = page.__log as Array<{ t: number; r: number; r2: number }>;
    expect(log.map(item => item.t)).toEqual([7, 3, 7, 3].map(frame => (frame * 1000) / 30));
    expect(log[0]).toEqual(log[2]);
    expect(log[1]).toEqual(log[3]);
    expect(log[0].r).not.toBe(log[1].r);
    expect(log[0].r).not.toBe(log[0].r2);

    const other = createFakePage({ animations: [fakeAnimation(2000)] });
    other.run(buildSceneRuntimeBootstrap('generic-css', { fps: 30, sceneId: 'scene-b' }));
    other.run(wrapSceneCode(sceneCode));
    await other.run('window.__sd.ready()');
    await other.run('window.__sd.seek(7)');
    expect(other.__log[0].r).not.toBe(log[0].r);
  });

  it('module scenes shadow via a module-scope destructure; classic wrapping refuses module code', () => {
    const wrapped = wrapSceneCode('import * as THREE from "three";\nwindow.render = t => Math.random();', { kind: 'module' });
    expect(wrapped.startsWith(`const { ${SCENE_SCOPE_SHADOWED_GLOBALS.join(', ')} } = window.__sdScope;`)).toBe(true);
    expect(() => wrapSceneCode('import x from "y";')).toThrow(/SCENE_RUNTIME_WRAP_MODULE/u);
    expect(() => wrapSceneCode('const a = import("./x.js");')).not.toThrow();

    // Semantics of the destructure (module scope emulated with a function scope).
    const page = createFakePage();
    page.run(buildSceneDeterminismShim({ fps: 30, epochMs: 1000 }));
    const body = wrapSceneCode('window.__seen = [Date.now(), performance.now()];', { kind: 'module' });
    page.run(`(function () {\n${body}\n})();`);
    expect(page.__seen).toEqual([1000, 0]);
    expect(page.run('typeof Date.now() === "number" && Date.now() > 1000')).toBe(true);
  });

  it('__sdScope cannot be replaced by scene code and scene callback errors are reported, not thrown', async () => {
    const page = createFakePage({ animations: [fakeAnimation(1000)] });
    page.run(buildSceneRuntimeBootstrap('generic-css', { fps: 30 }));
    const scope = page.__sdScope;
    page.run(wrapSceneCode('try { window.__sdScope = {}; } catch (e) {} requestAnimationFrame(function () { throw new Error("scene bug"); });'));
    expect(page.__sdScope).toBe(scope);
    await page.run('window.__sd.ready()');
    await page.run('window.__sd.seek(1)');
    expect(page.__sd.errors).toEqual([{ message: 'scene bug', source: 'scene', frame: 1 }]);
  });
});

describe('sceneCaptureStrategy (ADR-03)', () => {
  it('only VideoSpec projects use the capture host', () => {
    expect(sceneCaptureStrategy({ videoSpecVersion: 1 })).toBe('capture-host');
    expect(sceneCaptureStrategy({ videoSpecVersion: 2 })).toBe('capture-host');
    expect(sceneCaptureStrategy({})).toBe('legacy');
    expect(sceneCaptureStrategy({ videoSpecVersion: '1' })).toBe('legacy');
    expect(sceneCaptureStrategy(null)).toBe('legacy');
  });
});
