import { describe, expect, it } from 'vitest';
import { draftImageFrameRect, draftImageMediaRect, draftImageMediaStyle, draftTextLayerStyle, moveDraftImageFrame, moveDraftImageMedia, resizeDraftImageFrame, resizeDraftImageMedia } from '../src/features/templates/DraftCanvas';
import { readFile } from 'node:fs/promises';
import { draftTemplates } from '@shared/templates';

const textStyle = {
  fontFamily: '宋体' as const,
  color: '#ffde00',
  alpha: 1,
  align: 1,
  letterSpacing: 0,
  lineSpacing: 0,
};

describe('draft canvas text style', () => {
  it('previews crop-fill and full-image scaling as distinct image-region modes', () => {
    const template = structuredClone(draftTemplates[1]);
    template.image.fit = 'cover';
    expect(draftImageMediaStyle(template)).toMatchObject({ left: '0%', top: '0%', height: '100%', width: '100%', objectFit: 'cover' });

    template.image.fit = 'contain';
    expect(draftImageMediaStyle(template)).toMatchObject({
      inset: 0,
      height: '100%',
      width: '100%',
      objectFit: 'contain',
    });
  });

  it('keeps both transform rectangles constrained while moving and resizing', () => {
    const template = structuredClone(draftTemplates[0]);
    template.image.ratio = '16:9';
    const resizedFrame = resizeDraftImageFrame(template, 'se', -0.25, -0.2);
    expect(draftImageFrameRect(resizedFrame)).toEqual({ left: 0, top: 0, width: 0.75, height: 0.8 });

    const movedFrame = moveDraftImageFrame(resizedFrame, 0.4, 0.4);
    expect(draftImageFrameRect(movedFrame)).toMatchObject({ left: 0.25, width: 0.75, height: 0.8 });
    expect(draftImageFrameRect(movedFrame).top).toBeCloseTo(0.2, 8);

    const enlargedMedia = resizeDraftImageMedia(movedFrame, 'se', 0.2, 0.2);
    expect(enlargedMedia.image.mediaScale).toBeGreaterThan(1);
    const movedMedia = moveDraftImageMedia(enlargedMedia, -5, 5);
    const frame = draftImageFrameRect(movedMedia);
    const media = draftImageMediaRect(movedMedia);
    expect(media.left).toBeLessThanOrEqual(frame.left);
    expect(media.top).toBeLessThanOrEqual(frame.top);
    expect(media.left + media.width).toBeGreaterThanOrEqual(frame.left + frame.width);
    expect(media.top + media.height).toBeGreaterThanOrEqual(frame.top + frame.height);
  });

  it('renders two selectable image objects with eight keyboard-accessible handles', async () => {
    const source = await readFile(new URL('../src/features/templates/DraftCanvas.tsx', import.meta.url), 'utf8');
    expect(source).toContain('target="image-frame"');
    expect(source).toContain('target="image-media"');
    expect(source).toContain("const draftResizeHandles: DraftResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];");
    expect(source).toContain('aria-label={`${label}${draftResizeHandleLabels[handle]}缩放`}');
    expect(source).toContain("event.key === 'ArrowLeft'");
  });

  it('keeps native text decoration out of the stroked text compositor path', () => {
    const style = draftTextLayerStyle(textStyle, 24, 800);

    expect(style).not.toHaveProperty('textDecoration');
    expect(style).not.toHaveProperty('textDecorationLine');
    expect(style).not.toHaveProperty('textDecorationStyle');
    expect(style).not.toHaveProperty('textDecorationThickness');
    expect(style).not.toHaveProperty('textUnderlineOffset');
    expect(style.color).toBe(textStyle.color);
    expect(style.fontSize).toBe(24);
    expect(style.fontFamily).toContain('SimSun');
  });

  it('renders underline as an isolated inline fragment that can be removed without repainting the canvas layer', async () => {
    const [source, styles] = await Promise.all([
      readFile(new URL('../src/features/templates/DraftCanvas.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
    ]);

    expect(source).toContain("data-draft-underline={underline ? 'on' : 'off'}");
    expect(source).toContain("className={underline ? 'draft-text-content underlined' : 'draft-text-content'}");
    expect(styles).toContain('.draft-text-content.underlined {');
    expect(styles).toContain('border-bottom: 0.09em solid currentColor;');
    expect(styles).not.toMatch(/\.draft-text-content\.underlined\s*\{[^}]*text-decoration:/su);
  });
});
