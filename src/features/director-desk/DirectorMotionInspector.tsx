import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Gauge, Plus, Trash2, SkipBack, SkipForward, Play, Pause } from 'lucide-react';
import { IconButton, SelectField, SliderField, TextAreaField, TextField, Toolbar, Button } from '../../ui';
import type { DirectorCameraKeyframe, DirectorLayerKeyframe, DirectorDeskWorkspaceProps, DirectorMotionPreset, DirectorShot } from './DirectorDeskWorkspace';
import type { EditorialMotionEdit } from '../../shared/editorial-collage';

export function DirectorMotionInspector({ shot, onUpdate, onEdit, busy, timeMs, playing, onSeek, onPreview }: {
  shot: DirectorShot;
  onUpdate: DirectorDeskWorkspaceProps['onUpdateShot'];
  onEdit?: DirectorDeskWorkspaceProps['onUpdateShotMotion'];
  busy: boolean;
  timeMs: number;
  playing: boolean;
  onSeek: (timeMs: number) => void;
  onPreview: (startMs: number, endMs: number) => void;
}) {
  const [target, setTarget] = useState('camera');
  const [error, setError] = useState('');
  useEffect(() => { setTarget('camera'); setError(''); }, [shot.id]);
  const camera = shot.cameraKeyframes ?? [];
  const fallbackEndZoom = shot.motionPreset === '轻微视差' ? 1.03 : shot.motionPreset === '固定机位' ? 1 : 1.06;
  const start = camera[0] ?? { atMs: 0, x: 0.5, y: 0.5, zoom: 1 };
  const end = camera.at(-1) ?? { atMs: shot.durationMs, x: 0.5, y: 0.5, zoom: fallbackEndZoom };
  // Later DOM layers win when z-indices are equal; keep that order in the stack.
  const layers = [...(shot.previewLayers ?? [])].sort((left, right) => left.zIndex - right.zIndex).reverse();
  const disabled = busy || !onEdit;
  const layer = shot.previewLayers?.find((candidate) => `layer:${candidate.id}` === target);
  function edit(action: Parameters<NonNullable<typeof onEdit>>[1]) {
    if (disabled) return false;
    try { onEdit?.(shot.id, action); setError(''); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : '运动参数更新失败。'); return false; }
  }
  return <div className="director-form-stack" data-director-motion-editor={shot.id}>
    <TextAreaField fieldClassName="director-prompt-field" label="运动提示词" value={shot.motionPrompt} disabled={busy} onChange={(_, data) => onUpdate(shot.id, { motionPrompt: data.value })} resize="vertical" />
    {shot.renderStrategy === 'living-poster' ? <div className="director-inspector-note"><Gauge size={14} /><span>AI 动态海报直接播放生成的视频。切换到“本地关键帧”可编辑已保留的图层与相机；运动提示词在下次视频生成时生效。</span></div> : <>
      <SelectField label="运动控制" hint="套用预设会替换相机关键帧" value={shot.motionPreset ?? '平移 + 缓慢推进'} options={(['平移 + 缓慢推进', '轻微视差', '固定机位'] as const).map((label) => ({ value: label, label }))} disabled={busy} onChange={(event) => onUpdate(shot.id, { motionPreset: event.target.value as DirectorMotionPreset })} />
      <div className="director-two-col"><TextField label="起始缩放" value={`${Math.round(start.zoom * 100)}%`} readOnly /><TextField label="结束缩放" value={`${Math.round(end.zoom * 100)}%`} readOnly /></div>
      <div className="director-motion-facts"><span><strong>{camera.length}</strong> 个相机关键帧</span><span>起点 {Math.round(start.x * 100)}%, {Math.round(start.y * 100)}%</span><span>终点 {Math.round(end.x * 100)}%, {Math.round(end.y * 100)}%</span></div>
      <SelectField label="运动轨道" value={layer ? `layer:${layer.id}` : 'camera'} options={[{ value: 'camera', label: '相机' }, ...(shot.previewLayers ?? []).map((item) => ({ value: `layer:${item.id}`, label: item.label }))]} onChange={(event) => setTarget(event.target.value)} />
      <MotionFrames key={`${shot.id}:${layer?.id ?? 'camera'}`} frames={layer?.motion ?? camera} layerId={layer?.id} durationMs={shot.durationMs} disabled={disabled} onEdit={edit} timeMs={timeMs} playing={playing} onSeek={onSeek} onPreview={onPreview} />
      {layers.length > 0 ? <section className="director-motion-layers" aria-label="图层顺序与显隐">
        <strong>图层顺序与显隐（上层在前）</strong>
        {layers.map((layer, layerIndex) => <div key={layer.id} data-layer-id={layer.id} className={`director-motion-layer-row ${layer.visible === false ? 'is-hidden' : ''}`}>
          <IconButton label={`${layer.visible === false ? '显示' : '隐藏'} ${layer.label}`} icon={layer.visible === false ? <EyeOff size={13} /> : <Eye size={13} />} density="compact" variant="subtle" disabled={disabled} onClick={() => edit({ kind: 'layer-visibility', layerId: layer.id, visible: layer.visible === false })} />
          <Button className="director-motion-layer-copy" variant="subtle" density="compact" aria-pressed={target === `layer:${layer.id}`} onClick={() => setTarget(`layer:${layer.id}`)}><span title={layer.label}>{layer.label}</span><small>{layer.src ? `Z ${layer.zIndex} · ${layer.motion.length} 个关键帧` : '尚无图片素材'}</small></Button>
          <IconButton label={`上移 ${layer.label}`} icon={<ArrowUp size={13} />} density="compact" variant="subtle" disabled={disabled || layerIndex === 0} onClick={() => edit({ kind: 'layer-order', layerId: layer.id, direction: 'up' })} />
          <IconButton label={`下移 ${layer.label}`} icon={<ArrowDown size={13} />} density="compact" variant="subtle" disabled={disabled || layerIndex === layers.length - 1} onClick={() => edit({ kind: 'layer-order', layerId: layer.id, direction: 'down' })} />
        </div>)}
      </section> : null}
    </>}
    {error ? <div className="director-inspector-note is-warning" role="alert">{error}</div> : null}
  </div>;
}

function MotionFrames({ frames, layerId, durationMs, disabled, onEdit, timeMs, playing, onSeek, onPreview }: {
  frames: readonly (DirectorCameraKeyframe | DirectorLayerKeyframe)[];
  layerId?: string;
  durationMs: number;
  disabled: boolean;
  onEdit: (edit: EditorialMotionEdit) => boolean;
  timeMs: number;
  playing: boolean;
  onSeek: (timeMs: number) => void;
  onPreview: (startMs: number, endMs: number) => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const index = Math.min(selectedIndex, Math.max(0, frames.length - 1));
  const frame = frames[index];
  const [timeDraft, setTimeDraft] = useState(String(frame?.atMs ?? 0));
  const [timeError, setTimeError] = useState('');
  useEffect(() => { setTimeDraft(String(frame?.atMs ?? 0)); setTimeError(''); }, [frame?.atMs, index]);
  const prefix = layerId ? '图层' : '';
  const boundary = frame?.atMs === 0 || frame?.atMs === durationMs;
  const insertAt = Math.round(timeMs);
  function patch(patch: Partial<DirectorLayerKeyframe & DirectorCameraKeyframe>) {
    if (!frame) return false;
    const ok = onEdit(layerId ? { kind: 'layer-frame', layerId, index, patch } : { kind: 'camera-frame', index, patch });
    if (ok) onSeek(patch.atMs ?? frame.atMs);
    return ok;
  }
  function commitTime() {
    const atMs = Number(timeDraft);
    if (!timeDraft.trim() || !Number.isInteger(atMs)) { setTimeError('请输入整数毫秒。'); return; }
    if (atMs !== frame?.atMs && !patch({ atMs })) { setTimeError('时间未更新，请检查相邻关键帧范围。'); return; }
    setTimeError('');
  }
  return <div className="director-motion-keyframe-editor">
    <Toolbar aria-label="镜内预览" className="director-motion-toolbar">
      <IconButton label="定位首帧" icon={<SkipBack size={14} />} variant="subtle" density="compact" onClick={() => { setSelectedIndex(0); onSeek(0); }} />
      <IconButton label="定位尾帧" icon={<SkipForward size={14} />} variant="subtle" density="compact" onClick={() => { setSelectedIndex(Math.max(0, frames.length - 1)); onSeek(durationMs); }} />
      <IconButton label={playing ? '暂停镜内预览' : '预览整个镜头'} icon={playing ? <Pause size={14} /> : <Play size={14} />} variant="subtle" density="compact" onClick={() => onPreview(0, durationMs)} />
      <Button density="compact" variant="subtle" disabled={!frame || index + 1 >= frames.length} onClick={() => onPreview(frame.atMs, frames[index + 1].atMs)}><Play size={13} />预览到下一帧</Button>
    </Toolbar>
    <SliderField label="镜内时间" aria-label="镜内时间" min={0} max={Math.max(1, durationMs)} step={1} value={Math.round(timeMs)} valueLabel={`${Math.round(timeMs)}ms`} onChange={(_, data) => onSeek(Number(data.value))} />
    <div className="director-motion-frame-actions">
      <SelectField label={layerId ? '编辑图层关键帧' : '编辑相机关键帧'} value={frame ? String(index) : ''} options={frames.length ? frames.map((item, frameIndex) => ({ value: String(frameIndex), label: `${item.atMs === 0 ? '起始' : item.atMs === durationMs ? '结束' : `关键帧 ${frameIndex + 1}`} · ${item.atMs}ms` })) : [{ value: '', label: '尚无关键帧' }]} onChange={(event) => { const next = Number(event.target.value); setSelectedIndex(next); onSeek(frames[next].atMs); }} />
      <IconButton label="在播放位置添加关键帧" icon={<Plus size={14} />} variant="subtle" density="compact" disabled={disabled || frames.length >= 100 || frames.some((item) => item.atMs === insertAt)} onClick={() => { if (onEdit({ kind: 'insert-frame', layerId, atMs: insertAt })) setSelectedIndex(frames.filter((item) => item.atMs < insertAt).length); }} />
      <IconButton label="删除当前关键帧" icon={<Trash2 size={14} />} variant="subtle" density="compact" disabled={disabled || !frame || boundary || frames.length <= 1} onClick={() => { if (onEdit({ kind: 'remove-frame', layerId, index })) { setSelectedIndex(Math.max(0, index - 1)); onSeek(frames[Math.max(0, index - 1)].atMs); } }} />
    </div>
    {frame ? <>
      <TextField label="关键帧时间（毫秒）" type="number" value={timeDraft} min={0} max={durationMs} step={1} readOnly={boundary} disabled={disabled} validationMessage={timeError || undefined} onChange={(_, data) => setTimeDraft(data.value)} onBlur={commitTime} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setTimeDraft(String(frame.atMs)); setTimeError(''); } }} />
      {('zoom' in frame ? [{ key: 'zoom' as const, label: '缩放', min: 0.5, max: 2 }] : [{ key: 'scale' as const, label: '图层缩放', min: 0.1, max: 3 }]).map(({ key, label, min, max }) => {
        const value = key === 'zoom' && 'zoom' in frame ? frame.zoom : 'scale' in frame ? frame.scale : 1;
        return <SliderField key={key} label={label} aria-label={label} valueLabel={`${Math.round(value * 100)}%`} min={Math.min(min, value)} max={Math.max(max, value)} step={0.01} value={value} disabled={disabled} onChange={(_, data) => patch({ [key]: Number(data.value) })} />;
      })}
      {(['x', 'y'] as const).map((key) => <SliderField key={key} label={`${prefix}${key === 'x' ? '水平位置' : '垂直位置'}`} aria-label={`${prefix}${key === 'x' ? '水平位置' : '垂直位置'}`} valueLabel={`${Math.round(frame[key] * 100)}%`} min={Math.min(0, frame[key])} max={Math.max(1, frame[key])} step={0.01} value={frame[key]} disabled={disabled} onChange={(_, data) => patch({ [key]: Number(data.value) })} />)}
      {'opacity' in frame ? <>
        <SliderField label="图层透明度" aria-label="图层透明度" min={0} max={1} step={0.01} value={frame.opacity} valueLabel={`${Math.round(frame.opacity * 100)}%`} disabled={disabled} onChange={(_, data) => patch({ opacity: Number(data.value) })} />
        <SliderField label="图层旋转" aria-label="图层旋转" min={Math.min(-180, frame.rotation)} max={Math.max(180, frame.rotation)} step={1} value={frame.rotation} valueLabel={`${frame.rotation}°`} disabled={disabled} onChange={(_, data) => patch({ rotation: Number(data.value) })} />
      </> : null}
    </> : null}
  </div>;
}
