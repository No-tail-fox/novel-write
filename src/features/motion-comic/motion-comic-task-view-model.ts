import type { MotionComicPipelineData } from '../../shared/motion-comic';
import type { MotionComicScriptSnapshot } from '../../shared/motion-comic-script-batch';
import type { DirectorBatchRecord } from '../../shared/director-batch-persistence';
import type { ReferenceBatchTarget } from '../../shared/reference-batch';

export type MotionComicTaskStatus = 'running' | 'queued' | 'paused' | 'cancelling' | 'completed' | 'failed' | 'cancelled' | 'unknown' | 'stale' | 'review' | 'candidate' | 'skipped';
export type MotionComicTaskNavigation =
  | { kind: 'episode'; episodeId: string; stage: 'video' | 'audio' | 'storyboard' | 'export' }
  | { kind: 'script'; sourceEpisodeId: string }
  | { kind: 'asset'; target?: ReferenceBatchTarget };
export interface MotionComicTaskItem {
  id: string;
  source: 'provider' | 'script' | 'reference';
  kind: 'image' | 'video' | 'audio' | 'script' | 'render' | 'other';
  /** What the task produces; drives the drawer's type filter and visual identity. */
  taskType: MotionComicTaskType;
  title: string;
  subtitle: string;
  status: MotionComicTaskStatus;
  rawStatus: string;
  updatedAt: string;
  providerJobId?: string;
  thumbnailPath?: string;
  excerpt?: string;
  error?: string;
  detail?: string;
  navigation?: MotionComicTaskNavigation;
}
export type MotionComicTaskType = 'script' | 'storyboard' | 'reference' | 'image' | 'video' | 'audio' | 'render' | 'other';
export const motionComicTaskTypeLabels: Record<MotionComicTaskType, string> = {
  script: '剧本', storyboard: '分镜', reference: '参考图', image: '画面', video: '视频', audio: '配音', render: '成片', other: '其他',
};
export type MotionComicTaskCounts = Record<MotionComicTaskStatus, number> & { total: number; attention: number };
export const motionComicTaskStatusLabels: Record<MotionComicTaskStatus, string> = {
  running: '运行中', queued: '排队', paused: '已暂停', cancelling: '取消中', completed: '已完成', failed: '失败', cancelled: '已取消', unknown: '结果未知', stale: '输入已变化', review: '待审核', candidate: '待选用', skipped: '已跳过',
};
export function countMotionComicTasks(items: readonly MotionComicTaskItem[]): MotionComicTaskCounts {
  const counts = Object.fromEntries(Object.keys(motionComicTaskStatusLabels).map(key => [key, 0])) as MotionComicTaskCounts;
  counts.total = items.length;
  counts.attention = 0;
  for (const item of items) {
    counts[item.status]++;
    if (['failed', 'unknown', 'stale'].includes(item.status)) counts.attention++;
  }
  return counts;
}
function statusOf(raw: string): MotionComicTaskStatus {
  return Object.hasOwn(motionComicTaskStatusLabels, raw) ? raw as MotionComicTaskStatus : 'unknown';
}
/** Imported novels carry separator rulers and site banners; drop rulers so the excerpt reads as prose. */
const excerpt = (text?: string) => text?.replace(/[=＝\-—_*~#]{4,}/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 120) || undefined;

/** Pure projection of persisted evidence. Never polls, submits, or invents progress. */
export function buildMotionComicTaskViewModel({ project, scriptSnapshot, referenceBatches = [] }: {
  project: MotionComicPipelineData;
  scriptSnapshot?: MotionComicScriptSnapshot;
  referenceBatches?: readonly DirectorBatchRecord[];
}): { items: MotionComicTaskItem[]; counts: MotionComicTaskCounts } {
  const assets = new Map(project.assets.map(asset => [asset.id, asset]));
  const shots = project.episodes.flatMap(episode => episode.scenes.flatMap(scene => scene.shots.map(shot => ({ shot, episode }))));
  const targets = new Map<string, { title: string; target: ReferenceBatchTarget; thumbnailPath?: string }>();
  const imagePath = (ids: readonly string[]) => ids.map(id => assets.get(id)).find(asset => asset?.kind === 'image' && asset.localPath)?.localPath;
  for (const character of project.characters) for (const look of character.looks) targets.set(`reference-look-${look.id}`, { title: `${character.name} · ${look.label}`, target: { kind: 'look', id: look.id }, thumbnailPath: imagePath(look.referenceAssetVersionIds) });
  for (const [kind, values] of [['scene', project.sceneAssets], ['prop', project.props]] as const) for (const asset of values) targets.set(`reference-${kind}-${asset.id}`, { title: asset.label, target: { kind, id: asset.id }, thumbnailPath: imagePath(asset.referenceAssetVersionIds) });
  const items: MotionComicTaskItem[] = [];
  const linkedJobs = new Set<string>();
  for (const batch of referenceBatches) {
    if (batch.projectId !== project.id || batch.plan.purpose !== 'reference-generation') continue;
    for (const node of batch.nodes) {
      const ref = node.reference;
      if (!ref) continue;
      const result = ref.resultAssetVersionId ? assets.get(ref.resultAssetVersionId) : undefined;
      // The service persists this exact job id from the ImageLab request id.
      const providerJobId = result?.providerJobId ?? `motion-comic-reference-job-${ref.requestId}`;
      linkedJobs.add(providerJobId);
      const target = targets.get(`reference-${ref.target.kind}-${ref.target.id}`);
      let status: MotionComicTaskStatus = node.status === 'pending' ? 'queued' : statusOf(node.status);
      if (ref.submissionState === 'unknown' || (ref.submissionState === 'submitted' && node.status !== 'running')) status = 'unknown';
      else if (ref.applyState === 'stale') status = 'stale';
      else if (node.status === 'completed' && result && !result.pinned && !result.selected) status = 'candidate';
      else if (node.status === 'pending' && batch.status === 'paused') status = 'paused';
      else if (node.status === 'pending' && batch.status === 'cancelled') status = 'cancelled';
      items.push({ id: `reference:${batch.id}:${node.id}`, source: 'reference', kind: 'image', taskType: 'reference', title: target?.title ?? node.title,
        subtitle: `${ref.target.kind === 'look' ? '人物' : ref.target.kind === 'scene' ? '场景' : '道具'}参考 · 批次`, status,
        rawStatus: `${node.status} / ${ref.submissionState} / ${ref.applyState}`, updatedAt: batch.updatedAt, providerJobId,
        thumbnailPath: result?.kind === 'image' ? result.localPath ?? target?.thumbnailPath : target?.thumbnailPath,
        error: node.error, detail: batch.recoveryRequired ? batch.recoveryReason : undefined,
        navigation: target ? { kind: 'asset', target: ref.target } : { kind: 'asset' } });
    }
  }
  const seen = new Set<string>();
  for (const job of project.providerJobs) {
    if (seen.has(job.id) || linkedJobs.has(job.id)) continue;
    seen.add(job.id);
    const found = shots.find(({ shot, episode }) => shot.id === job.nodeId && (!job.episodeId || episode.id === job.episodeId));
    const episode = found?.episode ?? project.episodes.find(ep => ep.id === job.episodeId);
    const target = targets.get(job.nodeId);
    const output = project.assets.find(asset => asset.providerJobId === job.id);
    const kind: MotionComicTaskItem['kind'] = /video/u.test(job.capability) ? 'video' : /image/u.test(job.capability) ? 'image' : /voice|audio|speech|tts/u.test(job.capability) ? 'audio' : /render/u.test(job.capability) ? 'render' : 'other';
    let status = statusOf(job.status);
    // The video service retains uncertain submissions as running + error so they
    // can be reconciled without submitting a second paid request.
    if (kind === 'video' && status === 'running' && job.error) status = 'unknown';
    if (status === 'completed' && job.error?.includes('镜头输入已变化')) status = 'stale';
    if (status === 'completed' && ((job.videoAdoption === 'candidate' && output && found?.shot.videoAssetVersionId !== output.id) || (target && output && !output.pinned && !output.selected))) status = 'candidate';
    items.push({ id: `provider:${job.id}`, source: 'provider', kind, taskType: target ? 'reference' : kind, title: target?.title ?? found?.shot.title ?? episode?.title ?? job.nodeId,
      subtitle: [episode ? `第 ${episode.number} 集 · ${episode.title}` : target ? '资产参考' : '项目任务', `第 ${job.attempt} 次`].join(' · '),
      status, rawStatus: job.status, updatedAt: job.updatedAt, providerJobId: job.id, error: job.error,
      detail: [job.providerId, job.model, job.capability, job.phase].filter(Boolean).join(' · '),
      thumbnailPath: output?.kind === 'image' ? output.localPath : found ? imagePath([found.shot.firstFrameAssetVersionId ?? '', found.shot.lastFrameAssetVersionId ?? '']) : target?.thumbnailPath,
      navigation: target ? { kind: 'asset', target: target.target } : episode ? { kind: 'episode', episodeId: episode.id, stage: kind === 'audio' ? 'audio' : kind === 'render' ? 'export' : kind === 'image' ? 'storyboard' : 'video' } : undefined });
  }
  if (scriptSnapshot?.projectId === project.id) for (const task of scriptSnapshot.tasks) {
    const source = project.sourceDocument?.episodes.find(ep => ep.id === task.sourceEpisodeId);
    const candidate = scriptSnapshot.candidates.find(item => item.taskId === task.id);
    const status = task.status === 'script-ready' || task.status === 'review' ? 'review' : task.status === 'approved' ? 'completed' : statusOf(task.status);
    const base = { source: 'script' as const, kind: 'script' as const, taskType: 'script' as const, title: `${source ? `第 ${source.number} 集 · ${source.title}` : task.sourceEpisodeId} · 剧本`, subtitle: '剧本生成与审核', updatedAt: task.updatedAt,
      excerpt: excerpt(source?.sourceText), navigation: source ? { kind: 'script' as const, sourceEpisodeId: source.id } : undefined };
    items.push({ ...base, id: `script:${task.id}`, status: status === 'queued' && scriptSnapshot.paused ? 'paused' : status, rawStatus: task.status, error: task.error,
      detail: [task.provider, task.model, candidate ? `${candidate.script.scenes.length} 场景` : '', `修订 ${task.outputRevision}`].filter(Boolean).join(' · ') });
    if (task.storyboardStatus) items.push({ ...base, taskType: 'storyboard', excerpt: undefined, id: `script-storyboard:${task.id}`, title: base.title.replace(/ · 剧本$/u, ' · 分镜'), subtitle: '分镜生成与审核', detail: [task.provider, task.model].filter(Boolean).join(' · ') || undefined, status: task.status === 'stale' ? 'stale' : task.storyboardStatus === 'ready' ? 'review' : statusOf(task.storyboardStatus), rawStatus: task.storyboardStatus, error: task.storyboardError });
  }
  items.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0) || a.id.localeCompare(b.id));
  return { items, counts: countMotionComicTasks(items) };
}

/** Only URLs produced by the media resolver may enter an img src; never file/fs paths. */
export function safeMotionComicTaskMediaUrl(value: string): string | undefined {
  return /^(https?:\/\/|blob:|storydream-media:)/iu.test(value) ? value : undefined;
}
