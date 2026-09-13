import { normalizeAppConfig } from './config-utils';
import type { AppConfig, VideoCapability, VideoGenerationFallback, VideoProviderConfig } from './types';

export interface VideoGenerationRouteRequest {
  durationSec: number;
  requiredCapabilities: readonly VideoCapability[];
  remainingBudget: number;
}

export type VideoGenerationRoute =
  | { kind: 'provider'; provider: VideoProviderConfig; estimatedCost: number }
  | { kind: 'fallback'; fallback: Exclude<VideoGenerationFallback, 'disabled'>; reason: string }
  | { kind: 'unavailable'; reason: string };

/** Browser-safe provider selection shared by renderer preflight and the main-process executor. */
export function selectVideoGenerationRoute(
  input: AppConfig,
  request: VideoGenerationRouteRequest,
): VideoGenerationRoute {
  const config = normalizeAppConfig(input);
  const durationSec = normalizedDurationSec(request.durationSec);
  const budget = normalizedRemainingBudget(request.remainingBudget);
  const whitelist = new Set(config.video.automation.providerWhitelist);
  const candidates = config.video.providers
    .filter((provider) => provider.enabled && whitelist.has(provider.id))
    .filter((provider) => request.requiredCapabilities.every((capability) => provider.capabilities.includes(capability)))
    .filter((provider) => durationSec <= provider.maxDurationSec)
    .sort((left, right) => {
      if (left.id === config.video.activeProviderId) return -1;
      if (right.id === config.video.activeProviderId) return 1;
      return left.pricePerSecond - right.pricePerSecond;
    });
  const selected = candidates.find((provider) => provider.pricePerSecond * durationSec <= budget);
  if (selected) {
    return { kind: 'provider', provider: selected, estimatedCost: selected.pricePerSecond * durationSec };
  }
  const reason = candidates.length ? '本次生成会超过剩余预算。' : '没有满足能力、时长和白名单要求的云端视频 Provider。';
  if (config.video.automation.fallback !== 'disabled') {
    return { kind: 'fallback', fallback: config.video.automation.fallback, reason };
  }
  return { kind: 'unavailable', reason };
}

function normalizedDurationSec(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('VIDEO_PROVIDER_DURATION_INVALID: 视频时长必须是大于 0 的有限数字。');
  }
  return Math.max(1, value);
}

function normalizedRemainingBudget(value: number): number {
  if (value === Number.POSITIVE_INFINITY) return value;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('VIDEO_PROVIDER_BUDGET_INVALID: 视频生成剩余预算必须是非负有限数字或正无穷。');
  }
  return value;
}
