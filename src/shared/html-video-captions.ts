import { AppError } from './app-error';
import type { HtmlVideoJobConfig } from './types';

export const HTML_VIDEO_CAPTION_PRESETS = ['classic', 'editorial', 'karaoke'] as const;
export const HTML_VIDEO_CAPTION_ANIMATIONS = ['none', 'fade-up', 'pop'] as const;
export const HTML_VIDEO_CAPTION_COLOR_KEYS = ['text', 'accent', 'background', 'shadow'] as const;

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
  config: Pick<HtmlVideoJobConfig, 'captionPreset' | 'captionAnim' | 'captionColors'>,
  options: { reducedMotion?: boolean } = {},
): ResolvedHtmlVideoCaptionStyle {
  const preset = validateHtmlVideoCaptionPreset(config.captionPreset);
  const requestedAnimation = validateHtmlVideoCaptionAnimation(config.captionAnim);
  const overrides = validateHtmlVideoCaptionColors(config.captionColors);
  const reducedMotion = options.reducedMotion === true;
  return {
    preset,
    animation: reducedMotion ? 'none' : requestedAnimation,
    requestedAnimation,
    reducedMotion,
    colors: { ...captionPresetColors[preset], ...overrides },
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
