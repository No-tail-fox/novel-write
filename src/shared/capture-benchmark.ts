/**
 * 采集基准（backlog E-6，底座 §12 决策 1/3、§13.2/13.3）的纯函数部分：解析 ffmpeg 的 ssim / psnr / -benchmark 输出，
 * 汇总 scripts/bench-capture.ts 产出的原始测量，并按固定规则给出“默认帧格式 / 默认 fps”建议。
 * Electron 基准本身不进 vitest；这里的函数和规则由 tests/capture-benchmark.test.ts 覆盖。
 */

export type CaptureBenchFormat = 'bgra' | 'jpeg';
export type CaptureBenchScene = 'css' | 'lemo';
/** capture：sink 丢弃帧，只测采集；encode：帧经 stdin 送进 ffmpeg libx264。 */
export type CaptureBenchMode = 'capture' | 'encode';

export const CAPTURE_BENCHMARK_VERSION = 1;

export interface CaptureBenchCase {
  id: string;
  scene: CaptureBenchScene;
  format: CaptureBenchFormat;
  fps: number;
  frames: number;
  mode: CaptureBenchMode;
  repeat: number;
}

/** Electron runner 对一个 case 的一次原始测量。时间单位毫秒，内存单位 KiB。 */
export interface CaptureBenchRawRun extends CaptureBenchCase {
  ok: boolean;
  error?: string;
  framesCaptured: number;
  /** captureScene 开始 → （encode 模式）ffmpeg 退出 / （capture 模式）captureScene 返回。含建窗、加载、ready。 */
  wallMs: number;
  /** captureScene 开始 → 第一帧交给 sink（建窗 + 加载 + 注入 + ready + 第一帧）。 */
  firstFrameMs: number;
  /** 第一帧交给 sink → 最后一帧交给 sink（稳态循环，N-1 个间隔）。 */
  loopMs: number;
  /** 等 sink（ffmpeg stdin 背压）累计的时间。 */
  sinkWaitMs: number;
  /** stdin 关闭 → ffmpeg 退出（编码器排空）。capture 模式为 0。 */
  encoderFlushMs: number;
  frameBytesTotal: number;
  /** Electron 全部进程（getAppMetrics workingSetSize 之和）的采样峰值。 */
  electronPeakKb: number;
  /** case 开始前（主进程 GC 后）的 Electron 全部进程 working set。 */
  electronBaselineKb?: number;
  /** 峰值时刻按进程类型（Browser / Tab / GPU / Utility）拆分。 */
  electronPeakByTypeKb?: Record<string, number>;
  /** ffmpeg -benchmark 报告的 maxrss；capture 模式为 null。 */
  ffmpegMaxRssKb: number | null;
  ffmpegCpuS: number | null;
  outputBytes: number | null;
}

export interface CaptureBenchQuality {
  scene: CaptureBenchScene;
  /** frame：同一帧的原始 BGRA 与 JPEG q95（RGB 空间）；final：两条路径经 libx264 后的成片（yuv420p）。 */
  stage: 'frame' | 'final';
  ssimAll: number;
  ssimY: number | null;
  psnrAverage: number;
  psnrMin: number | null;
  samples: number;
}

export interface CaptureBenchEnvironment {
  electron: string;
  chrome: string;
  os: string;
  cpu: string;
  logicalCores: number;
  totalMemoryGb: number;
  ffmpeg: string;
  hardwareAcceleration: boolean;
}

export interface CaptureBenchReport {
  version: typeof CAPTURE_BENCHMARK_VERSION;
  createdAt: string;
  width: number;
  height: number;
  jpegQuality: number;
  /** 采集帧送进 ffmpeg 后的编码参数（输入参数之后、输出路径之前）。 */
  encoderArgs: string[];
  environment: CaptureBenchEnvironment;
  runs: CaptureBenchRawRun[];
  quality: CaptureBenchQuality[];
  /** 全部 case 结束并 GC 后仍存活的 Electron 进程（按类型的 working set KiB 与个数），用来发现窗口 / 会话泄漏。 */
  electronProcessesAfter?: Record<string, { kb: number; count: number }>;
}

// ───────────────────────────── ffmpeg 输出解析 ─────────────────────────────

export interface FfmpegSsim { y: number; u: number; v: number; all: number }
export interface FfmpegPsnr { y: number; u: number; v: number; average: number; min: number; max: number }
export interface FfmpegBench { utimeS: number; stimeS: number; rtimeS: number; maxRssKb: number | null }

const NUMBER = String.raw`(-?\d+(?:\.\d+)?|inf)`;
const toNumber = (value: string): number => (value === 'inf' ? Number.POSITIVE_INFINITY : Number(value));

/** 解析 ssim 滤镜的汇总行：`SSIM Y:0.99 (20.1) U:… V:… All:0.99 (19.8)`（gbrp 输入时为 R/G/B）；有多行时取最后一行。 */
export function parseFfmpegSsim(stderr: string): FfmpegSsim | null {
  const pattern = new RegExp(String.raw`SSIM\s+(?:Y|R):${NUMBER}\s+\([^)]*\)\s+(?:U|G):${NUMBER}\s+\([^)]*\)\s+(?:V|B):${NUMBER}\s+\([^)]*\)\s+All:${NUMBER}`, 'gu');
  let match: RegExpExecArray | null = null;
  for (let next = pattern.exec(stderr); next; next = pattern.exec(stderr)) match = next;
  if (!match) return null;
  return { y: toNumber(match[1]), u: toNumber(match[2]), v: toNumber(match[3]), all: toNumber(match[4]) };
}

/** 解析 psnr 滤镜的汇总行：`PSNR y:41.2 u:… v:… average:42.0 min:39.1 max:inf`（gbrp 输入时通道名为 r/g/b）。 */
export function parseFfmpegPsnr(stderr: string): FfmpegPsnr | null {
  const pattern = new RegExp(String.raw`PSNR\s+(?:y|r):${NUMBER}\s+(?:u|g):${NUMBER}\s+(?:v|b):${NUMBER}\s+average:${NUMBER}\s+min:${NUMBER}\s+max:${NUMBER}`, 'gu');
  let match: RegExpExecArray | null = null;
  for (let next = pattern.exec(stderr); next; next = pattern.exec(stderr)) match = next;
  if (!match) return null;
  return { y: toNumber(match[1]), u: toNumber(match[2]), v: toNumber(match[3]), average: toNumber(match[4]), min: toNumber(match[5]), max: toNumber(match[6]) };
}

/** 解析 `-benchmark` 的 `bench: utime=…s stime=…s rtime=…s` 与 `bench: maxrss=…KiB`。 */
export function parseFfmpegBench(stderr: string): FfmpegBench | null {
  const times = /bench:\s+utime=(\d+(?:\.\d+)?)s\s+stime=(\d+(?:\.\d+)?)s\s+rtime=(\d+(?:\.\d+)?)s/u.exec(stderr);
  if (!times) return null;
  const rss = /bench:\s+maxrss=(\d+)KiB/u.exec(stderr);
  return { utimeS: Number(times[1]), stimeS: Number(times[2]), rtimeS: Number(times[3]), maxRssKb: rss ? Number(rss[1]) : null };
}

// ───────────────────────────── 汇总 ─────────────────────────────

export function median(values: readonly number[]): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const round = (value: number, digits = 2) => (Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : value);

export interface CaptureBenchCaseSummary {
  id: string;
  scene: CaptureBenchScene;
  format: CaptureBenchFormat;
  fps: number;
  frames: number;
  mode: CaptureBenchMode;
  repeats: number;
  /** 稳态采集速度（帧/秒）：(N-1) / loopMs。 */
  loopFps: number;
  /** 端到端速度（帧/秒）：N / wallMs，含建窗、ready、编码器排空。 */
  endToEndFps: number;
  wallMs: number;
  firstFrameMs: number;
  sinkWaitMs: number;
  encoderFlushMs: number;
  avgFrameKb: number;
  /** Electron 峰值 + ffmpeg maxrss（两者峰值未必同时出现，是上界）。 */
  peakMemoryMb: number;
  electronPeakMb: number;
  /** case 开始前的 Electron 基线；peak − baseline 是本 case 带来的增量。 */
  electronBaselineMb: number | null;
  ffmpegMaxRssMb: number | null;
  outputKb: number | null;
}

/** 按 case id 聚合重复测量，取中位数；失败的 run 不计入，但只要有失败就抛错（基准结果不能静默缺项）。 */
export function summarizeCaptureBenchRuns(runs: readonly CaptureBenchRawRun[]): CaptureBenchCaseSummary[] {
  const failures = runs.filter(run => !run.ok);
  if (failures.length) throw new Error(`CAPTURE_BENCH_RUN_FAILED: ${failures.map(run => `${run.id}#${run.repeat}: ${run.error ?? 'unknown'}`).join('; ')}`);
  const groups = new Map<string, CaptureBenchRawRun[]>();
  for (const run of runs) {
    if (run.framesCaptured !== run.frames) throw new Error(`CAPTURE_BENCH_FRAME_COUNT: ${run.id}#${run.repeat} 采到 ${run.framesCaptured}/${run.frames} 帧`);
    groups.set(run.id, [...(groups.get(run.id) ?? []), run]);
  }
  return [...groups.values()].map(group => {
    const [first] = group;
    const pick = (selector: (run: CaptureBenchRawRun) => number) => median(group.map(selector));
    const ffmpegRss = group.every(run => run.ffmpegMaxRssKb !== null) ? pick(run => run.ffmpegMaxRssKb!) : null;
    const output = group.every(run => run.outputBytes !== null) ? pick(run => run.outputBytes!) : null;
    const electronPeakKb = pick(run => run.electronPeakKb);
    return {
      id: first.id,
      scene: first.scene,
      format: first.format,
      fps: first.fps,
      frames: first.frames,
      mode: first.mode,
      repeats: group.length,
      loopFps: round(pick(run => (run.frames > 1 && run.loopMs > 0 ? ((run.frames - 1) * 1000) / run.loopMs : Number.NaN))),
      endToEndFps: round(pick(run => (run.frames * 1000) / run.wallMs)),
      wallMs: Math.round(pick(run => run.wallMs)),
      firstFrameMs: Math.round(pick(run => run.firstFrameMs)),
      sinkWaitMs: Math.round(pick(run => run.sinkWaitMs)),
      encoderFlushMs: Math.round(pick(run => run.encoderFlushMs)),
      avgFrameKb: round(pick(run => run.frameBytesTotal / Math.max(1, run.framesCaptured) / 1024), 1),
      peakMemoryMb: round((electronPeakKb + (ffmpegRss ?? 0)) / 1024, 0),
      electronPeakMb: round(electronPeakKb / 1024, 0),
      electronBaselineMb: group.every(run => typeof run.electronBaselineKb === 'number') ? round(pick(run => run.electronBaselineKb!) / 1024, 0) : null,
      ffmpegMaxRssMb: ffmpegRss === null ? null : round(ffmpegRss / 1024, 0),
      outputKb: output === null ? null : round(output / 1024, 0),
    };
  });
}

export interface CaptureDecisionThresholds {
  /** JPEG 端到端至少要比 BGRA 快这么多（比例）才值得引入有损环节。 */
  minJpegSpeedup: number;
  /** JPEG 路径成片相对 BGRA 路径成片的最低 SSIM（All）。 */
  minFinalSsim: number;
  /** JPEG 路径成片相对 BGRA 路径成片的最低平均 PSNR（dB）。 */
  minFinalPsnr: number;
  /** BGRA 路径的峰值内存上限（MB）；超过则不能作为默认。 */
  maxPeakMemoryMb: number;
  /** 30 fps 相对 24 fps 的总耗时比例上限；超过说明成本不是线性的，默认退回 24。 */
  maxFps30CostRatio: number;
}

export const DEFAULT_CAPTURE_DECISION_THRESHOLDS: Readonly<CaptureDecisionThresholds> = Object.freeze({
  minJpegSpeedup: 0.1,
  minFinalSsim: 0.99,
  minFinalPsnr: 40,
  maxPeakMemoryMb: 3072,
  maxFps30CostRatio: 1.35,
});

export interface CaptureBenchDecision {
  format: CaptureBenchFormat;
  fps: 24 | 30;
  /** BGRA / JPEG 端到端速度比（JPEG ÷ BGRA，按场景取中位数）。 */
  jpegSpeedup: number;
  /** 30 fps ÷ 24 fps 的同时长总耗时比（按格式取中位数）。 */
  fps30CostRatio: number;
  finalSsim: number;
  finalPsnr: number;
  bgraPeakMemoryMb: number;
  jpegPeakMemoryMb: number;
  reasons: string[];
}

function encodeSummary(summaries: readonly CaptureBenchCaseSummary[], scene: CaptureBenchScene, format: CaptureBenchFormat, fps: number) {
  return summaries.find(item => item.mode === 'encode' && item.scene === scene && item.format === format && item.fps === fps);
}

/**
 * 决策规则（写死在这里并由测试锁定，文档里的结论必须与之一致）：
 * - 帧格式：JPEG 只有在“每个场景端到端都至少快 minJpegSpeedup，且成片 SSIM/PSNR 达标”时才是默认；
 *   否则默认 BGRA（无损、少一次编解码、色彩只转换一次）。BGRA 峰值内存超过上限时，即使不够快也改用 JPEG。
 * - fps：同时长下 30/24 的总耗时比不超过 maxFps30CostRatio（≈ 线性的 1.25 加余量）就建议默认 30（HF 与主流平台），
 *   否则建议 24。fps 仍由用户建项目时二选一并锁定（§12 决策 1），这里只给默认值。
 */
export function decideCaptureDefaults(report: Pick<CaptureBenchReport, 'runs' | 'quality'>, thresholds: CaptureDecisionThresholds = DEFAULT_CAPTURE_DECISION_THRESHOLDS): CaptureBenchDecision {
  const summaries = summarizeCaptureBenchRuns(report.runs);
  const scenes = [...new Set(summaries.filter(item => item.mode === 'encode').map(item => item.scene))];
  const speedups: number[] = [];
  const bgraMemory: number[] = [];
  const jpegMemory: number[] = [];
  for (const scene of scenes) {
    for (const fps of [30, 24]) {
      const bgra = encodeSummary(summaries, scene, 'bgra', fps);
      const jpeg = encodeSummary(summaries, scene, 'jpeg', fps);
      if (!bgra || !jpeg) continue;
      speedups.push(jpeg.endToEndFps / bgra.endToEndFps);
      bgraMemory.push(bgra.peakMemoryMb);
      jpegMemory.push(jpeg.peakMemoryMb);
    }
  }
  if (!speedups.length) throw new Error('CAPTURE_BENCH_INCOMPLETE: 缺少同场景同 fps 的 bgra/jpeg encode 对照');
  const ratios: number[] = [];
  for (const scene of scenes) {
    for (const format of ['bgra', 'jpeg'] as const) {
      const at30 = encodeSummary(summaries, scene, format, 30);
      const at24 = encodeSummary(summaries, scene, format, 24);
      if (!at30 || !at24) continue;
      // Normalise to the same scene duration: wall time per second of video.
      ratios.push((at30.wallMs / (at30.frames / 30)) / (at24.wallMs / (at24.frames / 24)));
    }
  }
  if (!ratios.length) throw new Error('CAPTURE_BENCH_INCOMPLETE: 缺少 24 / 30 fps 对照');
  const finals = report.quality.filter(item => item.stage === 'final');
  if (!finals.length) throw new Error('CAPTURE_BENCH_INCOMPLETE: 缺少成片画质对比');

  const minSpeedup = Math.min(...speedups);
  const jpegSpeedup = median(speedups);
  const finalSsim = Math.min(...finals.map(item => item.ssimAll));
  const finalPsnr = Math.min(...finals.map(item => item.psnrAverage));
  const bgraPeakMemoryMb = Math.max(...bgraMemory);
  const jpegPeakMemoryMb = Math.max(...jpegMemory);
  const fps30CostRatio = median(ratios);
  const reasons: string[] = [];

  const qualityOk = finalSsim >= thresholds.minFinalSsim && finalPsnr >= thresholds.minFinalPsnr;
  const fasterEverywhere = minSpeedup >= 1 + thresholds.minJpegSpeedup;
  const bgraMemoryOk = bgraPeakMemoryMb <= thresholds.maxPeakMemoryMb;
  const jpegMemoryOk = jpegPeakMemoryMb <= thresholds.maxPeakMemoryMb;
  const describeSpeed = (ratio: number) => (ratio >= 1 ? `快 ${round((ratio - 1) * 100, 1)}%` : `慢 ${round((1 - ratio) * 100, 1)}%`);
  let format: CaptureBenchFormat;
  if (!bgraMemoryOk && jpegMemoryOk && qualityOk) {
    format = 'jpeg';
    reasons.push(`BGRA 峰值内存 ${bgraPeakMemoryMb} MB 超过上限 ${thresholds.maxPeakMemoryMb} MB，JPEG（${jpegPeakMemoryMb} MB）在上限内且成片画质达标`);
  } else if (fasterEverywhere && qualityOk) {
    format = 'jpeg';
    reasons.push(`JPEG 在所有场景端到端至少${describeSpeed(minSpeedup)}（门槛快 ${thresholds.minJpegSpeedup * 100}%），成片 SSIM ${finalSsim} / PSNR ${finalPsnr} dB 达标`);
  } else {
    format = 'bgra';
    if (!fasterEverywhere) reasons.push(`JPEG 端到端相对 BGRA：最好的一组${describeSpeed(Math.max(...speedups))}、最差${describeSpeed(minSpeedup)}（中位${describeSpeed(jpegSpeedup)}），未达“快 ${thresholds.minJpegSpeedup * 100}%”门槛，不值得多一次有损编解码`);
    if (!qualityOk) reasons.push(`JPEG 成片画质 SSIM ${finalSsim} / PSNR ${finalPsnr} dB 未达门槛（${thresholds.minFinalSsim} / ${thresholds.minFinalPsnr} dB）`);
    reasons.push(bgraMemoryOk
      ? `BGRA 峰值内存 ${bgraPeakMemoryMb} MB 在上限 ${thresholds.maxPeakMemoryMb} MB 内`
      : `BGRA 峰值内存 ${bgraPeakMemoryMb} MB 超过上限 ${thresholds.maxPeakMemoryMb} MB，但 JPEG 也不满足条件（${jpegPeakMemoryMb} MB），需要先降内存`);
  }
  const fps: 24 | 30 = fps30CostRatio <= thresholds.maxFps30CostRatio ? 30 : 24;
  reasons.push(fps === 30
    ? `同时长 30/24 fps 总耗时比 ${round(fps30CostRatio, 3)}（≤ ${thresholds.maxFps30CostRatio}，接近线性 1.25），默认 30`
    : `同时长 30/24 fps 总耗时比 ${round(fps30CostRatio, 3)} 超过 ${thresholds.maxFps30CostRatio}，默认 24`);
  return { format, fps, jpegSpeedup: round(jpegSpeedup, 3), fps30CostRatio: round(fps30CostRatio, 3), finalSsim, finalPsnr, bgraPeakMemoryMb, jpegPeakMemoryMb, reasons };
}

/** 文档里机器可读的决策标记：`<!-- capture-benchmark-decision: {"format":"bgra","fps":30} -->`。 */
export function parseCaptureDecisionMarker(markdown: string): { format: CaptureBenchFormat; fps: 24 | 30 } | null {
  const match = /<!--\s*capture-benchmark-decision:\s*(\{[^}]*\})\s*-->/u.exec(markdown);
  if (!match) return null;
  const value = JSON.parse(match[1]) as { format?: unknown; fps?: unknown };
  if ((value.format !== 'bgra' && value.format !== 'jpeg') || (value.fps !== 24 && value.fps !== 30)) return null;
  return { format: value.format, fps: value.fps };
}
