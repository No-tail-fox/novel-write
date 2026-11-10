/**
 * L-6 预览一致性测试（docs/design/2026-11-09-lemo-faithful-mode.md §6）。
 * - 纯函数部分（时间点、帧比较、阈值判定、报告组装、skip 原因）总是运行；
 * - 真实比较：上游 still.mjs（打包的 Playwright 驱动 + chromium-headless-shell）vs 应用内预览（reviewLemoUpstreamProject）
 *   和 CaptureHost（lemo 适配器），夹具 tests/fixtures/lemo-preview/（canvas2d，按 t 确定性绘制）。
 *   缺少前置条件（vendor/python 驱动、无头浏览器、three、node_modules/electron）时 it.skipIf 跳过，标题里写明原因。
 */
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RawFrame } from '../src/shared/frame-hash';
import {
  LEMO_PREVIEW_CONSISTENCY_TOLERANCE,
  buildPreviewConsistencyReport,
  buildPreviewConsistencyTimes,
  meanAbsolutePixelDifference,
  previewConsistencyDiscrimination,
  previewConsistencyFrameForTime,
  previewConsistencyTotalFrames,
  skippedPreviewConsistencyReport,
  upstreamBrowserUnavailableReason,
  validatePreviewConsistencyTimes,
  type PreviewConsistencyFrameInput,
} from '../src/shared/lemo-preview-consistency';
import { checkLemoPreviewPrerequisites, runLemoPreviewConsistency } from '../scripts/lemo-preview-consistency';

const repoRoot = resolve(__dirname, '..');
const W = 64;
const H = 36;

/** 合成 RGBA 帧：背景 + 位置随 x 变化的亮块（模拟按 t 移动的画面）。 */
function synthetic(x: number, options: { background?: number; noise?: number; width?: number; height?: number } = {}): RawFrame {
  const width = options.width ?? W;
  const height = options.height ?? H;
  const data = new Uint8Array(width * height * 4);
  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      const inside = px >= x && px < x + 16 && py >= 8 && py < 28;
      const jitter = options.noise ? ((px * 7 + py * 13) % 3) - 1 : 0;
      const value = Math.max(0, Math.min(255, (inside ? 230 : options.background ?? 30 + px) + jitter * (options.noise ?? 0)));
      const offset = (py * width + px) * 4;
      data[offset] = value; data[offset + 1] = value; data[offset + 2] = Math.round(value / 2); data[offset + 3] = 255;
    }
  }
  return { data, width, height };
}

const canvas = { width: W, height: H, fps: 30, durationSeconds: 2 };

describe('L-6 preview consistency: pure parts', () => {
  it('builds frame-aligned, evenly spread times that round-trip through String/parseFloat', () => {
    expect(previewConsistencyTotalFrames(2, 30)).toBe(60);
    const times = buildPreviewConsistencyTimes({ durationSeconds: 2, fps: 30, count: 5 });
    expect(times.map(t => Math.round(t * 30))).toEqual([0, 15, 30, 44, 59]);
    for (const t of times) {
      expect(parseFloat(String(t))).toBe(t); // still.mjs reads the CLI string with parseFloat
      expect(t).toBeLessThan(2);
    }
    expect(buildPreviewConsistencyTimes({ durationSeconds: 0.1, fps: 30, count: 10 })).toEqual([0, 1 / 30, 2 / 30]);
    expect(buildPreviewConsistencyTimes({ durationSeconds: 2, fps: 30, count: 1 })).toEqual([0]);
    expect(() => buildPreviewConsistencyTimes({ durationSeconds: 0, fps: 30 })).toThrow(/DURATION/);
    expect(() => buildPreviewConsistencyTimes({ durationSeconds: 2, fps: 30, count: 0 })).toThrow(/COUNT/);
  });

  it('maps seconds to integer frames and rejects off-grid, out-of-film and duplicate times', () => {
    expect(previewConsistencyFrameForTime(0.5, 30)).toBe(15);
    expect(previewConsistencyFrameForTime(44 / 30, 30)).toBe(44);
    expect(() => previewConsistencyFrameForTime(0.51, 30)).toThrow(/NOT_FRAME_ALIGNED/);
    expect(() => previewConsistencyFrameForTime(-1, 30)).toThrow(/TIME_INVALID/);
    expect(validatePreviewConsistencyTimes([0, 0.5, 1], 2, 30)).toEqual([0, 0.5, 1]);
    expect(() => validatePreviewConsistencyTimes([2], 2, 30)).toThrow(/OUTSIDE_FILM/);
    expect(() => validatePreviewConsistencyTimes([0.5, 0.5], 2, 30)).toThrow(/DUPLICATE/);
    expect(() => validatePreviewConsistencyTimes([], 2, 30)).toThrow(/EMPTY/);
  });

  it('computes mean absolute pixel difference across channel orders and refuses size mismatches', () => {
    const a = synthetic(10);
    expect(meanAbsolutePixelDifference(a, a)).toBe(0);
    const bgra = new Uint8Array(a.data.length);
    for (let i = 0; i < a.data.length; i += 4) { bgra[i] = a.data[i + 2]; bgra[i + 1] = a.data[i + 1]; bgra[i + 2] = a.data[i]; bgra[i + 3] = 255; }
    expect(meanAbsolutePixelDifference(a, { data: bgra, width: W, height: H, channels: 'bgra' })).toBe(0);
    expect(meanAbsolutePixelDifference(a, synthetic(10, { width: W * 2, height: H * 2 }))).toBeNull();
    expect(meanAbsolutePixelDifference(a, synthetic(40))!).toBeGreaterThan(5);
  });

  it('passes when every app-side frame matches the reference within tolerance (small encoding noise allowed)', () => {
    const times = [0, 0.5, 1];
    const frames: PreviewConsistencyFrameInput[] = [];
    times.forEach((time, index) => {
      frames.push({ side: 'upstream-still', time, frame: synthetic(4 + index * 20, { noise: 2 }) });
      frames.push({ side: 'app-preview', time, frame: synthetic(4 + index * 20) });
      frames.push({ side: 'capture-host', time, frame: synthetic(4 + index * 20) });
    });
    const report = buildPreviewConsistencyReport({ canvas, times, frames, environment: { fixture: 'synthetic' }, now: () => new Date(0) });
    expect(report.failures).toEqual([]);
    expect(report.status).toBe('pass');
    expect(report.sides).toEqual(['upstream-still', 'app-preview', 'capture-host']);
    expect(report.pairs).toHaveLength(9);
    expect(report.pairs.filter(pair => pair.gating)).toHaveLength(6);
    expect(report.discrimination?.discriminative).toBe(true);
    expect(report.worst!.ahashDistance).toBeLessThanOrEqual(LEMO_PREVIEW_CONSISTENCY_TOLERANCE.maxBits);
    expect(report.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(JSON.parse(JSON.stringify(report)).status).toBe('pass');
  });

  it('fails on a timing error (app side renders a different t), on size mismatch and on missing frames', () => {
    const times = [0, 1];
    const timing = buildPreviewConsistencyReport({ canvas, times, frames: [
      { side: 'upstream-still', time: 0, frame: synthetic(4) },
      { side: 'upstream-still', time: 1, frame: synthetic(44) },
      { side: 'app-preview', time: 0, frame: synthetic(4) },
      // e.g. t passed in ms and clamped to the end of the film
      { side: 'app-preview', time: 1, frame: synthetic(4) },
    ] });
    expect(timing.status).toBe('fail');
    expect(timing.failures.join('\n')).toMatch(/t=1s upstream-still vs app-preview/);

    const size = buildPreviewConsistencyReport({ canvas, times: [0], frames: [
      { side: 'upstream-still', time: 0, frame: synthetic(4) },
      { side: 'app-preview', time: 0, frame: synthetic(4, { width: W * 2, height: H * 2 }) },
    ] });
    expect(size.status).toBe('fail');
    expect(size.pairs[0].sizeMatch).toBe(false);
    expect(size.failures[0]).toMatch(/尺寸不同/);

    const missing = buildPreviewConsistencyReport({ canvas, times: [0, 1], frames: [
      { side: 'upstream-still', time: 0, frame: synthetic(4) },
      { side: 'upstream-still', time: 1, frame: synthetic(44) },
      { side: 'app-preview', time: 0, frame: synthetic(4) },
    ] });
    expect(missing.failures).toContain('app-preview 缺少 t=1 的帧');
    expect(buildPreviewConsistencyReport({ canvas, times: [0], frames: [{ side: 'upstream-still', time: 0, frame: synthetic(4) }] }).failures)
      .toContain('缺少应用侧（app-preview / capture-host）帧');
  });

  it('declares a fixture non-discriminative when reference frames at different times are within tolerance', () => {
    const still = synthetic(4);
    const report = buildPreviewConsistencyReport({ canvas, times: [0, 1], frames: [
      { side: 'upstream-still', time: 0, frame: still },
      { side: 'upstream-still', time: 1, frame: still },
      { side: 'app-preview', time: 0, frame: still },
      { side: 'app-preview', time: 1, frame: still },
    ] });
    expect(report.discrimination).toEqual({ minCrossTimeBits: 0, discriminative: false });
    expect(report.status).toBe('fail');
    expect(previewConsistencyDiscrimination([], 3)).toEqual({ minCrossTimeBits: null, discriminative: true });
  });

  it('builds skip reports and recognises an unavailable upstream browser', () => {
    const skipped = skippedPreviewConsistencyReport('no browser', { canvas, times: [0] });
    expect(skipped).toMatchObject({ status: 'skip', skipReason: 'no browser', frames: [], pairs: [], failures: [] });
    expect(upstreamBrowserUnavailableReason("browserType.launch: Executable doesn't exist at C:\\x\\headless_shell.exe")).toMatch(/无法启动无头浏览器/);
    expect(upstreamBrowserUnavailableReason("Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'playwright-core'")).toMatch(/无法启动/);
    expect(upstreamBrowserUnavailableReason('[pageerror] boom')).toBeNull();
  });

  it('reports missing prerequisites as a reason instead of failing', () => {
    const missingElectron = checkLemoPreviewPrerequisites({ repoRoot, electronBinary: null, pythonRoot: join(repoRoot, 'vendor', 'python') });
    expect(missingElectron.ok).toBe(false);
    const missingDriver = checkLemoPreviewPrerequisites({ repoRoot, pythonRoot: join(repoRoot, '.tmp-does-not-exist'), electronBinary: 'x' });
    expect(missingDriver).toMatchObject({ ok: false });
    expect(missingDriver.reason).toMatch(/still\.mjs|three|Playwright/);
  });
});

const prerequisites = checkLemoPreviewPrerequisites({ repoRoot });

describe('L-6 preview consistency: real still.mjs vs app preview', () => {
  it.skipIf(!prerequisites.ok)(`same t, same picture in upstream still.mjs, reviewLemoUpstreamProject and CaptureHost${prerequisites.ok ? '' : `（已跳过：${prerequisites.reason}）`}`, async () => {
    const report = await runLemoPreviewConsistency({
      repoRoot,
      filmDir: join(repoRoot, 'tests', 'fixtures', 'lemo-preview'),
      width: 480,
      height: 270,
      fps: 30,
      durationSeconds: 2,
      count: 5,
      timeoutMs: 45_000,
    });
    // A runtime-level skip (e.g. headless shell revision missing) is legitimate; anything else must pass.
    if (report.status === 'skip') {
      console.warn(`[lemo-preview-consistency] skipped: ${report.skipReason}`);
      return;
    }
    const summary = report.pairs.map(pair => `${pair.time.toFixed(3)} ${pair.a}~${pair.b} a=${pair.ahashDistance} d=${pair.dhashDistance} L=${pair.meanLumaDelta} mad=${pair.meanAbsDiff}`).join('\n');
    console.log(`[lemo-preview-consistency] ${report.status} worst=${JSON.stringify(report.worst)} discrimination=${JSON.stringify(report.discrimination)}\n${summary}`);
    expect(report.failures, summary).toEqual([]);
    expect(report.status).toBe('pass');
    expect(report.sides).toEqual(['upstream-still', 'app-preview', 'capture-host']);
    expect(report.pairs).toHaveLength(15);
    expect(report.discrimination?.discriminative).toBe(true);
    for (const frame of report.frames) expect([frame.width, frame.height]).toEqual([480, 270]);
    // The two app-side paths share one Chromium: they must agree at least as tightly as with upstream.
    for (const pair of report.pairs.filter(item => !item.gating)) expect(pair.match, summary).toBe(true);
  }, 60_000);
});
