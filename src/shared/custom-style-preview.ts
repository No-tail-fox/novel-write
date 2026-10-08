import type { CustomStyle, CustomStylePreview } from './types';

export function customStylePreviewSignature(style: Pick<CustomStyle, 'prefix' | 'suffix' | 'negativePrompt' | 'allowColor'>): string {
  return JSON.stringify([style.prefix, style.suffix, style.negativePrompt, style.allowColor]);
}

export function validCustomStylePreview(style: CustomStyle): CustomStylePreview | undefined {
  const preview = style.preview;
  if (!preview || typeof preview.imagePath !== 'string' || !preview.imagePath.trim()
    || preview.imagePath.includes('\0') || typeof preview.generatedAt !== 'string'
    || Number.isNaN(Date.parse(preview.generatedAt))
    || preview.styleSignature !== customStylePreviewSignature(style)) return undefined;
  return preview;
}

export function withoutStaleCustomStylePreview(style: CustomStyle): CustomStyle {
  const { preview: _preview, ...draft } = style;
  const preview = validCustomStylePreview(style);
  return preview ? { ...draft, preview } : draft;
}

/** Keep one subject across built-in and custom samples so visual styles can be compared. */
export const CUSTOM_STYLE_PREVIEW_SUBJECT = 'Create one finished drawing-style reference artwork. A quiet traditional riverside bookshop in a Chinese water town: an adult bookbinder sits on the left repairing a plain cloth-bound book at a wooden desk; a clay teapot and cup sit in the right foreground; a window and doorway reveal a stone bridge over the river in the middle distance. Simple timeless cotton clothing, wooden shelves and a few neatly stacked unmarked books. Three-quarter interior view, the desk in the lower third, clear subject silhouette, depth from the foreground cup to the bookbinder to the bridge, clean visual hierarchy and calm human warmth. Landscape 16:9. Render the entire scene in the selected style, preserving the subject while adapting lighting, palette, realism and texture to the template. No visible writing, lettering, captions, logos or watermark; not a UI mockup or a split screen.';
