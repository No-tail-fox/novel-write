import type { DraftTemplate } from './types';
import type { PixelleTemplateDescriptor } from './pixelle';

/** Host layout only. The pinned original template and its branding stay untouched. */
export function fitPixelleTimedCaption(caption: DraftTemplate['caption'], template: Pick<PixelleTemplateDescriptor, 'ref' | 'width' | 'height'>, texts: readonly string[]): DraftTemplate['caption'] {
  if (template.ref.path !== '1080x1920/video_default.html') return caption;
  // The original footer ends at 1436.5px. Center captions in the clear lower band.
  const width = Math.min(.84, caption.width) * template.width;
  // Match short-video-render.ts: border-box width, 3.125% horizontal padding,
  // 1.25% vertical padding. Leave four pixels above the 95% safe bottom.
  const paddingX = template.width * .0625, paddingY = template.width * .025;
  const stroke = caption.border.alpha > 0 ? Math.max(1, Math.min(4, caption.border.width / 5000 * template.width)) : 0;
  const contentWidth = width - paddingX - stroke * 2;
  const availableHeight = template.height * .18 - 8;
  const lineHeight = Math.max(.5, 1 + caption.lineSpacing / 10);
  // Bold Microsoft YaHei UI W is 1.0762em, not .75em. Reserve 1.1em for
  // ASCII/CJK, two em for other code points, and the full CSS tab stop.
  const advance = (char: string, pixels: number) => (char === '\t' ? 8.8
    : /^[\x00-\x7f\u2e80-\u9fff\uac00-\ud7af\uff00-\uffef]$/u.test(char) ? 1.1 : 2) * pixels + Math.max(0, caption.letterSpacing);
  const lines = (text: string, pixels: number) => text.split(/\r\n?|\n/u).reduce((total, line) => {
    let count = 1, used = 0;
    // Preserve word-boundary wrapping. Dividing total advance by width alone
    // misses the unused tail of a line before an English word moves down.
    for (const token of line.match(/[^ \t]+|[ \t]+/gu) ?? []) {
      const chars = [...token], tokenWidth = chars.reduce((sum, char) => sum + advance(char, pixels), 0);
      if (!/^[ \t]+$/u.test(token) && used > 0 && used + tokenWidth > contentWidth) { count++; used = 0; }
      for (const char of chars) {
        const next = advance(char, pixels);
        if (next > contentWidth) return Infinity;
        if (used > 0 && used + next > contentWidth) { count++; used = 0; }
        used += next;
      }
    }
    return total + count;
  }, 0);
  let fontSize = Math.min(caption.fontSize, 12);
  while (fontSize >= 6) {
    const pixels = fontSize / 180 * template.width;
    // CSS line-height can be smaller than actual glyph ascent/descent. Include
    // that overhang, padding and stroke instead of treating line boxes as ink.
    const extraHeight = paddingY + stroke * 2 + pixels * Math.max(0, 1.55 - lineHeight);
    if (contentWidth > 0 && texts.every(text => lines(text, pixels) * pixels * lineHeight + extraHeight <= availableHeight)) {
      return { ...caption, x: 0, y: .72, width: width / template.width, fontSize };
    }
    if (fontSize === 6) break;
    fontSize = Math.max(6, fontSize - .25);
  }
  throw new Error('PIXELLE_CAPTION_TOO_DENSE: 当前字幕单条内容过长，无法在品牌栏下方清晰排版；请拆分该条字幕。');
}
