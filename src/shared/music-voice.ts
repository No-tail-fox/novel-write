import { z } from 'zod';
import { MUSIC_MODELS, type MusicModel } from './music-lab';
const text = (max: number) => z.string().trim().max(max);
const task = { taskId: z.number().int().positive() };
export const musicVoiceRequestSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }).strict(),
  z.object({ action: z.literal('validate'), audioPath: text(4096).min(1), name: text(200).min(1), description: text(2000), style: text(500), language: text(20), start: z.number().finite().nonnegative(), end: z.number().finite().positive() }).strict(),
  z.object({ action: z.literal('verify'), ...task, audioPath: text(4096).min(1) }).strict(),
  ...(['refresh', 'check', 'regenerate', 'delete'] as const).map((action) => z.object({ action: z.literal(action), ...task }).strict()),
  z.object({ action: z.literal('generate'), ...task, model: z.enum(MUSIC_MODELS), prompt: text(30000).min(1), custom: z.boolean(), style: text(5000), title: text(200), maxMode: z.boolean(), variety: z.number().int().min(0).max(4), styleWeight: z.number().min(0).max(1), weirdness: z.number().min(0).max(1) }).strict(),
  z.object({ action: z.literal('poll'), jobId: z.string().uuid() }).strict(),
]).superRefine((input, ctx) => {
  if (input.action === 'validate' && input.end <= input.start) ctx.addIssue({ code: 'custom', message: '结束时间需要晚于开始时间。' });
  if (input.action === 'generate' && input.custom && (!input.style || !input.title)) ctx.addIssue({ code: 'custom', message: '高级人声创作需要标题与风格。' });
});
export type MusicVoiceRequest = z.infer<typeof musicVoiceRequestSchema>;
export interface MusicVoiceTask { id: number; name: string; description: string; style: string; language: string; status: string; validationText: string; available: boolean; voiceId: string; error: string; updatedAt: string; }
export interface MusicVoiceJob { id: string; requestId: string; voiceTaskId: number; model?: MusicModel; title: string; status: string; songIds: string[]; error: string; createdAt: string; }
export interface MusicVoiceState { voices: MusicVoiceTask[]; jobs: MusicVoiceJob[]; }
