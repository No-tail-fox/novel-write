import { AppError } from '../../shared/app-error';
import { assertProductionHistoryCapacity } from '../../shared/production-history';
import type { ImageLabGenerateInput, ImageLabRecord } from '../../shared/types';
import type { MotionComicPipelineData } from '../../shared/motion-comic';
import type { DirectorImageProviderStatus } from '../director-desk/director-generation';
import { attachMotionComicReference, createMotionComicReferenceAsset, fixedMotionComicReferenceAsset, referenceTargetLabel, type MotionComicReferenceTarget } from './motion-comic-consistency';

/** Shared by submission and completion checks so edited asset definitions cannot receive stale results. */
export function motionComicReferenceGenerationInput(
  document: MotionComicPipelineData,
  target: MotionComicReferenceTarget,
  provider: DirectorImageProviderStatus,
): ImageLabGenerateInput {
  let description: string[];
  let references: string[] = [];
  if (target.kind === 'look') {
    const character = document.characters.find((item) => item.looks.some((look) => look.id === target.id));
    const look = character?.looks.find((item) => item.id === target.id);
    if (!character || !look) throw new AppError('MOTION_COMIC_REFERENCE_TARGET_MISSING', '角色造型已不存在，请重新选择。');
    if (!character.identityPrompt.trim() || !look.appearancePrompt.trim()) throw new AppError('MOTION_COMIC_REFERENCE_DEFINITION_REQUIRED', '请先填写角色身份提示词和造型外观。');
    description = ['角色定妆参考图，单一角色，全身或清晰的四分之三身构图，面部与服装细节清晰。',
      `角色：${character.name}。身份：${character.identityPrompt}`, `造型：${look.label}。外观：${look.appearancePrompt}`,
      `服装：${look.wardrobe}。连续性要求：${look.continuityNotes}`];
    const orderedLooks = [look, ...character.looks.filter((item) => item.id !== look.id)];
    references = orderedLooks.flatMap((item) => {
      const asset = fixedMotionComicReferenceAsset(document, item.referenceAssetVersionIds);
      return asset?.localPath ? [asset.localPath] : [];
    });
  } else {
    const asset = target.kind === 'scene' ? document.sceneAssets.find((item) => item.id === target.id) : document.props.find((item) => item.id === target.id);
    if (!asset) throw new AppError('MOTION_COMIC_REFERENCE_TARGET_MISSING', '资产已不存在，请重新选择。');
    if (!asset.prompt.trim()) throw new AppError('MOTION_COMIC_REFERENCE_DEFINITION_REQUIRED', `请先填写${target.kind === 'scene' ? '场景' : '道具'}生成提示词。`);
    description = [target.kind === 'scene' ? '场景空镜参考图，明确空间结构、建筑、光线与氛围，不添加主角。' : '关键道具参考图，单一物件，轮廓、材质和特征清楚，背景简洁，不添加人物。',
      `名称：${asset.label}。描述：${asset.description}`, asset.prompt];
    if ('continuityNotes' in asset) description.push(`连续性要求：${asset.continuityNotes}`);
    const fixed = fixedMotionComicReferenceAsset(document, asset.referenceAssetVersionIds);
    if (fixed?.localPath) references = [fixed.localPath];
  }
  if (references.length && (!provider.supportsReferenceImages || provider.maxReferenceImages < 1)) throw new AppError('MOTION_COMIC_REFERENCE_UNSUPPORTED', '当前图片模型不支持参考图，请切换兼容模型。');
  references = [...new Set(references)].slice(0, provider.maxReferenceImages);
  const prompt = [...description, `视觉规则：${document.series.visualRules.join('；')}`,
    document.series.negativePrompt.trim() ? `避免：${document.series.negativePrompt}` : '',
    '不要字幕、标题、水印或拼贴边框。', references.length ? '严格保留参考图中相同角色的身份或相同资产的外观。' : '',
  ].filter(Boolean).join('\n');
  return {
    prompt, ratio: target.kind === 'look' ? '9:16' : target.kind === 'prop' ? '1:1' : document.ratio,
    style: 'reference', provider: provider.provider, resolution: provider.resolution, quality: provider.quality,
    smartMode: references.length ? 'reference-edit' : 'text-to-image',
    referenceImagePaths: references, referenceImagePath: references[0] ?? '', upstreamTaskId: document.id,
  };
}

export function motionComicReferenceGenerationFingerprint(document: MotionComicPipelineData, target: MotionComicReferenceTarget, provider: DirectorImageProviderStatus): string {
  return JSON.stringify({ target, profileId: provider.profileId, model: provider.model, input: motionComicReferenceGenerationInput(document, target, provider) });
}

export function applyGeneratedMotionComicReference(document: MotionComicPipelineData, target: MotionComicReferenceTarget, record: ImageLabRecord, provider: DirectorImageProviderStatus): MotionComicPipelineData {
  if (record.status !== 'generated' || !record.imagePath) throw new AppError('MOTION_COMIC_REFERENCE_GENERATION_FAILED', record.errorMessage || '图片服务没有返回可用的参考图。', true);
  assertProductionHistoryCapacity(document, { assets: 1, providerJobs: 1 });
  const nodeId = `reference-${target.kind}-${target.id}`;
  const jobId = `motion-comic-reference-job-${record.id}`;
  const timestamp = record.finishedAt ?? record.createdAt;
  const asset = { ...createMotionComicReferenceAsset(record, target.id, target.kind), provider: record.provider, model: provider.model, providerJobId: jobId };
  const next = attachMotionComicReference(document, target, asset);
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
  return `生成 ${referenceTargetLabel(document, target)} 参考图`;
}

/** Compact deterministic dependency marker; not used as a security boundary. */
function referenceInputHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  return `reference-v1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
