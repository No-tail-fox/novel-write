import { z } from 'zod';
import { normalizeAppConfig } from './config-utils';
import type { AppConfig } from './types';

export const VIDEO_LAB_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] as const;
export const videoLabRecordIdSchema = z.string().uuid();
const referencePathSchema = z.string().trim().min(1).max(4096).refine(
  (value) => !value.includes('\0') && (/^[A-Za-z]:[\\/]/u.test(value) || /^\/(?!\/)/u.test(value)),
  '请选择本地图片文件。',
);
export const videoLabGenerateInputSchema = z.object({
  prompt: z.string().trim().min(1).max(65_536),
  durationSec: z.number().finite().min(1).max(600),
  ratio: z.enum(VIDEO_LAB_RATIOS),
  providerId: z.string().trim().min(1).max(256).optional(),
  firstFramePath: referencePathSchema.optional(),
  lastFramePath: referencePathSchema.optional(),
  referenceImagePaths: z.array(referencePathSchema).max(8).optional(),
}).strict().refine((input) => !input.lastFramePath || Boolean(input.firstFramePath), {
  message: '使用尾帧时请同时选择首帧。', path: ['lastFramePath'],
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
  if (!provider?.enabled) throw new Error('VIDEO_LAB_PROVIDER_UNAVAILABLE: 请先在设置中配置并启用所选视频生成服务。');
  if (!provider.baseUrl.trim() || !provider.apiKey.trim() || !provider.model.trim()) {
    throw new Error('VIDEO_LAB_PROVIDER_NOT_CONFIGURED: 所选视频生成服务缺少 API 地址、密钥或模型。');
  }
  return {
    ...config,
    video: {
      ...config.video,
      activeProviderId: provider.id,
      providers: [provider],
      automation: { ...config.video.automation, providerWhitelist: [provider.id], fallback: 'disabled', retryCount: 0 },
    },
  };
}
