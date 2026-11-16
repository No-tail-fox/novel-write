import { useEffect, useRef, useState } from 'react';
import { Image as ImageIcon, ImageOff } from 'lucide-react';
import type { MotionComicPipelineData, MotionComicShot } from '../../shared/motion-comic';
import { safeMotionComicTaskMediaUrl } from './motion-comic-task-view-model';

export type SceneMediaResolver = (path: string) => string | Promise<string>;
export function sceneShotImage(document: MotionComicPipelineData, shot?: MotionComicShot) {
  return shot ? document.assets.find(asset => asset.id === shot.firstFrameAssetVersionId && asset.kind === 'image') : undefined;
}
export function ScenePreview({ path, label, resolveUrl, compact = false, emptyLabel = '待生成画面' }: { path?: string; label: string; resolveUrl?: SceneMediaResolver; compact?: boolean; emptyLabel?: string }) {
  const [state, setState] = useState<{ path?: string; url?: string; failed?: boolean }>({});
  const resolver = useRef(resolveUrl);
  resolver.current = resolveUrl;
  const canResolve = Boolean(resolveUrl);
  useEffect(() => {
    let alive = true;
    setState({ path });
    if (path) Promise.resolve().then(() => resolver.current ? resolver.current(path) : path).then(value => {
      const url = safeMotionComicTaskMediaUrl(value);
      if (alive) setState({ path, url, failed: !url });
    }).catch(() => { if (alive) setState({ path, failed: true }); });
    return () => { alive = false; };
  }, [path, canResolve]);
  const current = state.path === path ? state : {};
  return <span className={`comic-scene-preview${compact ? ' is-compact' : ''}`}>
    {current.url && !current.failed ? <img src={current.url} alt={label} loading="lazy" onError={() => setState({ path, failed: true })} /> : <span className="comic-scene-preview__empty">{current.failed ? <ImageOff size={compact ? 18 : 26} aria-hidden="true" /> : <ImageIcon size={compact ? 18 : 26} aria-hidden="true" />}<span>{current.failed ? '图片加载失败' : path ? '正在加载' : emptyLabel}</span></span>}
  </span>;
}
