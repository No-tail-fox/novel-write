export interface EditorialGreenCutoutResult {
  /** Electron nativeImage bitmap: BGRA with premultiplied color channels. */
  bitmap: Uint8Array;
  transparentFraction: number;
  foregroundFraction: number;
}

const smoothstep = (minimum: number, maximum: number, value: number): number => {
  const amount = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  return amount * amount * (3 - 2 * amount);
};

/**
 * Prepare an isolated subject generated on a flat #00FF00 background. The subject
 * prompt must exclude green clothing/materials: this deterministic chroma key is
 * deliberately not a general-purpose segmentation model. Input is never mutated.
 */
export function removeEditorialGreenBackground(
  source: Uint8Array,
  width: number,
  height: number,
): EditorialGreenCutoutResult {
  const pixels = width * height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 2 || height < 2
    || !Number.isSafeInteger(pixels) || source.length !== pixels * 4) {
    throw new Error('EDITORIAL_CUTOUT_INVALID_BITMAP: The foreground image could not be decoded.');
  }

  const matte = new Uint8Array(pixels);
  let transparentPixels = 0;
  let foregroundPixels = 0;
  let transparentBorderPixels = 0;
  const borderPixels = width * 2 + (height - 2) * 2;

  for (let pixel = 0; pixel < pixels; pixel += 1) {
    const offset = pixel * 4;
    const originalAlpha = source[offset + 3];
    // nativeImage pixels are premultiplied. Keying those values directly would
    // mistake partially transparent green for dark subject colors.
    const unpremultiply = originalAlpha ? 255 / originalAlpha : 0;
    const blue = Math.min(255, source[offset] * unpremultiply);
    const green = Math.min(255, source[offset + 1] * unpremultiply);
    const red = Math.min(255, source[offset + 2] * unpremultiply);
    const dominance = green - Math.max(red, blue);
    const removal = smoothstep(24, 130, dominance) * smoothstep(70, 150, green);
    const alpha = Math.round(originalAlpha * (1 - removal));
    matte[pixel] = alpha;
    if (alpha <= 8) {
      transparentPixels += 1;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) transparentBorderPixels += 1;
    }
    if (alpha >= 224) foregroundPixels += 1;
  }

  const transparentFraction = transparentPixels / pixels;
  const foregroundFraction = foregroundPixels / pixels;
  if (foregroundFraction < 0.01) {
    throw new Error('EDITORIAL_CUTOUT_EMPTY_FOREGROUND: 抠图后没有足够的主体，请重新生成主体素材，主体不要使用绿色。');
  }
  // A few green pixels in a complete scene do not make an isolated subject.
  // Require both substantial transparency and clear space around the subject.
  if (transparentFraction < 0.08 || transparentBorderPixels / borderPixels < 0.55) {
    throw new Error('EDITORIAL_CUTOUT_BACKGROUND_NOT_ISOLATED: 主体素材没有符合要求的纯绿色背景，请重新生成，保留主体周围的纯 #00FF00 留白。');
  }

  const bitmap = new Uint8Array(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const offset = pixel * 4;
      const originalAlpha = source[offset + 3];
      const keyedAlpha = matte[pixel];
      if (!keyedAlpha || !originalAlpha) continue;

      // Feather only toward the inside of an edge. Transparent background stays
      // fully clear, avoiding a green halo when the cutout moves over other art.
      let neighborTotal = 0;
      let neighborCount = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const neighborY = y + dy;
        if (neighborY < 0 || neighborY >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const neighborX = x + dx;
          if (neighborX < 0 || neighborX >= width) continue;
          neighborTotal += matte[neighborY * width + neighborX];
          neighborCount += 1;
        }
      }
      const alpha = Math.round(Math.min(keyedAlpha, keyedAlpha * 0.75 + neighborTotal / neighborCount * 0.25));
      const red = Math.min(255, source[offset + 2] * 255 / originalAlpha);
      const blue = Math.min(255, source[offset] * 255 / originalAlpha);
      let green = Math.min(255, source[offset + 1] * 255 / originalAlpha);
      if (keyedAlpha < originalAlpha || neighborTotal < neighborCount * keyedAlpha) {
        green = Math.min(green, Math.max(red, blue));
      }
      const premultiply = alpha / 255;
      bitmap[offset] = Math.round(blue * premultiply);
      bitmap[offset + 1] = Math.round(green * premultiply);
      bitmap[offset + 2] = Math.round(red * premultiply);
      bitmap[offset + 3] = alpha;
    }
  }

  return { bitmap, transparentFraction, foregroundFraction };
}
