import { setMotionComicShotFirstFrame, setMotionComicShotLastFrame, type MotionComicPipelineData } from '../../shared/motion-comic';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { AppMutationResult } from '../../shared/types';
import { imageLabRecordIdFromMutation, motionComicReferenceVersionIds } from './motion-comic-consistency';

export type MotionComicFrameSlot = 'first' | 'last';
export type MotionComicFrameImportPhase = 'importing' | 'saving';

/** Include persisted local imports and bound frames, without exposing consistency references. */
export function motionComicFrameAssets(document: MotionComicPipelineData) {
  const references = motionComicReferenceVersionIds(document);
  const imageJobs = new Set(document.providerJobs.filter(job => job.capability === 'text-to-image').map(job => job.id));
  const bound = new Set(document.episodes.flatMap(episode => episode.scenes.flatMap(scene => scene.shots.flatMap(shot => [shot.firstFrameAssetVersionId, shot.lastFrameAssetVersionId]))));
  return document.assets.filter(asset => asset.kind === 'image' && asset.localPath && !references.has(asset.id)
    && !asset.assetId.startsWith('motion-comic-reference-')
    && (asset.assetId.startsWith('shot-keyframe-') || asset.assetId.startsWith('shot-frame-') || bound.has(asset.id) || Boolean(asset.providerJobId && imageJobs.has(asset.providerJobId))));
}

/** Import bytes through the existing managed-image IPC, then bind against the latest queued draft. */
export async function importMotionComicFrame({ api, projectId, shotId, slot, signal, readCurrent, isCurrent, applyMutation, enqueue, onPhase }: {
  api: Pick<StoryDreamApi, 'selectLocalImage' | 'addImageLabRecord' | 'getImageLabRecordDetail'>;
  projectId: string;
  shotId: string;
  slot: MotionComicFrameSlot;
  signal: AbortSignal;
  readCurrent: () => MotionComicPipelineData | null;
  isCurrent: () => boolean;
  applyMutation: (mutation: AppMutationResult | null) => void;
  enqueue: (projectId: string, update: (current: MotionComicPipelineData) => MotionComicPipelineData) => Promise<MotionComicPipelineData>;
  onPhase: (phase: MotionComicFrameImportPhase) => void;
}): Promise<string | null> {
  const field = slot === 'first' ? 'firstFrameAssetVersionId' : 'lastFrameAssetVersionId';
  const findShot = (document: MotionComicPipelineData) => document.episodes.flatMap(episode => episode.scenes.flatMap(scene => scene.shots)).find(shot => shot.id === shotId);
  function assertCurrent(current = readCurrent()) {
    signal.throwIfAborted();
    if (!isCurrent() || !current || current.id !== projectId) throw new Error('项目已切换，本次图片不会写入其他项目。');
    if (!findShot(current)) throw new Error('镜头已删除，请重新选择镜头后导入。');
    return current;
  }
  const initial = assertCurrent();
  const initialFrameId = findShot(initial)![field];
  const path = await api.selectLocalImage('video-reference');
  if (!path) return null;
  const current = assertCurrent();
  const mutation = await api.addImageLabRecord({
    prompt: `AI 漫剧${slot === 'first' ? '首帧' : '尾帧'} · ${path.split(/[\\/]/).at(-1) ?? shotId}`,
    ratio: current.ratio, style: 'frame', provider: 'local-import', imagePath: path,
    resolution: '2K', quality: 'high', smartMode: 'reference-edit', upstreamTaskId: projectId,
  });
  // The managed record exists independently of whether its pending slot binding was cancelled.
  applyMutation(mutation);
  assertCurrent();
  const record = await api.getImageLabRecordDetail(imageLabRecordIdFromMutation(mutation));
  assertCurrent();
  if (!record || record.status !== 'generated' || !record.imagePath || /^(blob:|data:|https?:)/i.test(record.imagePath)) {
    throw new Error('图片未能完成托管导入，请重新选择本地图片。');
  }
  const asset = {
    id: `motion-comic-frame-${record.id}`, assetId: `shot-frame-${shotId}-${slot}`,
    kind: 'image' as const, localPath: record.imagePath, prompt: record.prompt,
    provider: 'local-import', createdAt: record.createdAt,
  };
  await enqueue(projectId, latest => {
    assertCurrent(latest);
    if (findShot(latest)![field] !== initialFrameId) throw new Error('该帧已被修改，本次导入未覆盖较新的选择，请重试。');
    // Cancellation is meaningful before commit only; persistence itself cannot be rolled back.
    onPhase('saving');
    const next = { ...latest, assets: [...latest.assets.filter(item => item.id !== asset.id), asset] };
    return (slot === 'first' ? setMotionComicShotFirstFrame : setMotionComicShotLastFrame)(next, shotId, asset.id);
  });
  return asset.id;
}
