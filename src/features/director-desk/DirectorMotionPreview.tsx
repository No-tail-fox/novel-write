import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { Button, Dialog, HoverPreview, SegmentedControl, SliderField } from '../../ui';
import { createEditorialMotionLayers, EDITORIAL_MOTION_STYLES, type EditorialMotionStyle } from '../../shared/editorial-motion';
import { buildDirectorSceneHtml, directorCanvasForRatio } from '../../shared/director-render';
import './director-motion-preview.css';

const DURATION_MS = 5000;
const svg = (body: string) => `data:image/svg+xml,${encodeURIComponent(body)}`;
// Small local illustrations demonstrate the motion; they never enter project assets.
const background = svg('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><rect width="1600" height="900" fill="#eee5cf"/><path d="M0 655L330 390L680 660L1020 430L1600 690V900H0Z" fill="#b8c2ac"/><path d="M0 810L550 600L920 795L1260 610L1600 730V900H0Z" fill="#789684"/><path d="M0 860H1600M0 865H1600" stroke="#46695a" stroke-width="3"/></svg>');
const subject = svg('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="700"><path d="M90 170L295 30L510 170V535L300 665L90 535Z" fill="#bf4e38"/><path d="M90 170L300 280L510 170L295 30Z" fill="#ea9670"/><path d="M300 280V665L510 535V170Z" fill="#8e382b"/><path d="M145 188L300 270L455 188M300 300V610" stroke="#fff2d3" stroke-width="5" fill="none"/></svg>');
const secondary = svg('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="700"><path d="M70 500L300 70L535 500L300 650Z" fill="#3f6b87"/><path d="M300 70L300 650L535 500Z" fill="#29495f"/><path d="M70 500L300 470L535 500L300 650Z" fill="#8baebc"/><path d="M300 130V420L120 485" stroke="#fff2d3" stroke-width="5" fill="none"/></svg>');

export function buildMotionPreviewHtml(style: EditorialMotionStyle, ratio: string): string {
  const item = EDITORIAL_MOTION_STYLES.find(candidate => candidate.id === style)!;
  const layers = createEditorialMotionLayers({
    shotId: 'motion-example', narration: style === 'comparison' ? '一边是红色纸片，另一边是蓝色纸片。' : '红色纸片先进入画面。蓝色纸片随后展开。',
    title: item.label, durationMs: DURATION_MS, ratio, index: 0, motionStyle: style,
  }).map(layer => ({ ...layer, imageUrl: layer.content ? undefined : layer.kind === 'background' ? background : layer.id.endsWith('secondary') ? secondary : subject }));
  const html = buildDirectorSceneHtml({ title: item.label, caption: '', subtitleCues: [], layers, durationMs: DURATION_MS, modeLabel: 'VOX', index: 1,
    camera: [{ atMs: 0, x: .5, y: .5, zoom: 1 }], renderStrategy: 'deterministic-layers' });
  return html.replace('</body>', `<script nonce="director-render">
    const fail = error => parent.postMessage({type:'motion-preview-error',message:String(error.message || error)},'*');
    window.addEventListener('message', event => {
      if(event.source !== parent || event.data?.type !== 'motion-preview-seek' || !Number.isFinite(event.data.timeMs)) return;
      Promise.resolve(window.__tl.seek(event.data.timeMs/1000)).catch(fail);
    });
    Promise.all([document.fonts.ready,...Array.from(document.images).map(image=>image.decode())])
      .then(()=>parent.postMessage({type:'motion-preview-ready'},'*')).catch(fail);
  </script></body>`);
}

function MotionPlayer({ style, ratio, compact = false, autoPlay = true }: { style: EditorialMotionStyle; ratio: string; compact?: boolean; autoPlay?: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const canvas = directorCanvasForRatio(ratio);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const clock = useRef(0);
  const html = useMemo(() => buildMotionPreviewHtml(style, ratio), [style, ratio]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setScale(element.clientWidth / canvas.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [canvas.width]);
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== ref.current?.contentWindow) return;
      if (event.data?.type === 'motion-preview-ready') {
        setReady(true);
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        setPlaying(autoPlay && !reduced);
        if (compact && reduced) { clock.current = 2000; setTime(2000); }
      }
      if (event.data?.type === 'motion-preview-error') { setError(String(event.data.message)); setPlaying(false); }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [autoPlay, compact]);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => { if (preference.matches) setPlaying(false); };
    preference.addEventListener('change', change);
    return () => preference.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (ready || error) return;
    const timer = setTimeout(() => setError('动作预览加载失败，请关闭后重试。'), 10000);
    return () => clearTimeout(timer);
  }, [ready, error]);
  useEffect(() => {
    if (ready && !error) ref.current?.contentWindow?.postMessage({ type: 'motion-preview-seek', timeMs: time }, '*');
  }, [time, ready, error]);
  useEffect(() => {
    if (!playing || !ready || error) return;
    let frame = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const next = compact ? (clock.current + now - previous) % DURATION_MS : Math.min(DURATION_MS, clock.current + now - previous);
      previous = now;
      clock.current = next;
      setTime(next);
      if (next >= DURATION_MS) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, ready, error, compact]);
  const seek = (value: number) => { clock.current = value; setTime(value); };
  return <div className={`director-motion-player${compact ? ' director-motion-player--compact' : ''}`}>
    <div ref={container} className="director-motion-demo" data-motion-preview-style={style} data-preview-ratio={ratio} data-motion-ready={ready && !error ? 'true' : 'false'} style={{ aspectRatio: ratio.replace(':', '/') }}>
      <iframe ref={ref} title="本地拼贴动作预览" sandbox="allow-scripts" srcDoc={html} style={{ width: canvas.width, height: canvas.height, transform: `scale(${scale})`, transformOrigin: 'top left' }} />
      {error || !ready ? <div className="director-motion-message" role={error ? 'alert' : 'status'}>{error || '正在准备动作预览…'}</div> : null}
    </div>
    {!compact ? <><div className="director-motion-transport">
      <Button density="compact" disabled={!ready || Boolean(error)} onClick={() => { if (time >= DURATION_MS) seek(0); setPlaying(!playing); }}>{playing ? <Pause size={14} /> : <Play size={14} />}{playing ? '暂停预览' : '播放预览'}</Button>
      <Button density="compact" variant="subtle" disabled={!ready || Boolean(error)} onClick={() => { seek(0); setPlaying(true); }}><RotateCcw size={14} />重播</Button>
      <span>{(time / 1000).toFixed(1)} / 5.0 秒</span>
    </div>
    <SliderField label="动作预览进度" min={0} max={DURATION_MS} step={50} value={Math.round(time)} disabled={!ready || Boolean(error)} onChange={(_, data) => { setPlaying(false); seek(Number(data.value)); }} /></> : null}
  </div>;
}

/** A muted, local production-rendered loop for lightweight option previews. */
export function DirectorMotionSample({ style, ratio = '16:9', playing = true }: { style: EditorialMotionStyle; ratio?: string; playing?: boolean }) {
  return <MotionPlayer key={`${style}:${ratio}:${playing}`} style={style} ratio={ratio} compact autoPlay={playing} />;
}

export function DirectorMotionPreview({ selected, ratio = '16:9', disabled, onApply }: {
  selected: EditorialMotionStyle; ratio?: string; disabled?: boolean; onApply: (style: EditorialMotionStyle) => void;
}) {
  const [open, setOpen] = useState(false);
  const [candidate, setCandidate] = useState(selected);
  const [previewRatio, setPreviewRatio] = useState(ratio);
  const item = EDITORIAL_MOTION_STYLES.find(style => style.id === candidate)!;
  return <>
    <Button density="compact" variant="secondary" onClick={() => { setCandidate(selected); setPreviewRatio(ratio); setOpen(true); }}><Play size={14} />预览动作</Button>
    {open ? <Dialog open title="本地拼贴 · 动作预览" onOpenChange={setOpen} actions={<><Button onClick={() => setOpen(false)}>关闭</Button><Button variant="primary" disabled={disabled} onClick={() => { onApply(candidate); setOpen(false); }}>应用到当前镜头</Button></>}>
      <div className="director-motion-catalog">
        <p className="director-motion-note">示例素材 · 可先比较动作，应用后保留当前镜头素材。</p>
        <div className="director-motion-options" role="group" aria-label="预览叙事动作">{EDITORIAL_MOTION_STYLES.map(style => <HoverPreview key={style.id} title={style.label} description={style.description} renderPreview={() => <DirectorMotionSample style={style.id} ratio={previewRatio} />}><Button variant={candidate === style.id ? 'secondary' : 'subtle'} aria-pressed={candidate === style.id} onClick={() => setCandidate(style.id)}>{style.label}</Button></HoverPreview>)}</div>
        <SegmentedControl label="动作预览画幅" value={previewRatio} options={['16:9', '9:16', '1:1', '4:3'].map(value => ({ value, label: value }))} onChange={setPreviewRatio} />
        <MotionPlayer key={`${candidate}:${previewRatio}`} style={candidate} ratio={previewRatio} />
        <p className="director-motion-note">{item.description}</p>
      </div>
    </Dialog> : null}
  </>;
}
