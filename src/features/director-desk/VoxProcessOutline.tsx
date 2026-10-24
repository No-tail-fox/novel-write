import { BookOpenText, Check, ChevronDown, Film, ImageOff, Send, Volume2 } from 'lucide-react';
import { useLayoutEffect, useRef } from 'react';
import { Button } from '../../ui';
import { formatPlaybackTime, playbackShotOffset } from './director-playback';
import type { DirectorShot } from './DirectorDeskWorkspace';

const steps = [
  { id: 'script', label: '文案', stage: '剧本', icon: BookOpenText },
  { id: 'storyboard', label: '分镜', stage: '镜头生成', icon: Film },
  { id: 'audio', label: '配音字幕', stage: '配音字幕', icon: Volume2 },
  { id: 'delivery', label: '成片', stage: '导出', icon: Send },
] as const;

export function VoxProcessOutline({ shots, selectedId, phase, onStage, onSelect, reveal = true }: {
  shots: readonly DirectorShot[];
  selectedId: string;
  phase: string;
  onStage: (stage: string) => void;
  onSelect: (id: string) => void;
  reveal?: boolean;
}) {
  const outlineRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!reveal || !outlineRef.current?.getClientRects().length) return;
    outlineRef.current.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedId, reveal]);
  return <nav ref={outlineRef} className="vox-process-outline" aria-label="Vox 制作流程">
    {steps.map(({ id, label, stage, icon: Icon }) => <section className="vox-process-step" key={id}>
      <Button variant="subtle" className={`vox-process-heading ${phase === id ? 'is-active' : ''}`} aria-current={phase === id ? 'step' : undefined} onClick={() => onStage(stage)}>
        <Icon size={18} /><strong>{label}</strong><span>{id === 'storyboard' ? `${shots.length} 镜头` : id === 'audio' ? '音色与字幕' : id === 'delivery' ? '预览与导出' : '查看原稿'}</span><ChevronDown size={14} />
      </Button>
      {id === 'storyboard' ? <div className="vox-outline-shots" aria-label="分镜列表">
        {shots.map(shot => {
          const start = playbackShotOffset(shots, shot.id);
          const ready = shot.status === 'ready';
          return <Button key={shot.id} className={`vox-outline-shot ${shot.id === selectedId ? 'is-active' : ''}`} variant="subtle" aria-label={`选择镜头 ${String(shot.index).padStart(2, '0')} ${shot.title}`} aria-pressed={shot.id === selectedId} onClick={() => onSelect(shot.id)}>
            <span className="vox-outline-thumb">{shot.thumbnail ? <img src={shot.thumbnail} alt="" /> : <ImageOff size={20} aria-label="暂无画面" />}</span>
            <span className="vox-outline-copy"><strong>镜头 {String(shot.index).padStart(2, '0')}{ready ? <Check size={12} aria-label="画面已就绪" /> : null}</strong><span>{shot.title}</span><small>{formatPlaybackTime(start)} – {formatPlaybackTime(start + shot.durationMs)}</small></span>
          </Button>;
        })}
        {shots.length === 0 ? <p className="vox-outline-empty">生成分镜后，在这里选择镜头。</p> : null}
      </div> : null}
    </section>)}
  </nav>;
}
