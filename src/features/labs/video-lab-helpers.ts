import type { SecretStatus } from '../../shared/config-secrets';
import { VIDEO_LAB_RATIOS, type VideoLabGenerateInput, type VideoLabRecord } from '../../shared/video-lab';
import type { VideoProviderConfig } from '../../shared/types';

export interface VideoLabDraft {
  prompt: string;
  providerId: string;
  durationSec: number;
  ratio: string;
  firstFramePath: string;
  lastFramePath: string;
  referenceImagePaths: string;
}

export function videoLabReferences(value: string): string[] {
  return Array.from(new Set(value.split(/\r?\n/u).map((path) => path.trim()).filter(Boolean)));
}

export function videoLabInput(draft: VideoLabDraft): VideoLabGenerateInput {
  const references = videoLabReferences(draft.referenceImagePaths);
  return {
    prompt: draft.prompt.trim(),
    providerId: draft.providerId,
    durationSec: draft.durationSec,
    ratio: draft.ratio as VideoLabGenerateInput['ratio'],
    ...(draft.firstFramePath ? { firstFramePath: draft.firstFramePath } : {}),
    ...(draft.lastFramePath ? { lastFramePath: draft.lastFramePath } : {}),
    ...(references.length ? { referenceImagePaths: references } : {}),
  };
}

export function videoLabRecordDraft(record: VideoLabRecord): VideoLabDraft {
  return {
    prompt: record.prompt,
    providerId: record.providerId,
    durationSec: record.durationSec,
    ratio: record.ratio,
    firstFramePath: record.firstFramePath ?? '',
    lastFramePath: record.lastFramePath ?? '',
    referenceImagePaths: (record.referenceImagePaths ?? []).join('\n'),
  };
}

export function videoLabProviderIssue(provider: VideoProviderConfig | undefined, secrets: SecretStatus): string {
  if (!provider) return '请选择视频生成服务。';
  if (!provider.enabled) return '当前视频服务尚未启用，请在设置中启用。';
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
  if (!(VIDEO_LAB_RATIOS as readonly string[]).includes(draft.ratio)) return '请选择有效的画面比例。';
  if (draft.lastFramePath && !draft.firstFramePath) return '使用尾帧时请同时选择首帧。';
  const references = videoLabReferences(draft.referenceImagePaths);
  if (references.length > 8) return '最多支持 8 张参考图。';
  if (provider) {
    if (draft.firstFramePath && !provider.capabilities.includes('i2v')) return '当前服务不支持首帧图生视频，请更换服务或移除首帧。';
    if (draft.lastFramePath && !provider.capabilities.includes('first-last-frame')) return '当前服务不支持首尾帧，请更换服务或移除尾帧。';
    if (references.length && !provider.capabilities.includes('reference-image')) return '当前服务不支持参考图，请更换服务或移除参考图。';
    if (!draft.firstFramePath && !references.length && !provider.capabilities.includes('t2v')) return '当前服务不支持纯文本生成，请添加首帧或参考图。';
    if (provider.pricePerSecond * draft.durationSec > budgetLimit) return '预计费用超过视频生成预算，请调整时长或在设置中调整预算。';
  }
  return '';
}
