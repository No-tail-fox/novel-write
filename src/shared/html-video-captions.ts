import { AppError } from './app-error';
import { defaultDraftFontFamily, draftFontCssFamily, draftFontFamilies } from './templates';
import type {
  HtmlVideoCaptionAlign,
  HtmlVideoCaptionLayout,
  HtmlVideoCaptionRegion,
  HtmlVideoJobConfig,
} from './types';

export const HTML_VIDEO_CAPTION_PRESETS = ['classic', 'editorial', 'karaoke'] as const;
export const HTML_VIDEO_CAPTION_ANIMATIONS = ['none', 'fade-up', 'pop'] as const;
export const HTML_VIDEO_CAPTION_COLOR_KEYS = ['text', 'accent', 'background', 'shadow'] as const;
export const HTML_VIDEO_CAPTION_REGIONS = ['auto', 'top', 'middle', 'bottom'] as const satisfies readonly HtmlVideoCaptionRegion[];
export const HTML_VIDEO_CAPTION_ALIGNS = ['left', 'center', 'right'] as const satisfies readonly HtmlVideoCaptionAlign[];
export const HTML_VIDEO_CAPTION_FONT_WEIGHTS = [400, 500, 600, 700, 800, 900] as const;

export const HTML_VIDEO_CAPTION_LAYOUT_DEFAULTS: HtmlVideoCaptionLayout = {
  region: 'auto',
  fontFamily: defaultDraftFontFamily,
  fontSize: 48,
  lineHeight: 1.35,
  widthPercent: 88,
  align: 'center',
  fontWeight: 700,
};

export type HtmlVideoCaptionPreset = typeof HTML_VIDEO_CAPTION_PRESETS[number];
export type HtmlVideoCaptionAnimation = typeof HTML_VIDEO_CAPTION_ANIMATIONS[number];
export type HtmlVideoCaptionColorKey = typeof HTML_VIDEO_CAPTION_COLOR_KEYS[number];
export type HtmlVideoCaptionColorOverrides = Partial<Record<HtmlVideoCaptionColorKey, string>>;

export interface ResolvedHtmlVideoCaptionStyle {
  preset: HtmlVideoCaptionPreset;
  animation: HtmlVideoCaptionAnimation;
  requestedAnimation: HtmlVideoCaptionAnimation;
  reducedMotion: boolean;
  colors: Record<HtmlVideoCaptionColorKey, string>;
  layout: HtmlVideoCaptionLayout & { cssFontFamily: string };
}

export interface HtmlVideoCaptionCue {
  id: string;
  text: string;
  startSec: number;
  endSec: number;
  durationSec: number;
}

const captionPresetColors: Record<HtmlVideoCaptionPreset, Record<HtmlVideoCaptionColorKey, string>> = {
  classic: {
    text: '#f0f7f8f0',
    accent: '#45d7e6',
    background: '#00000000',
    shadow: '#0000006b',
  },
  editorial: {
    text: '#f8f5ed',
    accent: '#f2c14e',
    background: '#101418cc',
    shadow: '#00000099',
  },
  karaoke: {
    text: '#ffffff',
    accent: '#36d7c5',
    background: '#071316d9',
    shadow: '#000000b3',
  },
};

const safeCssColorPattern = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu;

export function resolveHtmlVideoCaptionStyle(
  config: Pick<HtmlVideoJobConfig, 'captionPreset' | 'captionAnim' | 'captionColors' | 'captionLayout'>,
  options: { reducedMotion?: boolean } = {},
): ResolvedHtmlVideoCaptionStyle {
  const preset = validateHtmlVideoCaptionPreset(config.captionPreset);
  const requestedAnimation = validateHtmlVideoCaptionAnimation(config.captionAnim);
  const overrides = validateHtmlVideoCaptionColors(config.captionColors);
  const layout = validateHtmlVideoCaptionLayout(config.captionLayout);
  const reducedMotion = options.reducedMotion === true;
  return {
    preset,
    animation: reducedMotion ? 'none' : requestedAnimation,
    requestedAnimation,
    reducedMotion,
    colors: { ...captionPresetColors[preset], ...overrides },
    layout: { ...layout, cssFontFamily: draftFontCssFamily(layout.fontFamily) },
  };
}

export function buildHtmlVideoCaptionCues(
  captions: readonly string[],
  durationSec: number,
  idPrefix: string | number = 'caption',
): HtmlVideoCaptionCue[] {
  const lines = captions.map((caption) => caption.trim()).filter(Boolean);
  if (!lines.length) return [];
  const durationMs = Math.max(lines.length, Math.round(Math.max(0.001, durationSec) * 1000));
  return lines.map((text, index) => {
    const startMs = Math.floor(index * durationMs / lines.length);
    const endMs = index === lines.length - 1
      ? durationMs
      : Math.floor((index + 1) * durationMs / lines.length);
    return {
      id: `${idPrefix}-${index}`,
      text,
      startSec: startMs / 1000,
      endSec: endMs / 1000,
      durationSec: (endMs - startMs) / 1000,
    };
  });
}

export function validateHtmlVideoCaptionPreset(value: unknown): HtmlVideoCaptionPreset {
  if (value === undefined) return 'classic';
  if (typeof value !== 'string' || !HTML_VIDEO_CAPTION_PRESETS.includes(value as HtmlVideoCaptionPreset)) {
    throw invalidCaptionConfig('captionPreset is invalid');
  }
  return value as HtmlVideoCaptionPreset;
}

export function validateHtmlVideoCaptionAnimation(value: unknown): HtmlVideoCaptionAnimation {
  if (value === undefined) return 'fade-up';
  if (typeof value !== 'string' || !HTML_VIDEO_CAPTION_ANIMATIONS.includes(value as HtmlVideoCaptionAnimation)) {
    throw invalidCaptionConfig('captionAnim is invalid');
  }
  return value as HtmlVideoCaptionAnimation;
}

export function validateHtmlVideoCaptionColors(value: unknown): Partial<Record<HtmlVideoCaptionColorKey, string>> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw invalidCaptionConfig('captionColors is invalid');
  const keys = Object.keys(value);
  if (keys.length > 32) throw invalidCaptionConfig('captionColors exceeds 32 entries');
  const colors: Partial<Record<HtmlVideoCaptionColorKey, string>> = {};
  for (const key of keys) {
    if (!HTML_VIDEO_CAPTION_COLOR_KEYS.includes(key as HtmlVideoCaptionColorKey)) {
      throw invalidCaptionConfig(`captionColors.${key} is not allowed`);
    }
    const color = value[key];
    if (typeof color !== 'string' || !safeCssColorPattern.test(color)) {
      throw invalidCaptionConfig(`captionColors.${key} is not a safe color`);
    }
    colors[key as HtmlVideoCaptionColorKey] = color;
  }
  return colors;
}

export function validateHtmlVideoCaptionLayout(value: unknown): HtmlVideoCaptionLayout {
  if (value === undefined) return { ...HTML_VIDEO_CAPTION_LAYOUT_DEFAULTS };
  if (!isRecord(value)) throw invalidCaptionConfig('captionLayout is invalid');
  const allowed = ['region', 'fontFamily', 'fontSize', 'lineHeight', 'widthPercent', 'align', 'fontWeight'];
  const unknownKey = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknownKey) throw invalidCaptionConfig(`captionLayout.${unknownKey} is not allowed`);
  const layout = { ...HTML_VIDEO_CAPTION_LAYOUT_DEFAULTS, ...value } as Record<string, unknown>;
  if (!HTML_VIDEO_CAPTION_REGIONS.includes(layout.region as HtmlVideoCaptionRegion)) {
    throw invalidCaptionConfig('captionLayout.region is invalid');
  }
  if (!draftFontFamilies.includes(layout.fontFamily as (typeof draftFontFamilies)[number])) {
    throw invalidCaptionConfig('captionLayout.fontFamily is invalid');
  }
  if (!HTML_VIDEO_CAPTION_ALIGNS.includes(layout.align as HtmlVideoCaptionAlign)) {
    throw invalidCaptionConfig('captionLayout.align is invalid');
  }
  requireCaptionNumber(layout.fontSize, 'fontSize', 24, 96);
  requireCaptionNumber(layout.lineHeight, 'lineHeight', 1, 2);
  requireCaptionNumber(layout.widthPercent, 'widthPercent', 40, 96);
  if (!HTML_VIDEO_CAPTION_FONT_WEIGHTS.includes(layout.fontWeight as (typeof HTML_VIDEO_CAPTION_FONT_WEIGHTS)[number])) {
    throw invalidCaptionConfig('captionLayout.fontWeight is invalid');
  }
  return {
    region: layout.region as HtmlVideoCaptionRegion,
    fontFamily: layout.fontFamily as HtmlVideoCaptionLayout['fontFamily'],
    fontSize: Number(layout.fontSize),
    lineHeight: Number(layout.lineHeight),
    widthPercent: Number(layout.widthPercent),
    align: layout.align as HtmlVideoCaptionAlign,
    fontWeight: layout.fontWeight as HtmlVideoCaptionLayout['fontWeight'],
  };
}

export function htmlVideoCaptionLayoutEqual(
  left: HtmlVideoCaptionLayout | undefined,
  right: HtmlVideoCaptionLayout | undefined,
): boolean {
  const a = validateHtmlVideoCaptionLayout(left);
  const b = validateHtmlVideoCaptionLayout(right);
  return a.region === b.region
    && a.fontFamily === b.fontFamily
    && a.fontSize === b.fontSize
    && a.lineHeight === b.lineHeight
    && a.widthPercent === b.widthPercent
    && a.align === b.align
    && a.fontWeight === b.fontWeight;
}

export function htmlVideoCaptionRegionY(region: HtmlVideoCaptionRegion, fallback: number): number {
  if (region === 'top') return 18;
  if (region === 'middle') return 50;
  if (region === 'bottom') return 84;
  return fallback;
}

export function htmlVideoCaptionPickerColor(value: string): string {
  if (!safeCssColorPattern.test(value)) return '#000000';
  const hex = value.slice(1);
  if (hex.length === 3 || hex.length === 4) {
    return `#${hex.slice(0, 3).split('').map((digit) => `${digit}${digit}`).join('')}`;
  }
  return `#${hex.slice(0, 6)}`;
}

export function htmlVideoCaptionColorsEqual(
  left: HtmlVideoCaptionColorOverrides | undefined,
  right: HtmlVideoCaptionColorOverrides | undefined,
): boolean {
  return HTML_VIDEO_CAPTION_COLOR_KEYS.every((key) => left?.[key] === right?.[key]);
}

function invalidCaptionConfig(message: string): AppError {
  return new AppError('HTML_VIDEO_CONFIG_INVALID', `HTML 视频配置无效：${message}`);
}

function requireCaptionNumber(value: unknown, field: string, minimum: number, maximum: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw invalidCaptionConfig(`captionLayout.${field} must be from ${minimum} to ${maximum}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
