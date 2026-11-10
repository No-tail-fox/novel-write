/**
 * O-3 分帧函数统一：`allocateFrameCounts`（video-spec.ts，毫秒、整数运算，规范实现）与
 * `allocateHtmlVideoSceneFrameCounts`（html-video.ts，秒、浮点累加，旧路线）是否在所有现有输入上逐值相同。
 *
 * 结论（本文件固定下来）：**不完全相同**，因此旧函数保持原样不委托（旧项目输出逐字节不变），
 * 新执行器只用规范实现。差异只有三类：
 *   1. 30 fps 下累计时长恰好落在半帧（例如 2050 ms = 61.5 帧）时，旧函数的秒浮点累加会落到 .4999…，向下取整；
 *      规范实现按整数运算 0.5 进位。24 fps 下整数毫秒永远不会恰好落在半帧（24·ms mod 1000 是 8 的倍数，≠ 500），所以相同。
 *   2. 定义域：旧函数接受任意正 fps（现有测试用 25 fps），规范实现只接受 24 / 30。
 *   3. 错误类型：旧函数抛普通 Error（英文），规范实现抛 AppError（VIDEO_SPEC_TIME_INVALID / VIDEO_SPEC_FPS_INVALID）。
 */
import { describe, expect, it } from 'vitest';
import { allocateFrameCounts, type VideoSpecFps } from '../src/shared/video-spec';
import { allocateHtmlVideoSceneFrameCounts } from '../src/shared/html-video';

function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const legacyMs = (durationsMs: readonly number[], fps: number, offsetMs = 0) =>
  allocateHtmlVideoSceneFrameCounts(durationsMs.map(ms => ms / 1000), fps, offsetMs / 1000);

describe('frame allocation: canonical (video-spec) vs legacy (html-video)', () => {
  it('is identical at 24 fps for every integer-millisecond input (20k random cases, with and without offsets)', () => {
    const random = rng(24);
    for (let trial = 0; trial < 20_000; trial += 1) {
      const count = 1 + Math.floor(random() * 40);
      const durations = Array.from({ length: count }, () => 1 + Math.floor(random() * (random() < 0.3 ? 200 : 20_000)));
      const offset = trial % 2 ? Math.floor(random() * 3000) : 0;
      expect(allocateFrameCounts(durations, 24, offset)).toEqual(legacyMs(durations, 24, offset));
    }
  });

  it('is identical at 24 and 30 fps for real-valued (TTS-measured) durations (10k random cases)', () => {
    const random = rng(30);
    for (let trial = 0; trial < 10_000; trial += 1) {
      const fps: VideoSpecFps = trial % 2 ? 30 : 24;
      const seconds = Array.from({ length: 1 + Math.floor(random() * 30) }, () => 0.001 + random() * 20);
      expect(allocateFrameCounts(seconds.map(value => value * 1000), fps)).toEqual(allocateHtmlVideoSceneFrameCounts(seconds, fps));
    }
  });

  it('is identical on the existing fixtures at 24 fps; at 30 fps the html-video-frame-clock fixture already hits a half-frame tie', () => {
    const fixture = Array.from({ length: 100 }, (_, index) => [0.83, 1.071, 0.583][index % 3]);
    for (const offsetSeconds of [0, 0.137, 0.83]) {
      expect(allocateFrameCounts(fixture.map(value => value * 1000), 24, offsetSeconds * 1000))
        .toEqual(allocateHtmlVideoSceneFrameCounts(fixture, 24, offsetSeconds));
    }
    // html-video-frame-clock 的“不逐段取整”用例（24 fps）。
    expect(allocateFrameCounts(Array(20).fill(830), 24)).toEqual(allocateHtmlVideoSceneFrameCounts(Array(20).fill(0.83), 24));
    // 同一输入放到 30 fps：第 5 段累计 4150 ms = 124.5 帧，恰好半帧 → 不同。
    expect(allocateFrameCounts(Array(20).fill(830), 30)[4]).toBe(25);
    expect(allocateHtmlVideoSceneFrameCounts(Array(20).fill(0.83), 30)[4]).toBe(24);
    for (const fps of [24, 30] as const) {
      // video-spec.test.ts 的对拍用例。
      const durationsMs = [2345, 3100, 800, 1234, 4567, 999];
      expect(allocateFrameCounts(durationsMs, fps)).toEqual(legacyMs(durationsMs, fps));
    }
    // 30 fps：累计到第 91 段（偏移 0）= 75350 ms = 2260.5 帧；偏移 0.137 s 时第 56 段 = 46750 ms = 1402.5 帧。
    for (const [offsetSeconds, firstDiff] of [[0, 90], [0.137, 55], [0.83, 89]] as const) {
      const canonical = allocateFrameCounts(fixture.map(value => value * 1000), 30, offsetSeconds * 1000);
      const legacy = allocateHtmlVideoSceneFrameCounts(fixture, 30, offsetSeconds);
      expect(canonical.findIndex((count, index) => count !== legacy[index])).toBe(firstDiff);
      expect(canonical[firstDiff] - legacy[firstDiff]).toBe(1);
      expect(canonical[firstDiff + 1] - legacy[firstDiff + 1]).toBe(-1);
    }
  });

  it('DIFFERS at 30 fps on exact half-frame boundaries: legacy float accumulation rounds down, canonical rounds half up', () => {
    // 2050 ms × 30 fps = 61.5 帧。旧函数：2.05 × 30 = 61.49999999999999 → 61；规范实现：(2050·30 + 500) / 1000 = 62。
    expect(allocateFrameCounts([2050], 30)).toEqual([62]);
    expect(allocateHtmlVideoSceneFrameCounts([2.05], 30)).toEqual([61]);
    // 累加造成的同类差异：250 + 2050 + 1050 = 3350 ms = 100.5 帧。
    expect(allocateFrameCounts([250, 2050, 1050], 30)).toEqual([8, 61, 32]);
    expect(allocateHtmlVideoSceneFrameCounts([0.25, 2.05, 1.05], 30)).toEqual([8, 61, 31]);
    // 随机整数毫秒输入里这类差异并不罕见，所以旧函数不能委托到规范实现。
    const random = rng(7);
    let differing = 0;
    for (let trial = 0; trial < 5_000; trial += 1) {
      const durations = Array.from({ length: 1 + Math.floor(random() * 30) }, () => [50, 150, 250, 350, 1050][Math.floor(random() * 5)] + 100 * Math.floor(random() * 30));
      const canonical = allocateFrameCounts(durations, 30);
      const legacy = legacyMs(durations, 30);
      if (canonical.join() !== legacy.join()) {
        differing += 1;
        // 差异只是边界帧的 ±1 平移，总帧数最多差 1，并且规范实现永远不比精确值偏离超过半帧。
        expect(Math.abs(canonical.reduce((a, b) => a + b, 0) - legacy.reduce((a, b) => a + b, 0))).toBeLessThanOrEqual(1);
      }
    }
    expect(differing).toBeGreaterThan(0);
  });

  it('differs in domain and error type (legacy accepts 25 fps and throws plain Error)', () => {
    expect(allocateHtmlVideoSceneFrameCounts([1, 1], 25)).toEqual([25, 25]);
    expect(() => allocateFrameCounts([1000, 1000], 25 as VideoSpecFps)).toThrow(/fps 只支持 24 或 30/);
    expect(() => allocateHtmlVideoSceneFrameCounts([0], 24)).toThrow('HTML video scene duration must be positive.');
    try {
      allocateFrameCounts([0], 24);
      expect.unreachable();
    } catch (error) {
      expect((error as { code?: string }).code).toBe('VIDEO_SPEC_TIME_INVALID');
    }
  });
});
