import { enableImageProfile, normalizedImageProfiles } from './provider-profile-utils';
import type { AppConfig, ImageLabGenerateInput } from './types';

export function selectImageLabProfileConfig(config: AppConfig, input: Pick<ImageLabGenerateInput, 'imageProfileId' | 'provider'>): AppConfig {
  if (!input.imageProfileId) return selectImageLabProviderConfig(config, input.provider);
  if (!config.imageProfiles.some(profile => profile.id === input.imageProfileId)) throw new Error('IMAGE_PROFILE_MISSING: 原生图模型配置已删除，请重新选择模型。');
  return enableImageProfile(config, input.imageProfileId);
}

export function selectImageLabProviderConfig(config: AppConfig, requestedProvider: ImageLabGenerateInput['provider']): AppConfig {
  if (!requestedProvider || requestedProvider === config.imageProvider) return config;
  if (requestedProvider !== 'gpt_image' && requestedProvider !== 'jimeng' && requestedProvider !== 'custom') {
    throw new Error(`Unsupported image lab provider: ${requestedProvider}`);
  }
  const profile = normalizedImageProfiles(config).find((candidate) => candidate.provider === requestedProvider);
  if (profile?.id) return enableImageProfile(config, profile.id);
  return { ...config, imageProvider: requestedProvider };
}

