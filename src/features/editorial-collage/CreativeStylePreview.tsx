import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Film } from 'lucide-react';
import { Button } from '../../ui';
import { creativeStyleSample, LEMO_GALLERY_URL, LEMO_REPOSITORY_URL } from '../../shared/creative-animation/samples';
import { creativeStylePoster } from '../../shared/creative-animation/posters';
import type { CREATIVE_STYLES } from '../../shared/creative-animation/styles';

type CreativeStyle = typeof CREATIVE_STYLES[number];
export function CreativeStyleCover({ style, thumbnail = false }: { style: CreativeStyle; thumbnail?: boolean }) {
  const [failed, setFailed] = useState(false);
  const poster = creativeStylePoster(style.slug);
  useEffect(() => setFailed(false), [poster]);
  return <div className="creative-style-cover">
    {poster && !failed ? <img src={poster} alt={`${style.cn} · Lemo 官方样片封面`} loading={thumbnail ? 'lazy' : 'eager'} onError={() => setFailed(true)} />
      : <span><Film size={24} />封面暂不可用</span>}
  </div>;
}

/** Only mounted after an explicit preview action; hover never loads video. */
export function CreativeStyleFilm({ style, mode, automatic, onOpenUrl }: {
  style: CreativeStyle;
  mode: 'ai-code' | 'template';
  automatic: boolean;
  onOpenUrl(url: string): Promise<void>;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [attempt, setAttempt] = useState(0);
  const [actionError, setActionError] = useState('');
  const sample = creativeStyleSample(style.slug);
  useEffect(() => {
    const element = video.current;
    // Retrying replaces the media node and removes the focused retry button.
    // Keep keyboard focus inside the preview dialog after that replacement.
    if (attempt > 0) element?.focus();
    const pause = () => { if (document.hidden) element?.pause(); };
    const exitFullscreen = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.fullscreenElement && element?.contains(document.fullscreenElement)) {
        event.preventDefault();
        event.stopPropagation();
        void document.exitFullscreen().catch(() => setActionError('退出全屏失败，请再次按 Esc。'));
      }
    };
    document.addEventListener('visibilitychange', pause);
    document.addEventListener('keydown', exitFullscreen, true);
    return () => { document.removeEventListener('visibilitychange', pause); document.removeEventListener('keydown', exitFullscreen, true); element?.pause(); };
  }, [attempt]);
  const open = (url: string) => {
    video.current?.pause();
    setActionError('');
    void onOpenUrl(url).catch(() => setActionError('未能打开浏览器，请稍后重试。'));
  };
  return <section className="creative-style-film" aria-label={`${style.cn}官方样片`}>
    {automatic ? <p>当前素材流程自动匹配：{style.cn}</p> : null}
    {sample ? <div className="creative-style-player">
      <video key={attempt} ref={video} src={sample.video} poster={creativeStylePoster(style.slug)} controls playsInline preload="none" tabIndex={0} aria-label={`${style.cn}官方参考样片`}
        onPlay={() => setState(video.current && video.current.readyState >= 3 ? 'ready' : 'loading')} onCanPlay={() => setState('ready')} onPlaying={() => setState('ready')} onWaiting={() => setState('loading')} onError={() => setState('error')} />
      {state === 'loading' ? <p role="status">样片正在加载…</p> : null}
      {state === 'error' ? <div className="creative-style-media-error" role="alert"><p>样片加载失败，请重试或前往官方风格库观看。</p><Button onClick={() => { setState('idle'); setAttempt(value => value + 1); }}>重新加载样片</Button></div> : null}
    </div> : <p>此风格尚未接入样片，可在官方风格库查看。</p>}
    <div className="creative-style-film-copy">
      <strong>{style.film} · {Math.round(style.dur)} 秒</strong>
      <p>{style.line_cn}</p>
      <p>{mode === 'template' ? '模板装配按风格生成素材，使用所选配色与现有兼容动效，官方样片供风格参考。' : '官方样片供风格参考，AI 将按你的文案重新编排画面与动画。'}</p>
      {style.adapter?.adaptationNote ? <p>{style.adapter.adaptationNote}</p> : null}
      <p className="creative-style-credit"><a href={LEMO_REPOSITORY_URL} onClick={event => { event.preventDefault(); open(LEMO_REPOSITORY_URL); }}>LemoLab</a> · 原片画面与封面 CC BY 4.0{sample?.voiceExcludedFromCc ? '；原片配音不在此许可内' : ''}。本地封面已缩放并转为 WebP。制作时不使用原片音轨。</p>
      <Button variant="subtle" icon={<ExternalLink size={14} />} onClick={() => open(LEMO_GALLERY_URL)}>查看 Lemo 全部 59 种风格</Button>
      {actionError ? <p role="alert">{actionError}</p> : null}
    </div>
  </section>;
}
