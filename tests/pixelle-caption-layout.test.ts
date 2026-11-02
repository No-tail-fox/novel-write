import { describe, expect, it } from 'vitest';
import { fitPixelleTimedCaption } from '../src/shared/pixelle-caption-layout';
import { getTemplate } from '../src/shared/templates';
import { PIXELLE_REVISION } from '../src/shared/pixelle';

const template = { width: 1080, height: 1920, ref: { provider: 'pixelle' as const, revision: PIXELLE_REVISION, path: '1080x1920/video_default.html', sha256: 'a'.repeat(64) } };
describe('Pixelle timed captions avoid original footer', () => {
  it('places ordinary text in the clear lower band without changing the original template', () => {
    const original = structuredClone(getTemplate('default-portrait-9-16').caption);
    const result = fitPixelleTimedCaption(original, template, ['第一段配音第二段配音']);
    expect(result.y).toBe(.72);
    expect(result.width).toBeLessThanOrEqual(.84);
    expect(result.fontSize).toBeLessThanOrEqual(original.fontSize);
    expect(original.y).not.toBe(result.y);
    expect(result).not.toBe(original);
  });
  it('fits Chinese, long English and explicit newlines while retaining readable font size', () => {
    const caption = getTemplate('default-portrait-9-16').caption;
    for (const text of ['清晰地解释每一个细节。'.repeat(12), 'A-long-unbroken-identifier'.repeat(5), '第一行\n第二行\n第三行\n第四行']) {
      const result = fitPixelleTimedCaption(caption, template, [text]);
      expect(result.fontSize).toBeGreaterThanOrEqual(6);
      const bottom = (result.y + 1) / 2 * 1920 + (1920 * .16 - 40) / 2;
      expect(bottom).toBeLessThan(1920 * .95);
    }
  });
  it('fails explicitly rather than clipping a cue that cannot fit readably', () => {
    expect(() => fitPixelleTimedCaption(getTemplate('default-portrait-9-16').caption, template, ['超长内容'.repeat(300)]))
      .toThrow('PIXELLE_CAPTION_TOO_DENSE');
  });
  it('preserves captions for unrelated original templates', () => {
    const caption = getTemplate('default-portrait-9-16').caption;
    expect(fitPixelleTimedCaption(caption, { ...template, ref: { ...template.ref, path: '1080x1920/video_healing.html' } }, ['旁白']))
      .toBe(caption);
  });
  it('shrinks wide ASCII to the measured safe sizes without altering cue text', () => {
    const caption = getTemplate('default-portrait-9-16').caption;
    const texts = ['W'.repeat(100), 'W'.repeat(150)], before = [...texts];
    expect(fitPixelleTimedCaption(caption, template, [texts[0]]).fontSize).toBeLessThanOrEqual(6.75);
    expect(fitPixelleTimedCaption(caption, template, [texts[1]]).fontSize).toBe(6);
    expect(fitPixelleTimedCaption({ ...caption, fontSize: 6.1 }, template, [texts[1]]).fontSize).toBe(6);
    expect(texts).toEqual(before);
    expect(() => fitPixelleTimedCaption(caption, template, ['W'.repeat(200)])).toThrow('PIXELLE_CAPTION_TOO_DENSE');
  });
  it('accounts for real padding, explicit line breaks and font ink overhang', () => {
    const caption = getTemplate('default-portrait-9-16').caption;
    expect(() => fitPixelleTimedCaption({ ...caption, width: .06 }, template, ['W'])).toThrow('PIXELLE_CAPTION_TOO_DENSE');
    expect(() => fitPixelleTimedCaption(caption, template, ['一\n'.repeat(9)])).toThrow('PIXELLE_CAPTION_TOO_DENSE');
    const text = '第一行\r第二行\r\nThird line\n第四行';
    expect(fitPixelleTimedCaption(caption, template, [text]).fontSize).toBeGreaterThanOrEqual(6);
    const styled = { ...caption, lineSpacing: 3, letterSpacing: 2, border: { ...caption.border, width: 8, alpha: 1 } };
    const result = fitPixelleTimedCaption(styled, template, ['混合 English words 在字幕区完整显示。']);
    expect(result).toMatchObject({ lineSpacing: 3, letterSpacing: 2, border: styled.border });
  });
});
