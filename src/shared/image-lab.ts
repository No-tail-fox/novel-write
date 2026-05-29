import { randomUUID } from 'node:crypto';
import { defaultConfig, defaultCustomStyles } from './config';
import { createConfiguredImageGenerator } from './media-providers';
import type { AppConfig, ImageLabGenerateInput, ImageLabRecord, ImagePrompt, StoryboardScene, Task } from './types';

export async function generateImageLabRecord(config: AppConfig, workDir: string, input: ImageLabGenerateInput, signal?: AbortSignal): Promise<ImageLabRecord> {
  const id = input.id ?? randomUUID();
  const createdAt = input.createdAt ?? new Date().toISOString();
  const baseRecord = createBaseRecord(config, input, id, createdAt);
  const prompt = buildImageLabPrompt(input.prompt, input.style);
  const generator = createConfiguredImageGenerator(applyImageLabRequestSize(config, input), workDir);
  const scene: StoryboardScene = {
    id: 1,
    cap: input.prompt,
    descPrompt: prompt,
    durationMs: 1200,
  };
  const imagePrompt: ImagePrompt = {
    sceneId: scene.id,
    cap: scene.cap,
    prompt,
    negativePrompt: imageLabNegativePrompt(input.style),
    style: input.style,
    ratio: input.ratio,
    characterProfile: input.referenceImagePath ? `Reference image: ${input.referenceImagePath}` : '',
  };

  try {
    if (!input.prompt.trim()) {
      throw new Error('Image lab prompt is required.');
    }
    const assets = await generator([scene], [imagePrompt], createImageLabTask(id, input, createdAt, workDir), signal);
    const imagePath = assets[0]?.path;
    if (!imagePath) {
      throw new Error('Image provider did not return a generated image path.');
    }
    return {
      ...baseRecord,
      imagePath,
      status: 'generated',
      errorMessage: '',
      finishedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      ...baseRecord,
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
      finishedAt: new Date().toISOString(),
    };
  }
}

function createBaseRecord(config: AppConfig, input: ImageLabGenerateInput, id: string, createdAt: string): ImageLabRecord {
  return {
    id,
    prompt: input.prompt,
    ratio: input.ratio,
    style: input.style,
    provider: config.imageProvider,
    imagePath: '',
    status: 'failed',
    errorMessage: '',
    resolution: input.resolution ?? activeImageResolution(config),
    referenceImagePath: input.referenceImagePath ?? '',
    upstreamTaskId: input.upstreamTaskId ?? null,
    createdAt,
    finishedAt: null,
  };
}

function createImageLabTask(id: string, input: ImageLabGenerateInput, createdAt: string, workDir: string): Task {
  return {
    id: `image-lab-${id}`,
    title: 'Image Lab',
    inputText: input.prompt,
    status: 'running',
    currentStep: 4,
    track: 'image-lab',
    style: input.style,
    speaker: '',
    ratio: input.ratio,
    templateId: '',
    bgmId: '',
    pausePoints: [],
    outputDir: workDir,
    errorMessage: '',
    createdAt,
    completedAt: null,
    startedAt: createdAt,
    lastHeartbeatAt: null,
    mode: 'paste',
    aiKeyword: '',
    aiSources: [],
    selectedSources: [],
    extraRequirements: '',
    promptTemplateId: null,
    promptTemplateType: null,
    referenceImagePath: input.referenceImagePath ?? '',
    rewriteIntensity: 'standard',
    narrativePov: 'keep-original',
    keepPromotion: false,
    ttsProvider: 'volcengine',
    ttsSpeed: 1,
    storyboardSceneCount: 1,
    step3PromptSnapshot: '',
    failedStep: null,
    retryFromStep: null,
    artifactStatePath: '',
  };
}

function applyImageLabRequestSize(config: AppConfig, input: ImageLabGenerateInput): AppConfig {
  const resolution = input.resolution ?? activeImageResolution(config);
  if (config.imageProvider === 'custom') {
    return { ...config, customImage: { ...config.customImage, ratio: input.ratio, resolution } };
  }
  if (config.imageProvider === 'jimeng') {
    return { ...config, jimeng: { ...config.jimeng, ratio: input.ratio, resolution } };
  }
  return {
    ...config,
    image: { ...config.image, ratio: input.ratio, resolution },
    gptImage: { ...config.gptImage, ratio: input.ratio, resolution },
  };
}

function activeImageResolution(config: AppConfig): ImageLabRecord['resolution'] {
  if (config.imageProvider === 'custom') return config.customImage.resolution ?? defaultConfig.customImage.resolution ?? '2K';
  if (config.imageProvider === 'jimeng') return config.jimeng.resolution;
  return config.gptImage.resolution ?? config.image.resolution ?? '2K';
}

function buildImageLabPrompt(prompt: string, styleId: string): string {
  const style = defaultCustomStyles.find((item) => item.id === styleId);
  if (!style) return prompt;
  return [style.prefix, prompt, style.suffix].filter(Boolean).join('，');
}

function imageLabNegativePrompt(styleId: string): string {
  return defaultCustomStyles.find((item) => item.id === styleId)?.negativePrompt ?? '';
}
