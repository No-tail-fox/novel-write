import { describe, expect, it } from 'vitest';
import {
  averageHash,
  compareGoldenFrame,
  differenceHash,
  downsampleLuma,
  frameMeanLuma,
  goldenFrameHashes,
  hammingDistance,
  type RawFrame,
} from '../src/shared/frame-hash';

type Pixel = [number, number, number, number?];

function synth(width: number, height: number, pixel: (x: number, y: number) => Pixel, options: { channels?: 'rgba' | 'bgra'; padding?: number } = {}): RawFrame {
  const stride = width * 4 + (options.padding ?? 0);
  const data = new Uint8Array(stride * height).fill(77);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a = 255] = pixel(x, y);
      const offset = y * stride + x * 4;
      if (options.channels === 'bgra') { data[offset] = b; data[offset + 2] = r; } else { data[offset] = r; data[offset + 2] = b; }
      data[offset + 1] = g;
      data[offset + 3] = a;
    }
  }
  return { data, width, height, channels: options.channels ?? 'rgba', ...(options.padding ? { stride } : {}) };
}

/** 可复现的伪随机噪声（测试内用）。 */
function noise(seed: number) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
}

const gradient = (x: number, y: number): Pixel => {
  const v = Math.round(((x / 63) * 0.7 + (y / 35) * 0.3) * 255);
  return [v, v, v];
};

describe('frame hashes on synthetic buffers', () => {
  it('solid frames hash to zero bits; mean luma separates black from white', () => {
    const black = synth(16, 16, () => [0, 0, 0]);
    const white = synth(16, 16, () => [255, 255, 255]);
    expect(averageHash(black).hex).toBe('0000000000000000');
    expect(differenceHash(white).hex).toBe('0000000000000000');
    expect(frameMeanLuma(black)).toBe(0);
    expect(frameMeanLuma(white)).toBeCloseTo(255, 6);
    const comparison = compareGoldenFrame(goldenFrameHashes(black), goldenFrameHashes(white));
    expect(comparison.match).toBe(false);
    expect(comparison.ahashDistance).toBe(0);
    expect(comparison.reasons.join()).toMatch(/平均亮度/u);
  });

  it('a left-white / right-black split has the expected aHash and dHash bit patterns', () => {
    const split = synth(64, 32, x => (x < 32 ? [255, 255, 255] : [0, 0, 0]));
    expect(averageHash(split).hex).toBe('f0'.repeat(8));
    // dHash grid is 9 columns wide: cell 4 (x 28–34) is half white, so both white→mixed and mixed→black set a bit (0b00011000).
    expect(differenceHash(split).hex).toBe('18'.repeat(8));
  });

  it('BGRA and RGBA buffers of the same picture hash identically; channel order matters for colour', () => {
    const picture = (x: number, y: number): Pixel => [x * 4, y * 7, 255 - x * 4];
    const rgba = synth(64, 36, picture);
    const bgra = synth(64, 36, picture, { channels: 'bgra' });
    expect(goldenFrameHashes(bgra)).toEqual(goldenFrameHashes(rgba));
    const red = synth(8, 8, () => [255, 0, 0]);
    expect(frameMeanLuma(red)).toBeCloseTo(0.299 * 255, 6);
    expect(frameMeanLuma({ ...red, channels: 'bgra' })).toBeCloseTo(0.114 * 255, 6);
  });

  it('honours row stride (padded rows) and composites alpha over black', () => {
    const plain = synth(40, 20, gradient);
    const padded = synth(40, 20, gradient, { padding: 12 });
    expect(goldenFrameHashes(padded)).toEqual(goldenFrameHashes(plain));
    const transparent = synth(8, 8, () => [255, 255, 255, 0]);
    expect(frameMeanLuma(transparent)).toBe(0);
  });

  it('small encoding noise stays within the default 2-bit tolerance; real changes do not', () => {
    const golden = goldenFrameHashes(synth(64, 36, gradient));
    const random = noise(7);
    const noisy = synth(64, 36, (x, y) => gradient(x, y).map((v, i) => (i < 3 ? Math.max(0, Math.min(255, (v as number) + Math.round((random() - 0.5) * 6))) : v)) as Pixel);
    const close = compareGoldenFrame(goldenFrameHashes(noisy), golden);
    expect(close.match, close.reasons.join()).toBe(true);
    expect(close.ahashDistance).toBeLessThanOrEqual(2);

    const mirrored = goldenFrameHashes(synth(64, 36, (x, y) => gradient(63 - x, y)));
    const far = compareGoldenFrame(mirrored, golden);
    expect(far.match).toBe(false);
    expect(far.ahashDistance).toBeGreaterThan(10);

    const moved = goldenFrameHashes(synth(64, 36, (x, y) => (x >= 20 && x < 36 && y >= 10 && y < 26 ? [255, 255, 255] : [20, 20, 20])));
    const movedMore = goldenFrameHashes(synth(64, 36, (x, y) => (x >= 40 && x < 56 && y >= 10 && y < 26 ? [255, 255, 255] : [20, 20, 20])));
    expect(compareGoldenFrame(moved, movedMore).match).toBe(false);
  });

  it('tolerances are configurable and validated', () => {
    const a = { ahash: 'ff00ff00ff00ff00', dhash: '0000000000000000', meanLuma: 100 };
    const b = { ahash: 'ff00ff00ff00ff07', dhash: '0000000000000000', meanLuma: 103 };
    expect(compareGoldenFrame(b, a).match).toBe(false);
    expect(compareGoldenFrame(b, a, { maxBits: 3 }).match).toBe(true);
    expect(compareGoldenFrame(b, a, { maxBits: 3, maxMeanLumaDelta: 2 }).match).toBe(false);
    expect(() => compareGoldenFrame(a, b, { maxBits: -1 })).toThrow(/TOLERANCE/u);
  });

  it('hamming distance counts differing bits and rejects incompatible hashes', () => {
    expect(hammingDistance('00', '00')).toBe(0);
    expect(hammingDistance('0f', 'f0')).toBe(8);
    expect(hammingDistance('A1', 'a0')).toBe(1);
    expect(() => hammingDistance('00', '000')).toThrow(/FRAME_HASH_MISMATCHED/u);
    expect(() => hammingDistance('zz', '00')).toThrow(/FRAME_HASH_MISMATCHED/u);
  });

  it('downsamples by area average and upsamples tiny frames without crashing', () => {
    const tiny = synth(2, 1, x => (x === 0 ? [255, 255, 255] : [0, 0, 0]));
    expect(Array.from(downsampleLuma(tiny, 4, 2)).map(v => Math.round(v))).toEqual([255, 255, 0, 0, 255, 255, 0, 0]);
    const checker = synth(4, 4, (x, y) => ((x + y) % 2 ? [255, 255, 255] : [0, 0, 0]));
    expect(Array.from(downsampleLuma(checker, 1, 1))[0]).toBeCloseTo(127.5, 6);
    expect(averageHash(tiny, 4).hex).toHaveLength(4);
    expect(averageHash(synth(64, 64, gradient), 16).hex).toHaveLength(64);
  });

  it('rejects malformed frames', () => {
    expect(() => averageHash({ data: new Uint8Array(10), width: 2, height: 2 })).toThrow(/FRAME_HASH_BUFFER_SHORT/u);
    expect(() => averageHash({ data: new Uint8Array(16), width: 0, height: 2 })).toThrow(/FRAME_HASH_SIZE_INVALID/u);
    expect(() => averageHash({ data: new Uint8Array(64), width: 2, height: 2, stride: 4 })).toThrow(/FRAME_HASH_STRIDE_INVALID/u);
    expect(() => averageHash({ data: new Uint8Array(16), width: 2, height: 2, channels: 'argb' as never })).toThrow(/CHANNELS/u);
    expect(() => averageHash(synth(4, 4, gradient), 1)).toThrow(/FRAME_HASH_GRID_INVALID/u);
  });
});
