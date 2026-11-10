/**
 * Lemo 预览一致性（backlog L-6，docs/design/2026-11-09-lemo-faithful-mode.md §6）：同一时刻 t，
 * 上游 `core/render/still.mjs`（Playwright + chromium-headless-shell，JPEG q92）截一帧，应用内预览
 * （`reviewLemoUpstreamProject`：Electron offscreen + 本机 HTTP + 私有 partition）和新架构 CaptureHost（lemo 适配器）
 * 各截一帧，比较感知哈希（src/shared/frame-hash.ts）。
 *
 * 本文件只放纯函数：时间点列表、帧比较、阈值判定、报告组装。真正跑浏览器的部分在 scripts/lemo-preview-consistency.ts。
 *
 * 阈值（LEMO_PREVIEW_CONSISTENCY_TOLERANCE）：8×8 aHash 和 dHash 各自 ≤ 3 位（64 位里），平均亮度差 ≤ 3（0–255）。
 * 依据：同一 Chromium 内的黄金帧容差是 2 位 / 亮度 6（frame-hash.ts，底座 §10.3）；这里两边是不同的 Chromium 构建
 * （headless shell vs Electron 自带）而且上游一侧多一次 JPEG q92 有损编码，所以哈希多放 1 位；亮度收紧到 3，
 * 因为画面内容完全相同，只应有编码噪声。另有“区分度”检查：参考帧之间（不同 t）至少要差 maxBits+1 位，
 * 否则夹具分辨不出时间语义错误（秒/毫秒、帧号/秒），判定无效。
 */
import { compareGoldenFrame, goldenFrameHashes, type GoldenFrameHashes, type GoldenFrameTolerance, type RawFrame } from './frame-hash';

export const LEMO_PREVIEW_CONSISTENCY_VERSION = 1 as const;

export const LEMO_PREVIEW_CONSISTENCY_TOLERANCE: Readonly<Required<GoldenFrameTolerance>> = Object.freeze({ maxBits: 3, maxMeanLumaDelta: 3 });

/** 参考侧（上游 still.mjs）和两条应用侧路径。 */
export const PREVIEW_CONSISTENCY_SIDES = ['upstream-still', 'app-preview', 'capture-host'] as const;
export type PreviewConsistencySide = (typeof PREVIEW_CONSISTENCY_SIDES)[number];
export const PREVIEW_CONSISTENCY_REFERENCE: PreviewConsistencySide = 'upstream-still';

export interface PreviewConsistencyTimesOptions {
  durationSeconds: number;
  fps: number;
  /** 采样个数（含首帧和末帧），默认 5。 */
  count?: number;
}

/** 整片帧数，与上游 video.mjs / SceneRuntime 一致：round(DUR × fps)，至少 1。 */
export function previewConsistencyTotalFrames(durationSeconds: number, fps: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new RangeError(`LEMO_PREVIEW_DURATION_INVALID: ${String(durationSeconds)}`);
  if (!Number.isFinite(fps) || fps <= 0 || fps > 240) throw new RangeError(`LEMO_PREVIEW_FPS_INVALID: ${String(fps)}`);
  return Math.max(1, Math.round(durationSeconds * fps));
}

/**
 * 均匀分布、对齐到帧的采样时刻（秒）：帧号 round(i × (N−1)/(count−1))，t = 帧号 / fps。
 * 对齐到帧是因为 CaptureHost 只能 seek 整数帧；`String(t)` 能无损往返（still.mjs 用 parseFloat 读回同一个 double）。
 */
export function buildPreviewConsistencyTimes(options: PreviewConsistencyTimesOptions): number[] {
  const total = previewConsistencyTotalFrames(options.durationSeconds, options.fps);
  const count = options.count ?? 5;
  if (!Number.isSafeInteger(count) || count < 1) throw new RangeError(`LEMO_PREVIEW_COUNT_INVALID: ${String(count)}`);
  const n = Math.min(count, total);
  const frames = n === 1 ? [0] : Array.from({ length: n }, (_, index) => Math.round((index * (total - 1)) / (n - 1)));
  return [...new Set(frames)].map(frame => frame / options.fps);
}

/** t（秒）→ 整数帧号；t 不在帧网格上（误差 > 1e-6 帧）时抛错，避免两边实际渲染的时刻不同。 */
export function previewConsistencyFrameForTime(time: number, fps: number): number {
  if (!Number.isFinite(time) || time < 0) throw new RangeError(`LEMO_PREVIEW_TIME_INVALID: ${String(time)}`);
  const exact = time * fps;
  const frame = Math.round(exact);
  if (Math.abs(exact - frame) > 1e-6) throw new RangeError(`LEMO_PREVIEW_TIME_NOT_FRAME_ALIGNED: t=${time}s 不在 ${fps} fps 的帧网格上`);
  return frame;
}

/** 校验用户给定的时间点：有限、非负、< DUR、对齐到帧、不重复。 */
export function validatePreviewConsistencyTimes(times: readonly number[], durationSeconds: number, fps: number): number[] {
  if (!times.length) throw new RangeError('LEMO_PREVIEW_TIMES_EMPTY: 至少需要一个时间点');
  previewConsistencyTotalFrames(durationSeconds, fps);
  const seen = new Set<number>();
  for (const time of times) {
    previewConsistencyFrameForTime(time, fps);
    if (time >= durationSeconds) throw new RangeError(`LEMO_PREVIEW_TIME_OUTSIDE_FILM: ${time} >= ${durationSeconds}`);
    if (seen.has(time)) throw new RangeError(`LEMO_PREVIEW_TIME_DUPLICATE: ${time}`);
    seen.add(time);
  }
  return [...times];
}

/** 两帧逐像素 RGB 平均绝对差（0–255）；尺寸不同返回 null。仅作诊断，不参与判定。 */
export function meanAbsolutePixelDifference(a: RawFrame, b: RawFrame): number | null {
  if (a.width !== b.width || a.height !== b.height) return null;
  const strideA = a.stride ?? a.width * 4;
  const strideB = b.stride ?? b.width * 4;
  if (a.data.length < strideA * (a.height - 1) + a.width * 4 || b.data.length < strideB * (b.height - 1) + b.width * 4) {
    throw new RangeError('LEMO_PREVIEW_BUFFER_SHORT: 像素缓冲小于画面尺寸');
  }
  const channel = (frame: RawFrame, base: number, which: 0 | 1 | 2) => {
    const bgra = (frame.channels ?? 'rgba') === 'bgra';
    const index = which === 1 ? 1 : (which === 0) === bgra ? 2 : 0;
    return frame.data[base + index];
  };
  let sum = 0;
  for (let y = 0; y < a.height; y += 1) {
    for (let x = 0; x < a.width; x += 1) {
      const pa = y * strideA + x * 4;
      const pb = y * strideB + x * 4;
      for (const which of [0, 1, 2] as const) sum += Math.abs(channel(a, pa, which) - channel(b, pb, which));
    }
  }
  return Math.round((sum / (a.width * a.height * 3)) * 100) / 100;
}

export interface PreviewConsistencyFrameInput {
  side: PreviewConsistencySide;
  time: number;
  frame: RawFrame;
}

export interface PreviewConsistencyFrameRecord extends GoldenFrameHashes {
  side: PreviewConsistencySide;
  time: number;
  width: number;
  height: number;
}

export interface PreviewConsistencyPair {
  time: number;
  a: PreviewConsistencySide;
  b: PreviewConsistencySide;
  /** 只有“参考侧 vs 应用侧”的配对参与判定；两条应用侧路径之间的配对仅供诊断。 */
  gating: boolean;
  ahashDistance: number;
  dhashDistance: number;
  meanLumaDelta: number;
  meanAbsDiff: number | null;
  sizeMatch: boolean;
  match: boolean;
  reasons: string[];
}

export interface PreviewConsistencyDiscrimination {
  /** 参考侧不同时刻之间 max(aHash, dHash) 距离的最小值；只有一个时刻时为 null。 */
  minCrossTimeBits: number | null;
  discriminative: boolean;
}

/** 单对帧比较：尺寸不同直接不一致（不缩放）；否则 aHash/dHash/平均亮度按容差判定。 */
export function comparePreviewConsistencyFrames(
  a: PreviewConsistencyFrameRecord,
  b: PreviewConsistencyFrameRecord,
  meanAbsDiff: number | null,
  tolerance: GoldenFrameTolerance = LEMO_PREVIEW_CONSISTENCY_TOLERANCE,
): PreviewConsistencyPair {
  const comparison = compareGoldenFrame(b, a, tolerance);
  const sizeMatch = a.width === b.width && a.height === b.height;
  const reasons = [...comparison.reasons];
  if (!sizeMatch) reasons.unshift(`尺寸不同：${a.side} ${a.width}x${a.height}，${b.side} ${b.width}x${b.height}`);
  return {
    time: a.time,
    a: a.side,
    b: b.side,
    gating: a.side === PREVIEW_CONSISTENCY_REFERENCE,
    ahashDistance: comparison.ahashDistance,
    dhashDistance: comparison.dhashDistance,
    meanLumaDelta: comparison.meanLumaDelta,
    meanAbsDiff,
    sizeMatch,
    match: sizeMatch && comparison.match,
    reasons,
  };
}

/** 参考侧不同时刻之间的最小距离；必须 > maxBits，否则这组时间点/夹具分辨不出时间语义错误。 */
export function previewConsistencyDiscrimination(reference: readonly PreviewConsistencyFrameRecord[], maxBits: number): PreviewConsistencyDiscrimination {
  let min: number | null = null;
  for (let i = 0; i < reference.length; i += 1) {
    for (let j = i + 1; j < reference.length; j += 1) {
      const comparison = compareGoldenFrame(reference[i], reference[j], { maxBits: 64, maxMeanLumaDelta: 255 });
      const bits = Math.max(comparison.ahashDistance, comparison.dhashDistance);
      if (min === null || bits < min) min = bits;
    }
  }
  return { minCrossTimeBits: min, discriminative: min === null || min > maxBits };
}

export type PreviewConsistencyStatus = 'pass' | 'fail' | 'skip';

export interface PreviewConsistencyReport {
  version: typeof LEMO_PREVIEW_CONSISTENCY_VERSION;
  status: PreviewConsistencyStatus;
  skipReason?: string;
  generatedAt: string;
  tolerance: Required<GoldenFrameTolerance>;
  canvas: { width: number; height: number; fps: number; durationSeconds: number };
  times: number[];
  /** 参与比较的侧（跳过时为空）。 */
  sides: PreviewConsistencySide[];
  /** 页面 / 运行时 / 浏览器版本等环境信息（由调用方填写，原样写入）。 */
  environment: Record<string, unknown>;
  frames: PreviewConsistencyFrameRecord[];
  pairs: PreviewConsistencyPair[];
  discrimination: PreviewConsistencyDiscrimination | null;
  /** 参考侧 vs 应用侧的最大距离（便于一眼看结论）。 */
  worst: { ahashDistance: number; dhashDistance: number; meanLumaDelta: number; meanAbsDiff: number | null } | null;
  failures: string[];
  notes: string[];
}

export interface PreviewConsistencyReportInput {
  canvas: PreviewConsistencyReport['canvas'];
  times: readonly number[];
  frames: readonly PreviewConsistencyFrameInput[];
  tolerance?: Required<GoldenFrameTolerance>;
  environment?: Record<string, unknown>;
  notes?: string[];
  now?: () => Date;
}

/** 由三侧原始帧组装报告并判定：每个时刻每条应用侧路径都必须与参考帧一致，且参考帧之间有区分度。 */
export function buildPreviewConsistencyReport(input: PreviewConsistencyReportInput): PreviewConsistencyReport {
  const tolerance = input.tolerance ?? { ...LEMO_PREVIEW_CONSISTENCY_TOLERANCE };
  const failures: string[] = [];
  const records: PreviewConsistencyFrameRecord[] = [];
  const raw = new Map<string, RawFrame>();
  const key = (side: PreviewConsistencySide, time: number) => `${side}@${time}`;
  for (const item of input.frames) {
    if (raw.has(key(item.side, item.time))) throw new RangeError(`LEMO_PREVIEW_FRAME_DUPLICATE: ${item.side}@${item.time}`);
    raw.set(key(item.side, item.time), item.frame);
    records.push({ side: item.side, time: item.time, width: item.frame.width, height: item.frame.height, ...goldenFrameHashes(item.frame) });
  }
  const sides = PREVIEW_CONSISTENCY_SIDES.filter(side => records.some(record => record.side === side));
  const record = (side: PreviewConsistencySide, time: number) => records.find(item => item.side === side && item.time === time);
  const pairs: PreviewConsistencyPair[] = [];
  const pairings: Array<[PreviewConsistencySide, PreviewConsistencySide]> = [
    ['upstream-still', 'app-preview'],
    ['upstream-still', 'capture-host'],
    ['app-preview', 'capture-host'],
  ];
  if (!sides.includes(PREVIEW_CONSISTENCY_REFERENCE)) failures.push('缺少参考侧（upstream-still）帧');
  if (!sides.some(side => side !== PREVIEW_CONSISTENCY_REFERENCE)) failures.push('缺少应用侧（app-preview / capture-host）帧');
  for (const time of input.times) {
    for (const side of sides) if (!record(side, time)) failures.push(`${side} 缺少 t=${time} 的帧`);
    for (const [a, b] of pairings) {
      const ra = record(a, time);
      const rb = record(b, time);
      if (!ra || !rb) continue;
      const pair = comparePreviewConsistencyFrames(ra, rb, meanAbsolutePixelDifference(raw.get(key(a, time))!, raw.get(key(b, time))!), tolerance);
      pairs.push(pair);
      if (pair.gating && !pair.match) failures.push(`t=${time}s ${a} vs ${b}：${pair.reasons.join('；')}`);
    }
  }
  const reference = input.times.map(time => record(PREVIEW_CONSISTENCY_REFERENCE, time)).filter((item): item is PreviewConsistencyFrameRecord => !!item);
  const discrimination = reference.length ? previewConsistencyDiscrimination(reference, tolerance.maxBits) : null;
  if (discrimination && !discrimination.discriminative) {
    failures.push(`参考帧之间区分度不足：不同时刻最小距离 ${discrimination.minCrossTimeBits} 位 ≤ 容差 ${tolerance.maxBits}，无法发现时间语义错误`);
  }
  const gating = pairs.filter(pair => pair.gating);
  const diffs = gating.map(pair => pair.meanAbsDiff).filter((value): value is number => value !== null);
  const worst = gating.length ? {
    ahashDistance: Math.max(...gating.map(pair => pair.ahashDistance)),
    dhashDistance: Math.max(...gating.map(pair => pair.dhashDistance)),
    meanLumaDelta: Math.max(...gating.map(pair => pair.meanLumaDelta)),
    meanAbsDiff: diffs.length ? Math.max(...diffs) : null,
  } : null;
  return {
    version: LEMO_PREVIEW_CONSISTENCY_VERSION,
    status: failures.length ? 'fail' : 'pass',
    generatedAt: (input.now?.() ?? new Date()).toISOString(),
    tolerance,
    canvas: { ...input.canvas },
    times: [...input.times],
    sides,
    environment: { ...input.environment },
    frames: records,
    pairs,
    discrimination,
    worst,
    failures,
    notes: [...(input.notes ?? [])],
  };
}

/** 前置条件缺失（浏览器、运行时、Electron）时的报告：status=skip 并写明原因，不当作失败。 */
export function skippedPreviewConsistencyReport(reason: string, input: Omit<PreviewConsistencyReportInput, 'frames'>): PreviewConsistencyReport {
  return {
    version: LEMO_PREVIEW_CONSISTENCY_VERSION,
    status: 'skip',
    skipReason: reason,
    generatedAt: (input.now?.() ?? new Date()).toISOString(),
    tolerance: input.tolerance ?? { ...LEMO_PREVIEW_CONSISTENCY_TOLERANCE },
    canvas: { ...input.canvas },
    times: [...input.times],
    sides: [],
    environment: { ...input.environment },
    frames: [],
    pairs: [],
    discrimination: null,
    worst: null,
    failures: [],
    notes: [...(input.notes ?? [])],
  };
}

/** still.mjs 失败输出里表示“浏览器本身起不来”的特征（缺可执行文件 / 启动失败）→ 报告 skip 而不是失败。 */
export function upstreamBrowserUnavailableReason(stderr: string): string | null {
  const line = stderr.split(/\r?\n/u).find(text => /Executable doesn't exist|browserType\.launch|Failed to launch|Cannot find module 'playwright-core'|ERR_MODULE_NOT_FOUND[^\n]*playwright/iu.test(text));
  return line ? `上游 still.mjs 无法启动无头浏览器：${line.trim().slice(0, 300)}` : null;
}
