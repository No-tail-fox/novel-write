import { useEffect, useRef, useState } from 'react';
import '../../styles/features/motion-comic-production-layout.css';
import type { MotionComicPipelineData, MotionComicShot } from '../../shared/motion-comic';
import { motionComicVideoVersions } from '../../shared/motion-comic-video-versions';
import { Button } from '../../ui';

export function MotionComicVideoVersions({ document, shot, busy, readVideo, onAdopt, onGenerateCandidate, generationDisabledReason }: {
  document: MotionComicPipelineData;
  shot: MotionComicShot;
  busy: boolean;
  readVideo: (path: string) => Promise<string>;
  onAdopt: (versionId: string) => Promise<void>;
  onGenerateCandidate?: () => Promise<void>;
  generationDisabledReason?: string;
}) {
  const versions = motionComicVideoVersions(document, shot);
  const unresolvedJob = document.providerJobs.some(job => job.nodeId === shot.id && job.episodeId === shot.episodeId
    && job.capability === 'image-to-video' && !['completed', 'failed', 'cancelled'].includes(job.status));
  const disabledReason = unresolvedJob ? '已有视频任务正在执行或结果尚未确认，请从原视频任务入口核对或恢复，勿重复提交。' : generationDisabledReason;
  const [preview, setPreview] = useState<{ id: string; url: string }>();
  const [pending, setPending] = useState('');
  const [feedback, setFeedback] = useState('');
  const inFlight = useRef(false);
  const activeShot = useRef(shot.id);
  activeShot.current = shot.id;
  useEffect(() => { setPreview(undefined); setFeedback(''); }, [shot.id]);
  async function act(id: string, action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(id); setFeedback('');
    try { await action(); } catch (error) { setFeedback(error instanceof Error ? error.message : String(error)); }
    finally { inFlight.current = false; setPending(''); }
  }
  return <section className="motion-comic-video-versions" aria-label="镜头视频历史候选">
    <div className="motion-comic-video-versions__heading"><strong>候选历史</strong><span>{versions.length} 个版本</span></div>
    <div className="motion-comic-video-versions__row">
      <details className="motion-comic-video-versions__policy"><summary>候选与费用说明</summary><p>新生成的视频保留为候选，不会替换当前采用版本，费用以服务商账单为准。</p></details>
      {onGenerateCandidate ? <Button density="compact" variant="secondary" disabled={busy || Boolean(pending) || Boolean(disabledReason)} title={disabledReason || '生成新的视频候选，不替换当前采用版本'} onClick={() => {
        if (busy || disabledReason) return;
        void act('generate-candidate', async () => {
          await onGenerateCandidate();
          setFeedback('候选已生成，历史列表已刷新；当前视频未替换。');
        });
      }}>{pending === 'generate-candidate' ? '正在生成视频候选…' : '仅生成视频候选'}</Button> : null}
    </div>
    {disabledReason ? <p className="motion-comic-video-versions__blocked" role="status">{disabledReason}</p> : null}
    {!versions.length ? <p className="motion-comic-video-versions__empty">暂无本镜头的视频候选。</p> : null}
    {preview ? <video key={preview.id} src={preview.url} controls preload="metadata" aria-label="历史候选视频预览" className="motion-comic-video-versions__preview" onError={() => setFeedback('本地视频无法播放，请检查文件是否完整。')} /> : null}
    <ul className="motion-comic-video-versions__list">
      {versions.map(({ asset, current, unavailableReason }, index) => <li key={asset.id} data-current={current}>
        <strong>候选 {versions.length - index}{current ? ' · 当前采用' : ''}{preview?.id === asset.id ? ' · 正在预览' : ''}</strong>
        <p>{asset.model || '模型未记录'} · {asset.durationMs ? `${(asset.durationMs / 1000).toFixed(1)} 秒` : '时长未记录'}<br />{asset.createdAt}</p>
        {unavailableReason ? <p>{unavailableReason}</p> : null}
        <div className="motion-comic-video-versions__actions">
          <Button variant="secondary" disabled={Boolean(pending) || !asset.localPath} onClick={() => void act(asset.id, async () => {
            setPreview(undefined);
            const url = await readVideo(asset.localPath!);
            if (!url) throw new Error('本地视频文件不可读取，请检查文件是否存在。');
            if (activeShot.current === shot.id) setPreview({ id: asset.id, url });
          })}>预览候选 {versions.length - index}</Button>
          <Button disabled={busy || Boolean(pending) || current || Boolean(unavailableReason)} onClick={() => void act(asset.id, async () => {
            await onAdopt(asset.id); setFeedback('候选已采用并保存。');
          })}>{pending === asset.id ? '处理中…' : current ? '当前采用' : '采用此版本'}</Button>
        </div>
      </li>)}
    </ul>
    <p role="status" aria-live="polite">{feedback || (pending ? '正在读取或保存候选…' : '')}</p>
  </section>;
}
