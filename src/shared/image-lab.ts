import { randomUUID } from 'node:crypto';
import { defaultConfig, defaultCustomStyles } from './config';
import { createConfiguredImageGenerator } from './media-providers';
import type { AppConfig, ImageLabGenerateInput, ImageLabRecord, ImageLabSmartMode, ImagePrompt, StoryboardScene, Task } from './types';

export async function generateImageLabRecord(config: AppConfig, workDir: string, input: ImageLabGenerateInput, signal?: AbortSignal): Promise<ImageLabRecord> {
  const id = input.id ?? randomUUID();
  const createdAt = input.createdAt ?? new Date().toISOString();
  const baseRecord = createBaseRecord(config, input, id, createdAt);
  const prompt = buildImageLabPrompt(input.prompt, input.style, input.smartMode ?? 'text-to-image');
  const generator = createConfiguredImageGenerator(applyImageLabRequestSize(config, input), workDir);
  const scene: StoryboardScene = {
    id: 1,
    cap: input.prompt,
    descPrompt: prompt,
    durationMs: 1200,
  };
  const referenceImagePaths = normalizeReferenceImagePaths(input);
  const imagePrompt: ImagePrompt = {
    sceneId: scene.id,
    cap: scene.cap,
    prompt,
    negativePrompt: imageLabNegativePrompt(input.style),
    style: input.style,
    ratio: input.ratio,
    characterProfile: referenceImagePaths.length ? `Reference images: ${referenceImagePaths.join(', ')}` : '',
    referenceImagePaths,
  };

  try {
    if (!input.prompt.trim()) {
      throw new Error('Image lab prompt is required.');
    }
    validateImageLabReferences(input);
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
    smartMode: input.smartMode ?? 'text-to-image',
    referenceImagePaths: normalizeReferenceImagePaths(input),
    referenceImagePath: normalizeReferenceImagePaths(input)[0] ?? '',
    upstreamTaskId: input.upstreamTaskId ?? null,
    createdAt,
    finishedAt: null,
  };
}

function validateImageLabReferences(input: ImageLabGenerateInput): void {
  if (input.smartMode !== 'reference-edit') return;
  const references = normalizeReferenceImagePaths(input);
  if (!references.length) {
    throw new Error('Reference edit requires at least 1 reference image.');
  }
  if (references.length > 10) {
    throw new Error('Reference edit supports at most 10 reference images.');
  }
}

function normalizeReferenceImagePaths(input: ImageLabGenerateInput): string[] {
  if (input.referenceImagePaths?.length) {
    return input.referenceImagePaths.map((path) => path.trim()).filter(Boolean);
  }
  return input.referenceImagePath?.trim() ? [input.referenceImagePath.trim()] : [];
}

function createImageLabTask(id: string, input: ImageLabGenerateInput, createdAt: string, workDir: string): Task {
  return {
    id: `image-lab-${id}`,
    title: 'Image Lab',
    inputText: input.prompt,
    taskKind: 'story',
    processingMode: 'full-auto',
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
    imagePromptReference: '',
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
    musicMv: { rhythmMode: 'lyric-sync', captionStyle: 'karaoke', visualMotif: '', audioPath: '' },
    videoForm: 'narration',
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

function buildImageLabPrompt(prompt: string, styleId: string, smartMode: ImageLabSmartMode): string {
  const style = defaultCustomStyles.find((item) => item.id === styleId);
  const smartPrefix = smartImagePromptPrefix(smartMode);
  const basePrompt = [smartPrefix, prompt].filter(Boolean).join('\n');
  if (!style) return basePrompt;
  return [style.prefix, basePrompt, style.suffix].filter(Boolean).join('，');
}

function smartImagePromptPrefix(smartMode: ImageLabSmartMode): string {
  if (smartMode === 'cover') {
    return '短视频封面，强主体，标题留白，缩略图清晰可读，避免画面内出现随机文字。';
  }
  if (smartMode === 'blog-cover') {
    return '博客封面，横向信息主图，标题留白，适合文章首图，构图克制清晰。';
  }
  if (smartMode === 'podcast-cover') {
    return '播客封面，适合双人播客节目，两位主播或主题物件清晰，标题留白，缩略图识别度高。';
  }
  if (smartMode === 'video-narration') {
    return '旁白视频主视觉，单人讲述感，画面可作为视频封面或分镜起始图。';
  }
  if (smartMode === 'two-host-podcast') {
    return '双人播客视频主视觉，两位主播一问一答，节目感构图，标题留白。';
  }
  if (smartMode === 'reference-edit') {
    return '基于参考图进行一致性改图，保留主体身份和关键特征，只改变用户指定内容。';
  }
  return '';
}

function imageLabNegativePrompt(styleId: string): string {
  return defaultCustomStyles.find((item) => item.id === styleId)?.negativePrompt ?? '';
}
