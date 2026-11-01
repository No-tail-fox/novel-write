import { useEffect, useRef, useState } from 'react';
import { Music2 } from 'lucide-react';
import { Button, CheckboxField, SelectField, SliderField } from '../../ui';
import type { StoryDreamApi } from '../../shared/storydream-api';
import type { BgmItem } from '../../shared/types';
import { voxProjectMusicSchema, type VoxProjectMusic } from '../../shared/vox-production';
import { toLocalAssetUrl } from '../tasks/task-formatters';
import { readDirectorSoundDuration } from '../director-desk/director-sound';

export function ProjectMusicFields({ value, library, api, busy, onChange }: {
  value?: VoxProjectMusic; library: readonly BgmItem[];
  api: Pick<StoryDreamApi, 'importBgmAudio'>; busy: boolean; onChange(value?: VoxProjectMusic): void;
}) {
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [imports, setImports] = useState<VoxProjectMusic[]>([]);
  const audioRef = useRef<HTMLAudioElement>(null);
  const mounted = useRef(true), importLock = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = Math.pow(10, (value?.gainDb ?? -18) / 20); }, [value?.gainDb, value?.path]);
  const options = [...library.filter(item => item.path && item.durationMs >= 1000).map(item => voxProjectMusicSchema.parse({
    id: item.id, title: item.title, path: item.path, durationMs: Math.round(item.durationMs) })), ...imports];
  if (value && !options.some(item => item.id === value.id)) options.push(value);
  const unique = [...new Map(options.map(item => [item.id, item])).values()];
  async function importMusic() {
    if (busy || importLock.current) return;
    importLock.current = true;
    setImporting(true); setError('');
    try {
      const imported = await api.importBgmAudio();
      if (!imported || !mounted.current) return;
      const durationMs = await readDirectorSoundDuration(imported.path);
      if (!mounted.current) return;
      const next = voxProjectMusicSchema.parse({ id: crypto.randomUUID(), title: imported.title, path: imported.path, durationMs,
        gainDb: value?.gainDb ?? -18, loop: value?.loop ?? true });
      setImports(items => [...items, next]); onChange(next);
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { importLock.current = false; if (mounted.current) setImporting(false); }
  }
  return <div className="vox-project-music" data-project-music>
    <SelectField label="整片背景音乐" value={value?.id ?? ''} disabled={busy || importing}
      options={[{ value: '', label: '不使用背景音乐' }, ...unique.map(item => ({ value: item.id, label: item.title }))]}
      onChange={event => { setError(''); const selected = unique.find(item => item.id === event.target.value); onChange(selected ? { ...selected, gainDb: value?.gainDb ?? selected.gainDb } : undefined); }} />
    <Button icon={<Music2 size={14} />} disabled={busy || importing} onClick={() => void importMusic()}>{importing ? '正在导入…' : '导入背景音乐'}</Button>
    {value ? <>
      <audio key={value.path} ref={audioRef} aria-label={`试听背景音乐：${value.title}`} controls preload="metadata" src={toLocalAssetUrl(value.path)} onError={() => setError('音乐文件无法播放，请重新选择或导入。')} />
      <SliderField label="音乐音量" min={-60} max={0} step={1} value={value.gainDb} valueLabel={`${value.gainDb} dB`} disabled={busy} onChange={(_, data) => onChange({ ...value, gainDb: data.value })} />
      <CheckboxField label="循环至片尾" checked={value.loop} disabled={busy} onChange={(_, data) => onChange({ ...value, loop: data.checked === true })} />
      <SliderField label="片头淡入" min={0} max={5000} step={100} value={value.fadeInMs} valueLabel={`${(value.fadeInMs / 1000).toFixed(1)} 秒`} disabled={busy} onChange={(_, data) => onChange({ ...value, fadeInMs: data.value })} />
      <SliderField label="片尾淡出" min={0} max={5000} step={100} value={value.fadeOutMs} valueLabel={`${(value.fadeOutMs / 1000).toFixed(1)} 秒`} disabled={busy} onChange={(_, data) => onChange({ ...value, fadeOutMs: data.value })} />
    </> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
