import type { MotionComicPipelineData } from '../../shared/motion-comic';
import { invalidateMotionComicVideosForChangedInputs } from '../../shared/motion-comic-video';
import type { DirectorBatchRecord } from '../../shared/director-batch-persistence';
import type { MotionComicReferenceJob } from './MotionComicReferenceEditor';
import { referenceTargetLabel, type MotionComicReferenceTarget } from './motion-comic-consistency';

export interface MotionComicAssetRemovalBlocker {
  /** Stable kind so the Page can translate it without parsing prose. */
  kind: 'shot' | 'surface';
  message: string;
}

export interface MotionComicAssetRemovalPlan {
  /** Null when the removal is blocked; every other field is then empty. */
  next: MotionComicPipelineData | null;
  blocker: MotionComicAssetRemovalBlocker | null;
  /** Script snapshot references that stay in the approved script but stop resolving. */
  scriptReferences: string[];
  /** Human-readable lines for the confirmation dialog. */
  notes: string[];
}

export type MotionComicAssetRemovalTarget =
  | { kind: 'character'; characterId: string }
  | { kind: 'look'; characterId: string; lookId: string }
  | { kind: 'scene'; sceneAssetId: string }
  | { kind: 'prop'; propAssetId: string };

function plan(
  document: MotionComicPipelineData,
  blocker: MotionComicAssetRemovalBlocker | null,
  next?: MotionComicPipelineData,
  scriptReferences: string[] = [],
): MotionComicAssetRemovalPlan {
  if (blocker || !next) return { next: null, blocker, scriptReferences: [], notes: [] };
  return {
    next: invalidateMotionComicVideosForChangedInputs(document, next),
    blocker: null,
    scriptReferences,
    notes: [
      scriptReferences.length > 0 ? `${scriptReferences.length} 个剧本仍引用该人物；剧本正文不变，重新确认时会提示补录。` : '',
      '参考图版本记录与图片历史保留，草稿阶段可撤销。',
    ].filter(Boolean),
  };
}

/**
 * Removal is only allowed when no persisted shot, scene location or generated voice
 * still depends on the asset. Existing shots are never silently rebound to another
 * asset, because that would change their continuity inputs without the author noticing.
 */
export function planMotionComicAssetRemoval(
  document: MotionComicPipelineData,
  target: MotionComicAssetRemovalTarget,
): MotionComicAssetRemovalPlan {
  const shots = document.episodes.flatMap((episode) => episode.scenes.flatMap((scene) => scene.shots));

  if (target.kind === 'character' || target.kind === 'look') {
    const character = document.characters.find((item) => item.id === target.characterId);
    if (!character) return plan(document, { kind: 'surface', message: '人物已不存在，请刷新后重试。' });
    const looks = target.kind === 'look'
      ? character.looks.filter((look) => look.id === target.lookId)
      : character.looks;
    if (target.kind === 'look' && looks.length === 0) return plan(document, { kind: 'surface', message: '造型已不存在，请刷新后重试。' });
    if (target.kind === 'look' && looks.length >= character.looks.length) {
      return plan(document, { kind: 'surface', message: '人物至少保留一个造型，请先新增其他造型再删除。' });
    }
    const lookIds = new Set(looks.map((look) => look.id));
    const boundShots = shots.filter((shot) => shot.characterLookIds.some((id) => lookIds.has(id)));
    if (boundShots.length > 0) {
      return plan(document, { kind: 'shot', message: `${boundShots.length} 个镜头仍在使用该${target.kind === 'look' ? '造型' : '人物'}，请先在分镜中改绑或清空后再删除。` });
    }
    const voiced = document.episodes.flatMap((episode) => episode.dialogueCues)
      .filter((cue) => cue.characterId === character.id && Boolean(cue.voiceAssetVersionId ?? cue.audioAssetVersionId));
    if (voiced.length > 0) {
      return plan(document, { kind: 'surface', message: `${voiced.length} 句对白已生成配音，请先在配音页解除后再删除人物。` });
    }
    // Approved script snapshots reference characters by id; those stay in the script text.
    const scriptReferences = Array.from(new Set(document.episodes
      .filter((episode) => episode.dialogueCues.some((cue) => cue.characterId === character.id))
      .map((episode) => `第 ${episode.number} 集 · ${episode.title}`)));
    const next: MotionComicPipelineData = target.kind === 'look'
      ? {
        ...document,
        characters: document.characters.map((item) => item.id === character.id
          ? { ...item, looks: item.looks.filter((look) => look.id !== target.lookId) }
          : item),
      }
      : {
        ...document,
        series: { ...document.series, characterIds: document.series.characterIds.filter((id) => id !== character.id) },
        characters: document.characters.filter((item) => item.id !== character.id),
      };
    return plan(document, null, next, scriptReferences);
  }

  if (target.kind === 'scene') {
    if (!document.sceneAssets.some((item) => item.id === target.sceneAssetId)) return plan(document, { kind: 'surface', message: '地点已不存在，请刷新后重试。' });
    const used = document.episodes.some((episode) => episode.scenes.some((scene) => scene.locationAssetId === target.sceneAssetId))
      || shots.some((shot) => shot.sceneAssetId === target.sceneAssetId);
    if (used) return plan(document, { kind: 'shot', message: '该地点仍被分场或分镜引用，请先改绑其他地点后再删除。' });
    return plan(document, null, {
      ...document,
      series: { ...document.series, sceneAssetIds: document.series.sceneAssetIds.filter((id) => id !== target.sceneAssetId) },
      sceneAssets: document.sceneAssets.filter((item) => item.id !== target.sceneAssetId),
    });
  }

  if (!document.props.some((item) => item.id === target.propAssetId)) return plan(document, { kind: 'surface', message: '道具已不存在，请刷新后重试。' });
  if (shots.some((shot) => shot.propAssetIds.includes(target.propAssetId))) {
    return plan(document, { kind: 'shot', message: '该道具仍被分镜引用，请先解除绑定后再删除。' });
  }
  return plan(document, null, {
    ...document,
    series: { ...document.series, propAssetIds: document.series.propAssetIds.filter((id) => id !== target.propAssetId) },
    props: document.props.filter((item) => item.id !== target.propAssetId),
  });
}

const REQUEST_STAGE_LABELS: Record<string, string> = {
  pending: '排队中',
  submitted: '已提交，等待服务返回',
  unknown: '结果待核对',
  resolved: '结果已返回，正在挂接',
};

/**
 * Derive the inline job state for one reference target from the authoritative batch
 * records. Nothing is inferred: a target with no live batch reports no job, so the
 * editor never shows a decorative spinner.
 */
export function referenceJobFor(
  document: MotionComicPipelineData,
  targetKey: string,
  batches: readonly DirectorBatchRecord[],
): MotionComicReferenceJob | null {
  const label = batchTargetLabel(document, targetKey);
  for (const batch of batches) {
    if (batch.plan?.purpose !== 'reference-generation') continue;
    for (const node of batch.nodes) {
      const reference = node.reference;
      if (!reference || `${reference.target.kind}:${reference.target.id}` !== targetKey) continue;
      if (reference.applyState === 'applied') continue;
      const done = batch.nodes.filter((item) => item.status === 'completed' || item.status === 'failed').length;
      const total = batch.nodes.length;
      const progress = total > 0 ? done / total : undefined;
      if (batch.status === 'queued') return { label: `已加入队列 · ${label}`, detail: `批次内已完成 ${done}/${total} 项；结果只追加候选。`, progress };
      if (node.status === 'failed') return { label: `${label} 生成失败`, detail: node.error || '请检查模型配置后重新生成。' };
      if (reference.submissionState === 'unknown') return { label: `${label} 结果未知`, detail: '可能已计费；请在后台任务中恢复查询，不会自动重发。' };
      if (batch.status === 'running') return { label: `正在生成 · ${label}`, detail: `批次进度 ${done}/${total}，预计按顺序返回；可继续编辑其他资产。`, progress };
      if (batch.status === 'cancelling') return { label: '正在取消 · 已提交的请求可能仍会完成', detail: '取消完成前请勿重复提交。' };
      if (batch.status === 'paused' && reference.submissionState === 'not-submitted' && node.status === 'pending') {
        return { label: `${label} 已在批次中暂停`, detail: '可在后台任务抽屉中继续未提交的目标。' };
      }
    }
  }
  return null;
}

function batchTargetLabel(document: MotionComicPipelineData, targetKey: string): string {
  const separator = targetKey.indexOf(':');
  const target: MotionComicReferenceTarget = { kind: targetKey.slice(0, separator) as MotionComicReferenceTarget['kind'], id: targetKey.slice(separator + 1) };
  return referenceTargetLabel(document, target);
}
