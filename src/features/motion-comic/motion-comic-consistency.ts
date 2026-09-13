import type { AppMutationResult, ImageLabRecord } from '../../shared/types';
import type {
  MotionComicCharacterLook,
  MotionComicPipelineData,
  MotionComicPropAsset,
  MotionComicShot,
} from '../../shared/motion-comic';
import type { ProductionAssetVersion } from '../../shared/production-workflow';
import { assertProductionHistoryCapacity } from '../../shared/production-history';

export type MotionComicReferenceKind = 'look' | 'scene' | 'prop';

export interface MotionComicReferenceTarget {
  kind: MotionComicReferenceKind;
  id: string;
}

export interface MotionComicShotConsistencyCheck {
  ready: boolean;
  fixedReferenceCount: number;
  missingTargets: string[];
  exceedsProviderLimit: boolean;
}

export interface MotionComicConsistencySummary {
  ready: boolean;
  requiredTargetCount: number;
  readyTargetCount: number;
  fixedReferenceCount: number;
  missingTargets: string[];
  maxReferencesPerShot: number;
  exceedsProviderLimit: boolean;
}

export interface MotionComicReferenceBinding {
  target: MotionComicReferenceTarget;
  label: string;
  assetVersionId: string;
  path: string;
}

export const MAX_MOTION_COMIC_PROVIDER_REFERENCES = 10;

/** Build provider-facing context from the series bible and the shot's stable IDs. */
export function buildMotionComicConsistencyPrompt(
  document: MotionComicPipelineData,
  shot: MotionComicShot,
): string {
  const looks = shot.characterLookIds
    .map((lookId) => findLook(document, lookId))
    .filter((look): look is MotionComicCharacterLook => Boolean(look));
  const characters = looks.map((look) => {
    const character = document.characters.find((candidate) => candidate.id === look.characterId);
    return [
      character?.name,
      character?.role,
      character?.identityPrompt,
      `造型: ${look.label}`,
      `外观: ${look.appearancePrompt}`,
      `服装: ${look.wardrobe}`,
      `连续性: ${look.continuityNotes}`,
    ].filter(Boolean).join(' | ');
  });
  const scene = document.sceneAssets.find((candidate) => candidate.id === shot.sceneAssetId);
  const props = shot.propAssetIds
    .map((propId) => document.props.find((candidate) => candidate.id === propId))
    .filter((prop): prop is MotionComicPropAsset => Boolean(prop))
    .map((prop) => [prop.label, prop.description, prop.prompt].filter(Boolean).join(' | '));
  const sceneContext = scene ? [scene.label, scene.description, scene.prompt, scene.continuityNotes].filter(Boolean).join(' | ') : '';
  const rules = [...document.series.worldRules, ...document.series.visualRules].filter(Boolean);
  const referenceMap = collectMotionComicReferenceBundle(document, shot)
    .map((binding, index) => `Image ${index + 1} = ${binding.label}`)
    .join(' | ');
  return [
    shot.prompt,
    `Layout: ${shot.layoutTemplate ?? '漫画分格 · 角色优先'}. Motion reference: ${shot.motionPreset ?? '轻微视差'}.`,
    characters.length ? `CHARACTER IDENTITY LOCK: ${characters.join(' || ')}` : '',
    sceneContext ? `LOCATION CONTINUITY LOCK: ${sceneContext}` : '',
    props.length ? `PROP CONTINUITY LOCK: ${props.join(' || ')}` : '',
    referenceMap ? `REFERENCE IMAGE ORDER: ${referenceMap}` : '',
    rules.length ? `SERIES RULES: ${rules.join(' | ')}` : '',
    document.series.negativePrompt ? `NEGATIVE PROMPT: ${document.series.negativePrompt}` : '',
    shot.seedLocked && shot.seed ? `Keep the series seed marker ${shot.seed} in this prompt context.` : '',
    'Cinematic motion-comic keyframe. Preserve the named character identity, face geometry, hairstyle, body proportions, wardrobe, location lighting, and recognizable props. No generated text, no watermark.',
  ].filter(Boolean).join('\n');
}

/** Resolve only the fixed version for each target bound to this shot. */
export function collectMotionComicReferencePaths(
  document: MotionComicPipelineData,
  shot: MotionComicShot,
): string[] {
  return collectMotionComicReferenceBundle(document, shot)
    .slice(0, MAX_MOTION_COMIC_PROVIDER_REFERENCES)
    .map((binding) => binding.path);
}

/** Preserve target semantics and deterministic order for provider multi-image requests. */
export function collectMotionComicReferenceBundle(
  document: MotionComicPipelineData,
  shot: MotionComicShot,
): MotionComicReferenceBinding[] {
  const seenPaths = new Set<string>();
  return shotReferenceTargets(shot).flatMap((target) => {
    const asset = fixedMotionComicReferenceAsset(document, referenceIdsForTarget(document, target));
    const path = asset?.localPath?.trim();
    if (!asset || !path || seenPaths.has(path)) return [];
    seenPaths.add(path);
    return [{ target, label: referenceTargetLabel(document, target), assetVersionId: asset.id, path }];
  });
}

export function createMotionComicReferenceAsset(
  record: ImageLabRecord,
  targetId: string,
  kind: MotionComicReferenceKind,
): ProductionAssetVersion {
  const timestamp = record.finishedAt ?? record.createdAt;
  return {
    id: `motion-comic-reference-${record.id}`,
    assetId: `motion-comic-reference-${kind}-${targetId}`,
    kind: 'image',
    uri: `storydream:image-lab/${record.id}`,
    localPath: record.imagePath,
    prompt: record.prompt,
    provider: 'local-import',
    model: 'managed-reference',
    license: '版权待确认',
    createdAt: timestamp,
    selected: true,
    pinned: true,
  };
}

/** Append a version to the target history and make it the sole fixed version. */
export function attachMotionComicReference(
  document: MotionComicPipelineData,
  target: MotionComicReferenceTarget,
  asset: ProductionAssetVersion,
): MotionComicPipelineData {
  assertReferenceTarget(document, target);
  const currentIds = referenceIdsForTarget(document, target);
  const hasAsset = document.assets.some((candidate) => candidate.id === asset.id);
  assertProductionHistoryCapacity(document, { assets: hasAsset ? 0 : 1 });
  const targetVersionIds = new Set([...currentIds, asset.id]);
  const assets = document.assets
    .map((candidate) => {
      if (candidate.id === asset.id) return { ...candidate, ...asset, selected: true, pinned: true };
      if (targetVersionIds.has(candidate.id)) return { ...candidate, selected: false, pinned: false };
      return candidate;
    })
    .concat(hasAsset ? [] : [{ ...asset, selected: true, pinned: true }]);
  const addReference = (ids: string[]) => Array.from(new Set([...ids, asset.id]));
  return updateTargetReferences(document, target, addReference(currentIds), assets);
}

/** Fix one historical version, or pass null to leave this target intentionally unfixed. */
export function setMotionComicFixedReference(
  document: MotionComicPipelineData,
  target: MotionComicReferenceTarget,
  versionId: string | null,
): MotionComicPipelineData {
  assertReferenceTarget(document, target);
  const referenceIds = referenceIdsForTarget(document, target);
  if (versionId && !referenceIds.includes(versionId)) {
    throw new Error(`MOTION_COMIC_REFERENCE_NOT_FOUND: ${versionId}`);
  }
  const referenceIdSet = new Set(referenceIds);
  const assets = document.assets.map((asset) => referenceIdSet.has(asset.id)
    ? { ...asset, selected: asset.id === versionId, pinned: asset.id === versionId }
    : asset);
  return { ...document, assets };
}

export function motionComicReferenceAssets(
  document: MotionComicPipelineData,
  referenceAssetVersionIds: readonly string[],
): ProductionAssetVersion[] {
  const ids = new Set(referenceAssetVersionIds);
  return document.assets.filter((asset) => ids.has(asset.id) && asset.kind === 'image' && Boolean(asset.localPath));
}

export function fixedMotionComicReferenceAsset(
  document: MotionComicPipelineData,
  referenceAssetVersionIds: readonly string[],
): ProductionAssetVersion | undefined {
  const references = motionComicReferenceAssets(document, referenceAssetVersionIds);
  return references.find((asset) => asset.selected === true && asset.pinned === true)
    ?? [...references].reverse().find((asset) => asset.pinned === true);
}

/** Retained for callers that previously asked for the latest visible reference. */
export const latestReferenceAsset = fixedMotionComicReferenceAsset;

export function motionComicReferenceVersionIds(document: MotionComicPipelineData): Set<string> {
  return new Set([
    ...document.characters.flatMap((character) => character.looks.flatMap((look) => look.referenceAssetVersionIds)),
    ...document.sceneAssets.flatMap((scene) => scene.referenceAssetVersionIds),
    ...document.props.flatMap((prop) => prop.referenceAssetVersionIds),
  ]);
}

export function inspectMotionComicShotConsistency(
  document: MotionComicPipelineData,
  shot: MotionComicShot,
): MotionComicShotConsistencyCheck {
  const missingTargets: string[] = [];
  if (shot.characterLookIds.length === 0) missingTargets.push('角色造型未绑定');
  if (!shot.sceneAssetId) missingTargets.push('场景未绑定');
  shotReferenceTargets(shot).forEach((target) => {
    const fixed = fixedMotionComicReferenceAsset(document, referenceIdsForTarget(document, target));
    if (!fixed) missingTargets.push(referenceTargetLabel(document, target));
  });
  const fixedReferenceCount = collectMotionComicReferenceBundle(document, shot).length;
  const exceedsProviderLimit = fixedReferenceCount > MAX_MOTION_COMIC_PROVIDER_REFERENCES;
  return {
    ready: missingTargets.length === 0 && fixedReferenceCount > 0 && !exceedsProviderLimit,
    fixedReferenceCount,
    missingTargets: Array.from(new Set(missingTargets)),
    exceedsProviderLimit,
  };
}

export function motionComicConsistencySummary(document: MotionComicPipelineData): MotionComicConsistencySummary {
  const shots = document.episodes.flatMap((episode) => episode.scenes.flatMap((scene) => scene.shots));
  const targets = uniqueTargets(shots.flatMap(shotReferenceTargets));
  const missingTargets = targets
    .filter((target) => !fixedMotionComicReferenceAsset(document, referenceIdsForTarget(document, target)))
    .map((target) => referenceTargetLabel(document, target));
  if (shots.some((shot) => shot.characterLookIds.length === 0)) missingTargets.push('角色造型未绑定');
  if (shots.some((shot) => !shot.sceneAssetId)) missingTargets.push('场景未绑定');
  const shotChecks = shots.map((shot) => inspectMotionComicShotConsistency(document, shot));
  const fixedIds = new Set(targets.flatMap((target) => {
    const fixed = fixedMotionComicReferenceAsset(document, referenceIdsForTarget(document, target));
    return fixed ? [fixed.id] : [];
  }));
  const uniqueMissingTargets = Array.from(new Set(missingTargets));
  const missingTargetCount = targets.filter((target) => !fixedMotionComicReferenceAsset(document, referenceIdsForTarget(document, target))).length;
  const exceedsProviderLimit = shotChecks.some((check) => check.exceedsProviderLimit);
  return {
    ready: shots.length > 0 && uniqueMissingTargets.length === 0 && !exceedsProviderLimit,
    requiredTargetCount: targets.length,
    readyTargetCount: Math.max(0, targets.length - missingTargetCount),
    fixedReferenceCount: fixedIds.size,
    missingTargets: uniqueMissingTargets,
    maxReferencesPerShot: Math.max(0, ...shotChecks.map((check) => check.fixedReferenceCount)),
    exceedsProviderLimit,
  };
}

export function motionComicConsistencyReady(document: MotionComicPipelineData): boolean {
  return motionComicConsistencySummary(document).ready;
}

export function imageLabRecordIdFromMutation(result: AppMutationResult | null): string {
  if (result?.kind === 'state-patch' && result.patch.kind === 'image-lab-upsert') return result.patch.record.id;
  throw new Error('IMAGE_LAB_IMPORT_RESULT_INVALID: 托管导入没有返回图片记录。');
}

function findLook(document: MotionComicPipelineData, lookId: string): MotionComicCharacterLook | undefined {
  return document.characters.flatMap((character) => character.looks).find((look) => look.id === lookId);
}

export function referenceTargetLabel(
  document: MotionComicPipelineData,
  target: MotionComicReferenceTarget,
): string {
  if (target.kind === 'look') {
    const character = document.characters.find((candidate) => candidate.looks.some((look) => look.id === target.id));
    const look = character?.looks.find((candidate) => candidate.id === target.id);
    return [character?.name, look?.label].filter(Boolean).join(' · ') || '角色造型';
  }
  if (target.kind === 'scene') return document.sceneAssets.find((scene) => scene.id === target.id)?.label ?? '场景';
  return document.props.find((prop) => prop.id === target.id)?.label ?? '道具';
}

function referenceIdsForTarget(document: MotionComicPipelineData, target: MotionComicReferenceTarget): string[] {
  if (target.kind === 'look') return findLook(document, target.id)?.referenceAssetVersionIds ?? [];
  if (target.kind === 'scene') return document.sceneAssets.find((scene) => scene.id === target.id)?.referenceAssetVersionIds ?? [];
  return document.props.find((prop) => prop.id === target.id)?.referenceAssetVersionIds ?? [];
}

function updateTargetReferences(
  document: MotionComicPipelineData,
  target: MotionComicReferenceTarget,
  referenceAssetVersionIds: string[],
  assets: ProductionAssetVersion[],
): MotionComicPipelineData {
  return {
    ...document,
    assets,
    characters: target.kind === 'look'
      ? document.characters.map((character) => ({
        ...character,
        looks: character.looks.map((look) => look.id === target.id ? { ...look, referenceAssetVersionIds } : look),
      }))
      : document.characters,
    sceneAssets: target.kind === 'scene'
      ? document.sceneAssets.map((scene) => scene.id === target.id ? { ...scene, referenceAssetVersionIds } : scene)
      : document.sceneAssets,
    props: target.kind === 'prop'
      ? document.props.map((prop) => prop.id === target.id ? { ...prop, referenceAssetVersionIds } : prop)
      : document.props,
  };
}

function assertReferenceTarget(document: MotionComicPipelineData, target: MotionComicReferenceTarget): void {
  const exists = target.kind === 'look'
    ? Boolean(findLook(document, target.id))
    : target.kind === 'scene'
      ? document.sceneAssets.some((scene) => scene.id === target.id)
      : document.props.some((prop) => prop.id === target.id);
  if (!exists) throw new Error(`MOTION_COMIC_REFERENCE_TARGET_NOT_FOUND: ${target.kind}:${target.id}`);
}

function shotReferenceTargets(shot: MotionComicShot): MotionComicReferenceTarget[] {
  return uniqueTargets([
    ...shot.characterLookIds.map((id) => ({ kind: 'look' as const, id })),
    ...(shot.sceneAssetId ? [{ kind: 'scene' as const, id: shot.sceneAssetId }] : []),
    ...shot.propAssetIds.map((id) => ({ kind: 'prop' as const, id })),
  ]);
}

function uniqueTargets(targets: MotionComicReferenceTarget[]): MotionComicReferenceTarget[] {
  const seen = new Set<string>();
  return targets.filter((target) => {
    const key = `${target.kind}:${target.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
