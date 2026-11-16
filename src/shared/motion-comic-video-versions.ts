import type { MotionComicPipelineData, MotionComicShot } from './motion-comic';
import type { ProductionAssetVersion } from './production-workflow';
import { motionComicVideoJobInputsMatch } from './motion-comic-video';

export function motionComicVideoVersionUnavailableReason(document: MotionComicPipelineData, shot: MotionComicShot, asset: ProductionAssetVersion): string | undefined {
  if (asset.kind !== 'video' || asset.assetId !== `shot-video-${shot.id}` || asset.episodeId !== shot.episodeId) return '候选不属于当前集的这个镜头。';
  if (asset.outputValidation?.status === 'rejected') return `输出校验未通过：${asset.outputValidation.reason}`;
  if (!asset.localPath?.trim()) return '本地视频路径缺失，无法采用。';
  const job = document.providerJobs.find(item => item.id === asset.providerJobId);
  if (!job || job.workflowKind !== 'motion-comic' || job.nodeId !== shot.id || job.episodeId !== shot.episodeId || job.capability !== 'image-to-video') return '生成任务来源不明或与当前镜头不符，无法采用。';
  if (job.status !== 'completed') return '生成任务尚未确认完成，无法采用。';
  if (shot.renderStrategy !== 'remote-video') return '请先切换为远程视频制作方式。';
  try {
    if (!motionComicVideoJobInputsMatch(document, shot, job)) return '候选已过期：参考、提示词或制作输入已变化；本版仅支持查看。';
  } catch { return '当前镜头输入不完整，无法核对候选；请先补全制作输入。'; }
  return undefined;
}

export function motionComicVideoVersions(document: MotionComicPipelineData, shot: MotionComicShot) {
  return document.assets.filter(asset => asset.kind === 'video' && asset.assetId === `shot-video-${shot.id}` && asset.episodeId === shot.episodeId)
    .map(asset => ({ asset, current: shot.videoAssetVersionId === asset.id && shot.videoJobId === asset.providerJobId,
      unavailableReason: motionComicVideoVersionUnavailableReason(document, shot, asset) })).reverse();
}

/** Pure atomic adoption; caller verifies the local file and persists with a revision guard. */
export function adoptMotionComicVideoVersion(document: MotionComicPipelineData, episodeId: string, shotId: string, versionId: string): MotionComicPipelineData {
  const episode = document.episodes.find(item => item.id === episodeId);
  const shot = episode?.scenes.flatMap(scene => scene.shots).find(item => item.id === shotId && item.episodeId === episodeId);
  const asset = document.assets.find(item => item.id === versionId);
  if (!shot || !asset) throw new Error('镜头或候选已不存在，请重新打开当前集。');
  const reason = motionComicVideoVersionUnavailableReason(document, shot, asset);
  if (reason) throw new Error(reason);
  return { ...document,
    assets: document.assets.map(item => item.kind === 'video' && item.episodeId === episodeId && item.assetId === asset.assetId ? { ...item, selected: item.id === asset.id } : item),
    episodes: document.episodes.map(item => item.id !== episodeId ? item : { ...item,
      scenes: item.scenes.map(scene => ({ ...scene, shots: scene.shots.map(candidate => candidate.id !== shotId ? candidate : {
        ...candidate, videoJobId: asset.providerJobId, videoAssetVersionId: asset.id,
        continuityAdvice: candidate.videoAssetVersionId === asset.id ? candidate.continuityAdvice : undefined,
      }) })),
      timeline: { ...item.timeline, clips: item.timeline.clips.map(clip => clip.shotId !== shotId ? clip : { ...clip,
        assetVersionIds: [...new Set([...clip.assetVersionIds.filter(id => document.assets.find(candidate => candidate.id === id)?.kind !== 'video'), asset.id])], source: 'ai-video' as const,
      }) },
    }),
  };
}
