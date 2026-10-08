import {
  resolveMotionComicSceneAct,
  type MotionComicDialogueCue,
  type MotionComicEpisode,
  type MotionComicPipelineData,
  type MotionComicShot,
  type MotionComicWorkflowStage,
} from '../../shared/motion-comic';
import { inspectMotionComicShotConsistency } from './motion-comic-consistency';

export interface MotionComicWorkflowStageState {
  ready: boolean;
  complete: boolean;
  detail: string;
}

export interface MotionComicEpisodeProductionReadiness {
  episode?: MotionComicEpisode;
  shotCount: number;
  cueCount: number;
  consistencyComplete: boolean;
  storyboardReadyCount: number;
  storyboardComplete: boolean;
  videoReadyCount: number;
  videoComplete: boolean;
  audioReadyCount: number;
  audioComplete: boolean;
  generationComplete: boolean;
}

export function motionComicShotStoryboardReady(
  document: MotionComicPipelineData,
  shot: MotionComicShot,
): boolean {
  return hasUsableAsset(document, shot.firstFrameAssetVersionId, 'image');
}

export function motionComicShotVideoReady(
  document: MotionComicPipelineData,
  shot: MotionComicShot,
): boolean {
  if (shot.renderStrategy !== 'remote-video') return motionComicShotStoryboardReady(document, shot);
  if (!shot.videoAssetVersionId || !shot.videoJobId) return false;
  const asset = document.assets.find((candidate) => candidate.id === shot.videoAssetVersionId);
  const job = document.providerJobs.find((candidate) => candidate.id === shot.videoJobId);
  return Boolean(
    asset?.kind === 'video'
    && asset.localPath?.trim()
    && job?.nodeId === shot.id
    && job.capability === 'image-to-video'
    && job.status === 'completed'
    && asset.providerJobId === job.id,
  );
}

export function motionComicDialogueCueAudioReady(
  document: MotionComicPipelineData,
  cue: MotionComicDialogueCue,
  shot?: MotionComicShot,
): boolean {
  const candidateIds = [cue.audioAssetVersionId, cue.voiceAssetVersionId, shot?.voiceAssetVersionId]
    .filter((id): id is string => Boolean(id));
  return candidateIds.some((id) => hasUsableAsset(document, id, 'audio'));
}

export function resolveMotionComicActiveEpisodeReadiness(
  document: MotionComicPipelineData,
): MotionComicEpisodeProductionReadiness {
  const episode = document.episodes.find((candidate) => candidate.id === document.activeEpisodeId) ?? document.episodes[0];
  const shots = episode?.scenes.flatMap((scene) => scene.shots) ?? [];
  const shotById = new Map(shots.map((shot) => [shot.id, shot]));
  const cues = episode?.dialogueCues.filter((cue) => shotById.has(cue.shotId)) ?? [];
  const storyboardReadyCount = shots.filter((shot) => motionComicShotStoryboardReady(document, shot)).length;
  const videoReadyCount = shots.filter((shot) => motionComicShotVideoReady(document, shot)).length;
  const audioReadyCount = cues.filter((cue) => motionComicDialogueCueAudioReady(document, cue, shotById.get(cue.shotId))).length;
  const consistencyComplete = shots.length > 0 && shots.every((shot) => inspectMotionComicShotConsistency(document, shot).ready);
  const storyboardComplete = shots.length > 0 && storyboardReadyCount === shots.length;
  const videoComplete = shots.length > 0 && videoReadyCount === shots.length;
  const audioComplete = shots.length > 0 && audioReadyCount === cues.length;
  const generationComplete = shots.length > 0 && shots.every((shot) => (
    motionComicShotStoryboardReady(document, shot)
    && (shot.renderStrategy !== 'remote-video' || motionComicShotVideoReady(document, shot))
  ));
  return {
    episode,
    shotCount: shots.length,
    cueCount: cues.length,
    consistencyComplete,
    storyboardReadyCount,
    storyboardComplete,
    videoReadyCount,
    videoComplete,
    audioReadyCount,
    audioComplete,
    generationComplete,
  };
}

export function resolveMotionComicStageState(
  document: MotionComicPipelineData,
  plannedSourceEpisodeIds: ReadonlySet<string>,
  outputReady: boolean,
): Record<MotionComicWorkflowStage, MotionComicWorkflowStageState> {
  const sourceReady = Boolean(document.sourceDocument?.originalText.trim() || document.series.premise.trim());
  const sourceEpisodes = document.sourceDocument?.episodes ?? [];
  const generatedEpisodes = document.episodes.filter((episode) => episode.scenes.length > 0);
  const readiness = resolveMotionComicActiveEpisodeReadiness(document);
  const activeScenes = readiness.episode?.scenes ?? [];
  const scenesReady = activeScenes.length > 0;
  const resolvedActs = activeScenes.map((scene, index) => resolveMotionComicSceneAct(scene, index, activeScenes.length));
  const actStructureReady = resolvedActs.every((act, index) => (
    index === 0
      ? act.actIndex === 1
      : act.actIndex === resolvedActs[index - 1].actIndex || act.actIndex === resolvedActs[index - 1].actIndex + 1
  ));
  const referencedCharacterIds = new Set<string>();
  const referencedSceneIds = new Set<string>();
  const referencedPropIds = new Set<string>();
  const lookOwners = new Map(document.characters.flatMap((character) => character.looks.map((look) => [look.id, character.id] as const)));
  activeScenes.forEach((scene) => scene.shots.forEach((shot) => {
    shot.characterLookIds.forEach((lookId) => {
      const characterId = lookOwners.get(lookId);
      if (characterId) referencedCharacterIds.add(characterId);
    });
    if (shot.sceneAssetId) referencedSceneIds.add(shot.sceneAssetId);
    shot.propAssetIds.forEach((propId) => referencedPropIds.add(propId));
  }));
  const audioStageComplete = readiness.videoComplete && readiness.audioComplete;
  return {
    source: { ready: true, complete: sourceReady, detail: sourceReady ? '源文已保存' : '等待导入源文' },
    episodes: {
      ready: sourceReady,
      complete: sourceEpisodes.length > 0 ? plannedSourceEpisodeIds.size === sourceEpisodes.length : generatedEpisodes.length > 0,
      detail: sourceEpisodes.length > 0 ? `${plannedSourceEpisodeIds.size}/${sourceEpisodes.length} 集已结构化` : `${generatedEpisodes.length} 集`,
    },
    scenes: {
      ready: scenesReady,
      complete: scenesReady && actStructureReady,
      detail: scenesReady ? `当前第 ${readiness.episode?.number ?? 1} 集 · ${activeScenes.length} 场` : '当前分集尚未完成规划',
    },
    assets: {
      ready: scenesReady,
      complete: readiness.consistencyComplete,
      detail: `${referencedCharacterIds.size} 人物 · ${referencedSceneIds.size} 场景 · ${referencedPropIds.size} 道具`,
    },
    storyboard: {
      ready: readiness.consistencyComplete,
      complete: readiness.storyboardComplete,
      detail: `${readiness.storyboardReadyCount}/${readiness.shotCount} 镜头图已就绪`,
    },
    video: {
      ready: readiness.storyboardComplete,
      complete: readiness.videoComplete,
      detail: `${readiness.videoReadyCount}/${readiness.shotCount} 远程视频已就绪`,
    },
    audio: {
      ready: readiness.videoComplete,
      complete: audioStageComplete,
      detail: `${readiness.audioReadyCount}/${readiness.cueCount} 句已配音`,
    },
    export: {
      ready: readiness.videoComplete && readiness.audioComplete,
      complete: outputReady,
      detail: outputReady ? '已有可播放成片' : '等待合成与审片',
    },
  };
}

function hasUsableAsset(
  document: MotionComicPipelineData,
  assetId: string | undefined,
  kind: 'image' | 'video' | 'audio',
): boolean {
  if (!assetId) return false;
  const asset = document.assets.find((candidate) => candidate.id === assetId);
  return asset?.kind === kind && Boolean(asset.localPath?.trim());
}
