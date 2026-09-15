import { describe, expect, it } from 'vitest';
import { removeEditorialGreenBackground } from '@shared/editorial-cutout';
import { ipcInputSchemas } from '@shared/ipc-contract';

function fixture(width = 12, height = 12): Uint8Array {
  const bitmap = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      bitmap.set(x >= 3 && x < width - 3 && y >= 3 && y < height - 3
        ? [30, 60, 210, 255]
        : [0, 255, 0, 255], offset);
    }
  }
  return bitmap;
}

function pixel(bitmap: Uint8Array, x: number, y: number, width = 12): number[] {
  return [...bitmap.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];
}

describe('editorial transparent foreground preparation', () => {
  it('removes the green canvas and interior holes while preserving opaque subject detail and the source', () => {
    const source = fixture();
    source.set([0, 255, 0, 255], (6 * 12 + 6) * 4);
    const original = source.slice();

    const result = removeEditorialGreenBackground(source, 12, 12);

    expect(source).toEqual(original);
    expect(pixel(result.bitmap, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(result.bitmap, 6, 6)).toEqual([0, 0, 0, 0]);
    expect(pixel(result.bitmap, 4, 4)).toEqual([30, 60, 210, 255]);
    expect(result.transparentFraction).toBeGreaterThan(0.7);
    expect(result.foregroundFraction).toBeGreaterThan(0.2);
  });

  it('feathers inward and despills the fringe without creating color outside the subject', () => {
    const source = fixture();
    source.set([20, 180, 100, 255], (5 * 12 + 3) * 4);
    const result = removeEditorialGreenBackground(source, 12, 12);

    const fringe = pixel(result.bitmap, 3, 5);
    expect(fringe[3]).toBeGreaterThan(0);
    expect(fringe[3]).toBeLessThan(224);
    expect(fringe[1]).toBe(fringe[2]);
    expect(pixel(result.bitmap, 2, 5)).toEqual([0, 0, 0, 0]);
    const edge = pixel(result.bitmap, 3, 3);
    expect(edge[3]).toBeGreaterThan(190);
    expect(edge[3]).toBeLessThan(255);
    expect(edge[2] / edge[3] * 255).toBeCloseTo(210, 0);
  });

  it('uses premultiplied BGRA correctly for translucent source pixels and returned colors', () => {
    const source = fixture();
    source.set([15, 30, 105, 128], (6 * 12 + 6) * 4);
    source.set([0, 64, 0, 64], (1 * 12 + 1) * 4);
    const result = removeEditorialGreenBackground(source, 12, 12);

    expect(pixel(result.bitmap, 6, 6)).toEqual([15, 30, 105, 128]);
    expect(pixel(result.bitmap, 1, 1)).toEqual([0, 0, 0, 0]);
    for (let offset = 0; offset < result.bitmap.length; offset += 4) {
      for (const channel of result.bitmap.slice(offset, offset + 3)) {
        expect(channel).toBeLessThanOrEqual(result.bitmap[offset + 3]);
      }
    }
  });

  it('retains already transparent backgrounds when the generated subject is valid', () => {
    const source = fixture();
    for (let offset = 0; offset < source.length; offset += 4) {
      if (source[offset + 1] === 255) source.fill(0, offset, offset + 4);
    }
    const result = removeEditorialGreenBackground(source, 12, 12);
    expect(pixel(result.bitmap, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(result.bitmap, 6, 6)).toEqual([30, 60, 210, 255]);
  });

  it('rejects an opaque scene even if it contains a small green object', () => {
    const source = new Uint8Array(12 * 12 * 4);
    for (let offset = 0; offset < source.length; offset += 4) source.set([90, 90, 90, 255], offset);
    for (let y = 3; y < 9; y += 1) {
      for (let x = 3; x < 9; x += 1) source.set([0, 255, 0, 255], (y * 12 + x) * 4);
    }
    expect(() => removeEditorialGreenBackground(source, 12, 12)).toThrow(/BACKGROUND_NOT_ISOLATED/);
  });

  it('rejects images with no foreground or negligible transparent background', () => {
    const empty = new Uint8Array(12 * 12 * 4);
    for (let offset = 0; offset < empty.length; offset += 4) empty.set([0, 255, 0, 255], offset);
    expect(() => removeEditorialGreenBackground(empty, 12, 12)).toThrow(/EMPTY_FOREGROUND/);
    expect(() => removeEditorialGreenBackground(new Uint8Array(empty.length), 12, 12)).toThrow(/EMPTY_FOREGROUND/);
    const opaque = new Uint8Array(empty.length).fill(255);
    expect(() => removeEditorialGreenBackground(opaque, 12, 12)).toThrow(/BACKGROUND_NOT_ISOLATED/);
  });

  it('rejects invalid dimensions and incomplete bitmap data', () => {
    expect(() => removeEditorialGreenBackground(fixture(), 0, 12)).toThrow(/INVALID_BITMAP/);
    expect(() => removeEditorialGreenBackground(fixture(), 12, 11)).toThrow(/INVALID_BITMAP/);
    expect(() => removeEditorialGreenBackground(fixture(), 12.5, 12)).toThrow(/INVALID_BITMAP/);
  });

  it('accepts optional green cutout requests without changing normal generation contracts', () => {
    const input = { prompt: 'Isolated red bird', ratio: '1:1', style: '' };
    const schema = ipcInputSchemas['image-lab:generate'];
    expect(schema.parse(input)).toEqual(input);
    expect(schema.parse({ ...input, cutout: 'green' })).toEqual({ ...input, cutout: 'green' });
    expect(() => schema.parse({ ...input, cutout: 'automatic' })).toThrow();
  });
});
