import { z } from 'zod';

export const CHARACTER_VOICE_SAMPLE_ASSET_PREFIX = 'character-voice-sample:';
export const CHARACTER_VOICE_SAMPLE_MAX_BYTES = 20 * 1024 * 1024;
export const CHARACTER_VOICE_SAMPLE_MAX_DURATION_MS = 60_000;
export const importCharacterVoiceSampleSchema = z.object({
  taskId: z.string().trim().min(1).max(256),
  characterId: z.string().trim().min(1).max(256),
  expectedUpdatedAt: z.string().datetime(),
}).strict();
export type ImportCharacterVoiceSampleInput = z.infer<typeof importCharacterVoiceSampleSchema>;
