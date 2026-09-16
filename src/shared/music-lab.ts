import { z } from 'zod';
import type { MusicOperationInput } from './music-operations';

export const MUSIC_MODELS = ['suno-v6', 'suno-v6-wild', 'suno-v6-mini'] as const;
export type MusicModel = typeof MUSIC_MODELS[number];
export const MUSIC_PROVIDER_NAME = 'Suno-API';
export const MUSIC_PROVIDER_ID = 'suno-api';
export const musicLabRecordIdSchema = z.string().uuid();
const text = (max: number) => z.string().trim().max(max);
const common = {
  model: z.enum(MUSIC_MODELS),
  instrumental: z.boolean(),
  maxMode: z.boolean(),
  variety: z.number().int().min(0).max(4),
};
export const musicLabGenerateInputSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('description'), ...common, description: text(10_000).min(1) }).strict(),
  z.object({
    mode: z.literal('custom'), ...common, title: text(200), lyrics: text(30_000), style: text(5_000).min(1),
    negativeStyle: text(5_000).optional(), vocalGender: z.enum(['m', 'f']).optional(),
    styleWeight: z.number().finite().min(0).max(1).optional(), weirdness: z.number().finite().min(0).max(1).optional(),
  }).strict(),
  z.object({
    mode: z.literal('sounds'), model: z.enum(MUSIC_MODELS), description: text(10_000).min(1),
    title: text(200).optional(), loop: z.boolean(), bpm: z.number().finite().positive().max(999).optional(),
    key: text(40).optional(),
  }).strict(),
]);
export type MusicGenerateInput = z.infer<typeof musicLabGenerateInputSchema>;
export type MusicLabGenerateInput = MusicGenerateInput;
export const musicLabLyricsInputSchema = z.object({
  model: z.enum(MUSIC_MODELS), instruction: text(10_000).min(1), style: text(5_000).optional(), title: text(200).optional(),
}).strict();
export type MusicLyricsInput = z.infer<typeof musicLabLyricsInputSchema>;
export const musicLabBoostStyleInputSchema = z.object({
  model: z.enum(MUSIC_MODELS), style: text(5_000).min(1), lyrics: text(30_000).optional(), instrumental: z.boolean(),
}).strict();
export type MusicBoostStyleInput = z.infer<typeof musicLabBoostStyleInputSchema>;
export const musicLabTrackInputSchema = z.object({ recordId: musicLabRecordIdSchema, trackId: musicLabRecordIdSchema }).strict();
export type MusicTrackInput = z.infer<typeof musicLabTrackInputSchema>;
export const MUSIC_MEDIA_FORMATS = ['mp3','wav','lyrics','lrc','midi','cover','mp4'] as const;
export type MusicMediaFormat = typeof MUSIC_MEDIA_FORMATS[number];
export const musicLabDownloadInputSchema = musicLabTrackInputSchema.extend({ format: z.enum(MUSIC_MEDIA_FORMATS) }).strict();
export type MusicDownloadInput = z.infer<typeof musicLabDownloadInputSchema>;
export interface MusicServiceStatus { configured: boolean; providerName: string; profileId?: string; defaultModel?: MusicModel; enabled?: boolean; errorMessage?: string; }
export interface MusicBalance { balance: number; currency: 'CNY'; checkedAt: string; }
export interface MusicLyricsResult { lyrics: string; helperFree?: boolean; }
export interface MusicBoostStyleResult { style: string; helperFree?: boolean; }
export interface MusicTrack {
  id: string;
  songId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  providerStatus: string;
  title: string;
  lyrics: string;
  style: string;
  durationSec?: number;
  audioUrl?: string;
  imageUrl?: string;
  localMp3Path?: string;
  localWavPath?: string;
  mediaPaths?: Partial<Record<MusicMediaFormat,string>>;
  downloadStatus: 'none' | 'downloading' | 'completed' | 'failed';
  downloadError?: string;
  errorMessage?: string;
  bgmId?: string;
  sourceSongIds?: string[];
  stemType?: string;
}
export interface MusicLabRecord {
  id: string;
  providerId: string;
  providerName: string;
  model: MusicModel;
  input: MusicGenerateInput;
  operation?: MusicOperationInput;
  origin?: 'generated' | 'operation' | 'upload' | 'history';
  sourceUpload?: { fileName: string; localPath: string };
  status: 'submitting' | 'processing' | 'completed' | 'partial' | 'failed' | 'needs-recovery';
  tracks: MusicTrack[];
  estimatedCost: number;
  actualCost?: number;
  errorMessage: string;
  createdAt: string;
  updatedAt: string;
  lastPolledAt?: string;
  finishedAt: string | null;
}

export function estimateMusicCost(input: MusicGenerateInput): number {
  return input.mode !== 'sounds' && input.maxMode ? 1.2 : 0.6;
}
