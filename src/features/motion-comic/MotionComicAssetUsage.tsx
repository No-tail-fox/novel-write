import { useEffect, useState } from 'react';
import { ArrowUpRight, Link2, Loader2, RefreshCw } from 'lucide-react';
import type { MotionComicPipelineData } from '../../shared/motion-comic';
import type { MotionComicScriptSnapshot } from '../../shared/motion-comic-script-batch';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { Button, IconButton } from '../../ui';
import { motionComicAssetEpisodeUsages, type MotionComicAssetIdentity, type MotionComicAssetEpisodeUsage } from './motion-comic-asset-usage';

export function MotionComicAssetUsage({ api, document, target, busy, onOpen }: {
  api: StoryDreamApi;
  document: MotionComicPipelineData;
  target: MotionComicAssetIdentity;
  busy: boolean;
  onOpen: (usage: MotionComicAssetEpisodeUsage) => void;
}) {
  const [result, setResult] = useState<{ projectId: string; snapshot: MotionComicScriptSnapshot | null; error: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const projectId = document.id;
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setResult(null);
    void api.getMotionComicScripts(projectId).then((snapshot) => {
      if (!disposed) setResult({ projectId, snapshot, error: '' });
    }).catch(() => {
      if (!disposed) setResult({ projectId, snapshot: null, error: '剧本引用读取失败，当前仅显示正式分镜引用。' });
    }).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [api, projectId, document.updatedAt, reload]);
  const current = result?.projectId === projectId ? result : null;
  const usages = motionComicAssetEpisodeUsages(document, target, current?.snapshot ?? null);
  return <div className="comic-asset-usage" aria-label="跨集引用" aria-busy={loading}>
    <div className="comic-asset-usage__heading"><Link2 size={13} /><strong>跨集引用</strong><small>{loading ? '读取中' : `${usages.length} 集`}</small></div>
    {current?.error ? <div className="comic-asset-usage__error" role="status"><span>{current.error}</span><IconButton label="重试读取剧本引用" icon={<RefreshCw size={13} />} onClick={() => setReload((value) => value + 1)} /></div> : null}
    <div className="comic-asset-usage__items">
      {usages.map((usage) => <Button key={usage.key} variant="subtle" density="compact" disabled={busy} icon={<ArrowUpRight size={12} />} iconPosition="after" onClick={() => onOpen(usage)}>
        <span>第 {usage.number} 集 · {usage.title}</span><small>{[usage.script ? '剧本已确认' : '', usage.storyboard ? '分镜已引用' : ''].filter(Boolean).join(' · ')}</small>
      </Button>)}
      {!usages.length ? <small role="status">{loading ? <><Loader2 size={12} className="director-spin" />正在读取剧本引用</> : current?.error ? '暂无正式分镜引用' : '尚未被已确认剧本或正式分镜引用'}</small> : null}
    </div>
  </div>;
}
