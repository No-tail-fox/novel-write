import type { MotionComicEpisode, MotionComicPipelineData, MotionComicShot } from '../../shared/motion-comic';
import { productionAudioClipsForShot, type ProductionAudioClip } from '../../shared/production-audio';
import type { DirectorPreviewAudioClip } from '../director-desk/DirectorAudioPreview';
import { toLocalAssetUrl } from '../tasks/task-formatters';

export function motionComicShotUsesNativeAudio(shot: MotionComicShot): boolean {
  return shot.renderStrategy === 'remote-video'
    && (shot.videoProduction?.audioMode === 'native' || shot.videoProduction?.audioMode === 'audio-driven');
}

function previewClip(clip: ProductionAudioClip, document: MotionComicPipelineData, shot: MotionComicShot): DirectorPreviewAudioClip[] {
  const asset = document.assets.find((candidate) => candidate.id === clip.assetVersionId && candidate.kind === 'audio');
  return asset?.localPath ? [{
    id: clip.id,
    assetVersionId: clip.assetVersionId,
    trackType: clip.trackType,
    url: toLocalAssetUrl(asset.localPath),
    startMs: clip.startMs,
    durationMs: clip.durationMs ?? clip.sourceDurationMs ?? shot.durationMs,
    sourceStartMs: clip.sourceStartMs,
    sourceDurationMs: clip.sourceDurationMs,
    gainDb: clip.gainDb,
    fadeInMs: clip.fadeInMs,
    fadeOutMs: clip.fadeOutMs,
    fadeEnvelope: clip.fadeEnvelope,
    muted: clip.muted,
  }] : [];
}

/** Maps the same authored/native tracks used by export to the preview transport. */
export function motionComicPreviewAudioClips(
  episode: MotionComicEpisode,
  shot: MotionComicShot,
  document: MotionComicPipelineData | null,
): DirectorPreviewAudioClip[] {
  if (!document) return [];
  const nativeAudio = motionComicShotUsesNativeAudio(shot);
  const authored = (productionAudioClipsForShot(episode.timeline, shot) ?? [])
    .filter((clip) => !nativeAudio || !['dialogue', 'narration'].includes(clip.trackType))
    .flatMap((clip) => previewClip(clip, document, shot));
  const videoAsset = shot.videoAssetVersionId
    ? document.assets.find((candidate) => candidate.id === shot.videoAssetVersionId && candidate.kind === 'video')
    : undefined;
  const native = nativeAudio && videoAsset?.localPath ? [{
    id: `native-${shot.id}`,
    trackType: 'native' as const,
    url: toLocalAssetUrl(videoAsset.localPath),
    startMs: episode.timeline.clips.find((clip) => clip.shotId === shot.id)?.startMs ?? 0,
    durationMs: shot.durationMs,
  }] : [];
  return [...native, ...authored];
}
