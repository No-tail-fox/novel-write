/**
 * O-3 (d)：新架构出片端到端 —— 真实的打包 ffmpeg + 假采集窗口（每个场景一种纯色静帧）。
 * 走 html-video-runtime 的 renderVideoSpec 全流程：暂存 → VideoSpec → 执行器（AudioTimeline / xfade 封装）→
 * 发布 final.mp4 → 可信摘要 → 复检 quality-gate.json。没有 ffmpeg 时跳过。
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createElectronHtmlVideoRuntime } from '../electron/html-video-runtime';
import { createHtmlVideoSpecFilmRenderer } from '../electron/html-video-spec-render';
import { runFinalFilmGateSafely, type FinalFilmGateRunOptions } from '../electron/final-film-gate-runner';
import type { CaptureImage, CaptureWindow, CaptureWindowRequest } from '../electron/capture-host';
import { createTestTempDirectory, removeTestTempDirectories } from './helpers/test-temp-directories';
import { createFakePage, type FakePage } from './helpers/fake-scene-page';
import { audioRmsDb, createFfmpegProbe, filmFacts, frameRgb, prepareSpecTaskFixture, resolveTestFfmpeg } from './helpers/html-video-spec-fixture';

const ffmpegPath = await resolveTestFfmpeg();
const GRAY: Record<string, number> = { '1': 40, '2': 200, '3': 120 };

/** HyperFrames 契约的假页面（__hf.seek）；capturePage 按 URL 里的场景号输出纯色 BGRA。 */
function fakeCaptureFactory(options: { failScene?: string } = {}) {
  const urls: string[] = [];
  const factory = (request: CaptureWindowRequest): CaptureWindow => {
    let page: FakePage | undefined;
    let gray = 0;
    let destroyed = false;
    return {
      loadURL: async (url: string) => {
        urls.push(url);
        const scene = /scene-0*(\d+)\.html\?storydream-render=1$/u.exec(url)?.[1] ?? '0';
        if (scene === options.failScene) throw new Error(`fake load failure for scene ${scene}`);
        gray = GRAY[scene] ?? 0;
        page = createFakePage({ globals: { __hf: { duration: 30, seek: () => undefined } } });
      },
      executeJavaScript: async (code: string) => {
        const result = await page!.run(code);
        return result === undefined ? undefined : JSON.parse(JSON.stringify(result));
      },
      capturePage: async (): Promise<CaptureImage> => ({
        getSize: () => ({ width: request.width, height: request.height }),
        toBitmap: () => {
          const bitmap = new Uint8Array(request.width * request.height * 4).fill(gray);
          for (let index = 3; index < bitmap.length; index += 4) bitmap[index] = 255;
          return bitmap;
        },
        toJPEG: () => new Uint8Array(),
      }),
      onPageError: () => undefined,
      onCrash: () => undefined,
      destroy: () => { destroyed = true; page?.close(); },
      isDestroyed: () => destroyed,
    } as CaptureWindow;
  };
  return { factory, urls };
}

const near = (value: number, target: number, tolerance = 14) => Math.abs(value - target) <= tolerance;

describe.skipIf(!ffmpegPath)('(d) VideoSpec render end to end (real ffmpeg, fake capture)', () => {
  it('publishes final.mp4 on the project clock with cover, transitions, narration + BGM, bt709 and a passing gate', async () => {
    const trustedRoot = await createTestTempDirectory(join(tmpdir(), 'storydream-html-spec-e2e-'));
    try {
      const fixture = await prepareSpecTaskFixture({ ffmpegPath: ffmpegPath!, trustedRoot, cover: true });
      const capture = fakeCaptureFactory();
      const gateRuns: FinalFilmGateRunOptions[] = [];
      const gateReports: unknown[] = [];
      let legacyCalls = 0;
      const runtime = createElectronHtmlVideoRuntime({
        taskDirectory: fixture.taskDirectory,
        taskTitle: '新架构端到端',
        bgmPath: fixture.bgmPath,
        renderMaxLongEdge: 320,
        renderer: { render: async () => { legacyCalls += 1; throw new Error('legacy renderer must not run'); } } as never,
        probeMedia: createFfmpegProbe(ffmpegPath!),
        videoSpecRender: createHtmlVideoSpecFilmRenderer({ createCaptureWindow: capture.factory, ffmpegPath: ffmpegPath! }),
        finalFilmGate: async (options) => {
          gateRuns.push(options);
          const report = await runFinalFilmGateSafely({ ...options, ffmpegPath: ffmpegPath!, ffprobePath: null });
          gateReports.push(report);
          return report;
        },
      });
      const started = Date.now();
      const output = await runtime.renderVideoSpec(fixture.input);
      const elapsedMs = Date.now() - started;
      expect(legacyCalls).toBe(0);
      const film = join(fixture.workDir, 'final.mp4');
      expect(output.path).toBe(film);
      expect(output.sizeBytes).toBe((await stat(film)).size);

      // 可信摘要与发布的文件一致（下游历史 / 导出 / 成本面板用的是同一个 final.mp4）。
      const digest = await runtime.consumeRenderArtifactDigest(output);
      expect(digest.sha256).toBe(createHash('sha256').update(await readFile(film)).digest('hex'));

      // 时钟：封面 1.4 s = 34 帧；场景 1 至少 6 s（开场蒙太奇）= 144 帧；1.5 s = 36 帧；1.0 s = 24 帧。
      const facts = await filmFacts(ffmpegPath!, film);
      expect(facts.frames).toBe(34 + 144 + 36 + 24);
      expect(output.durationSec).toBeCloseTo(238 / 24, 1);
      expect(facts.videoLine).toMatch(/Video: h264.*yuv420p\(tv, bt709\/bt709\/iec61966-2-1/u);
      expect(facts.videoLine).toMatch(/180x320/u);
      expect(facts.videoLine).toMatch(/24 fps/u);
      expect(facts.audioLine).toMatch(/Audio: aac.*48000 Hz/u);

      // 采集：三个场景页面都带 ?storydream-render=1，封面走静图（不开采集窗口）。
      expect(capture.urls).toHaveLength(3);
      expect(capture.urls.every(url => url.startsWith('file:') && url.endsWith('.html?storydream-render=1'))).toBe(true);

      // 画面：封面（红）→ 场景 1（灰 40）→ 场景 2（灰 200）→ 场景 3（灰 120），转场 7 帧，从下一场景的起点开始。
      const px = async (frame: number) => [...await frameRgb(ffmpegPath!, film, frame)];
      const [cover, coverMid, s1, s1Tail, s12Mid, s2, s2Tail, s23Mid, s3] = await Promise.all([30, 37, 45, 175, 181, 190, 211, 217, 230].map(px));
      expect(cover[0]).toBeGreaterThan(200);
      expect(cover[1]).toBeLessThan(40);
      expect(near(s1[0], 40) && near(s1[1], 40)).toBe(true);
      expect(near(s1Tail[1], 40)).toBe(true);
      expect(near(s2[1], 200)).toBe(true);
      expect(near(s2Tail[1], 200)).toBe(true);
      expect(near(s3[1], 120)).toBe(true);
      // 转场中点和两侧都不同（真的做了 xfade，不是硬切）。
      expect(coverMid[0]).toBeLessThan(cover[0] - 30);
      expect(coverMid[0]).toBeGreaterThan(s1[0] + 30);
      expect(s12Mid[1]).toBeGreaterThan(s1[1] + 30);
      expect(s12Mid[1]).toBeLessThan(s2[1] - 30);
      expect(s23Mid[1]).toBeLessThan(s2[1] - 20);
      expect(s23Mid[1]).toBeGreaterThan(s3[1] + 20);

      // 音频：封面段没有旁白，只有 BGM（证明 BGM 混进去了）；场景段有旁白。
      const coverRms = await audioRmsDb(ffmpegPath!, film, 0.1, 1.1);
      const narrationRms = await audioRmsDb(ffmpegPath!, film, 2.0, 1.0);
      expect(coverRms).toBeGreaterThan(-45);
      expect(narrationRms).toBeGreaterThan(coverRms);

      // 复检：发布后跑在 final.mp4 上，预期值来自 VideoSpec，结果通过并写出 quality-gate.json。
      expect(gateRuns).toHaveLength(1);
      expect(gateRuns[0]).toMatchObject({ route: 'html', filmPath: film, expected: { durationMs: 238 * 1000 / 24, fps: 24, width: 180, height: 320, audioExpected: true, loudnessTarget: true } });
      const report = gateReports[0] as { status: string; checks: Array<{ id: string; status: string; detail?: string }> };
      expect(report.status, JSON.stringify(report.checks)).toBe('passed');
      const written = JSON.parse(await readFile(join(fixture.workDir, 'quality-gate.json'), 'utf8')) as { status: string };
      expect(written.status).toBe('passed');
      console.info(`[html-video-spec e2e] ${facts.frames} frames, ${output.durationSec}s, ${output.sizeBytes} bytes, cover RMS ${coverRms.toFixed(1)} dB, narration RMS ${narrationRms.toFixed(1)} dB, render ${elapsedMs} ms`);
    } finally {
      await removeTestTempDirectories(trustedRoot);
    }
  }, 240_000);

  it('fails with VIDEO_SPEC_RENDER_* and never falls back to the legacy renderer or publishes a film', async () => {
    const trustedRoot = await createTestTempDirectory(join(tmpdir(), 'storydream-html-spec-e2e-fail-'));
    try {
      const fixture = await prepareSpecTaskFixture({ ffmpegPath: ffmpegPath!, trustedRoot });
      const capture = fakeCaptureFactory({ failScene: '2' });
      let legacyCalls = 0;
      let gateCalls = 0;
      const runtime = createElectronHtmlVideoRuntime({
        taskDirectory: fixture.taskDirectory,
        taskTitle: '新架构失败',
        bgmPath: fixture.bgmPath,
        renderMaxLongEdge: 320,
        renderer: { render: async () => { legacyCalls += 1; throw new Error('legacy renderer must not run'); } } as never,
        probeMedia: createFfmpegProbe(ffmpegPath!),
        videoSpecRender: createHtmlVideoSpecFilmRenderer({ createCaptureWindow: capture.factory, ffmpegPath: ffmpegPath! }),
        finalFilmGate: async () => { gateCalls += 1; },
      });
      await expect(runtime.renderVideoSpec(fixture.input)).rejects.toMatchObject({ code: 'VIDEO_SPEC_RENDER_SCENE_FAILED' });
      expect(legacyCalls).toBe(0);
      expect(gateCalls).toBe(0);
      await expect(stat(join(fixture.workDir, 'final.mp4'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await removeTestTempDirectories(trustedRoot);
    }
  }, 240_000);
});
