/**
 * 适配器契约测试（Q-5，底座 §7.1 / §10.2）：列出所有 VideoSpec 适配器，要求要么有可注入的 SceneRuntime 启动脚本，
 * 要么给出明确的“不经过浏览器采集”原因；每个可采集的运行时都跑同一套 HF FrameAdapter 规则：
 * 帧数有限非负、回传同一帧号、任意顺序 seek 结果相同、重复 seek 结果相同、场景作用域里没有挂钟和未设种子的随机数。
 */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  SCENE_RUNTIME_ADAPTERS,
  SCENE_RUNTIME_DEFAULT_EPOCH_MS,
  VIDEO_SPEC_ADAPTER_CAPTURE,
  buildSceneRuntimeBootstrap,
  sceneCapturePlan,
  validateSceneRuntimeDescriptor,
  wrapSceneCode,
  type SceneRuntimeAdapter,
} from '../src/shared/scene-runtime';
import { VIDEO_SPEC_ADAPTER_KINDS } from '../src/shared/video-spec';
import { createFakePage, fakeAnimation, type FakePage } from './helpers/fake-scene-page';

const FPS = 30;
const DURATION_FRAMES = 45;

/** 每个运行时一个夹具页面：页面状态是“当前画面”的替身，`window.__state()` 读出。 */
const fixtures: Record<SceneRuntimeAdapter, () => FakePage> = {
  hyperframes: () => {
    const page = createFakePage({ globals: { __ready: true } });
    let time = 0;
    page.__tl = { seek: (t: number) => { time = t; }, duration: () => DURATION_FRAMES / FPS, then: () => undefined };
    page.__player = { renderSeek: (t: number) => { time = t; return page.__tl; } };
    page.__hfWaitForSeekCompletion = async () => undefined;
    // Scene code (wrapped) draws from the timeline time + seeded random.
    page.run(buildSceneRuntimeBootstrap('hyperframes', { fps: FPS, sceneId: 'contract-hf' }));
    page.__readTime = () => time;
    page.run(wrapSceneCode('window.__state = function () { return window.__readTime().toFixed(5) + "|" + Math.random().toFixed(8) + "|" + Date.now(); };'));
    return page;
  },
  lemo: () => {
    const page = createFakePage({ globals: { READY: false } });
    page.run(buildSceneRuntimeBootstrap('lemo', { fps: FPS, sceneId: 'contract-lemo' }));
    page.run(wrapSceneCode(`
      var particles = [];
      for (var i = 0; i < 8; i++) particles.push(Math.random());
      var painted = '';
      window.DUR = ${DURATION_FRAMES / FPS};
      window.render = function (t) { painted = t.toFixed(5) + '|' + particles.map(function (p) { return (p * t).toFixed(6); }).join(',') + '|' + Math.random().toFixed(8) + '|' + performance.now(); };
      window.__state = function () { return painted; };
      window.READY = true;
    `));
    return page;
  },
  'generic-css': () => {
    const animations = [fakeAnimation((DURATION_FRAMES / FPS) * 1000), fakeAnimation(700)];
    const page = createFakePage({ animations });
    page.run(buildSceneRuntimeBootstrap('generic-css', { fps: FPS, sceneId: 'contract-css' }));
    page.__state = () => animations.map(animation => `${animation.playState}:${animation.currentTime}`).join(',');
    return page;
  },
};

describe('VideoSpec adapter → capture plan', () => {
  it('lists every VideoSpec adapter kind with a bootstrap or an explicit not-capturable reason', () => {
    expect(Object.keys(VIDEO_SPEC_ADAPTER_CAPTURE).sort()).toEqual([...VIDEO_SPEC_ADAPTER_KINDS].sort());
    for (const kind of VIDEO_SPEC_ADAPTER_KINDS) {
      const plan = sceneCapturePlan(kind);
      if (plan.capturable) {
        expect(SCENE_RUNTIME_ADAPTERS).toContain(plan.runtime);
        const source = buildSceneRuntimeBootstrap(plan.runtime, { fps: FPS, durationFrames: 10 });
        expect(() => new vm.Script(source), kind).not.toThrow();
      } else {
        expect(plan.compositor, kind).toBe('ffmpeg');
        expect(plan.reason.length, kind).toBeGreaterThan(10);
      }
    }
  });

  it('video and still scenes are composited by ffmpeg, not captured', () => {
    expect(sceneCapturePlan('video')).toMatchObject({ capturable: false, compositor: 'ffmpeg' });
    expect(sceneCapturePlan('still')).toMatchObject({ capturable: false, compositor: 'ffmpeg' });
    expect(sceneCapturePlan('hyperframes')).toMatchObject({ capturable: true, runtime: 'hyperframes' });
    expect(sceneCapturePlan('lemo')).toMatchObject({ capturable: true, runtime: 'lemo' });
    expect(() => sceneCapturePlan('remotion' as never)).toThrow();
  });

  it('every SceneRuntime adapter has a contract fixture', () => {
    expect(Object.keys(fixtures).sort()).toEqual([...SCENE_RUNTIME_ADAPTERS].sort());
  });
});

describe.each(SCENE_RUNTIME_ADAPTERS)('SceneRuntime adapter contract: %s', adapter => {
  async function stateAt(page: FakePage, frame: number): Promise<string> {
    const echoed = await page.run<Promise<{ frame: number }>>(`window.__sd.seekFrame(${frame})`);
    expect(echoed.frame).toBe(frame);
    return String(page.__state());
  }

  it('ready() completes and reports a finite, non-negative frame count', async () => {
    const page = fixtures[adapter]();
    await page.run('window.__sd.ready()');
    const descriptor = page.run('window.__sd.describe()');
    const validation = validateSceneRuntimeDescriptor(descriptor, { adapter, fps: FPS, durationFrames: DURATION_FRAMES });
    expect(validation.ok, JSON.stringify(validation)).toBe(true);
    expect(page.__hf.duration).toBeCloseTo(DURATION_FRAMES / FPS, 9);
  });

  it('random-order and repeated seeks produce identical results', async () => {
    const sequential = fixtures[adapter]();
    await sequential.run('window.__sd.ready()');
    const order = [0, 1, 2, 22, 44];
    const expected = new Map<number, string>();
    for (const frame of order) expected.set(frame, await stateAt(sequential, frame));
    expect(new Set(expected.values()).size).toBe(order.length);

    const shuffled = fixtures[adapter]();
    await shuffled.run('window.__sd.ready()');
    for (const frame of [44, 2, 22, 0, 1, 22, 22, 0]) expect(await stateAt(shuffled, frame), `frame ${frame}`).toBe(expected.get(frame));
  });

  it('rejects frames outside [0, durationFrames)', async () => {
    const page = fixtures[adapter]();
    await page.run('window.__sd.ready()');
    await expect(page.run(`window.__sd.seek(${DURATION_FRAMES})`)).rejects.toThrow(/SCENE_RUNTIME_FRAME_OUT_OF_RANGE/u);
    await expect(page.run('window.__sd.seek(-1)')).rejects.toThrow(/SCENE_RUNTIME_FRAME_OUT_OF_RANGE/u);
  });

  it('scene scope sees frame time, not the wall clock', async () => {
    const page = fixtures[adapter]();
    page.run(wrapSceneCode('window.__clock = function () { return [Date.now(), performance.now()]; };'));
    await page.run('window.__sd.ready()');
    await page.run('window.__sd.seek(15)');
    expect(page.__clock()).toEqual([SCENE_RUNTIME_DEFAULT_EPOCH_MS + 500, 500]);
    expect(Math.abs(page.run<number>('Date.now()') - Date.now())).toBeLessThan(5_000);
  });
});
