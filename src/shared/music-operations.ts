import { z } from 'zod';
import { MUSIC_MODELS, musicLabTrackInputSchema, type MusicModel } from './music-lab';

const text = (max: number) => z.string().trim().max(max);
const source = z.array(musicLabTrackInputSchema).length(1);
const base = { model: z.enum(MUSIC_MODELS), sources: source, title: text(200).optional() };
const creative = {
  ...base, lyrics: text(30_000).optional(), style: text(5_000).optional(), negativeStyle: text(5_000).optional(),
  maxMode: z.boolean().optional(), variety: z.number().int().min(0).max(4).optional(),
};
const range = { startSeconds: z.number().finite().nonnegative(), endSeconds: z.number().finite().positive() };
const weight = z.number().finite().min(0).max(1).optional();
export const MUSIC_OPERATIONS = [
  'cover', 'extend', 'replace', 'add-instrumental', 'add-vocal', 'add-stem', 'mashup', 'sample', 'inspo',
  'crop', 'remove-section', 'fade', 'reverse', 'speed', 'separate', 'vocal-removal',
] as const;
export const musicOperationInputSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('cover'), ...creative, style: text(5_000).min(1), instrumental: z.boolean().optional(), audioWeight: weight, styleWeight: weight, weirdness: weight }).strict(),
  z.object({ operation: z.literal('extend'), ...creative, continueAt: z.number().finite().nonnegative() }).strict(),
  z.object({ operation: z.literal('replace'), ...creative, ...range, lyrics: text(30_000).min(1), contextLyrics: text(30_000).optional(), contextWindowLyrics: text(30_000).optional() }).strict(),
  z.object({ operation: z.literal('add-instrumental'), ...creative, audioWeight: weight, durationSec: z.number().int().min(1).max(480).optional() }).strict(),
  z.object({ operation: z.literal('add-vocal'), ...creative, lyrics: text(30_000).min(1) }).strict(),
  z.object({ operation: z.literal('add-stem'), ...creative, stemControlTags: text(120).min(1).refine((value) => !/[\r\n\t]/u.test(value), '请填写一行乐器指令。') }).strict(),
  z.object({ operation: z.literal('mashup'), ...creative, sources: z.array(musicLabTrackInputSchema).length(2), instrumental: z.boolean().optional() }).strict(),
  z.object({ operation: z.literal('sample'), ...creative, ...range }).strict(),
  z.object({ operation: z.literal('inspo'), ...creative, sources: z.array(musicLabTrackInputSchema).min(1).max(2), instrumental: z.boolean().optional() }).strict(),
  z.object({ operation: z.literal('crop'), ...base, ...range }).strict(),
  z.object({ operation: z.literal('remove-section'), ...base, ...range }).strict(),
  z.object({ operation: z.literal('fade'), ...base, direction: z.enum(['in', 'out']), durationSec: z.number().finite().positive() }).strict(),
  z.object({ operation: z.literal('reverse'), ...base }).strict(),
  z.object({ operation: z.literal('speed'), ...base, speedMultiplier: z.number().finite().positive().refine((value) => Math.abs(value * 10_000 - Math.round(value * 10_000)) < 0.000001, '倍速最多支持四位小数。'), keepPitch: z.boolean().optional() }).strict(),
  z.object({ operation: z.literal('separate'), ...base, stemMode: z.enum(['two', 'twelve']) }).strict(),
  z.object({ operation: z.literal('vocal-removal'), ...base }).strict(),
]).superRefine((input, ctx) => {
  if ('endSeconds' in input && input.endSeconds <= input.startSeconds) ctx.addIssue({ code: 'custom', path: ['endSeconds'], message: '结束时间必须晚于开始时间。' });
  const seen = new Set<string>();
  for (const item of input.sources) {
    const id = `${item.recordId}/${item.trackId}`;
    if (seen.has(id)) ctx.addIssue({ code: 'custom', path: ['sources'], message: '来源歌曲不能重复。' });
    seen.add(id);
  }
});
export type MusicOperationInput = z.infer<typeof musicOperationInputSchema>;
export type MusicOperation = MusicOperationInput['operation'];

export const musicUploadSourceInputSchema = z.object({
  audioPath: text(4096).min(1).refine((path) => !path.includes('\0') && (/^[A-Za-z]:[\\/]/u.test(path) || /^\/(?!\/)/u.test(path)), '请选择受管音频文件。'),
  title: text(200).optional(), model: z.enum(MUSIC_MODELS),
}).strict();
export type MusicUploadSourceInput = z.infer<typeof musicUploadSourceInputSchema>;
export interface MusicOperationSource {
  songId: string;
  title: string;
  audioUrl?: string;
  durationSec?: number;
}
export interface MusicHistorySyncResult {
  records: import('./music-lab').MusicLabRecord[];
  added: number;
  updated: number;
}
export interface MusicRemoteHistoryPage {
  tracks: (import('./music-provider').MusicRemoteTrack & { model?: MusicModel })[];
  hasMore: boolean;
}
export const MUSIC_OPERATION_LABELS: Record<MusicOperation, string> = {
  cover: '翻唱改编', extend: '续写', replace: '局部重写', 'add-instrumental': '添加伴奏', 'add-vocal': '添加人声',
  'add-stem': '添加乐器', mashup: '融合两曲', sample: '采样创作', inspo: '灵感创作', crop: '保留片段',
  'remove-section': '删除片段', fade: '淡入淡出', reverse: '倒放', speed: '变速', separate: '分轨', 'vocal-removal': '人声伴奏分离',
};
export function estimateMusicOperationCost(input: MusicOperationInput): number {
  if (input.operation === 'vocal-removal') return 0;
  if (input.operation === 'separate') return input.stemMode === 'twelve' ? 3 : 0.6;
  return 'maxMode' in input && input.maxMode ? 1.2 : 0.6;
}
