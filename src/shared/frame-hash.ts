/**
 * 黄金帧比较（backlog Q-5，底座 §10.3）：感知哈希 + 汉明距离容差。纯函数，不依赖 Node / Electron / 图像库。
 *
 * - `averageHash`（aHash）：缩成 size×size 灰度块，按均值二值化。对整体亮度/构图敏感，对轻微抗锯齿、编码噪声不敏感。
 * - `differenceHash`（dHash）：缩成 (size+1)×size，比较水平相邻块的明暗。对渐变方向、位移更敏感。
 * - 黄金帧默认两者都比，任何一个超出容差即判定不一致（底座要求“允许 1–2 位差异”，默认容差 2 位 / 64 位）。
 *
 * 输入是原始像素：RGBA（Canvas / 测试）或 BGRA（Electron `NativeImage.toBitmap()`），每像素 4 字节，可带行跨度。
 * 透明像素按“合成到黑底”处理（采集帧本来就是不透明的）。
 */

export type PixelChannelOrder = 'rgba' | 'bgra';

export interface RawFrame {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  /** 默认 rgba。Electron capturePage().toBitmap() 是 bgra。 */
  channels?: PixelChannelOrder;
  /** 每行字节数，默认 width × 4。 */
  stride?: number;
}

export interface FrameHash {
  algorithm: 'ahash' | 'dhash';
  /** 边长（8 → 64 位）。 */
  size: number;
  /** 十六进制位串，长度 = ceil(size² / 4)；高位在前，按行优先。 */
  hex: string;
}

function validateFrame(frame: RawFrame): { stride: number; order: PixelChannelOrder } {
  const { width, height, data } = frame;
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw new RangeError(`FRAME_HASH_SIZE_INVALID: 画面尺寸必须是正整数（${String(width)}x${String(height)}）`);
  }
  const stride = frame.stride ?? width * 4;
  if (!Number.isSafeInteger(stride) || stride < width * 4) throw new RangeError(`FRAME_HASH_STRIDE_INVALID: 行跨度 ${String(stride)} 小于 ${width * 4}`);
  const needed = stride * (height - 1) + width * 4;
  if (data.length < needed) throw new RangeError(`FRAME_HASH_BUFFER_SHORT: 像素缓冲 ${data.length} 字节，至少需要 ${needed}`);
  const order = frame.channels ?? 'rgba';
  if (order !== 'rgba' && order !== 'bgra') throw new RangeError(`FRAME_HASH_CHANNELS_INVALID: ${String(order)}`);
  return { stride, order };
}

/** 单个像素的亮度（Rec.601 权重，0–255），alpha 合成到黑底。 */
function luma(data: RawFrame['data'], offset: number, order: PixelChannelOrder): number {
  const r = order === 'rgba' ? data[offset] : data[offset + 2];
  const g = data[offset + 1];
  const b = order === 'rgba' ? data[offset + 2] : data[offset];
  const a = data[offset + 3];
  return ((0.299 * r + 0.587 * g + 0.114 * b) * a) / 255;
}

/**
 * 面积平均缩小到 cols×rows 灰度格（每格取其覆盖的源像素均值；源比目标小时最近邻放大）。
 * 返回行优先的 Float64Array。
 */
export function downsampleLuma(frame: RawFrame, cols: number, rows: number): Float64Array {
  const { stride, order } = validateFrame(frame);
  if (!Number.isSafeInteger(cols) || cols < 1 || !Number.isSafeInteger(rows) || rows < 1) throw new RangeError('FRAME_HASH_GRID_INVALID: 网格尺寸必须是正整数');
  const out = new Float64Array(cols * rows);
  for (let row = 0; row < rows; row += 1) {
    const y0 = Math.floor((row * frame.height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * frame.height) / rows));
    for (let col = 0; col < cols; col += 1) {
      const x0 = Math.floor((col * frame.width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((col + 1) * frame.width) / cols));
      let sum = 0;
      for (let y = y0; y < y1; y += 1) {
        const rowOffset = y * stride;
        for (let x = x0; x < x1; x += 1) sum += luma(frame.data, rowOffset + x * 4, order);
      }
      out[row * cols + col] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

function bitsToHex(bits: readonly boolean[]): string {
  let hex = '';
  for (let index = 0; index < bits.length; index += 4) {
    let nibble = 0;
    for (let bit = 0; bit < 4; bit += 1) nibble = (nibble << 1) | (bits[index + bit] ? 1 : 0);
    hex += nibble.toString(16);
  }
  return hex;
}

function assertHashSize(size: number) {
  if (!Number.isSafeInteger(size) || size < 2 || size > 64) throw new RangeError('FRAME_HASH_GRID_INVALID: 哈希边长必须是 2–64 的整数');
}

/** aHash：格值 > 均值记 1。纯色画面全 0。 */
export function averageHash(frame: RawFrame, size = 8): FrameHash {
  assertHashSize(size);
  const grid = downsampleLuma(frame, size, size);
  let mean = 0;
  for (const value of grid) mean += value;
  mean /= grid.length;
  return { algorithm: 'ahash', size, hex: bitsToHex(Array.from(grid, value => value > mean)) };
}

/** dHash：同一行里左格比右格亮记 1。 */
export function differenceHash(frame: RawFrame, size = 8): FrameHash {
  assertHashSize(size);
  const grid = downsampleLuma(frame, size + 1, size);
  const bits: boolean[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) bits.push(grid[row * (size + 1) + col] > grid[row * (size + 1) + col + 1]);
  }
  return { algorithm: 'dhash', size, hex: bitsToHex(bits) };
}

/** 两个十六进制位串的汉明距离（长度必须相同）。 */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length || !/^[0-9a-f]*$/iu.test(a) || !/^[0-9a-f]*$/iu.test(b)) throw new RangeError('FRAME_HASH_MISMATCHED: 只能比较同长度的十六进制哈希');
  let distance = 0;
  for (let index = 0; index < a.length; index += 1) {
    let diff = parseInt(a[index], 16) ^ parseInt(b[index], 16);
    while (diff) { distance += diff & 1; diff >>= 1; }
  }
  return distance;
}

export interface GoldenFrameHashes {
  ahash: string;
  dhash: string;
  /** 平均亮度（0–255，保留 1 位小数），用来区分“全黑 / 全白”这类哈希相同但画面完全不同的情况。 */
  meanLuma: number;
}

export function frameMeanLuma(frame: RawFrame): number {
  const { stride, order } = validateFrame(frame);
  let sum = 0;
  for (let y = 0; y < frame.height; y += 1) for (let x = 0; x < frame.width; x += 1) sum += luma(frame.data, y * stride + x * 4, order);
  return sum / (frame.width * frame.height);
}

/** 计算一帧的黄金指纹（8×8 aHash + dHash + 平均亮度）。 */
export function goldenFrameHashes(frame: RawFrame, size = 8): GoldenFrameHashes {
  return {
    ahash: averageHash(frame, size).hex,
    dhash: differenceHash(frame, size).hex,
    meanLuma: Math.round(frameMeanLuma(frame) * 10) / 10,
  };
}

export interface GoldenFrameTolerance {
  /** 允许的 aHash / dHash 汉明距离（默认 2，底座 §10.3“允许 1–2 位差异”）。 */
  maxBits?: number;
  /** 允许的平均亮度差（0–255，默认 6）。 */
  maxMeanLumaDelta?: number;
}

export interface GoldenFrameComparison {
  match: boolean;
  ahashDistance: number;
  dhashDistance: number;
  meanLumaDelta: number;
  /** 不一致时的中文原因（match 为 true 时为空数组）。 */
  reasons: string[];
}

export function compareGoldenFrame(actual: GoldenFrameHashes, golden: GoldenFrameHashes, tolerance: GoldenFrameTolerance = {}): GoldenFrameComparison {
  const maxBits = tolerance.maxBits ?? 2;
  const maxLuma = tolerance.maxMeanLumaDelta ?? 6;
  if (!Number.isSafeInteger(maxBits) || maxBits < 0) throw new RangeError('FRAME_HASH_TOLERANCE_INVALID: maxBits 必须是非负整数');
  if (!Number.isFinite(maxLuma) || maxLuma < 0) throw new RangeError('FRAME_HASH_TOLERANCE_INVALID: maxMeanLumaDelta 必须是非负数');
  const ahashDistance = hammingDistance(actual.ahash, golden.ahash);
  const dhashDistance = hammingDistance(actual.dhash, golden.dhash);
  const meanLumaDelta = Math.round(Math.abs(actual.meanLuma - golden.meanLuma) * 10) / 10;
  const reasons: string[] = [];
  if (ahashDistance > maxBits) reasons.push(`aHash 相差 ${ahashDistance} 位（容差 ${maxBits}）`);
  if (dhashDistance > maxBits) reasons.push(`dHash 相差 ${dhashDistance} 位（容差 ${maxBits}）`);
  if (meanLumaDelta > maxLuma) reasons.push(`平均亮度相差 ${meanLumaDelta}（容差 ${maxLuma}）`);
  return { match: reasons.length === 0, ahashDistance, dhashDistance, meanLumaDelta, reasons };
}
