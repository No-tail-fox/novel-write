import { join } from 'node:path';

export const HTML_VIDEO_BACKGROUND_REMOVAL_MODELS = [
  { file: 'birefnet-lite.onnx', kind: 'birefnet' },
  { file: 'BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx', kind: 'birefnet' },
  { file: 'isnet-general-use.onnx', kind: 'isnet' },
  { file: 'isnet-anime.onnx', kind: 'isnet' },
  { file: 'u2net.onnx', kind: 'u2net' },
  { file: 'silueta.onnx', kind: 'u2net' },
  { file: 'u2netp.onnx', kind: 'u2net' },
] as const;

export interface HtmlVideoBackgroundRemovalModel {
  path: string;
  kind: typeof HTML_VIDEO_BACKGROUND_REMOVAL_MODELS[number]['kind'];
}

export function findHtmlVideoBackgroundRemovalModel(
  modelDirectory: string,
  exists: (path: string) => boolean,
): HtmlVideoBackgroundRemovalModel | null {
  for (const model of HTML_VIDEO_BACKGROUND_REMOVAL_MODELS) {
    const path = join(modelDirectory, model.file);
    if (exists(path)) return { path, kind: model.kind };
  }
  return null;
}

export function htmlVideoBitmapHasTransparency(bitmap: Uint8Array): boolean {
  if (bitmap.byteLength % 4 !== 0) {
    throw new Error('HTML_VIDEO_BITMAP_INVALID: Expected four bytes per pixel.');
  }
  for (let offset = 3; offset < bitmap.byteLength; offset += 4) {
    if (bitmap[offset] < 255) return true;
  }
  return false;
}
