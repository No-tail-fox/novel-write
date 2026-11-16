import type { MotionComicEpisode, MotionComicPipelineData } from '../../shared/motion-comic';
import { isUntouchedMotionComicStarter, motionComicSourceEpisodeIdForEpisode } from '../../shared/motion-comic-planning';
import { motionComicShotVideoReady, resolveMotionComicActiveEpisodeReadiness } from './motion-comic-stage-state';
import { motionComicScriptStatusLabel, type MotionComicScriptSnapshot } from '../../shared/motion-comic-script-batch';

export function motionComicOverviewFacts(document: MotionComicPipelineData, row: MotionComicOverviewRow, snapshot?: MotionComicScriptSnapshot) {
  const task = snapshot?.projectId === document.id && row.sourceEpisodeId
    ? snapshot.tasks.filter(item => item.sourceEpisodeId === row.sourceEpisodeId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    : undefined;
  const ready = row.episode ? resolveMotionComicActiveEpisodeReadiness({ ...document, activeEpisodeId: row.episode.id }) : undefined;
  const structured = Boolean(row.episode?.scenes.length);
  const stages = [
    { label: '剧本', complete: structured, detail: structured ? '已结构化' : task ? motionComicScriptStatusLabel[task.status] : '待结构化' },
    { label: '资产', complete: ready?.consistencyComplete ?? false, detail: ready?.consistencyComplete ? '引用已就绪' : '待确认引用' },
    { label: '分镜', complete: ready?.storyboardComplete ?? false, detail: ready ? `${ready.storyboardReadyCount}/${ready.shotCount} 镜头图就绪` : '尚无镜头' },
    { label: '生产', complete: Boolean(ready?.videoComplete && ready.audioComplete), detail: ready ? `画面 ${ready.videoReadyCount}/${ready.shotCount} · 配音 ${ready.audioReadyCount}/${ready.cueCount}` : '尚未生产' },
  ];
  return { task, stages, status: task && ['queued', 'running', 'script-ready', 'review', 'failed', 'stale'].includes(task.status)
    ? motionComicScriptStatusLabel[task.status]
    : !structured ? '待结构化' : stages.every(stage => stage.complete) ? '素材已就绪' : '制作中' };
}

export function motionComicEpisodeProgress(document: MotionComicPipelineData, episode: MotionComicEpisode): { shots: number; videos: number; durationMs: number } {
  const shots = episode.scenes.flatMap(scene => scene.shots);
  return { shots: shots.length, videos: shots.filter(shot => motionComicShotVideoReady(document, shot)).length, durationMs: shots.reduce((sum, shot) => sum + shot.durationMs, 0) };
}

export interface MotionComicOverviewRow { id: string; number: number; title: string; sourceEpisodeId?: string; episode?: MotionComicEpisode }
/** Keep manually created episodes visible even in imported-source projects. */
export function motionComicOverviewRows(document: MotionComicPipelineData): MotionComicOverviewRow[] {
  const claimed = new Set<string>();
  const rows: MotionComicOverviewRow[] = (document.sourceDocument?.episodes ?? []).map(source => {
    const episode = document.episodes.find(candidate => !claimed.has(candidate.id) && motionComicSourceEpisodeIdForEpisode(document, candidate) === source.id);
    if (episode) claimed.add(episode.id);
    return { id: `source:${source.id}`, sourceEpisodeId: source.id, number: source.number, title: source.title, episode };
  });
  const hasSourcePlaceholder = rows.length > 0 && isUntouchedMotionComicStarter(document)
    && document.episodes[0]?.id === `episode-${document.id}-source-placeholder`;
  for (const episode of document.episodes) {
    // Imported projects retain one empty active episode until their source is structured.
    // It is a workspace placeholder, not an additional authored episode.
    if (hasSourcePlaceholder && episode.id === `episode-${document.id}-source-placeholder`) continue;
    if (!claimed.has(episode.id)) rows.push({ id: `episode:${episode.id}`, number: episode.number, title: episode.title, episode });
  }
  return rows;
}
