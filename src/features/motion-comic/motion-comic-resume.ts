import { motionComicSourceEpisodeIdForEpisode, plannedMotionComicSourceEpisodeIds } from '../../shared/motion-comic-planning';
import type { MotionComicPipelineData, MotionComicWorkflowStage } from '../../shared/motion-comic';
import { motionComicDialogueCueAudioReady, motionComicShotVideoReady, resolveMotionComicActiveEpisodeReadiness, resolveMotionComicStageState } from './motion-comic-stage-state';
import { buildMotionComicShotVideoRequest } from '../../shared/motion-comic-video';

/** Continue the active episode; unfinished siblings must not redirect its workspace. */
export function resolveMotionComicResume(document: MotionComicPipelineData): { stage: MotionComicWorkflowStage; sourceEpisodeId: string; shotId: string } {
  const readiness = resolveMotionComicActiveEpisodeReadiness(document);
  const episode = readiness.episode;
  const planned = plannedMotionComicSourceEpisodeIds(document);
  const sourceEpisodeId = (episode ? motionComicSourceEpisodeIdForEpisode(document, episode) : undefined)
    ?? episode?.planningEvidence?.sourceEpisodeId
    ?? document.sourceDocument?.episodes.find(source => !planned.has(source.id))?.id
    ?? document.sourceDocument?.episodes[0]?.id ?? '';
  const shotId = episode?.scenes[0]?.shots[0]?.id ?? '';
  if (!episode?.scenes.length) return { stage: document.sourceDocument ? 'episodes' : 'source', sourceEpisodeId, shotId };
  const stages = resolveMotionComicStageState(document, planned, false);
  const pendingShots = episode.scenes.flatMap(scene => scene.shots).filter(shot => !motionComicShotVideoReady(document, shot));
  const pendingInputsReady = pendingShots.every(shot => {
    try { buildMotionComicShotVideoRequest(document, shot); return true; } catch { return false; }
  });
  const stage: MotionComicWorkflowStage = !stages.scenes.complete ? 'scenes'
    : !readiness.videoComplete && !readiness.consistencyComplete ? 'assets'
    : !readiness.videoComplete && !readiness.storyboardComplete && !pendingInputsReady ? 'storyboard'
    : !readiness.videoComplete ? 'video'
    : !readiness.audioComplete ? 'audio' : 'export';
  // Resume the remaining work, not a completed first shot in the same episode.
  const audioPending = stage === 'audio' ? episode.scenes.flatMap(scene => scene.shots).find(shot =>
    episode.dialogueCues.some(cue => cue.shotId === shot.id && !motionComicDialogueCueAudioReady(document, cue, shot))) : undefined;
  const resumeShotId = (stage === 'video' || stage === 'storyboard' || stage === 'assets') ? pendingShots[0]?.id ?? shotId : audioPending?.id ?? shotId;
  return { stage, sourceEpisodeId, shotId: resumeShotId };
}
