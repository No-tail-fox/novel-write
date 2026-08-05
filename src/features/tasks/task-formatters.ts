import { normalizeStoryboardSceneCount, normalizeTargetLength } from '../../shared/content-metrics';
import { defaultCustomStyles } from '../../shared/config';
import { contentTracks } from '../../shared/editorial-options';
import { selectTaskPromptTemplate } from '../../shared/prompt-templates';
import type {
  AiSourceSection,
  AppConfig,
  AppMutationResult,
  BgmItem,
  BookProductInfo,
  DraftTemplate,
  ManagedBgmImport,
  PromptTemplate,
  TaskSummary,
  CustomStyle,
} from '../../shared/types';

const taskTrackLabelById = new Map(contentTracks.map(([id, label]) => [id, label] as const));

export function formatDuration(start: string, end: string | null, now = Date.now()): string {
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : now;
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return '--';
  const seconds = Math.max(0, Math.floor((endMs - startMs) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}:${String(rest).padStart(2, '0')}` : `0:${String(rest).padStart(2, '0')}`;
}

export function countChars(value?: string): number {
  return value?.trim().length ?? 0;
}

export function parseBookProductInfo(value: string | null): BookProductInfo | null {
  if (!value?.trim()) return null;
  try {
    const parsed = JSON.parse(value) as BookProductInfo;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function productInfoSummary(value: string | null): string {
  const product = parseBookProductInfo(value);
  if (!product) return trimForPreview(value ?? '', 42);
  return [product.name, product.author, product.sellPoint || product.category].filter(Boolean).join(' · ') || '已带入商品信息';
}

export function emptyToUndefined(value: string): string | undefined {
  return value.trim() || undefined;
}

export function trimForPreview(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function formatTaskOperationTime(value: string, now = Date.now()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const current = new Date(now);
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const sameDay = date.getFullYear() === current.getFullYear()
    && date.getMonth() === current.getMonth()
    && date.getDate() === current.getDate();
  if (sameDay && Math.abs(current.getTime() - date.getTime()) < 60_000) return '刚刚';
  if (sameDay) return `今天 ${clock}`;
  const yesterday = new Date(current);
  yesterday.setDate(current.getDate() - 1);
  const isYesterday = date.getFullYear() === yesterday.getFullYear()
    && date.getMonth() === yesterday.getMonth()
    && date.getDate() === yesterday.getDate();
  if (isYesterday) return `昨天 ${clock}`;
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${clock}`;
}

export function taskHistoryTypeLabel(task: Pick<TaskSummary, 'taskType' | 'track'>): string {
  if (task.taskType === 'html-video') return 'HTML 动画';
  if (task.taskType === 'music-mv') return '音乐 MV';
  return taskTrackLabelById.get(task.track) ?? task.track;
}

export function resolvePromptTemplateForTrack(
  templates: PromptTemplate[],
  track: string,
  overrideId?: string | null,
): PromptTemplate | null {
  return selectTaskPromptTemplate(templates, { track, promptTemplateId: overrideId ?? null });
}

export function draftTemplateImageRatio(templates: DraftTemplate[], templateId: string): string {
  return templates.find((template) => template.id === templateId)?.image.ratio ?? templates[0]?.image.ratio ?? '9:16';
}

export function defaultTaskDraftTemplateId(templates: DraftTemplate[]): string {
  return templates[0]?.id ?? 'default-portrait-9-16';
}

export function draftTemplateLabel(templateId: string, templates: DraftTemplate[]): string {
  return templates.find((template) => template.id === templateId)?.name ?? templateId;
}

export function characterPolicyLabel(policy: PromptTemplate['characterPolicy']): string {
  if (policy === 'force-extract') return '强制提取';
  if (policy === 'force-skip') return '强制跳过';
  return '跟随赛道';
}

export function referenceKindLabel(kind: PromptTemplate['referenceKind']): string {
  if (kind === 'face') return '人脸';
  if (kind === 'product') return '产品';
  return '无';
}

export function validBgmItems(config: AppConfig): BgmItem[] {
  return config.jianying.bgmLibrary.filter((bgm) => bgm.id.trim() && bgm.path.trim());
}

export function resolveDefaultBgmId(config: AppConfig): string {
  const bgms = validBgmItems(config);
  return bgms.some((bgm) => bgm.id === config.jianying.defaultBgmId) ? config.jianying.defaultBgmId : bgms[0]?.id ?? '';
}

export function addUploadedBgm(config: AppConfig, audio: string | ManagedBgmImport): { config: AppConfig; bgmId: string } {
  const id = `bgm-${crypto.randomUUID()}`;
  const audioPath = typeof audio === 'string' ? audio : audio.path;
  const item: BgmItem = {
    id,
    title: typeof audio === 'string' ? audioTitleFromPath(audioPath) : audio.title,
    path: audioPath,
    ...(typeof audio === 'string' ? {} : { managedFileName: audio.managedFileName }),
    durationMs: 0,
    volume: 0.25,
  };
  const existingDefaultId = resolveDefaultBgmId(config);
  return {
    config: {
      ...config,
      jianying: {
        ...config.jianying,
        bgmLibrary: [...validBgmItems(config), item],
        defaultBgmId: existingDefaultId || id,
      },
    },
    bgmId: id,
  };
}

export function audioTitleFromPath(path: string): string {
  const filename = path.split(/[\\/]/u).pop() || 'BGM';
  return filename.replace(/\.[^.]+$/u, '') || filename;
}

export function normalizeTaskTargetLength(value: string): number | undefined {
  return normalizeTargetLength(value) ?? undefined;
}

export function normalizeTaskStoryboardSceneCount(value: string): number | undefined {
  return normalizeStoryboardSceneCount(value) ?? undefined;
}

export function normalizeLockIntroSentencesInput(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(20, Math.max(0, Math.trunc(parsed)));
}

export function toggleArray(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function sourceKey(source: AiSourceSection, index: number): string {
  return source.url || `${source.title}-${index}`;
}

export function taskFromMutation(result: AppMutationResult | null): TaskSummary | null {
  return result?.kind === 'task-upsert' ? result.task : null;
}

export function styleLabel(id: string, styles: CustomStyle[] = defaultCustomStyles): string {
  return [...defaultCustomStyles, ...styles].find((style) => style.id === id)?.name ?? id;
}

export function activeImageConcurrency(config: AppConfig): number {
  if (config.imageProvider === 'custom') return config.customImage.concurrency;
  if (config.imageProvider === 'jimeng') return config.jimeng.concurrency;
  return config.gptImage.concurrency ?? config.image.concurrency;
}

export function toLocalImageUrl(path: string): string {
  if (/^(https?:|file:|data:|blob:)/i.test(path)) return path;
  const normalized = path.replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(normalized)) return `file:///${encodeURI(normalized)}`;
  if (normalized.startsWith('/')) return `file://${encodeURI(normalized)}`;
  return encodeURI(normalized);
}

export function toLocalAssetUrl(path: string): string {
  return toLocalImageUrl(path);
}

export function formatMs(value: number): string {
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
