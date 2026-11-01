import { z } from 'zod';
import type { AppConfig, ProjectModels } from './types';
import { activeImageProfileId, activeLlmProfileId, enableImageProfile, enableLlmProfile } from './provider-profile-utils';

const profileId = z.string().trim().min(1).max(256);
export const projectModelsSchema = z.object({
  llmProfileId: profileId,
  imageProfileId: profileId,
  videoProviderId: profileId.nullable(),
}).strict();

/** Defaults are copied once when a project is created or a legacy project is migrated. */
export function defaultProjectModels(config: AppConfig, legacyLlmProfileId?: string | null): ProjectModels {
  return {
    llmProfileId: legacyLlmProfileId || activeLlmProfileId(config),
    imageProfileId: activeImageProfileId(config),
    videoProviderId: config.video.providers.find(profile => profile.id === config.video.activeProviderId)?.id
      ?? config.video.providers[0]?.id ?? null,
  };
}

export function validateProjectModels(config: AppConfig, value: ProjectModels): ProjectModels {
  const models = projectModelsSchema.parse(value);
  if (!config.llmProfiles.some(profile => profile.id === models.llmProfileId)) {
    throw new Error('PROJECT_LLM_PROFILE_MISSING: 项目的语言模型配置已不存在，请在项目模型设置中重新选择。');
  }
  if (!config.imageProfiles.some(profile => profile.id === models.imageProfileId)) {
    throw new Error('PROJECT_IMAGE_PROFILE_MISSING: 项目的生图模型配置已不存在，请在项目模型设置中重新选择。');
  }
  if (models.videoProviderId && !config.video.providers.some(profile => profile.id === models.videoProviderId)) {
    throw new Error('PROJECT_VIDEO_PROFILE_MISSING: 项目的视频模型配置已不存在，请在项目模型设置中重新选择。');
  }
  return models;
}

/** Produces a private runtime view; never updates global defaults or falls back to another provider. */
export function projectRuntimeConfig(config: AppConfig, models: ProjectModels): AppConfig {
  validateProjectModels(config, models);
  const selected = enableImageProfile(enableLlmProfile(config, models.llmProfileId), models.imageProfileId);
  const video = config.video.providers.find(profile => profile.id === models.videoProviderId);
  return {
    ...selected,
    video: {
      ...selected.video,
      activeProviderId: video?.id ?? '',
      providers: video ? [{ ...video, enabled: true }] : [],
      automation: { ...selected.video.automation, providerWhitelist: video ? [video.id] : [] },
    },
  };
}

export function readProjectModelsDraft(raw: unknown, fallback: ProjectModels): ProjectModels {
  try { const parsed = projectModelsSchema.safeParse(typeof raw === 'string' ? JSON.parse(raw) : raw); return parsed.success ? parsed.data : fallback; }
  catch { return fallback; }
}

export function selectedLanguageConfig(config: AppConfig, profileId?: string): AppConfig {
  if (!profileId) return config;
  if (!config.llmProfiles.some(profile => profile.id === profileId)) throw new Error('LLM_PROFILE_MISSING: 所选语言模型配置已删除，请重新选择。');
  return enableLlmProfile(config, profileId);
}
