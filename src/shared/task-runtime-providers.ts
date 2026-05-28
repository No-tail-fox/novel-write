import type { RunTaskOptions } from './runner';
import type { AppConfig } from './types';
import { createOpenAiCompatibleJsonLlm } from './llm-provider';
import { createConfiguredImageGenerator, createConfiguredNarrationSynthesizer, getConfiguredImageConcurrency } from './media-providers';

export function createTaskRuntimeProviders(config: AppConfig, workDir: string): Pick<RunTaskOptions, 'llm' | 'generateImages' | 'imageConcurrency' | 'synthesizeNarration'> {
  return {
    llm: hasUsableLlm(config) ? createOpenAiCompatibleJsonLlm(config.llm) : undefined,
    generateImages: hasUsableImageProvider(config) ? createConfiguredImageGenerator(config, workDir) : undefined,
    imageConcurrency: getConfiguredImageConcurrency(config),
    synthesizeNarration: hasUsableTtsProvider(config) ? createConfiguredNarrationSynthesizer(config, workDir) : undefined,
  };
}

function hasUsableLlm(config: AppConfig): boolean {
  return Boolean(config.llm.apiKey.trim() && config.llm.model.trim());
}

function hasUsableImageProvider(config: AppConfig): boolean {
  if (config.imageProvider === 'mock') return false;
  if (config.imageProvider === 'jimeng') return Boolean(config.jimeng.accessKeyId && config.jimeng.secretAccessKey && config.jimeng.reqKey);
  if (config.imageProvider === 'custom') return Boolean(config.customImage.baseUrl && config.customImage.apiKey && config.customImage.model);
  return Boolean((config.gptImage.apiKey || config.image.apiKey) && (config.gptImage.model || config.image.model));
}

function hasUsableTtsProvider(config: AppConfig): boolean {
  if (config.tts.provider === 'mock') return false;
  if (config.tts.provider === 'minimax') return Boolean(config.tts.minimax.apiKey && config.tts.minimax.model);
  if (config.tts.volcengine.apiKey) {
    return Boolean(config.tts.volcengine.resourceId && (config.tts.volcengine.speaker || config.tts.speaker));
  }
  return Boolean((config.tts.volcengine.appId || config.tts.appId) && (config.tts.volcengine.accessKey || config.tts.accessKey));
}
