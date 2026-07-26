import type { MinimaxCloneVoice, MinimaxCloneVoiceInput } from './types';

export function mergeMinimaxCloneVoice(
  existing: MinimaxCloneVoice | null,
  input: MinimaxCloneVoiceInput,
  now = Date.now(),
): MinimaxCloneVoice {
  return {
    voiceId: input.voiceId.trim(),
    displayName: input.displayName.trim(),
    sourceAudioPath: input.sourceAudioPath.trim(),
    createdAt: existing?.createdAt ?? now,
    lastUsedAt: existing?.lastUsedAt ?? 0,
  };
}
