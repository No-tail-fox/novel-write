import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CAPTURE_FORMAT } from '../electron/capture-host';
import {
  DEFAULT_CAPTURE_DECISION_THRESHOLDS,
  decideCaptureDefaults,
  median,
  parseCaptureDecisionMarker,
  parseFfmpegBench,
  parseFfmpegPsnr,
  parseFfmpegSsim,
  summarizeCaptureBenchRuns,
  type CaptureBenchQuality,
  type CaptureBenchRawRun,
  type CaptureBenchReport,
} from '../src/shared/capture-benchmark';

const DOC = 'docs/design/2026-11-10-capture-benchmark.md';
const REPORT = 'docs/design/2026-11-10-capture-benchmark.json';

describe('ffmpeg output parsers', () => {
  const stderr = [
    '[Parsed_psnr_6 @ 000001bf9e11f180] PSNR y:44.120000 u:47.500000 v:48.010000 average:45.100000 min:31.190000 max:inf',
    '[Parsed_ssim_5 @ 000001bf9e11f080] SSIM Y:0.993118 (21.623) U:0.997000 (25.2) V:0.996500 (24.5) All:0.994500 (22.596)',
    'frame=   30 fps=0.0 q=-0.0 Lsize=N/A time=00:00:01.00 bitrate=N/A speed=25.9x',
    'bench: utime=1.234s stime=0.050s rtime=3.400s',
    'bench: maxrss=342000KiB',
  ].join('\r\n');

  it('parses ssim, psnr (including inf) and -benchmark lines', () => {
    expect(parseFfmpegSsim(stderr)).toEqual({ y: 0.993118, u: 0.997, v: 0.9965, all: 0.9945 });
    expect(parseFfmpegPsnr(stderr)).toEqual({ y: 44.12, u: 47.5, v: 48.01, average: 45.1, min: 31.19, max: Number.POSITIVE_INFINITY });
    expect(parseFfmpegBench(stderr)).toEqual({ utimeS: 1.234, stimeS: 0.05, rtimeS: 3.4, maxRssKb: 342000 });
  });

  it('parses the RGB (gbrp) variants and takes the last summary line', () => {
    const rgb = 'SSIM R:0.5 (3.0) G:0.5 (3.0) B:0.5 (3.0) All:0.5 (3.0)\nSSIM R:0.98 (17.1) G:0.97 (16.0) B:0.96 (15.2) All:0.97 (16.1)\nPSNR r:37.9 g:38.1 b:38.2 average:38.1 min:38.0 max:38.2';
    expect(parseFfmpegSsim(rgb)).toEqual({ y: 0.98, u: 0.97, v: 0.96, all: 0.97 });
    expect(parseFfmpegPsnr(rgb)?.average).toBe(38.1);
  });

  it('returns null when the lines are missing', () => {
    expect(parseFfmpegSsim('nothing')).toBeNull();
    expect(parseFfmpegPsnr('nothing')).toBeNull();
    expect(parseFfmpegBench('nothing')).toBeNull();
    expect(parseFfmpegBench('bench: utime=1.0s stime=0.1s rtime=2.0s')).toEqual({ utimeS: 1, stimeS: 0.1, rtimeS: 2, maxRssKb: null });
  });

  it('median handles odd, even and empty inputs', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNaN();
  });
});

function run(partial: Partial<CaptureBenchRawRun> & Pick<CaptureBenchRawRun, 'scene' | 'format' | 'fps' | 'mode'>): CaptureBenchRawRun {
  const frames = partial.frames ?? partial.fps * 4;
  return {
    id: `${partial.scene}-${partial.format}-${partial.fps}-${partial.mode}`,
    frames,
    repeat: 0,
    ok: true,
    framesCaptured: frames,
    wallMs: 10_000,
    firstFrameMs: 400,
    loopMs: 8_000,
    sinkWaitMs: 100,
    encoderFlushMs: 0,
    frameBytesTotal: frames * 8_294_400,
    electronPeakKb: 600 * 1024,
    electronBaselineKb: 350 * 1024,
    ffmpegMaxRssKb: partial.mode === 'encode' ? 340 * 1024 : null,
    ffmpegCpuS: null,
    outputBytes: partial.mode === 'encode' ? 500_000 : null,
    ...partial,
  };
}

/** 一份合成报告：wall 时间按“每帧耗时”给出，30 fps 正好是 24 fps 的 1.25 倍帧数。 */
function syntheticReport(options: { jpegMsPerFrame: number; bgraMsPerFrame: number; finalSsim?: number; finalPsnr?: number; bgraPeakMb?: number }): Pick<CaptureBenchReport, 'runs' | 'quality'> {
  const runs: CaptureBenchRawRun[] = [];
  for (const scene of ['css', 'lemo'] as const) {
    for (const fps of [30, 24]) {
      for (const format of ['bgra', 'jpeg'] as const) {
        const msPerFrame = format === 'jpeg' ? options.jpegMsPerFrame : options.bgraMsPerFrame;
        for (const repeat of [0, 1, 2]) {
          runs.push(run({
            scene, format, fps, mode: 'encode', repeat,
            wallMs: 500 + msPerFrame * fps * 4 + repeat * 10,
            ...(format === 'bgra' && options.bgraPeakMb ? { electronPeakKb: (options.bgraPeakMb - 340) * 1024 } : {}),
          }));
        }
      }
    }
  }
  const quality: CaptureBenchQuality[] = (['css', 'lemo'] as const).flatMap(scene => [
    { scene, stage: 'frame' as const, ssimAll: 0.98, ssimY: null, psnrAverage: 40, psnrMin: 39, samples: 3 },
    { scene, stage: 'final' as const, ssimAll: options.finalSsim ?? 0.995, ssimY: 0.994, psnrAverage: options.finalPsnr ?? 44, psnrMin: 31, samples: 120 },
  ]);
  return { runs, quality };
}

describe('summarizeCaptureBenchRuns', () => {
  it('groups repeats by case id and takes medians', () => {
    const runs = [0, 1, 2].map(repeat => run({ scene: 'css', format: 'bgra', fps: 30, mode: 'encode', repeat, wallMs: [12_000, 10_000, 11_000][repeat], loopMs: [7_000, 9_000, 8_500][repeat] }));
    const [summary] = summarizeCaptureBenchRuns(runs);
    expect(summary).toMatchObject({ id: 'css-bgra-30-encode', repeats: 3, wallMs: 11_000, endToEndFps: 10.91, loopFps: 14, avgFrameKb: 8100, electronPeakMb: 600, electronBaselineMb: 350, ffmpegMaxRssMb: 340, peakMemoryMb: 940, outputKb: 488 });
  });

  it('refuses failed runs and short captures instead of silently dropping them', () => {
    expect(() => summarizeCaptureBenchRuns([run({ scene: 'css', format: 'jpeg', fps: 30, mode: 'capture', ok: false, error: 'CAPTURE_HOST_SEEK_TIMEOUT' })])).toThrow(/CAPTURE_BENCH_RUN_FAILED.*SEEK_TIMEOUT/u);
    expect(() => summarizeCaptureBenchRuns([run({ scene: 'css', format: 'jpeg', fps: 30, mode: 'capture', framesCaptured: 100 })])).toThrow(/CAPTURE_BENCH_FRAME_COUNT/u);
  });
});

describe('decideCaptureDefaults', () => {
  it('keeps BGRA when JPEG is not clearly faster', () => {
    const decision = decideCaptureDefaults(syntheticReport({ bgraMsPerFrame: 100, jpegMsPerFrame: 105 }));
    expect(decision.format).toBe('bgra');
    expect(decision.jpegSpeedup).toBeLessThan(1);
    expect(decision.reasons.join()).toMatch(/未达“快 10%”门槛/u);
  });

  it('switches to JPEG only when it is ≥10% faster everywhere and the final quality holds', () => {
    expect(decideCaptureDefaults(syntheticReport({ bgraMsPerFrame: 100, jpegMsPerFrame: 80 })).format).toBe('jpeg');
    expect(decideCaptureDefaults(syntheticReport({ bgraMsPerFrame: 100, jpegMsPerFrame: 80, finalSsim: 0.97 })).format).toBe('bgra');
    expect(decideCaptureDefaults(syntheticReport({ bgraMsPerFrame: 100, jpegMsPerFrame: 80, finalPsnr: 35 })).format).toBe('bgra');
  });

  it('switches to JPEG when BGRA exceeds the memory ceiling and JPEG does not', () => {
    const decision = decideCaptureDefaults(syntheticReport({ bgraMsPerFrame: 100, jpegMsPerFrame: 105, bgraPeakMb: DEFAULT_CAPTURE_DECISION_THRESHOLDS.maxPeakMemoryMb + 500 }));
    expect(decision.format).toBe('jpeg');
    expect(decision.reasons[0]).toMatch(/超过上限/u);
  });

  it('recommends 30 fps when cost scales about linearly, 24 when it does not', () => {
    const linear = decideCaptureDefaults(syntheticReport({ bgraMsPerFrame: 100, jpegMsPerFrame: 105 }));
    expect(linear.fps).toBe(30);
    expect(linear.fps30CostRatio).toBeGreaterThan(1.2);
    expect(linear.fps30CostRatio).toBeLessThan(1.25);
    const strict = decideCaptureDefaults(syntheticReport({ bgraMsPerFrame: 100, jpegMsPerFrame: 105 }), { ...DEFAULT_CAPTURE_DECISION_THRESHOLDS, maxFps30CostRatio: 1.1 });
    expect(strict.fps).toBe(24);
  });

  it('requires both formats, both frame rates and a final-quality comparison', () => {
    const report = syntheticReport({ bgraMsPerFrame: 100, jpegMsPerFrame: 105 });
    expect(() => decideCaptureDefaults({ ...report, quality: report.quality.filter(item => item.stage !== 'final') })).toThrow(/CAPTURE_BENCH_INCOMPLETE/u);
    expect(() => decideCaptureDefaults({ ...report, runs: report.runs.filter(item => item.fps === 30) })).toThrow(/24 \/ 30/u);
    expect(() => decideCaptureDefaults({ ...report, runs: report.runs.filter(item => item.format === 'bgra') })).toThrow(/bgra\/jpeg/u);
  });
});

describe('decision marker', () => {
  it('parses the machine-readable marker and rejects malformed ones', () => {
    expect(parseCaptureDecisionMarker('x <!-- capture-benchmark-decision: {"format":"bgra","fps":30} --> y')).toEqual({ format: 'bgra', fps: 30 });
    expect(parseCaptureDecisionMarker('<!-- capture-benchmark-decision: {"format":"png","fps":30} -->')).toBeNull();
    expect(parseCaptureDecisionMarker('<!-- capture-benchmark-decision: {"format":"jpeg","fps":25} -->')).toBeNull();
    expect(parseCaptureDecisionMarker('no marker')).toBeNull();
  });
});

describe.runIf(existsSync(DOC) && existsSync(REPORT))('benchmark document ↔ recorded report ↔ DEFAULT_CAPTURE_FORMAT', () => {
  const doc = existsSync(DOC) ? readFileSync(DOC, 'utf8') : '';
  const report = existsSync(REPORT) ? JSON.parse(readFileSync(REPORT, 'utf8')) as CaptureBenchReport & { decision: ReturnType<typeof decideCaptureDefaults> } : null;

  it('the recorded report reproduces its own decision under the current rules', () => {
    const recomputed = decideCaptureDefaults(report!);
    expect(recomputed).toEqual(report!.decision);
  });

  it('the document marker matches the recomputed decision and the exported constant', () => {
    const marker = parseCaptureDecisionMarker(doc);
    expect(marker).not.toBeNull();
    const recomputed = decideCaptureDefaults(report!);
    expect(marker).toEqual({ format: recomputed.format, fps: recomputed.fps });
    expect(DEFAULT_CAPTURE_FORMAT).toBe(marker!.format);
  });

  it('the document quotes the recorded headline numbers', () => {
    const { decision } = report!;
    expect(doc).toContain(String(decision.jpegSpeedup));
    expect(doc).toContain(String(decision.fps30CostRatio));
    expect(doc).toContain(String(decision.finalSsim));
  });
});
