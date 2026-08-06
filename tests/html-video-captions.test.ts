import { describe, expect, it } from 'vitest';
import {
  HTML_VIDEO_CAPTION_ANIMATIONS,
  HTML_VIDEO_CAPTION_COLOR_KEYS,
  HTML_VIDEO_CAPTION_PRESETS,
  htmlVideoCaptionPickerColor,
  resolveHtmlVideoCaptionStyle,
} from '@shared/html-video-captions';
import { preserveHtmlVideoJobConfig } from '@shared/html-video-config';
import { buildHtmlVideoExportInput } from '@shared/html-video';
import type { HtmlVideoJobConfig } from '@shared/types';

describe('HTML video caption consumers', () => {
  it('exposes only the governed preset, animation, and semantic color catalogs', () => {
    expect(HTML_VIDEO_CAPTION_PRESETS).toEqual(['classic', 'editorial', 'karaoke']);
    expect(HTML_VIDEO_CAPTION_ANIMATIONS).toEqual(['none', 'fade-up', 'pop']);
    expect(HTML_VIDEO_CAPTION_COLOR_KEYS).toEqual(['text', 'accent', 'background', 'shadow']);
  });

  it('preserves the legacy appearance when caption fields are missing', () => {
    const resolved = resolveHtmlVideoCaptionStyle({});
    const html = buildCaptionHtml(resolved);

    expect(resolved).toMatchObject({ preset: 'classic', animation: 'fade-up' });
    expect(html).toContain('data-caption-preset="classic"');
    expect(html).toContain('data-caption-animation="fade-up"');
    expect(html).toContain('color: rgba(240, 247, 248, 0.94);');
    expect(html).toContain("tl.fromTo('#scene-copy .caption', { opacity: 0.72, y: 18 }, { opacity: 1, y: 0");
    expect(html).toContain("const captionAnimation = reduceCaptionMotion ? 'none' : \"fade-up\"");
    expect(html).not.toContain('requestAnimationFrame');
  });

  it('resolves fixed preset tokens and validated semantic color overrides', () => {
    const resolved = resolveHtmlVideoCaptionStyle({
      captionPreset: 'editorial',
      captionAnim: 'pop',
      captionColors: {
        text: '#fefefe',
        accent: '#22ccaa',
        background: '#101418cc',
        shadow: '#000000aa',
      },
    });
    const html = buildCaptionHtml(resolved);

    expect(resolved.colors).toEqual({
      text: '#fefefe',
      accent: '#22ccaa',
      background: '#101418cc',
      shadow: '#000000aa',
    });
    expect(html).toContain('--caption-text: #fefefe;');
    expect(html).toContain('--caption-accent: #22ccaa;');
    expect(html).toContain('--caption-background: #101418cc;');
    expect(html).toContain('--caption-shadow: #000000aa;');
    expect(html).toContain("tl.fromTo('#scene-copy .caption', { opacity: 0.7, scale: 0.92 }, { opacity: 1, scale: 1");
    expect(html).toContain("ease: 'back.out(1.4)'");
  });

  it.each([
    ['#abc', '#aabbcc'],
    ['#abcd', '#aabbcc'],
    ['#123456', '#123456'],
    ['#12345678', '#123456'],
  ])('derives a six-digit picker preview from exact color %s without changing the stored value', (value, expected) => {
    expect(htmlVideoCaptionPickerColor(value)).toBe(expected);
  });

  it('disables caption motion deterministically for reduced-motion capture', () => {
    expect(resolveHtmlVideoCaptionStyle({ captionAnim: 'pop' }, { reducedMotion: true }))
      .toMatchObject({ animation: 'none', requestedAnimation: 'pop', reducedMotion: true });
    expect(buildCaptionHtml(resolveHtmlVideoCaptionStyle({ captionAnim: 'pop' }, { reducedMotion: true })))
      .toContain('data-caption-animation="none"');
  });

  it.each([
    [{ captionPreset: 'vendor-preset' }, /captionPreset/i],
    [{ captionAnim: 'bounce-and-spin' }, /captionAnim/i],
    [{ captionColors: { width: '#ffffff' } }, /captionColors|width/i],
    [{ captionColors: { text: 'red; background:url(javascript:alert(1))' } }, /captionColors|color/i],
    [{ captionColors: { text: 'var(--unsafe)' } }, /captionColors|color/i],
    [{ captionColors: { text: '#1234567' } }, /captionColors|color/i],
  ] as const)('rejects unsafe caption config %# before rendering', (config, error) => {
    expect(() => preserveHtmlVideoJobConfig(config)).toThrow(error);
    expect(() => resolveHtmlVideoCaptionStyle(config)).toThrow(error);
  });

  it('rejects 33 color entries before reading their values', () => {
    let valueRead = false;
    const colors: Record<string, string> = {};
    for (let index = 0; index < 33; index += 1) {
      Object.defineProperty(colors, `color-${index}`, {
        enumerable: true,
        get() {
          valueRead = true;
          return '#ffffff';
        },
      });
    }

    expect(() => preserveHtmlVideoJobConfig({ captionColors: colors })).toThrow(/captionColors.*32/i);
    expect(valueRead).toBe(false);
  });

  it('builds byte-identical scene HTML for preview and final render inputs', () => {
    const style = resolveHtmlVideoCaptionStyle({
      captionPreset: 'karaoke',
      captionAnim: 'fade-up',
      captionColors: { accent: '#36d7c5' },
    });

    expect(buildCaptionHtml(style)).toBe(buildCaptionHtml(style));
  });

  it('validates raw caption config again at the public HTML builder boundary', () => {
    expect(() => buildCaptionHtmlFromConfig({
      captionPreset: 'classic',
      captionColors: { text: '#fff; background:url(javascript:alert(1))' },
    })).toThrow(/captionColors|color/i);
  });

  it('locks generated scene scripts and styles behind a nonce CSP', () => {
    const html = buildCaptionHtml(resolveHtmlVideoCaptionStyle({}));

    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("script-src 'nonce-storydream-html-video'");
    expect(html).toContain("style-src 'nonce-storydream-html-video'");
    expect(html).toContain("style-src-attr 'unsafe-inline'");
    expect(html).toContain('<style nonce="storydream-html-video">');
    expect(html).toContain('<script nonce="storydream-html-video">');
    expect(html).not.toContain("'unsafe-eval'");
  });
});

function buildCaptionHtml(captionStyle: ReturnType<typeof resolveHtmlVideoCaptionStyle>): string {
  return buildCaptionHtmlFromConfig({
    captionPreset: captionStyle.preset,
    captionAnim: captionStyle.requestedAnimation,
    captionColors: captionStyle.colors,
  }, captionStyle.reducedMotion);
}

function buildCaptionHtmlFromConfig(captionConfig: HtmlVideoJobConfig, captionReducedMotion = false): string {
  return buildHtmlVideoExportInput({
    workDir: 'D:/storydream-caption-test',
    outputPath: 'D:/storydream-caption-test/final.mp4',
    title: '字幕测试',
    artifact: {
      reviewedText: '字幕测试。',
      rewrittenCopy: '字幕测试。',
      cover: { title: '字幕测试', subtitle: [], summary: '字幕测试。', tags: [], comments: [] },
      scenes: [{ id: 1, cap: '字幕测试。', descPrompt: '字幕测试背景', durationMs: 1200 }],
      imagePrompts: [],
      subtitles: { cues: [], srt: '' },
    },
    generatedImages: [{ sceneId: 1, path: 'D:/storydream-caption-test/bg.png' }],
    narrationAudio: [{ sceneId: 1, path: 'D:/storydream-caption-test/voice.wav' }],
    captionConfig,
    captionReducedMotion,
    fps: 24,
    canvas_w: 720,
    canvas_h: 1280,
  }).scenes[0].html;
}
