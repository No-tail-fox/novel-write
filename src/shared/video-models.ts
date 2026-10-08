import type { VideoProviderConfig } from './types';

export const VIDEO_MODEL_PRESETS = [
  { id: 'h3', label: 'MiniMax H3' },
  { id: 'h3-max', label: 'MiniMax H3 Max' },
  { id: 'seedance-2.0', label: 'Seedance 2.0' },
  { id: 'seedance-2.5', label: 'Seedance 2.5' },
  { id: 'custom', label: '其他 / 自定义模型' },
] as const;
export type VideoModelPreset = typeof VIDEO_MODEL_PRESETS[number]['id'];

/** Explicit presets also identify providers whose model is an opaque deployment ID. */
export function videoModelPreset(provider: Pick<VideoProviderConfig, 'model' | 'modelPreset'>): VideoModelPreset {
  if (provider.modelPreset && provider.modelPreset !== 'custom') return provider.modelPreset;
  if (/minimax[-_ ]?h3(?:\b|_)/iu.test(provider.model)) return /h3[-_ ]max(?:\b|_)/iu.test(provider.model) ? 'h3-max' : 'h3';
  if (/seedance.*2[._-]?5(?:\D|$)/iu.test(provider.model)) return 'seedance-2.5';
  if (/seedance.*2[._-]?0(?:\D|$)/iu.test(provider.model)) return 'seedance-2.0';
  return 'custom';
}

export function videoModelLimits(provider: Pick<VideoProviderConfig, 'model' | 'modelPreset' | 'maxDurationSec' | 'maxResolution'>) {
  const preset = videoModelPreset(provider);
  const h3 = preset === 'h3' || preset === 'h3-max';
  const seedance = preset === 'seedance-2.0' || preset === 'seedance-2.5';
  return {
    preset, family: h3 ? 'h3' as const : seedance ? 'seedance' as const : 'generic' as const,
    minDuration: preset === 'h3-max' ? 5 : h3 || seedance ? 4 : 1,
    maxDuration: Math.min(provider.maxDurationSec, preset === 'seedance-2.5' ? 30 : h3 || seedance ? 15 : 600),
    resolutions: preset === 'h3' ? ['768P', '2K'] : preset === 'h3-max' ? ['480P', '768P']
      : preset === 'seedance-2.0' ? /fast|mini/iu.test(provider.model) ? ['480P', '720P'] : ['480P', '720P', '1080P', '4K']
        : seedance ? ['480P', '720P', '1080P'] : [provider.maxResolution.toUpperCase()],
    images: preset === 'seedance-2.5' ? 30 : 9,
    videos: preset === 'seedance-2.5' ? 10 : 3,
    audio: preset === 'seedance-2.5' ? 10 : 3,
  };
}

export function videoReferenceToken(provider: Pick<VideoProviderConfig, 'model' | 'modelPreset'>, type: 'Image' | 'Video' | 'Audio', index: number): string {
  return videoModelPreset(provider).startsWith('seedance') ? `@${type}${index + 1}`
    : `${type === 'Image' ? '参考图片' : type === 'Video' ? '参考视频' : '参考音频'} ${index + 1}`;
}
