import type { MotionComicPipelineData } from '../../shared/motion-comic';
import { motionComicSourceEpisodeIdForEpisode } from '../../shared/motion-comic-planning';
import type { MotionComicScriptSnapshot } from '../../shared/motion-comic-script-batch';

export interface MotionComicAssetIdentity {
  kind: 'character' | 'scene' | 'prop';
  id: string;
}

export interface MotionComicAssetEpisodeUsage {
  key: string;
  number: number;
  title: string;
  sourceEpisodeId?: string;
  episodeId?: string;
  script: boolean;
  storyboard: boolean;
}

export function motionComicAssetEpisodeUsages(
  document: MotionComicPipelineData,
  target: MotionComicAssetIdentity,
  snapshot: MotionComicScriptSnapshot | null,
): MotionComicAssetEpisodeUsage[] {
  const usages = new Map<string, MotionComicAssetEpisodeUsage>();
  if (snapshot?.projectId === document.id) {
    const latestTasks = new Map(snapshot.tasks.map((task) => [task.sourceEpisodeId, task]));
    for (const approval of snapshot.approvals) {
      const source = document.sourceDocument?.episodes.find((episode) => episode.id === approval.sourceEpisodeId);
      const task = latestTasks.get(approval.sourceEpisodeId);
      if (!source || approval.stale || !approval.assetsConfirmedAt || task?.id !== approval.taskId
        || task.status !== 'approved' || task.outputRevision !== approval.outputRevision) continue;
      const references = target.kind === 'character'
        ? approval.script.characters.some((item) => item.existingCharacterId === target.id)
        : target.kind === 'scene'
          ? approval.script.sceneAssets.some((item) => item.existingSceneAssetId === target.id)
          : approval.script.props.some((item) => item.existingPropId === target.id);
      if (references) usages.set(`source:${source.id}`, {
        key: `source:${source.id}`, number: source.number, title: source.title,
        sourceEpisodeId: source.id, script: true, storyboard: false,
      });
    }
  }
  const looks = new Set(target.kind === 'character'
    ? document.characters.find((item) => item.id === target.id)?.looks.map((look) => look.id) : []);
  for (const episode of document.episodes) {
    const references = target.kind === 'character'
      ? episode.dialogueCues.some((cue) => cue.characterId === target.id)
        || episode.scenes.some((scene) => scene.shots.some((shot) => shot.characterLookIds.some((id) => looks.has(id))))
      : target.kind === 'scene'
        ? episode.scenes.some((scene) => scene.locationAssetId === target.id || scene.shots.some((shot) => shot.sceneAssetId === target.id))
        : episode.scenes.some((scene) => scene.shots.some((shot) => shot.propAssetIds.includes(target.id)));
    if (!references) continue;
    const sourceEpisodeId = motionComicSourceEpisodeIdForEpisode(document, episode);
    const key = sourceEpisodeId ? `source:${sourceEpisodeId}` : `episode:${episode.id}`;
    const previous = usages.get(key);
    usages.set(key, { key, number: previous?.number ?? episode.number, title: previous?.title ?? episode.title,
      sourceEpisodeId, episodeId: episode.id, script: previous?.script ?? false, storyboard: true });
  }
  return [...usages.values()].sort((left, right) => left.number - right.number || left.key.localeCompare(right.key));
}
