import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, LocateFixed } from 'lucide-react';
import { Button, IconButton, SelectField } from '../../ui';
import { DIRECTOR_TIMELINE_LANES, projectDirectorTimeline, timelinePixelsAtTime, timelineTimeAtPixel, timelineTimeLabel, type DirectorTimelineItem, type TimelineShot } from './director-multitrack';

type Drag = { item: DirectorTimelineItem; originX: number; scrollLeft: number; startMs: number; active: boolean };
export function DirectorMultitrackTimeline({ shots, timeMs, selectedShotId, shotStatusLabel, onSeek, onSelect, busy = false, onReorder, onEditTime, canEditTime, onDropCandidate, acceptsCandidateDrop, visibleLaneIds }: {
  shots: readonly TimelineShot[];
  timeMs: number;
  selectedShotId: string;
  shotStatusLabel: (shotId: string) => string;
  onSeek: (timeMs: number) => void;
  onSelect: (item: DirectorTimelineItem) => void;
  busy?: boolean;
  onReorder?: (shotId: string, targetShotId: string) => void;
  onEditTime?: (item: DirectorTimelineItem, startMs: number) => void;
  canEditTime?: (item: DirectorTimelineItem) => boolean;
  /** Accepts a dragged video candidate dropped on the video lane; shotId is resolved by x position. */
  onDropCandidate?: (shotId: string, dataTransfer: DataTransfer) => void;
  acceptsCandidateDrop?: (dataTransfer: DataTransfer) => boolean;
  /** When set, only these lane ids are rendered. */
  visibleLaneIds?: readonly string[];
}) {
  const projection = useMemo(() => projectDirectorTimeline(shots), [shots]);
  const [scale, setScale] = useState(40);
  const [selectedKey, setSelectedKey] = useState('');
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const [error, setError] = useState('');
  const [dropShotId, setDropShotId] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const width = Math.max(1, timelinePixelsAtTime(projection.durationMs, scale));
  const tickMs = Math.max(1000, Math.ceil(90 / scale) * 1000);
  const ticks = Array.from({ length: Math.floor(projection.durationMs / tickMs) + 1 }, (_, index) => index * tickMs);
  const selected = projection.items.find((item) => item.key === selectedKey && item.shotId === selectedShotId);
  const editable = (item: DirectorTimelineItem) => !busy && (item.lane === 'video' ? Boolean(onReorder) : Boolean(canEditTime?.(item)));
  function clampStart(item: DirectorTimelineItem, start: number) {
    const owner = projection.items.find((clip) => clip.lane === 'video' && clip.shotId === item.shotId);
    return Math.round(Math.max(owner?.startMs ?? 0, Math.min((owner?.endMs ?? projection.durationMs) - (item.endMs - item.startMs), start)));
  }
  function commit(item: DirectorTimelineItem, start: number) {
    if (!editable(item)) return;
    try {
      if (item.lane === 'video') {
        const videos = projection.items.filter((clip) => clip.lane === 'video');
        const target = videos.find((clip) => start >= clip.startMs && start < clip.endMs) ?? videos.at(-1);
        if (target && target.shotId !== item.shotId) onReorder?.(item.shotId, target.shotId);
      } else onEditTime?.(item, clampStart(item, start));
      setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  function nudge(direction: number) {
    if (!selected) return;
    if (selected.lane === 'video') {
      const index = shots.findIndex((shot) => shot.id === selected.shotId);
      const target = shots[index + direction];
      if (target) { try { onReorder?.(selected.shotId, target.id); setError(''); } catch (reason) { setError(String(reason)); } }
    } else commit(selected, selected.startMs + direction * 100);
  }
  function revealPlayhead() {
    const scroll = scrollRef.current;
    if (scroll) scroll.scrollLeft = Math.max(0, timelinePixelsAtTime(timeMs, scale) - (scroll.clientWidth - 112) / 2);
  }
  return <section className="director-multitrack" aria-label="多轨时间线">
    <div className="director-multitrack-toolbar">
      <strong>多轨时间线</strong><span>{timelineTimeLabel(timeMs)} / {timelineTimeLabel(projection.durationMs)}</span>
      <IconButton label="向前移动所选片段" icon={<ArrowLeft size={14} />} disabled={!selected || !editable(selected)} onClick={() => nudge(-1)} />
      <IconButton label="向后移动所选片段" icon={<ArrowRight size={14} />} disabled={!selected || !editable(selected)} onClick={() => nudge(1)} />
      <SelectField label="缩放" aria-label="时间线缩放" value={String(scale)} options={[10, 20, 40, 80, 160, 320].map(value => ({ value: String(value), label: `${value} 像素/秒` }))} onChange={event => setScale(Number(event.target.value))} />
      <Button density="compact" icon={<LocateFixed size={14} />} onClick={revealPlayhead}>定位游标</Button>
    </div>
    <p className="director-multitrack-hint">拖动画面调整镜头顺序；拖动字幕、音乐与音效调整时间。Alt + 左右方向键或移动按钮也可调整。</p>
    <div className="director-multitrack-scroll" ref={scrollRef} tabIndex={0} aria-label="可横向滚动的时间线">
      <div className="director-multitrack-grid" style={{ width: width + 112 }}>
        <div className="director-multitrack-label">时间（分:秒）</div>
        <div className="director-multitrack-ruler" role="slider" tabIndex={0} aria-label="时间线播放位置" aria-valuemin={0} aria-valuemax={projection.durationMs} aria-valuenow={Math.min(timeMs, projection.durationMs)} aria-valuetext={timelineTimeLabel(timeMs)} onPointerDown={event => { event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); onSeek(timelineTimeAtPixel(event.clientX - event.currentTarget.getBoundingClientRect().left, scale, projection.durationMs)); }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) onSeek(timelineTimeAtPixel(event.clientX - event.currentTarget.getBoundingClientRect().left, scale, projection.durationMs)); }} onKeyDown={event => {
          const delta = event.shiftKey ? 1000 : 100;
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? projection.durationMs : ['ArrowRight', 'ArrowUp'].includes(event.key) ? timeMs + delta : ['ArrowLeft', 'ArrowDown'].includes(event.key) ? timeMs - delta : null;
          if (next !== null) { event.preventDefault(); onSeek(Math.max(0, Math.min(projection.durationMs, next))); }
        }}>
          {ticks.map(tick => <span key={tick} style={{ left: timelinePixelsAtTime(tick, scale) }}>{timelineTimeLabel(tick).slice(0, -4)}</span>)}
        </div>
        {DIRECTOR_TIMELINE_LANES.filter(lane => (visibleLaneIds ? visibleLaneIds.includes(lane.id) : lane.id !== 'other' || projection.items.some(item => item.lane === 'other'))).map(lane => {
          const clips = projection.items.filter(item => item.lane === lane.id);
          const rows = Math.max(1, ...clips.map(item => item.row + 1));
          const isVideo = lane.id === 'video';
          const canDrop = isVideo && Boolean(onDropCandidate);
          return <div className="director-multitrack-row" key={lane.id}>
            <div className="director-multitrack-label">{lane.label}<small>{clips.length} 个片段</small></div>
            <div className={`director-multitrack-lane director-multitrack-lane--${lane.id}`} style={{ height: rows * 44 + 8 }}
              onDragOver={canDrop ? (event) => { if (!acceptsCandidateDrop?.(event.dataTransfer)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; const rect = event.currentTarget.getBoundingClientRect(); const x = event.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0); const hit = projection.items.filter(c => c.lane === 'video').find(c => x >= timelinePixelsAtTime(c.startMs, scale) && x < timelinePixelsAtTime(c.endMs, scale)); setDropShotId(hit?.shotId ?? ''); } : undefined}
              onDragLeave={canDrop ? () => setDropShotId('') : undefined}
              onDrop={canDrop ? (event) => { if (!acceptsCandidateDrop?.(event.dataTransfer)) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); const x = event.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0); const videoClips = projection.items.filter(c => c.lane === 'video'); const hit = videoClips.find(c => x >= timelinePixelsAtTime(c.startMs, scale) && x < timelinePixelsAtTime(c.endMs, scale)) ?? videoClips.at(-1); setDropShotId(''); if (hit) onDropCandidate!(hit.shotId, event.dataTransfer); } : undefined}
            >
              {!clips.length ? <span className="director-multitrack-empty">暂无{lane.label}片段</span> : clips.map(item => <Button key={item.key} variant="subtle" className="director-multitrack-clip" data-selected={item.key === selected?.key} data-shot-selected={item.shotId === selectedShotId} data-draggable={editable(item)} data-dragging={drag?.item.key === item.key && drag.active} data-drop-target={isVideo && dropShotId === item.shotId ? 'true' : undefined} aria-pressed={item.key === selected?.key} aria-label={`${lane.label}：${item.label}，${timelineTimeLabel(item.startMs)} 至 ${timelineTimeLabel(item.endMs)}，${item.detail}${isVideo ? `，${shotStatusLabel(item.shotId)}` : ''}${item.muted ? '，已静音' : ''}`} title={`${item.label} · ${item.detail} · ${timelineTimeLabel(item.startMs)}–${timelineTimeLabel(item.endMs)}${editable(item) ? ' · 可拖动' : ''}`} style={{ left: timelinePixelsAtTime(drag?.item.key === item.key ? drag.startMs : item.startMs, scale), width: timelinePixelsAtTime(item.endMs - item.startMs, scale), top: item.row * 44 + 4 }}
                onPointerDown={event => {
                  if (event.button !== 0 || !editable(item)) return;
                  suppressClick.current = false;
                  setSelectedKey(item.key); onSelect(item);
                  const next = { item, originX: event.clientX, scrollLeft: scrollRef.current?.scrollLeft ?? 0, startMs: item.startMs, active: false };
                  dragRef.current = next; setDrag(next); event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={event => {
                  const current = dragRef.current;
                  if (!current || current.item.key !== item.key) return;
                  const scroll = scrollRef.current;
                  const delta = event.clientX - current.originX + (scroll?.scrollLeft ?? 0) - current.scrollLeft;
                  if (!current.active && Math.abs(delta) < 5) return;
                  const start = item.startMs + Math.round(delta * 1000 / scale / (event.shiftKey ? 1 : 100)) * (event.shiftKey ? 1 : 100);
                  const next = { ...current, active: true, startMs: isVideo ? Math.max(0, Math.min(projection.durationMs - 1, start)) : clampStart(item, start) };
                  dragRef.current = next; setDrag(next);
                  if (scroll) { const rect = scroll.getBoundingClientRect(); if (event.clientX > rect.right - 28) scroll.scrollLeft += 12; else if (event.clientX < rect.left + 140) scroll.scrollLeft -= 12; }
                }}
                onPointerUp={event => {
                  const current = dragRef.current;
                  dragRef.current = null; setDrag(null);
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                  if (current?.active) { suppressClick.current = true; setSelectedKey(item.key); commit(item, current.startMs); }
                }}
                onPointerCancel={() => { dragRef.current = null; setDrag(null); }}
                onKeyDown={event => { if (event.key === 'Escape') { dragRef.current = null; setDrag(null); } if (event.altKey && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); if (item.key !== selected?.key) { setSelectedKey(item.key); onSelect(item); } if (isVideo) { const index = shots.findIndex(shot => shot.id === item.shotId); const target = shots[index + (event.key === 'ArrowLeft' ? -1 : 1)]; if (!busy && target) onReorder?.(item.shotId, target.id); } else commit(item, item.startMs + (event.key === 'ArrowLeft' ? -100 : 100)); } }}
                onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } setSelectedKey(item.key); onSelect(item); }} onFocus={event => event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' })}>
                {item.thumbnail ? <img src={item.thumbnail} alt="" loading="lazy" /> : null}<span>{item.muted ? '静音 · ' : ''}{item.label}{isVideo ? <span className="director-mini-status-label">{shotStatusLabel(item.shotId)}</span> : null}</span>
              </Button>)}
            </div>
          </div>;
        })}
        <div className="director-multitrack-playhead" aria-hidden="true" style={{ left: 112 + timelinePixelsAtTime(Math.min(timeMs, projection.durationMs), scale) }} />
      </div>
    </div>
    <p className="director-multitrack-selection" aria-live="polite">{error || (drag?.active ? `移动到 ${timelineTimeLabel(drag.startMs)}` : selected ? `${selected.label} · ${selected.detail} · ${timelineTimeLabel(selected.startMs)}–${timelineTimeLabel(selected.endMs)}${editable(selected) ? ' · 拖动或 Alt + 方向键移动' : ''}` : '选择片段查看时间与设置；拖动画面排序，字幕、音乐和音效可在所属镜头内移动。')}</p>
  </section>;
}
