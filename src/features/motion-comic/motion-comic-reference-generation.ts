import { AppError } from '../../shared/app-error';
import { assertProductionHistoryCapacity } from '../../shared/production-history';
import type { ImageLabGenerateInput, ImageLabRecord } from '../../shared/types';
import type { MotionComicCharacter, MotionComicCharacterLook, MotionComicPipelineData } from '../../shared/motion-comic';
import type { DirectorImageProviderStatus } from '../director-desk/director-generation';
import { attachMotionComicReference, createMotionComicReferenceAsset, fixedMotionComicReferencePaths, referenceTargetLabel, type MotionComicReferenceTarget } from './motion-comic-consistency';

/** Pinned images of the edited look that may join one request alongside other-cast identity sheets. */
const PROVIDER_IMAGE_SLOTS = 3;

export type MotionComicReferenceView = 'front' | 'side' | 'back';
export interface MotionComicReferenceGenerationOptions { composeMultiple?: boolean; view?: MotionComicReferenceView }
const viewLabels = { front: '正面', side: '侧面', back: '背面' } as const;

export function defaultMotionComicLookReferencePrompt(character: MotionComicCharacter, look: MotionComicCharacterLook): string {
  return ['角色定妆参考图，单一角色，全身构图，面部与服装细节清晰。',
    `角色：${character.name}。身份：${character.identityPrompt}`, `造型：${look.label}。外观：${look.appearancePrompt}`,
    `服装：${look.wardrobe}。连续性要求：${look.continuityNotes}`].join('\n');
}

export function motionComicReferenceGenerationRequests(document: MotionComicPipelineData, target: MotionComicReferenceTarget, provider: DirectorImageProviderStatus, options: MotionComicReferenceGenerationOptions = {}) {
  const views: Array<MotionComicReferenceView | undefined> = target.kind === 'look' ? ['front', 'side', 'back'] : [undefined];
  return views.map(view => ({ view, input: motionComicReferenceGenerationInput(document, target, provider, { ...options, view }) }));
}

/** Shared by submission and completion checks so edited asset definitions cannot receive stale results. */
export function motionComicReferenceGenerationInput(
  document: MotionComicPipelineData,
  target: MotionComicReferenceTarget,
  provider: DirectorImageProviderStatus,
  options: MotionComicReferenceGenerationOptions = {},
): ImageLabGenerateInput {
  let description: string[];
  let references: string[] = [];
  if (target.kind === 'look') {
    const character = document.characters.find((item) => item.looks.some((look) => look.id === target.id));
    const look = character?.looks.find((item) => item.id === target.id);
    if (!character || !look) throw new AppError('MOTION_COMIC_REFERENCE_TARGET_MISSING', '角色造型已不存在，请重新选择。');
    if (!character.identityPrompt.trim() || !look.appearancePrompt.trim()) throw new AppError('MOTION_COMIC_REFERENCE_DEFINITION_REQUIRED', '请先填写角色身份提示词和造型外观。');
    const defaultPrompt = defaultMotionComicLookReferencePrompt(character, look);
    description = look.referencePrompt?.trim() && look.referencePrompt.trim() !== defaultPrompt
      ? [look.referencePrompt.trim(), `角色：${character.name}。身份：${character.identityPrompt}`, `造型：${look.label}。外观：${look.appearancePrompt}`, `服装：${look.wardrobe}。连续性要求：${look.continuityNotes}`]
      : [defaultPrompt];
    if (options.view) description.push(`本次只生成一张${viewLabels[options.view]}全身图：${options.view === 'front' ? '人物正对镜头' : options.view === 'side' ? '人物呈严格侧面，展示身体侧面轮廓' : '人物背对镜头，展示后脑、后背与服装背部'}。保持同一人物、同一造型与服装。不得生成三视图拼图、分格或多个角度。`);
    // Legacy look inputs mirror the visible input editor; never add hidden inputs from other looks.
    references = look.generationReferenceImagePaths ?? fixedMotionComicReferencePaths(document, look.referenceAssetVersionIds);
  } else {
    const asset = target.kind === 'scene' ? document.sceneAssets.find((item) => item.id === target.id) : document.props.find((item) => item.id === target.id);
    if (!asset) throw new AppError('MOTION_COMIC_REFERENCE_TARGET_MISSING', '资产已不存在，请重新选择。');
    if (!asset.prompt.trim()) throw new AppError('MOTION_COMIC_REFERENCE_DEFINITION_REQUIRED', `请先填写${target.kind === 'scene' ? '场景' : '道具'}生成提示词。`);
    description = [target.kind === 'scene' ? '场景空镜参考图，明确空间结构、建筑、光线与氛围，不添加主角。' : '关键道具参考图，单一物件，轮廓、材质和特征清楚，背景简洁，不添加人物。',
      `名称：${asset.label}。描述：${asset.description}`, asset.prompt];
    if ('continuityNotes' in asset) description.push(`连续性要求：${asset.continuityNotes}`);
    references = fixedMotionComicReferencePaths(document, asset.referenceAssetVersionIds).slice(0, options.composeMultiple ? 1 + PROVIDER_IMAGE_SLOTS : 1);
  }
  if (references.length && (!provider.supportsReferenceImages || provider.maxReferenceImages < 1)) throw new AppError('MOTION_COMIC_REFERENCE_UNSUPPORTED', '当前图片模型不支持参考图，请切换兼容模型。');
  references = [...new Set(references)].slice(0, provider.maxReferenceImages);
  const prompt = [...description, `视觉规则：${document.series.visualRules.join('；')}`,
    document.series.negativePrompt.trim() ? `避免：${document.series.negativePrompt}` : '',
    '不要字幕、标题、水印或拼贴边框。', references.length > 1
      ? '严格保留参考图中相同角色的身份，结合各参考图的角度、服装与细节生成同一角色的统一形象。'
      : references.length ? '严格保留参考图中相同角色的身份或相同资产的外观。' : '',
  ].filter(Boolean).join('\n');
  return {
    prompt, ratio: target.kind === 'look' ? '9:16' : target.kind === 'prop' ? '1:1' : document.ratio,
    style: 'reference', provider: provider.provider, resolution: provider.resolution, quality: provider.quality,
    smartMode: references.length ? 'reference-edit' : 'text-to-image',
    referenceImagePaths: references, referenceImagePath: references[0] ?? '', upstreamTaskId: document.id,
  };
}

export function motionComicReferenceGenerationFingerprint(document: MotionComicPipelineData, target: MotionComicReferenceTarget, provider: DirectorImageProviderStatus, options: MotionComicReferenceGenerationOptions = {}): string {
  return JSON.stringify({ target, profileId: provider.profileId, model: provider.model, composeMultiple: options.composeMultiple === true, input: motionComicReferenceGenerationInput(document, target, provider, options) });
}

export function applyGeneratedMotionComicReference(document: MotionComicPipelineData, target: MotionComicReferenceTarget, record: ImageLabRecord, provider: DirectorImageProviderStatus, options: MotionComicReferenceGenerationOptions = {}): MotionComicPipelineData {
  if (record.status !== 'generated' || !record.imagePath) throw new AppError('MOTION_COMIC_REFERENCE_GENERATION_FAILED', record.errorMessage || '图片服务没有返回可用的参考图。', true);
  assertProductionHistoryCapacity(document, { assets: 1, providerJobs: 1 });
  const nodeId = `reference-${target.kind}-${target.id}`;
  const jobId = `motion-comic-reference-job-${record.id}`;
  const timestamp = record.finishedAt ?? record.createdAt;
  const asset = { ...createMotionComicReferenceAsset(record, target.id, target.kind), provider: record.provider, model: provider.model, providerJobId: jobId, ...(options.view ? { referenceRole: options.view } : {}) };
  const next = attachMotionComicReference(document, target, asset, { setFixed: false });
  return { ...next, providerJobs: [...next.providerJobs, {
    id: jobId, workflowKind: 'motion-comic', nodeId, providerId: provider.profileId, model: provider.model,
    capability: record.referenceImagePaths.length ? 'image-edit' : 'text-to-image', status: 'completed',
    inputHash: referenceInputHash(JSON.stringify({ prompt: record.prompt, references: record.referenceImagePaths })),
    idempotencyKey: jobId, estimatedCost: 0,
    attempt: document.providerJobs.filter((job) => job.nodeId === nodeId).length + 1,
    createdAt: timestamp, updatedAt: timestamp,
  }] };
}

export function motionComicReferenceGenerationLabel(document: MotionComicPipelineData, target: MotionComicReferenceTarget): string {
  return `生成 ${referenceTargetLabel(document, target)} 参考图候选`;
}

/** Compact deterministic dependency marker; not used as a security boundary. */
function referenceInputHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  return `reference-v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
