import { useState } from 'react';
import { Music2, Trash2 } from 'lucide-react';
import { Button, CheckboxField, SelectField, TextField, Toolbar } from '../../ui';
import { DIRECTOR_AUDIO_LABELS, DIRECTOR_SOUND_TRACKS, type DirectorAudioEdit } from '../../shared/director-audio-edit';
import type { DirectorSoundClip } from './director-sound';

export interface DirectorSoundInspectorProps {
  clips: readonly DirectorSoundClip[];
  shotStartMs: number;
  durationMs: number;
  busy: boolean;
  onUpdate: (id: string, patch: DirectorAudioEdit) => void;
  onRemove: (id: string) => void;
  onImport: (track: (typeof DIRECTOR_SOUND_TRACKS)[number]) => Promise<void>;
  onSeek: (timeMs: number) => void;
}

export function DirectorSoundInspector({ clips, shotStartMs, durationMs, busy, onUpdate, onRemove, onImport, onSeek }: DirectorSoundInspectorProps) {
  const [selectedId, setSelectedId] = useState(clips[0]?.id ?? '');
  const [track, setTrack] = useState<(typeof DIRECTOR_SOUND_TRACKS)[number]>('music');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const selected = clips.find((clip) => clip.id === selectedId) ?? clips[0];
  const disabled = busy || importing;
  const apply = (id: string, patch: DirectorAudioEdit) => {
    try { onUpdate(id, patch); setError(''); return true; }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return false; }
  };
  async function importSound() {
    setImporting(true);
    setError('');
    try { await onImport(track); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setImporting(false); }
  }
  const speech = selected && ['dialogue', 'narration'].includes(selected.trackType);
  return <div className="director-sound-inspector" data-director-sound-inspector>
    <h3>声音设计</h3>
    <p className="director-sound-hint">音频随镜头播放。修改后保存项目并重新导出成片。</p>
    <SelectField label="导入轨道" value={track} disabled={disabled} options={DIRECTOR_SOUND_TRACKS.map((value) => ({ value, label: DIRECTOR_AUDIO_LABELS[value] }))} onChange={(event) => setTrack(event.target.value as typeof track)} />
    <Button icon={<Music2 size={14} />} variant="secondary" disabled={disabled} onClick={() => void importSound()}>{importing ? '正在导入音频…' : '导入本地音频'}</Button>
    {error ? <p role="alert" className="director-sound-error">{error}</p> : null}
    {clips.length === 0 ? <p className="director-sound-hint">当前镜头暂无音频。可导入本地声音，或到字幕页生成配音。</p> : <>
      <SelectField label="声音片段" value={selected?.id ?? ''} disabled={disabled} options={clips.map((clip, index) => ({ value: clip.id, label: `${index + 1}. ${DIRECTOR_AUDIO_LABELS[clip.trackType]} · ${clip.title}${clip.muted ? ' · 已静音' : ''}` }))} onChange={(event) => { setSelectedId(event.target.value); setError(''); }} />
      {selected ? <div key={selected.id} data-sound-clip-id={selected.id}>
        {!selected.available ? <p className="director-sound-error">音频文件不可用，请重新导入或生成。</p> : null}
        <CheckboxField label="静音此片段" checked={selected.muted === true} disabled={disabled} onChange={(_, data) => apply(selected.id, { muted: data.checked === true })} />
        {!speech ? <SelectField label="片段轨道" value={selected.trackType} disabled={disabled} options={DIRECTOR_SOUND_TRACKS.map((value) => ({ value, label: DIRECTOR_AUDIO_LABELS[value] }))} onChange={(event) => apply(selected.id, { trackType: event.target.value as typeof track })} /> : <p className="director-sound-hint">对白与旁白时间由字幕控制；可在这里调整音量、淡入淡出和静音。</p>}
        <div className="director-sound-fields">
          {!speech ? <>
            <SoundNumber label="镜头内起点（毫秒）" value={selected.startMs - shotStartMs} min={0} max={durationMs - 1} disabled={disabled} onApply={(value) => apply(selected.id, { startMs: shotStartMs + value })} />
            <SoundNumber label="片段时长（毫秒）" value={selected.durationMs ?? durationMs} min={1} max={durationMs} disabled={disabled} onApply={(value) => apply(selected.id, { durationMs: value })} />
            <SoundNumber label="源裁剪起点（毫秒）" value={selected.sourceStartMs ?? 0} min={0} disabled={disabled} onApply={(value) => apply(selected.id, { sourceStartMs: value })} />
            <SoundNumber label="源使用时长（毫秒）" value={selected.sourceDurationMs ?? selected.durationMs ?? durationMs} min={0} disabled={disabled} onApply={(value) => apply(selected.id, { sourceDurationMs: value })} />
          </> : null}
          <SoundNumber label="音量（dB）" value={selected.gainDb ?? 0} min={-60} max={24} step={0.5} disabled={disabled} onApply={(value) => apply(selected.id, { gainDb: value })} />
          <SoundNumber label="淡入（毫秒）" value={selected.fadeInMs ?? 0} min={0} max={selected.durationMs ?? durationMs} disabled={disabled} onApply={(value) => apply(selected.id, { fadeInMs: value })} />
          <SoundNumber label="淡出（毫秒）" value={selected.fadeOutMs ?? 0} min={0} max={selected.durationMs ?? durationMs} disabled={disabled} onApply={(value) => apply(selected.id, { fadeOutMs: value })} />
        </div>
        <Toolbar aria-label="声音片段操作">
          <Button variant="subtle" disabled={disabled} onClick={() => onSeek(selected.startMs)}>定位片段</Button>
          {!speech ? <Button icon={<Trash2 size={14} />} variant="danger" disabled={disabled} onClick={() => { try { onRemove(selected.id); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } }}>移除片段</Button> : null}
        </Toolbar>
      </div> : null}
    </>}
  </div>;
}

function SoundNumber({ label, value, min, max, step = 1, disabled, onApply }: {
  label: string; value: number; min: number; max?: number; step?: number; disabled: boolean; onApply: (value: number) => boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  function commit() {
    if (draft === null) return;
    const parsed = Number(draft);
    if (!draft.trim() || !Number.isFinite(parsed) || parsed < min || (max !== undefined && parsed > max) || (step === 1 && !Number.isInteger(parsed))) { setInvalid(true); return; }
    if (onApply(parsed)) { setDraft(null); setInvalid(false); } else setInvalid(true);
  }
  return <TextField label={label} type="number" min={min} max={max} step={step} value={draft ?? String(value)} disabled={disabled} validationMessage={invalid ? '数值无效或片段超出范围，请调整。' : undefined} onChange={(_, data) => { setDraft(data.value); setInvalid(false); }} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } if (event.key === 'Escape') { setDraft(null); setInvalid(false); } }} />;
}
