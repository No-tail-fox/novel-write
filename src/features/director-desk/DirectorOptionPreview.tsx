import { useEffect, useMemo, useRef, useState } from 'react';
import { buildDirectorSceneHtml, directorCanvasForRatio } from '../../shared/director-render';
import './director-option-preview.css';

export type DirectorOptionKind = 'layout' | 'camera' | 'subtitle' | 'recipe' | 'strategy';
export const DIRECTOR_LAYOUT_OPTIONS = ['对比拼贴 · 纸张撕裂', '纪录片 · 纯画面', '漫画分格 · 角色优先'] as const;
export const DIRECTOR_CAMERA_OPTIONS = ['平移 + 缓慢推进', '轻微视差', '固定机位'] as const;
export const DIRECTOR_SUBTITLE_OPTIONS = ['简体中文 · 白色描边', '简体中文 · 下方黑底'] as const;

const illustration = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect width="1920" height="1080" fill="#e9dfc9"/><path d="M0 850L450 430L1020 900L1550 480L1920 700V1080H0Z" fill="#7d9687"/><circle cx="1360" cy="320" r="155" fill="#c44d37"/><path d="M110 170H800M110 205H580M110 240H700" stroke="#b9ad93" stroke-width="16"/><path d="M200 960L700 500L1100 960" fill="#375f69"/></svg>')}`;

/** Uses the same scene HTML, layout and camera interpolation as local video export. */
export function buildDirectorOptionPreview(kind: DirectorOptionKind, value: string): string {
  return buildDirectorSceneHtml({
    title: kind === 'subtitle' ? '' : '城市里的日常', caption: '同一座城市，不同的生活视角。',
    imageUrl: illustration, durationMs: 4500, modeLabel: 'VOX', index: 1,
    layoutTemplate: kind === 'layout' ? value : '纪录片 · 纯画面',
    motionPreset: kind === 'camera' ? value : '固定机位',
    subtitleStyle: kind === 'subtitle' ? value : '简体中文 · 白色描边',
  });
}

const recipeSteps: Record<string, readonly string[]> = {
  '': ['选择素材', '编排镜头', '本地合成'],
  'paper-cut': ['构图原画', '背景＋透明主体', '分层运动'],
  'vox-narrated': ['旁白时间', '纸片＋图表＋文字', '同步动画'],
  'collage-broll': ['一句口播', '视觉隐喻关键帧', '模型生成动画'],
  nantian: ['首帧构图', '纸片展开连接', '尾帧构图'],
  'deterministic-layers': ['独立背景', '透明主体＋文字', '本地动画'],
  'living-poster': ['完整关键帧', '视频模型', '镜头视频'],
  remotion: ['选模板或编写动画', '图文与旁白', '本地渲染'],
};

export function DirectorOptionPreview({ kind, value, ratio = '16:9' }: { kind: DirectorOptionKind; value: string; ratio?: string }) {
  const frame = useRef<HTMLIFrameElement>(null), box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const html = useMemo(() => buildDirectorOptionPreview(kind, value), [kind, value]);
  const canvas = directorCanvasForRatio(ratio);
  const workflow = kind === 'recipe' || kind === 'strategy';
  useEffect(() => {
    if (workflow || !box.current) return;
    const observer = new ResizeObserver(() => setWidth(box.current?.clientWidth ?? 0));
    observer.observe(box.current); return () => observer.disconnect();
  }, [workflow]);
  // A short local loop only lives while the popover or detailed preview is mounted.
  const htmlWithPlayback = useMemo(() => html.replace('</body>', `<script nonce="director-render">
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let started=performance.now(),last=0,frame=0;
    const tick=now=>{if(now-last>80){last=now;window.__tl.seek(((now-started)%4500)/1000);}frame=requestAnimationFrame(tick);};
    const update=()=>{cancelAnimationFrame(frame);if(motion.matches){window.__tl.seek(1.8);}else{started=performance.now();frame=requestAnimationFrame(tick);}};
    motion.addEventListener('change',update);update();
  </script></body>`), [html]);
  if (workflow) return <div className="director-workflow-sample" aria-label="制作流程示意">
    <div className="director-workflow-sample__layers" aria-hidden="true"><span /><span /><span /></div>
    <div>{(recipeSteps[value] ?? recipeSteps['']).map((step, index) => <span key={step}><b>{index + 1}</b>{step}</span>)}</div>
    <small>流程示意 · 实际画面取决于素材与设置</small>
  </div>;
  return <div ref={box} className="director-option-sample" data-preview-kind={kind} data-preview-value={value} style={{ aspectRatio: ratio.replace(':', '/') }}>
    <iframe ref={frame} title={`${value}效果预览`} sandbox="allow-scripts" srcDoc={htmlWithPlayback} style={{ width: canvas.width, height: canvas.height, transform: `scale(${width / canvas.width})` }} />
  </div>;
}
