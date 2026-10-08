import type { SecretStatus } from '../../shared/config-secrets';
import { VIDEO_LAB_RATIOS, VIDEO_LAB_RESOLUTIONS, type VideoLabGenerateInput, type VideoLabRecord, type VideoReferenceImage } from '../../shared/video-lab';
import type { VideoProviderConfig } from '../../shared/types';
import { videoModelLimits, videoModelPreset, type VideoModelPreset } from '../../shared/video-models';

export interface VideoLabDraft {
  mode: 'text' | 'frames' | 'references';
  prompt: string;
  providerId: string;
  modelPreset?: VideoModelPreset;
  durationSec: number;
  ratio: string;
  resolution: string;
  generateAudio: boolean;
  firstFramePath: string;
  lastFramePath: string;
  referenceImages: VideoReferenceImage[];
  referenceVideoPaths: string[];
  referenceAudioPaths: string[];
}

export function videoLabReferences(value: string): string[] {
  return Array.from(new Set(value.split(/\r?\n/u).map((path) => path.trim()).filter(Boolean)));
}

export function videoLabInput(draft: VideoLabDraft): VideoLabGenerateInput {
  return {
    prompt: draft.prompt.trim(),
    providerId: draft.providerId,
    durationSec: draft.durationSec,
    ratio: draft.ratio as VideoLabGenerateInput['ratio'],
    resolution: draft.resolution as VideoLabGenerateInput['resolution'],
    generateAudio: draft.generateAudio,
    ...(draft.mode === 'frames' && draft.firstFramePath ? { firstFramePath: draft.firstFramePath } : {}),
    ...(draft.mode === 'frames' && draft.lastFramePath ? { lastFramePath: draft.lastFramePath } : {}),
    ...(draft.mode === 'references' && draft.referenceImages.length ? { referenceImages: draft.referenceImages } : {}),
    ...(draft.mode === 'references' && draft.referenceVideoPaths.length ? { referenceVideoPaths: draft.referenceVideoPaths } : {}),
    ...(draft.mode === 'references' && draft.referenceAudioPaths.length ? { referenceAudioPaths: draft.referenceAudioPaths } : {}),
  };
}

export function videoLabRecordDraft(record: VideoLabRecord): VideoLabDraft {
  return {
    mode: record.firstFramePath || record.lastFramePath ? 'frames'
      : record.referenceImages?.length || record.referenceImagePaths?.length || record.referenceVideoPaths?.length || record.referenceAudioPaths?.length ? 'references' : 'text',
    prompt: record.prompt,
    providerId: record.providerId,
    modelPreset: videoModelPreset({ model: record.model }),
    durationSec: record.durationSec,
    ratio: record.ratio,
    resolution: record.resolution ?? '720P',
    generateAudio: record.generateAudio ?? true,
    firstFramePath: record.firstFramePath ?? '',
    lastFramePath: record.lastFramePath ?? '',
    referenceImages: record.referenceImages ?? (record.referenceImagePaths ?? []).map((path) => ({ path, kind: 'style' as const, description: '' })),
    referenceVideoPaths: record.referenceVideoPaths ?? [],
    referenceAudioPaths: record.referenceAudioPaths ?? [],
  };
}

export function normalizeVideoLabDraft(value: Partial<VideoLabDraft> & { referenceImagePaths?: string }): VideoLabDraft {
  return {
    mode: value.mode ?? (value.firstFramePath || value.lastFramePath ? 'frames'
      : value.referenceImages?.length || value.referenceImagePaths || value.referenceVideoPaths?.length || value.referenceAudioPaths?.length ? 'references' : 'text'),
    prompt: value.prompt ?? '', providerId: value.providerId ?? '', modelPreset: value.modelPreset, durationSec: value.durationSec ?? 5,
    ratio: value.ratio ?? '16:9', resolution: value.resolution ?? '720P', generateAudio: value.generateAudio ?? true,
    firstFramePath: value.firstFramePath ?? '', lastFramePath: value.lastFramePath ?? '',
    referenceImages: value.referenceImages ?? videoLabReferences(value.referenceImagePaths ?? '').map((path) => ({ path, kind: 'style', description: '' })),
    referenceVideoPaths: value.referenceVideoPaths ?? [], referenceAudioPaths: value.referenceAudioPaths ?? [],
  };
}

export function videoLabModelFamily(model: string): 'h3' | 'seedance' | 'generic' {
  return videoModelLimits({ model, maxDurationSec: 600, maxResolution: '720P' }).family;
}

export function videoLabResolutionOptions(model: string, fallback: string): string[] {
  return videoModelLimits({ model, maxDurationSec: 600, maxResolution: fallback }).resolutions;
}

export function videoLabReferenceLimits(model: string): { images: number; videos: number; audio: number } {
  const { images, videos, audio } = videoModelLimits({ model, maxDurationSec: 600, maxResolution: '720P' });
  return { images, videos, audio };
}

export function videoLabProviderIssue(provider: VideoProviderConfig | undefined, secrets: SecretStatus): string {
  if (!provider) return '请选择视频生成服务。';
  if (!provider.baseUrl.trim() || !provider.model.trim() || !secrets[`video/${encodeURIComponent(provider.id)}/apiKey`]) {
    return '当前视频服务缺少接口地址、模型或 API Key，请在设置中补全。';
  }
  return '';
}

export function videoLabInputIssue(draft: VideoLabDraft, provider: VideoProviderConfig | undefined, budgetLimit: number): string {
  if (!draft.prompt.trim()) return '请填写视频提示词。';
  if (draft.prompt.trim().length > 65_536) return '提示词过长，请缩短至 65536 个字符以内。';
  if (!Number.isFinite(draft.durationSec) || draft.durationSec < 1 || draft.durationSec > 600) return '请输入 1–600 秒的视频时长。';
  if (provider && draft.durationSec > provider.maxDurationSec) return `当前服务最长支持 ${provider.maxDurationSec} 秒。`;
  const limits = videoModelLimits(provider ?? { model: '', modelPreset: draft.modelPreset, maxDurationSec: 600, maxResolution: draft.resolution });
  if (limits.family !== 'generic' && (!Number.isInteger(draft.durationSec) || draft.durationSec < limits.minDuration || draft.durationSec > limits.maxDuration)) return `当前模型支持 ${limits.minDuration}–${limits.maxDuration} 秒，请填写整数。`;
  if (!(VIDEO_LAB_RATIOS as readonly string[]).includes(draft.ratio)) return '请选择有效的画面比例。';
  if (draft.mode === 'frames' && draft.lastFramePath && !draft.firstFramePath) return '使用尾帧时请同时选择首帧。';
  if (draft.mode === 'frames' && !draft.firstFramePath) return '首尾帧模式至少需要一张首帧图片。';
  if (!(VIDEO_LAB_RESOLUTIONS as readonly string[]).includes(draft.resolution)) return '请选择有效的视频分辨率。';
  if (limits.family !== 'generic' && !limits.resolutions.includes(draft.resolution)) return '当前模型不支持此分辨率，请重新选择。';
  if (draft.mode === 'references') {
    if (draft.referenceImages.length > limits.images) return `当前模型最多支持 ${limits.images} 张参考图。`;
    if (draft.referenceVideoPaths.length > limits.videos) return `当前模型最多支持 ${limits.videos} 段参考视频。`;
    if (draft.referenceAudioPaths.length > limits.audio) return `当前模型最多支持 ${limits.audio} 段参考音频。`;
    if (limits.family === 'h3' && draft.referenceImages.length + draft.referenceVideoPaths.length + draft.referenceAudioPaths.length > 12) return 'H3 的参考图片、视频与音频合计最多 12 份。';
    if (limits.family === 'seedance' && draft.referenceVideoPaths.some((path) => !/^https:\/\/|^asset:\/\//u.test(path))) return 'Seedance 参考视频请使用 HTTPS 地址或 asset:// 素材 ID；已选择的本地视频可以保留供其他模型使用。';
  }
  const hasReferences = draft.mode === 'references' && Boolean(draft.referenceImages.length || draft.referenceVideoPaths.length || draft.referenceAudioPaths.length);
  if (draft.mode === 'references' && !hasReferences) return '多模态参考模式至少需要一份参考素材。';
  if (draft.mode === 'references' && limits.preset === 'seedance-2.0' && draft.referenceAudioPaths.length > 0
    && !draft.referenceImages.length && !draft.referenceVideoPaths.length) return 'Seedance 2.0 不能只使用参考音频，请再添加参考图或参考视频。';
  if (provider) {
    if (draft.mode === 'frames' && draft.firstFramePath && !provider.capabilities.includes('i2v')) return '当前服务不支持首帧图生视频，请更换服务或移除首帧。';
    if (draft.mode === 'frames' && draft.lastFramePath && !provider.capabilities.includes('first-last-frame')) return '当前服务不支持首尾帧，请更换服务或移除尾帧。';
    if (draft.mode === 'references' && draft.referenceImages.length && !provider.capabilities.includes('reference-image')) return '当前服务不支持参考图，请更换模型或移除参考图。';
    if (draft.mode === 'references' && draft.referenceVideoPaths.length && !provider.capabilities.includes('reference-video')) return '当前服务不支持参考视频，请更换模型或移除参考视频。';
    if (draft.mode === 'references' && draft.referenceAudioPaths.length && !provider.capabilities.includes('reference-audio')) return '当前服务不支持参考音频，请更换模型或移除参考音频。';
    if (draft.mode === 'text' && !provider.capabilities.includes('t2v')) return '当前服务不支持纯文本生成，请切换到首尾帧或参考素材。';
    if (provider.pricePerSecond * draft.durationSec > budgetLimit) return '预计费用超过视频生成预算，请调整时长或在设置中调整预算。';
  }
  return '';
}
