/** Actual glyph bounds from the visible stage, independent of model-authored TEXTS metadata. */
export interface NativeCanvasText {
  text: string; font: string; fontFamily: string; fontSize: number;
  /** A visible fragment is evidence of clipping, never proof of a complete caption. */
  clipped?: boolean;
  x0: number; y0: number; x1: number; y1: number;
}

export function measureNativeCanvasText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth?: number, includeDetached = false): NativeCanvasText | undefined {
  // Cached textures are measured in their own coordinates and cannot prove stage geometry.
  if (!includeDetached && !(context.canvas as HTMLCanvasElement).isConnected || context.globalAlpha <= .05 || !text.trim()
    || ![x, y].every(Number.isFinite) || maxWidth !== undefined && (!Number.isFinite(maxWidth) || maxWidth <= 0)) return;
  const font = context.font, fontMatch = font.match(/([\d.]+)px\s+(.+)$/);
  if (!fontMatch) return;
  const metrics = context.measureText(text), matrix = context.getTransform();
  const squeeze = maxWidth !== undefined && metrics.width > maxWidth ? maxWidth / metrics.width : 1;
  const left = x - metrics.actualBoundingBoxLeft * squeeze, right = x + metrics.actualBoundingBoxRight * squeeze;
  const top = y - metrics.actualBoundingBoxAscent, bottom = y + metrics.actualBoundingBoxDescent;
  const points = [[left, top], [right, top], [left, bottom], [right, bottom]].map(([px, py]) => ({
    x: matrix.a * px + matrix.c * py + matrix.e, y: matrix.b * px + matrix.d * py + matrix.f,
  }));
  const row = { text, font, fontFamily: fontMatch[2], fontSize: Number(fontMatch[1]) * Math.hypot(matrix.c, matrix.d),
    x0: Math.min(...points.map(p => p.x)), y0: Math.min(...points.map(p => p.y)),
    x1: Math.max(...points.map(p => p.x)), y1: Math.max(...points.map(p => p.y)) };
  if (![row.x0, row.y0, row.x1, row.y1, row.fontSize].every(Number.isFinite) || row.x1 <= row.x0 || row.y1 <= row.y0) return;
  // Fully offstage draws are not visible; partially clipped glyphs still need review.
  if (row.x1 <= 0 || row.y1 <= 0 || row.x0 >= context.canvas.width || row.y0 >= context.canvas.height) return;
  return row;
}
