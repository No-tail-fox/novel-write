import { z } from 'zod';
import { normalizeAppConfig } from './config-utils';
import type { AppConfig } from './types';

export const VIDEO_LAB_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'] as const;
export const VIDEO_LAB_RESOLUTIONS = ['480P', '720P', '768P', '1080P', '2K', '4K'] as const;
export const VIDEO_REFERENCE_KINDS = ['character', 'scene', 'object', 'style', 'opening', 'transition', 'ending'] as const;
export type VideoReferenceKind = typeof VIDEO_REFERENCE_KINDS[number];
export interface VideoReferenceImage {
  path: string;
  kind: VideoReferenceKind;
  description: string;
}
export const videoLabRecordIdSchema = z.string().uuid();
/** Remote references are forwarded to the provider, never fetched by the desktop app. */
export function isRemoteVideoReference(value: string): boolean {
  // mm_file is a provider identifier, not an RFC URL scheme (it contains an underscore).
  if (/^(?:asset|mm_file):\/\/[^\s/?#@]+(?:\/[^\s]*)?$/u.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname)
      && !url.username && !url.password && !/\s/u.test(value);
  } catch { return false; }
}
const referencePathSchema = z.string().trim().min(1).max(4096).refine(
  (value) => !value.includes('\0') && (/^[A-Za-z]:[\\/]/u.test(value) || /^\/(?!\/)/u.test(value) || isRemoteVideoReference(value)),
  '请选择本地素材，或填写 HTTPS、asset://、mm_file:// 素材地址。',
);
export const videoLabGenerateInputSchema = z.object({
  prompt: z.string().trim().min(1).max(65_536),
  durationSec: z.number().finite().min(1).max(600),
  ratio: z.enum(VIDEO_LAB_RATIOS),
  resolution: z.enum(VIDEO_LAB_RESOLUTIONS).optional(),
  generateAudio: z.boolean().optional(),
  providerId: z.string().trim().min(1).max(256).optional(),
  firstFramePath: referencePathSchema.optional(),
  lastFramePath: referencePathSchema.optional(),
  referenceImagePaths: z.array(referencePathSchema).max(30).optional(),
  referenceImages: z.array(z.object({
    path: referencePathSchema,
    kind: z.enum(VIDEO_REFERENCE_KINDS),
    description: z.string().trim().max(500),
  }).strict()).max(30).optional(),
  referenceVideoPaths: z.array(referencePathSchema).max(10).optional(),
  referenceAudioPaths: z.array(referencePathSchema).max(10).optional(),
}).strict().refine((input) => !input.lastFramePath || Boolean(input.firstFramePath), {
  message: '使用尾帧时请同时选择首帧。', path: ['lastFramePath'],
}).refine((input) => !(input.firstFramePath || input.lastFramePath) || !(
  input.referenceImages?.length || input.referenceImagePaths?.length || input.referenceVideoPaths?.length || input.referenceAudioPaths?.length
), {
  message: '首尾帧生成与多模态参考生成不能混用。', path: ['referenceImages'],
});

export type VideoLabGenerateInput = z.infer<typeof videoLabGenerateInputSchema>;
export interface VideoLabRecord extends VideoLabGenerateInput {
  id: string;
  status: 'running' | 'completed' | 'failed';
  providerId: string;
  providerName: string;
  model: string;
  videoPath: string;
  errorMessage: string;
  createdAt: string;
  finishedAt: string | null;
  estimatedCost: number;
  remoteTaskId?: string;
}

/** A manual generation uses exactly the service selected in this workbench. */
export function videoLabProviderConfig(input: AppConfig, providerId?: string): AppConfig {
  const config = normalizeAppConfig(input);
  const selectedId = providerId ?? config.video.activeProviderId;
  const provider = config.video.providers.find((candidate) => candidate.id === selectedId);
  if (!provider) throw new Error('VIDEO_LAB_PROVIDER_UNAVAILABLE: 请先在设置中配置所选视频生成服务。');
  if (!provider.baseUrl.trim() || !provider.apiKey.trim() || !provider.model.trim()) {
    throw new Error('VIDEO_LAB_PROVIDER_NOT_CONFIGURED: 所选视频生成服务缺少 API 地址、密钥或模型。');
  }
  return {
    ...config,
    video: {
      ...config.video,
      activeProviderId: provider.id,
      providers: [{ ...provider, enabled: true }],
      automation: { ...config.video.automation, providerWhitelist: [provider.id], fallback: 'disabled', retryCount: 0 },
    },
  };
}
