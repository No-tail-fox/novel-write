import type { DirectorShot } from './DirectorDeskWorkspace';

export const DIRECTOR_TIMELINE_LANES = [
  { id: 'video', label: '视频 / 画面' },
  { id: 'dialogue', label: '对白 / 旁白' },
  { id: 'subtitle', label: '字幕' },
  { id: 'music', label: '音乐' },
  { id: 'sfx', label: '音效 / 环境' },
  { id: 'other', label: '其他音频' },
] as const;
const AUDIO_TRACK_LABELS: Record<string, string> = { dialogue: '对白', narration: '旁白', music: '音乐', sfx: '音效', ambience: '环境声', foley: '拟音', native: '视频原声' };
export type DirectorTimelineLane = typeof DIRECTOR_TIMELINE_LANES[number]['id'];
export interface DirectorTimelineItem {
  key: string;
  sourceId: string;
  shotId: string;
  lane: DirectorTimelineLane;
  startMs: number;
  endMs: number;
  label: string;
  detail: string;
  inspector: 'generate' | 'subtitle' | 'sound';
  editableSound?: boolean;
  muted?: boolean;
  thumbnail?: string;
  row: number;
}
export type TimelineShot = Pick<DirectorShot, 'id' | 'index' | 'title' | 'durationMs' | 'thumbnail' | 'videoUrl' | 'audioClips' | 'soundClips' | 'subtitleCues'>;

/** All media clocks are already episode-global. Never add the shot offset to them. */
export function projectDirectorTimeline(shots: readonly TimelineShot[]) {
  const items: DirectorTimelineItem[] = [];
  let offset = 0;
  for (const shot of shots) {
    const duration = Number.isFinite(shot.durationMs) ? Math.max(0, shot.durationMs) : 0;
    const end = offset + duration;
    const add = (item: Omit<DirectorTimelineItem, 'key' | 'shotId' | 'row'>) => {
      if (!Number.isFinite(item.startMs) || !Number.isFinite(item.endMs)) return;
      const startMs = Math.max(offset, item.startMs);
      const endMs = Math.min(end, item.endMs);
      if (endMs <= startMs) return;
      items.push({ ...item, startMs, endMs, key: JSON.stringify([shot.id, item.lane, item.sourceId]), shotId: shot.id, row: 0 });
    };
    add({ sourceId: shot.id, lane: 'video', startMs: offset, endMs: end, label: `${shot.index}. ${shot.title}`, detail: shot.videoUrl ? '视频已就绪' : shot.thumbnail ? '静态画面 · 视频未就绪' : '画面未就绪', thumbnail: shot.thumbnail, inspector: 'generate' });
    for (const cue of shot.subtitleCues ?? []) add({ sourceId: cue.id, lane: 'subtitle', startMs: cue.startMs, endMs: cue.endMs, label: cue.text, detail: '字幕', inspector: 'subtitle' });
    const soundIds = new Set<string>();
    for (const clip of shot.soundClips ?? []) {
      soundIds.add(clip.id);
      const preview = shot.audioClips?.find((audio) => audio.id === clip.id);
      const lane = clip.trackType === 'music' ? 'music' : ['dialogue', 'narration'].includes(clip.trackType) ? 'dialogue' : 'sfx';
      add({ sourceId: clip.id, lane, startMs: clip.startMs, endMs: clip.startMs + (clip.durationMs ?? clip.sourceDurationMs ?? preview?.durationMs ?? duration), label: clip.title, detail: `${AUDIO_TRACK_LABELS[clip.trackType] ?? '音频'}${clip.available ? '' : ' · 文件不可用'}${clip.available && !preview ? ' · 未接入当前预览' : ''}`, inspector: 'sound', editableSound: true, muted: clip.muted });
    }
    for (const clip of shot.audioClips ?? []) {
      if (soundIds.has(clip.id)) continue;
      const lane = clip.trackType === 'music' ? 'music' : clip.trackType === 'dialogue' || clip.trackType === 'narration' ? 'dialogue' : clip.trackType && ['sfx', 'ambience', 'foley'].includes(clip.trackType) ? 'sfx' : 'other';
      add({ sourceId: clip.id, lane, startMs: clip.startMs, endMs: clip.startMs + clip.durationMs, label: clip.trackType === 'native' ? '视频原声' : '预览音频', detail: `${AUDIO_TRACK_LABELS[clip.trackType ?? ''] ?? '未提供轨道类型'} · 仅定位`, inspector: 'generate', muted: clip.muted });
    }
    offset = end;
  }
  // Stack overlapping clips instead of hiding one behind another.
  for (const lane of DIRECTOR_TIMELINE_LANES) {
    const ends: number[] = [];
    for (const item of items.filter((item) => item.lane === lane.id).sort((a, b) => a.startMs - b.startMs)) {
      let row = ends.findIndex((end) => end <= item.startMs);
      if (row < 0) row = ends.length;
      item.row = row;
      ends[row] = item.endMs;
    }
  }
  return { items, durationMs: offset };
}

export function timelineTimeAtPixel(pixel: number, pixelsPerSecond: number, durationMs: number) {
  if (!Number.isFinite(pixel) || !Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) return 0;
  return Math.round(Math.max(0, Math.min(durationMs, pixel * 1000 / pixelsPerSecond)));
}
export function timelinePixelsAtTime(timeMs: number, pixelsPerSecond: number) {
  return timeMs * pixelsPerSecond / 1000;
}
export function timelineTimeLabel(ms: number) {
  const value = Math.max(0, Math.round(ms));
  return `${Math.floor(value / 60000).toString().padStart(2, '0')}:${Math.floor(value / 1000 % 60).toString().padStart(2, '0')}.${(value % 1000).toString().padStart(3, '0')}`;
}
