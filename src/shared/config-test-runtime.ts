import { activeOpenAiImageConfig, normalizeAppConfig, validateConfigTarget, type ConfigValidationOptions } from './config-utils';
import { testOpenAiCompatibleImageModel } from './openai-image';
import type { AppConfig, ConfigTestResult, ConfigTestTarget } from './types';

interface ConfigTestOptions extends ConfigValidationOptions {
  fetchImpl?: typeof fetch;
}

// Provider probes use Node networking and must only be imported by the main process.
export async function testConfigTarget(target: ConfigTestTarget, input: AppConfig, options: ConfigTestOptions = {}): Promise<ConfigTestResult> {
  const fieldResult = validateConfigTarget(target, input, options);
  if (target !== 'image' || fieldResult.status === 'fail') return fieldResult;

  const config = normalizeAppConfig(input);
  if (config.imageProvider !== 'gpt_image' && config.imageProvider !== 'custom') return fieldResult;

  const image = activeOpenAiImageConfig(config);
  const probe = await testOpenAiCompatibleImageModel({
    baseUrl: image.baseUrl,
    apiKey: image.apiKey,
    model: image.model,
    ratio: image.ratio,
    resolution: image.resolution,
    quality: image.quality,
    fetchImpl: options.fetchImpl,
  });

  return {
    target: 'image',
    status: probe.status,
    detail: probe.detail,
    latencyMs: probe.latencyMs,
    endpoint: probe.endpoint,
    requestId: probe.requestId,
  };
}
