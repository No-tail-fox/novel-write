import type { MusicGenerateInput, MusicLabRecord, MusicModel, MusicTrack } from '../../shared/music-lab';

export type MusicDraft = {
  profileId: string;
  mode: 'description' | 'custom' | 'sounds'; model: MusicModel;
  description: string; title: string; lyrics: string; style: string; instrumental: boolean;
  negativeStyle: string; vocalGender: string; styleWeight: number; weirdness: number;
  maxMode: boolean; variety: number; soundDescription: string; loop: boolean; bpm: string; key: string;
  targetDuration: string;
};
export const defaultMusicDraft: MusicDraft = {
  profileId: '',
  mode: 'description', model: 'suno-v6', description: '', title: '', lyrics: '', style: '',
  instrumental: false, negativeStyle: '', vocalGender: '', styleWeight: 0.5, weirdness: 0.5,
  maxMode: false, variety: 1, soundDescription: '', loop: false, bpm: '', key: '',
  targetDuration: '',
};
export function musicDraftInput(draft: MusicDraft): MusicGenerateInput {
  if (draft.mode === 'sounds') return {
    mode: 'sounds', model: draft.model, description: draft.soundDescription.trim(), title: draft.title.trim(), loop: draft.loop,
    ...(draft.bpm ? { bpm: Number(draft.bpm) } : {}), ...(draft.key.trim() ? { key: draft.key.trim() } : {}),
  };
  const shared = { model: draft.model, instrumental: draft.instrumental, maxMode: draft.maxMode, variety: draft.variety };
  const durationHint = draft.targetDuration.trim() ? `目标时长约 ${draft.targetDuration.trim()} 秒` : '';
  if (draft.mode === 'description') return { ...shared, mode: 'description', description: [draft.description.trim(),durationHint].filter(Boolean).join('\n') };
  return {
    ...shared, mode: 'custom', title: draft.title.trim(), lyrics: draft.instrumental ? '' : draft.lyrics.trim(), style: [draft.style.trim(),durationHint].filter(Boolean).join(', '),
    negativeStyle: draft.negativeStyle.trim(), styleWeight: draft.styleWeight, weirdness: draft.weirdness,
    ...(!draft.instrumental && (draft.vocalGender === 'm' || draft.vocalGender === 'f') ? { vocalGender: draft.vocalGender } : {}),
  };
}
export function musicDraftIssue(draft: MusicDraft): string {
  if (draft.mode !== 'sounds' && draft.targetDuration && (!Number.isFinite(Number(draft.targetDuration)) || Number(draft.targetDuration) <= 0 || Number(draft.targetDuration) > 480)) return '目标时长需在 1–480 秒之间。';
  if (draft.mode === 'description' && !draft.description.trim()) return '先描述你想创作的音乐。';
  if (draft.mode === 'custom' && !draft.style.trim()) return '填写音乐风格，或选择一个风格标签。';
  if (draft.mode === 'custom' && !draft.instrumental && !draft.lyrics.trim()) return '填写歌词，或切换为纯音乐。';
  if (draft.mode === 'sounds' && !draft.soundDescription.trim()) return '描述需要的音效或循环片段。';
  if (draft.mode === 'sounds' && draft.bpm && (!Number.isFinite(Number(draft.bpm)) || Number(draft.bpm) <= 0 || Number(draft.bpm) > 999)) return 'BPM 需要在 1–999 之间。';
  return '';
}
export function musicRecordDraft(input: MusicGenerateInput): Partial<MusicDraft> {
  if (input.mode === 'sounds') return { mode: input.mode, model: input.model, soundDescription: input.description, title: input.title ?? '', loop: input.loop, bpm: input.bpm ? String(input.bpm) : '', key: input.key ?? '' };
  if (input.mode === 'description') return { ...input };
  return { ...input, negativeStyle: input.negativeStyle ?? '', vocalGender: input.vocalGender ?? '', styleWeight: input.styleWeight ?? 0.5, weirdness: input.weirdness ?? 0.5 };
}
export type MusicLibraryRow = { record: MusicLabRecord; track?: MusicTrack; id: string };
export function musicLibraryRows(records: MusicLabRecord[], query = '', filter = 'all', sort = 'newest'): MusicLibraryRow[] {
  const rows = records.flatMap((record): MusicLibraryRow[] => record.tracks.length
    ? record.tracks.map((track) => ({ record, track, id: track.id })) : [{ record, id: record.id }]);
  const needle = query.trim().toLocaleLowerCase();
  return rows.filter(({ record, track }) => {
    const matches = !needle || [track?.title, track?.style, track?.lyrics, record.input.mode === 'custom' ? record.input.title : record.input.description].join(' ').toLocaleLowerCase().includes(needle);
    if (!matches) return false;
    if (filter === 'completed') return track?.status === 'completed';
    if (filter === 'active') return record.status === 'processing' || record.status === 'submitting';
    if (filter === 'saved') return !!(track?.localMp3Path || track?.localWavPath);
    if (filter === 'upload') return record.origin === 'upload';
    if (filter === 'generated') return !record.origin || record.origin === 'generated' || record.origin === 'history';
    if (filter === 'remix') return !!record.operation && !['separate','vocal-removal'].includes(record.operation.operation);
    if (filter === 'stems') return !!track?.stemType || ['separate','vocal-removal'].includes(record.operation?.operation ?? '');
    return true;
  }).sort((a, b) => sort === 'title' ? (a.track?.title ?? '').localeCompare(b.track?.title ?? '', 'zh-CN') : b.record.createdAt.localeCompare(a.record.createdAt));
}
export function musicTime(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return '0:00';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
