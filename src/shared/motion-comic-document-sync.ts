import { mergeDirectorSavedDocument } from './director-document-sync';
import type { MotionComicPipelineData } from './motion-comic';

function mergeExisting<T extends { id: string }>(
  live: T[], submitted: T[], saved: T[], merge: (live: T, submitted: T, saved: T) => T,
): T[] {
  const baseline = new Map(submitted.map((item) => [item.id, item]));
  const remote = new Map(saved.map((item) => [item.id, item]));
  // A background reference result must never recreate a locally deleted target.
  const present = new Set(live.map((item) => item.id));
  const merged = live.map((item) => {
    const original = baseline.get(item.id);
    const updated = remote.get(item.id);
    return original && updated ? merge(item, original, updated) : item;
  });
  return [...merged, ...saved.filter((item) => {
    if (baseline.has(item.id) || present.has(item.id)) return false;
    present.add(item.id);
    return true;
  })];
}

function mergeReferences<T extends { referenceAssetVersionIds: string[] }>(live: T, submitted: T, saved: T, availableAssets: Set<string>): T {
  const baseline = new Set(submitted.referenceAssetVersionIds ?? []);
  const present = new Set(live.referenceAssetVersionIds ?? []);
  const additions = (saved.referenceAssetVersionIds ?? []).filter((id) => {
    if (baseline.has(id) || present.has(id) || !availableAssets.has(id)) return false;
    present.add(id);
    return true;
  });
  // Keep local adoption/order/removal decisions; append only new remote candidates.
  return additions.length ? { ...live, referenceAssetVersionIds: [...(live.referenceAssetVersionIds ?? []), ...additions] } : live;
}

/** Reconcile background references without replacing concurrently edited MotionComic metadata. */
export function mergeMotionComicSavedDocument(
  live: MotionComicPipelineData,
  submitted: MotionComicPipelineData,
  saved: MotionComicPipelineData,
  knownSaved?: MotionComicPipelineData,
): MotionComicPipelineData {
  const merged = mergeDirectorSavedDocument(live, submitted, saved, knownSaved);
  if (merged === live || merged === saved) return merged;
  const availableAssets = new Set(merged.assets.map((asset) => asset.id));
  const references = <T extends { referenceAssetVersionIds: string[] }>(item: T, original: T, updated: T) =>
    mergeReferences(item, original, updated, availableAssets);
  const characters = mergeExisting(live.characters ?? [], submitted.characters ?? [], saved.characters ?? [], (character, original, updated) => ({
      ...character,
      ...(character.voiceSampleAssetVersionId === original.voiceSampleAssetVersionId
        && (updated.voiceSampleAssetVersionId === undefined || availableAssets.has(updated.voiceSampleAssetVersionId))
        ? { voiceSampleAssetVersionId: updated.voiceSampleAssetVersionId }
        : {}),
      looks: mergeExisting(character.looks ?? [], original.looks ?? [], updated.looks ?? [], references),
    }));
  const sceneAssets = mergeExisting(live.sceneAssets ?? [], submitted.sceneAssets ?? [], saved.sceneAssets ?? [], references);
  const props = mergeExisting(live.props ?? [], submitted.props ?? [], saved.props ?? [], references);
  const seriesIds = (key: 'characterIds' | 'sceneAssetIds' | 'propAssetIds', targets: { id: string }[]) =>
    mergeReferences(
      { referenceAssetVersionIds: live.series[key] ?? [] },
      { referenceAssetVersionIds: submitted.series[key] ?? [] },
      { referenceAssetVersionIds: saved.series[key] ?? [] },
      new Set(targets.map((item) => item.id)),
    ).referenceAssetVersionIds;
  return {
    ...merged,
    characters,
    sceneAssets,
    props,
    series: {
      ...live.series,
      characterIds: seriesIds('characterIds', characters),
      sceneAssetIds: seriesIds('sceneAssetIds', sceneAssets),
      propAssetIds: seriesIds('propAssetIds', props),
    },
  };
}
