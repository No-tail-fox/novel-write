import { defaultConfig } from './config';
import type { VideoProviderConfig } from './types';
import { VIDEO_MODEL_PRESETS, type VideoModelPreset } from './video-models';

/** New profiles never inherit credentials from a different service. */
export function createVideoModelProfile(preset: VideoModelPreset, id: string): VideoProviderConfig {
  const h3 = preset === 'h3' || preset === 'h3-max';
  return {
    ...defaultConfig.video.providers[0], id,
    name: VIDEO_MODEL_PRESETS.find((item) => item.id === preset)?.label ?? '自定义视频服务',
    modelPreset: preset, enabled: false, apiKey: '',
    model: preset === 'h3' ? 'MiniMax-H3' : preset === 'h3-max' ? 'MiniMax-H3-Max'
      : preset === 'seedance-2.0' ? 'doubao-seedance-2-0-260128' : preset === 'seedance-2.5' ? 'doubao-seedance-2-5-260628' : '',
    baseUrl: h3 ? 'https://api.minimax.io' : preset.startsWith('seedance') ? 'https://ark.cn-beijing.volces.com/api/v3' : '',
    submitPath: h3 ? '/v2/video_generation' : preset.startsWith('seedance') ? '/contents/generations/tasks' : '/videos/generations',
    statusPathTemplate: h3 ? '/v2/query/video_generation/{id}' : preset.startsWith('seedance') ? '/contents/generations/tasks/{id}' : '/videos/generations/{id}',
    maxDurationSec: preset === 'seedance-2.5' ? 30 : preset === 'custom' ? 10 : 15,
    maxResolution: preset === 'h3' ? '2K' : preset === 'h3-max' ? '768P' : preset === 'seedance-2.0' ? '4K' : '1080P',
    capabilities: preset === 'custom' ? ['t2v', 'i2v'] : ['t2v', 'i2v', 'first-last-frame', 'reference-image', 'reference-video', 'reference-audio', 'synchronized-audio'],
  };
}
