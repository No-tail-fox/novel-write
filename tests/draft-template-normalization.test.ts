import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { draftTemplates, imageAnimations, normalizeDraftTemplate } from '@shared/templates';
import type { DraftTemplate } from '@shared/types';

describe('draft template normalization', () => {
  it('ships StoryDream built-in draft template presets', () => {
    const [portrait916, portrait43, landscape169] = draftTemplates;

    expect(draftTemplates.map((template) => template.id)).toEqual([
      'default-portrait-9-16',
      'builtin-portrait-4-3',
      'builtin-landscape-16-9',
    ]);

    expect(portrait916).toMatchObject({
      id: 'default-portrait-9-16',
      name: '默认竖屏',
      canvas: { width: 1080, height: 1920, ratio: '9:16', backgroundColor: '#000000' },
      image: { ratio: '9:16', fit: 'cover', top: 0, height: 1, animation: '缩放' },
      title: {
        x: 0,
        y: 0.04739583333333333,
        width: 0.8,
        fontSize: 25,
        color: '#FFDE00',
        alpha: 1,
        bold: true,
        underline: true,
        align: 1,
        letterSpacing: 0,
        lineSpacing: 0,
        border: { color: '#000000', width: 40, alpha: 1 },
      },
      subtitle: {
        x: 0,
        y: -0.21666666666666667,
        width: 0.8,
        fontSize: 12,
        color: '#FFFFFF',
        alpha: 1,
        bold: false,
        underline: false,
        align: 1,
        letterSpacing: 2,
        lineSpacing: 4,
        border: { color: '#000000', width: 40, alpha: 1 },
      },
      caption: {
        x: 0,
        y: -0.21510416666666668,
        width: 0.8,
        fontSize: 12,
        color: '#FFDE00',
        alpha: 1,
        bold: false,
        underline: false,
        align: 1,
        letterSpacing: 0,
        lineSpacing: 0,
        maxCharsPerLine: 12,
        border: { color: '#000000', width: 0, alpha: 0 },
        background: { color: '#000000', alpha: 0.5, roundRadius: 0.3 },
      },
      disclaimer: {
        x: 0,
        y: -0.903125,
        width: 0.8,
        fontSize: 8,
        color: '#FFFFFF',
        alpha: 0.26,
        bold: false,
        underline: false,
        align: 1,
        letterSpacing: 0,
        lineSpacing: 5,
        border: { color: '#000000', width: 40, alpha: 1 },
      },
      audio: { narrationVolume: 10, bgmVolume: 3, bgmFadeOutMs: 2000 },
    });
    expect(portrait916.disclaimer.text).toBe('图片由AI生成与网络下载\n科普视频，无不良引导');

    expect(portrait43).toMatchObject({
      id: 'builtin-portrait-4-3',
      name: '竖屏4:3',
      canvas: { width: 1080, height: 1920, ratio: '9:16', backgroundColor: '#000000' },
      image: { ratio: '4:3', fit: 'cover', top: 0.2890625, height: 0.421875, animation: '缩放' },
      title: { y: 0.8357783211083945, fontSize: 20, underline: false, border: { color: '#000000', width: 40, alpha: 1 } },
      subtitle: { y: 0.5953125, fontSize: 12, letterSpacing: 2, lineSpacing: 4, border: { color: '#000000', width: 40, alpha: 1 } },
      caption: { y: -0.5572916666666666, fontSize: 12, border: { color: '#000000', width: 0, alpha: 0 } },
      disclaimer: { y: -0.8141628912685337, fontSize: 8, alpha: 1, lineSpacing: 5, border: { color: '#000000', width: 40, alpha: 1 } },
      audio: { narrationVolume: 10, bgmVolume: 3, bgmFadeOutMs: 2000 },
    });

    expect(landscape169).toMatchObject({
      id: 'builtin-landscape-16-9',
      name: '横屏16:9',
      canvas: { width: 1920, height: 1080, ratio: '16:9', backgroundColor: '#000000' },
      image: { ratio: '16:9', fit: 'cover', top: 0, height: 1, animation: '缩放' },
      title: { y: 0.12777777777777777, fontSize: 20, border: { color: '#000000', width: 40, alpha: 1 } },
      subtitle: { y: -0.43333333333333335, fontSize: 8, letterSpacing: 2, lineSpacing: 4, border: { color: '#000000', width: 40, alpha: 1 } },
      caption: { y: -0.6425925925925926, fontSize: 8, border: { color: '#000000', width: 0, alpha: 0 } },
      disclaimer: { y: -0.8787037037037037, fontSize: 5, alpha: 0.5, lineSpacing: 5, border: { color: '#000000', width: 40, alpha: 1 } },
      audio: { narrationVolume: 10, bgmVolume: 3, bgmFadeOutMs: 2000 },
    });
    expect(landscape169.disclaimer.text).toBe('图片由AI生成与网络下载 科普视频，无不良引导');
  });

  it('fills draggable coordinates for legacy template objects', () => {
    const fallback = draftTemplates[0];
    const legacyTemplate = {
      ...fallback,
      title: { visible: true, text: 'Legacy title', fontSize: 44, color: '#ffde00' },
      subtitle: { visible: true, fontSize: 22, color: '#ffffff' },
      caption: { ...fallback.caption, x: undefined },
      disclaimer: { visible: true, text: 'Legacy disclaimer' },
    } as unknown as DraftTemplate;

    const normalized = normalizeDraftTemplate(legacyTemplate);

    expect(normalized.image.visible).toBe(true);
    expect(normalized.title).toMatchObject({
      x: 0,
      y: 0.04739583333333333,
      width: 0.8,
      alpha: 1,
      bold: true,
      underline: true,
      align: 1,
      letterSpacing: 0,
      lineSpacing: 0,
    });
    expect(normalized.subtitle).toMatchObject({
      x: 0,
      y: -0.21666666666666667,
      width: 0.8,
      text: expect.any(String),
      alpha: 1,
      bold: false,
      underline: false,
      align: 1,
      letterSpacing: 2,
      lineSpacing: 4,
    });
    expect(normalized.caption).toMatchObject({
      x: 0,
      width: 0.8,
      fontSize: expect.any(Number),
      color: expect.stringMatching(/^#/),
      alpha: 1,
      bold: false,
      underline: false,
      align: 1,
      letterSpacing: 0,
      lineSpacing: 0,
      maxCharsPerLine: 12,
    });
    expect(typeof normalized.caption.y).toBe('number');
    expect(normalized.disclaimer).toMatchObject({
      x: 0,
      y: -0.903125,
      width: 0.8,
      bold: false,
      underline: false,
      align: 1,
      letterSpacing: 0,
      lineSpacing: 5,
    });
    expect(normalized.disclaimer).toMatchObject({
      fontSize: expect.any(Number),
      color: expect.stringMatching(/^#/),
      alpha: 0.26,
    });
    expect(normalized.title.border).toEqual({ color: '#000000', width: 40, alpha: 1 });
    expect(normalized.subtitle.border).toEqual({ color: '#000000', width: 40, alpha: 1 });
    expect(normalized.caption.border).toEqual({ color: '#000000', width: 0, alpha: 0 });
    expect(normalized.disclaimer.border).toEqual({ color: '#000000', width: 40, alpha: 1 });
  });

  it('allows oversized text box widths for large fonts while clamping invalid values', () => {
    const fallback = draftTemplates[0];
    const normalized = normalizeDraftTemplate({
      ...fallback,
      title: { ...fallback.title, width: 1.4 },
      subtitle: { ...fallback.subtitle, width: 0.04 },
      caption: { ...fallback.caption, width: Number.NaN },
      disclaimer: { ...fallback.disclaimer, width: 2.5 },
    });

    expect(normalized.title.width).toBe(1.4);
    expect(normalized.subtitle.width).toBe(0.1);
    expect(normalized.caption.width).toBe(0.8);
    expect(normalized.disclaimer.width).toBe(2);
  });

  it('keeps StoryDream text-layer style fields from partially saved templates', () => {
    const fallback = draftTemplates[0];
    const normalized = normalizeDraftTemplate({
      ...fallback,
      title: { ...fallback.title, underline: false, align: 2, letterSpacing: 3, lineSpacing: 6 },
      subtitle: { ...fallback.subtitle, underline: true, align: 0, letterSpacing: 4, lineSpacing: 8 },
      caption: { ...fallback.caption, bold: true, underline: true, align: 2, letterSpacing: 1, lineSpacing: 3, maxCharsPerLine: 18 },
      disclaimer: { ...fallback.disclaimer, bold: true, underline: true, align: 2, letterSpacing: 2, lineSpacing: 7 },
    });

    expect(normalized.title).toMatchObject({ underline: false, align: 2, letterSpacing: 3, lineSpacing: 6 });
    expect(normalized.subtitle).toMatchObject({ underline: true, align: 0, letterSpacing: 4, lineSpacing: 8 });
    expect(normalized.caption).toMatchObject({ bold: true, underline: true, align: 2, letterSpacing: 1, lineSpacing: 3, maxCharsPerLine: 18 });
    expect(normalized.disclaimer).toMatchObject({ bold: true, underline: true, align: 2, letterSpacing: 2, lineSpacing: 7 });
  });

  it('repairs invalid StoryDream caption style fields from stale templates', () => {
    const fallback = draftTemplates[0];
    const normalized = normalizeDraftTemplate({
      ...fallback,
      caption: {
        ...fallback.caption,
        fontSize: Number.NaN,
        color: '',
        alpha: Number.NaN,
        bold: 'false',
        underline: 'false',
        align: Number.NaN,
        letterSpacing: Number.NaN,
        lineSpacing: Number.NaN,
        maxCharsPerLine: Number.NaN,
        background: {
          color: '',
          alpha: Number.NaN,
          roundRadius: Number.NaN,
        },
      },
    } as unknown as DraftTemplate);

    expect(normalized.caption).toMatchObject({
      fontSize: fallback.caption.fontSize,
      color: fallback.caption.color,
      alpha: fallback.caption.alpha,
      bold: fallback.caption.bold,
      underline: fallback.caption.underline,
      align: fallback.caption.align,
      letterSpacing: fallback.caption.letterSpacing,
      lineSpacing: fallback.caption.lineSpacing,
      maxCharsPerLine: fallback.caption.maxCharsPerLine,
      background: fallback.caption.background,
    });
  });

  it('fills editing effect defaults for legacy template audio settings', () => {
    const fallback = draftTemplates[0];
    const legacyTemplate = {
      ...fallback,
      audio: {
        narrationVolume: 8,
        bgmVolume: 2,
        bgmFadeOutMs: 1500,
      },
    } as unknown as DraftTemplate;

    const normalized = normalizeDraftTemplate(legacyTemplate);

    expect(normalized.audio).toMatchObject({
      narrationVolume: 8,
      bgmVolume: 2,
      transitionType: '叠化',
      transitionDurationMs: 450,
      narrationFadeInMs: 80,
      narrationFadeOutMs: 80,
      bgmFadeInMs: 800,
      bgmFadeOutMs: 1500,
      filterType: '',
      videoEffectType: '',
      audioEffectType: '',
    });
  });

  it('only exposes image animations that pyJianYingDraft can resolve', () => {
    const pythonPath = join(process.cwd(), 'vendor', 'python', 'python.exe');
    if (!existsSync(pythonPath)) return;
    const script = `
import json
import pyJianYingDraft as draft
names = ${JSON.stringify(imageAnimations)}
invalid = []
for name in names:
    if name == "无动画":
        continue
    matched = False
    for enum_name in ("GroupAnimationType", "IntroType", "OutroType"):
        enum_type = getattr(draft, enum_name, None)
        if not enum_type:
            continue
        try:
            enum_type.from_name(name)
            matched = True
            break
        except Exception:
            pass
    if not matched:
        invalid.append(name)
print(json.dumps(invalid, ensure_ascii=False))
`;
    const invalid = JSON.parse(execFileSync(pythonPath, ['-c', script], { encoding: 'utf8' })) as string[];

    expect(invalid).toEqual([]);
  });
});
