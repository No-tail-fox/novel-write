import type { DirectorShot } from '../director-desk/DirectorDeskWorkspace';
import type { MotionComicPipelineData } from '../../shared/motion-comic';

type Episode = MotionComicPipelineData['episodes'][number];

/** Groups the existing shot projections by canonical scene IDs, never by display titles. */
export function storyboardSceneGroups(episode: Episode, shots: readonly DirectorShot[]) {
  const byId = new Map(shots.map((shot) => [shot.id, shot]));
  return episode.scenes.map((scene) => ({
    id: scene.id,
    title: scene.title,
    shots: scene.shots.flatMap((shot) => { const projected = byId.get(shot.id); return projected ? [projected] : []; }),
  }));
}

export function storyboardSelectedShot(shots: readonly DirectorShot[], selectedId: string) {
  return shots.find((shot) => shot.id === selectedId) ?? shots[0];
}

export function storyboardDurationMs(seconds: string): number | undefined {
  if (!seconds.trim()) return undefined;
  const value = Number(seconds);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 1000) : undefined;
}

export function storyboardImageStatus(shot: DirectorShot): string {
  if (shot.videoRecovery === 'unknown') return '提交结果待核对';
  if (shot.videoUrl) return '视频已就绪';
  if (shot.videoJobStatus === 'running' || shot.videoJobStatus === 'queued') return '视频生成中';
  if (shot.videoJobStatus === 'failed' || shot.videoJobStatus === 'cancelled') return '视频生成失败';
  if (shot.imageFailed) return '生成失败';
  if (shot.imageReady) return '画面已就绪';
  return shot.renderStrategy === 'living-poster' && shot.videoInputReady ? '待生成视频' : '待生成画面';
}

export function storyboardShotStatusTone(shot: DirectorShot): 'ready' | 'pending' | 'failed' {
  if (shot.videoJobStatus === 'failed' || shot.videoJobStatus === 'cancelled' || shot.imageFailed) return 'failed';
  if (shot.videoUrl || shot.imageReady) return 'ready';
  return 'pending';
}

export function storyboardKeyframeActionLabel(shot: DirectorShot): string {
  return shot.renderStrategy === 'living-poster' && shot.videoInputReady && !shot.videoFirstFrameReady
    ? '生成可选关键帧'
    : '生成分镜图';
}

export function storyboardKeyframeHint(shot: DirectorShot): string | undefined {
  if (shot.renderStrategy !== 'living-poster' || !shot.videoInputReady || shot.videoFirstFrameReady) return undefined;
  return '当前为远程视频多参考模式，角色、场景与道具参考已就绪；首帧关键帧可选，不会阻塞视频生成。';
}
