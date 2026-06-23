import type { RunTaskOptions } from './runner';
import type { AppConfig, Task } from './types';
import { createConfiguredJsonLlm } from './llm-provider';
import { createConfiguredImageGenerator, createConfiguredNarrationSynthesizer, getConfiguredImageConcurrency } from './media-providers';

export function createTaskRuntimeProviders(config: AppConfig, workDir: string, task?: Pick<Task, 'llmProfileId'>): Pick<RunTaskOptions, 'llm' | 'generateImages' | 'imageConcurrency' | 'synthesizeNarration'> {
  const llm = task?.llmProfileId ? config.llmProfiles.find((profile) => profile.id === task.llmProfileId) ?? config.llm : config.llm;
  return {
    llm: hasUsableLlm(llm) ? createConfiguredJsonLlm(llm) : undefined,
    generateImages: hasUsableImageProvider(config) ? createConfiguredImageGenerator(config, workDir) : undefined,
    imageConcurrency: getConfiguredImageConcurrency(config),
    synthesizeNarration: hasUsableTtsProvider(config) ? createConfiguredNarrationSynthesizer(config, workDir) : undefined,
  };
}

function hasUsableLlm(config: AppConfig['llm']): boolean {
  return Boolean(config.apiKey.trim() && config.model.trim());
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
  if (config.tts.volcengine.apiKey) return true;
  return Boolean((config.tts.volcengine.appId || config.tts.appId) && (config.tts.volcengine.accessKey || config.tts.accessKey));
}
